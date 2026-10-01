import { computed, nextTick, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUiStore } from "@/stores/ui";
import { useNavHistoryStore, type NavEntry } from "@/stores/navHistory";
import { activeRelayUrl } from "@/features/communities/relayCommunities";
import { useShortcut } from "@/features/shortcuts/useShortcuts";

/**
 * Header Back / Forward over the app's own history (`stores/navHistory`).
 *
 * Records a destination whenever the open channel, DM or thread changes —
 * derived from the route (`/channels?channelId`, `/dm?conversationId`) and the
 * open thread panel, tagged with the active community. Everything else (auth,
 * loading, modals, typing, presence, read state) never reaches the history
 * because it never changes those three things.
 *
 * Call once, from the persistent header.
 */
let applying = false;

export function useAppNavigation() {
  const route = useRoute();
  const router = useRouter();
  const ui = useUiStore();
  const history = useNavHistoryStore();

  /** The open channel/DM as a key (`c:<id>` / `d:<id>`), or null elsewhere. */
  const parentKey = computed<string | null>(() => {
    const q = route.query;
    if (route.name === "channels") {
      const id = (typeof q.channelId === "string" && q.channelId) || ui.selectedChannelId;
      return id ? `c:${id}` : null;
    }
    if (route.name === "dm") {
      const id = (typeof q.conversationId === "string" && q.conversationId) || ui.selectedConversationId;
      return id ? `d:${id}` : null;
    }
    return null;
  });

  // A thread belongs to the channel/DM it was opened in. The panel state can
  // outlive a route change for a tick, so a thread only counts while we're
  // still where it was opened (otherwise "DM + stale thread" would be recorded).
  let threadOwner: string | null = null;
  watch(
    () => ui.openThreadRootId,
    (root) => (threadOwner = root ? parentKey.value : null),
  );

  function currentEntry(): NavEntry | null {
    const community = activeRelayUrl.value;
    const key = parentKey.value;
    if (!community || !key) return null;
    const id = key.slice(2);
    const root = ui.openThreadRootId;
    const parent = key.startsWith("c:") ? "channel" : "dm";
    if (root && threadOwner === key) return { type: "thread", community, parent, parentId: id, rootEventId: root };
    return parent === "channel" ? { type: "channel", community, channelId: id } : { type: "dm", community, conversationId: id };
  }

  // Triggered by where you are (route / thread) — never by the community alone,
  // so an active-community change doesn't re-label the old channel as a visit.
  watch(
    [() => route.fullPath, () => ui.openThreadRootId],
    () => {
      if (applying) return;
      const entry = currentEntry();
      if (entry) history.record(entry);
    },
    { immediate: true, flush: "post" },
  );

  const community = computed(() => activeRelayUrl.value ?? null);
  const canGoBack = computed(() => !!history.peek(-1, community.value));
  const canGoForward = computed(() => !!history.peek(1, community.value));

  async function apply(entry: NavEntry): Promise<void> {
    applying = true;
    try {
      if (entry.type === "channel") {
        await router.push({ name: "channels", query: { channelId: entry.channelId } });
        ui.closeContextPanel();
      } else if (entry.type === "dm") {
        await router.push({ name: "dm", query: { conversationId: entry.conversationId } });
        ui.closeContextPanel();
      } else {
        await router.push(
          entry.parent === "channel"
            ? { name: "channels", query: { channelId: entry.parentId } }
            : { name: "dm", query: { conversationId: entry.parentId } },
        );
        await nextTick();
        ui.openThread(entry.rootEventId);
      }
      await nextTick();
    } finally {
      applying = false;
    }
  }

  async function go(step: -1 | 1): Promise<void> {
    const target = history.peek(step, community.value);
    if (!target) return;
    history.moveTo(target.index);
    await apply(target.entry);
  }

  const back = () => go(-1);
  const forward = () => go(1);

  // Alt+Left / Alt+Right, from the shortcut registry (consumed there, so the
  // webview's own history doesn't also move).
  useShortcut("go-back", () => void back());
  useShortcut("go-forward", () => void forward());

  return { canGoBack, canGoForward, back, forward };
}
