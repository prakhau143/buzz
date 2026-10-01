import { computed, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import { nip19 } from "nostr-tools";
import { useSessionStore } from "@/stores/session";
import { useReadStateStore } from "@/stores/readState";
import { useUiStore } from "@/stores/ui";
import { useDmList } from "@/features/dm/useDmList";
import { useChannels } from "@/features/channels/useChannels";
import { useInboxFeed } from "@/features/inbox/useInboxFeed";
import { useUnreadTracking } from "@/features/readState/useUnreadTracking";
import { activeRelayUrl } from "@/features/communities/relayCommunities";
import { communitySessionGeneration } from "@/features/communities/communitySession";
import { profileFor } from "@/features/profile/profileStore";
import { profileService } from "@/services/ProfileService";
import { shortKey } from "@/features/identity/format";
import { useCommunitySwitch } from "@/features/communities/useCommunitySwitch";
import { useIsMobile } from "@/features/mobile/breakpoints";
import { fromNotificationTarget } from "@/features/navigation/messageTarget";
import { useOpenMessageTarget } from "@/features/navigation/useOpenMessageTarget";
import type { Message } from "@/types/domain";
import { useNotificationSettings } from "./notificationSettings";
import { alertIfAllowed, setTaskbarIndicator } from "./desktopNotifier";
import { clearInAppToasts, setInAppToastOpener } from "./inAppToasts";
import {
  NotificationLedger,
  classifyMessage,
  identityFingerprint,
  isFresh,
  ledgerKey,
  messageTarget,
  needsActionBody,
  needsAttention,
  notificationContext,
  notificationTitle,
  parseNotificationTarget,
  safePreview,
  targetRoute,
  type NotificationTarget,
} from "./notificationEngine";

/** Emitted by the native layer when a toast is clicked (src-tauri/src/notifications.rs). */
export const NOTIFICATION_ACTIVATED_EVENT = "swf-notification-activated";

/**
 * The conversation on screen, reported by the sidebar of the channel/DM views.
 * `null` everywhere else (Settings, Inbox) — nothing is "being viewed" there.
 */
const activeConversationId = ref<string | null>(null);
let activeOwner = 0;

/** Called by AppSidebar: keep the viewed conversation current while it is mounted. */
export function useReportActiveConversation(getter: () => string | null): void {
  const owner = ++activeOwner;
  watch(getter, (id) => {
    if (owner === activeOwner) activeConversationId.value = id;
  }, { immediate: true });
  onUnmounted(() => {
    // Only the most recent reporter clears it (a view swap mounts the next first).
    if (owner === activeOwner) activeConversationId.value = null;
  });
}

const NAME_LOOKUP_MS = 1500;
/** The Inbox screen on desktop and on mobile. */
const INBOX_ROUTES: ReadonlySet<string> = new Set(["inbox", "mobile-inbox"]);

/**
 * The ONE notification service, mounted by app/SessionServices.vue for the
 * whole signed-in session — so alerts, unread tracking and the taskbar dot keep
 * working in full-screen Settings, the Inbox and every other route.
 *
 * Pipeline per event: classify → freshness → ledger (dedup) → settings policy
 * (`shouldAlert` inside `alertIfAllowed`) → native toast with a click target.
 */
export function useNotificationService(): void {
  const session = useSessionStore();
  const readState = useReadStateStore();
  const ui = useUiStore();
  const router = useRouter();
  const { settings } = useNotificationSettings(() => session.pubkey);
  const { data: conversations } = useDmList();
  const { data: channels } = useChannels();
  const inboxFeed = useInboxFeed();
  const ledger = new NotificationLedger();
  /** What the taskbar currently shows (null = not set yet this session). */
  let lastIndicator: boolean | null = null;

  const dmIds = computed(() => new Set((conversations.value ?? []).map((c) => c.id)));

  // Identity isolation: a new identity starts with a clean ledger and no dot.
  watch(
    () => session.pubkey,
    (next, previous) => {
      if (next === previous) return;
      ledger.clear();
      void setTaskbarIndicator(false);
      lastIndicator = false;
      clearInAppToasts();
    },
  );

  // ---------- classify → policy → action (messages) ----------
  const nameOfRef = (ref: string): string | null => {
    try {
      const decoded = nip19.decode(ref);
      const pubkey = decoded.type === "npub" ? decoded.data : decoded.type === "nprofile" ? decoded.data.pubkey : null;
      return pubkey ? (profileFor(pubkey)?.displayName ?? null) : null;
    } catch {
      return null;
    }
  };

  async function authorName(pubkey: string): Promise<string> {
    const known = profileFor(pubkey)?.displayName;
    if (known) return known;
    // Canonical profile, fetched once if this person hasn't been seen yet.
    await Promise.race([
      profileService.fetchProfiles([pubkey]).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, NAME_LOOKUP_MS)),
    ]);
    return profileFor(pubkey)?.displayName ?? shortKey(pubkey);
  }

  async function onMessage(message: Message, viewing: boolean): Promise<void> {
    const me = session.pubkey;
    if (!me) return;
    const community = activeRelayUrl.value;
    const isDm = dmIds.value.has(message.channelId);
    const slot = classifyMessage(message, { me, isDm });
    if (!slot) return;
    if (!isFresh(message.createdAt)) return; // reconnect/resubscribe replay: history, not news
    if (!ledger.claim(ledgerKey(me, community, message.id))) return; // already alerted
    const author = await authorName(message.authorPubkey);
    // The identity or community may have changed while the name resolved.
    if (session.pubkey !== me || activeRelayUrl.value !== community) return;
    const channelName = isDm ? null : (channels.value ?? []).find((c) => c.id === message.channelId)?.name;
    await alertIfAllowed({
      slot,
      title: notificationTitle(slot, author, channelName),
      body: safePreview(message.content, { nameOf: nameOfRef, attachments: message.attachments.length }),
      viewing,
      target: messageTarget(message, { identity: me, community, isDm }),
      inApp: {
        id: message.id,
        // Reached only through @everyone (not named): say so, rather than "Mentioned you".
        context:
          slot === "mention" && message.mentionsEveryone && !message.mentions.includes(me)
            ? `${channelName ? `#${channelName}` : "Channel"} · Mentioned @everyone`
            : notificationContext(slot, channelName),
        authorPubkey: message.authorPubkey,
        authorName: author,
        createdAt: message.createdAt,
        mentions: message.mentions,
        mentionsEveryone: !!message.mentionsEveryone,
      },
    });
  }

  // One live tracker for channels AND DMs (a DM is a channel on the wire); it
  // also maintains the unread counts, so those keep counting in Settings too.
  useUnreadTracking(() => activeConversationId.value, (message, { viewing }) => {
    void onMessage(message, viewing);
  });

  // ---------- needs-action (Inbox requests / reminders) ----------
  let needsActionSeeded = false;
  // Each community's feed is seeded on its own first load.
  watch(communitySessionGeneration, () => {
    needsActionSeeded = false;
  });
  watch(
    () => [inboxFeed.items.value, session.pubkey] as const,
    ([items, me]) => {
      if (!me) return;
      const actionable = items.filter((i) => i.type === "needs_action" || i.type === "reminder");
      const community = activeRelayUrl.value;
      if (!needsActionSeeded) {
        // What was already there when the feed first loaded is not news.
        if (inboxFeed.isLoading.value) return;
        actionable.forEach((i) => ledger.claim(ledgerKey(me, community, i.event.id)));
        needsActionSeeded = true;
        return;
      }
      for (const item of actionable) {
        if (!isFresh(item.event.created_at)) continue;
        if (!ledger.claim(ledgerKey(me, community, item.event.id))) continue;
        void (async () => {
          const author = await authorName(item.event.pubkey);
          if (session.pubkey !== me || activeRelayUrl.value !== community) return;
          const reminder = item.type === "reminder";
          await alertIfAllowed({
            slot: "needs_action",
            title: notificationTitle("needs_action", author),
            body: needsActionBody(author, safePreview(item.event.content, { nameOf: nameOfRef }), reminder),
            inApp: {
              id: item.event.id,
              context: notificationContext("needs_action", null, reminder),
              authorPubkey: item.event.pubkey,
              authorName: author,
              createdAt: item.event.created_at,
            },
            // The Inbox on either tier is where this request already shows.
            viewing: INBOX_ROUTES.has(String(router.currentRoute.value.name ?? "")),
            target: { v: "1", identity: identityFingerprint(me), community, kind: "inbox", item: item.key },
          });
        })();
      }
    },
  );

  // ---------- taskbar overlay ----------
  const attention = computed(() => {
    if (!settings.value.taskbarIndicator || !readState.isReady) return false;
    const needsActionUnread = inboxFeed.items.value.filter(
      (i) => (i.type === "needs_action" || i.type === "reminder") && inboxFeed.unread(i),
    ).length;
    return needsAttention({
      unread: readState.unreadCounts,
      hasMention: readState.hasMention,
      dmIds: dmIds.value,
      needsActionUnread,
    });
  });
  watch(
    attention,
    (show) => {
      if (show === lastIndicator) return; // only touch the taskbar on a change
      lastIndicator = show;
      void setTaskbarIndicator(show);
    },
    { immediate: true },
  );
  // Sign-out / session end unmounts this service: never leave a dot behind.
  onUnmounted(() => {
    lastIndicator = false;
    void setTaskbarIndicator(false);
    clearInAppToasts();
  });

  // ---------- click routing ----------
  // Channel / DM targets go through THE deep-link opener (features/navigation):
  // the shared, membership-verified community switch, then the exact message
  // on the current tier (desktop reveal or the mobile conversation/thread).
  const { openMessageTarget } = useOpenMessageTarget();
  const { switchTo } = useCommunitySwitch();
  const isMobile = useIsMobile();
  async function openTarget(target: NotificationTarget): Promise<void> {
    const me = session.pubkey;
    // A toast from another identity is never routed into this one.
    if (!me || identityFingerprint(me) !== target.identity) return;
    const message = fromNotificationTarget(target);
    if (message) {
      await openMessageTarget(message);
      return;
    }
    if (target.kind !== "inbox") return; // incomplete channel/DM target: never guessed
    if (target.community !== activeRelayUrl.value) {
      if (!(await switchTo(target.community)) || activeRelayUrl.value !== target.community) return;
      ui.clearChannelRestore();
    }
    await router.push(isMobile.value ? { name: "mobile-inbox" } : targetRoute(target));
  }

  // In-app toasts route through the same guarded opener as Windows toasts.
  setInAppToastOpener(openTarget);
  onUnmounted(() => setInAppToastOpener(null));

  if (isTauri()) {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>(NOTIFICATION_ACTIVATED_EVENT, (event) => {
        const target = parseNotificationTarget(event.payload);
        if (target) void openTarget(target);
      }).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      }),
    );
    onUnmounted(() => {
      disposed = true;
      unlisten?.();
    });
  }
}
