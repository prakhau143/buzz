import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useSessionStore } from "@/stores/session";
import { useReadStateStore } from "@/stores/readState";
import { useDmList } from "@/features/dm/useDmList";
import type { InboxServerCategory } from "@/protocol/inbox";
import { fetchEventsOnce } from "@/services/relayQuery";
import { RENDERABLE_MESSAGE_KINDS } from "@/protocol/kinds";
import { inboxService } from "./InboxService";
import { buildInboxItems, isUnread, type InboxItem } from "./inboxModel";

/** OLD BUZZ refreshes the feed every 30 s (`get_feed` poll). */
const FEED_REFRESH_MS = 30_000;
/** How many of my own recent messages define "threads I am in". */
const MY_EVENTS_LIMIT = 300;

/**
 * The Inbox feed: the relay's three `feed_types` categories (one request each,
 * shared cache), merged and grouped by `inboxModel`, with unread computed from
 * the SAME read state channels use (NIP-RS kind 30078 frontier). Nothing here
 * is local-only except "mark unread", which is local by design in both SWF
 * (`readState.markUnreadFrom`) and OLD BUZZ (`buzz-forced-unread.v1`).
 */
export function useInboxFeed() {
  const session = useSessionStore();
  const readState = useReadStateStore();
  const enabled = computed(() => !!session.pubkey);

  const category = (name: InboxServerCategory) =>
    useQuery({
      queryKey: computed(() => queryKeys.inbox(`raw:${name}`)),
      queryFn: () => inboxService.fetchCategory(name, session.pubkey as string),
      enabled,
      staleTime: FEED_REFRESH_MS,
      refetchInterval: FEED_REFRESH_MS,
    });
  const mentions = category("mentions");
  const needsAction = category("needs_action");
  const activity = category("activity");
  // My own recent messages: the thread roots I authored or replied in, which is
  // what admits an `activity` reply to my Inbox (inboxModel SCOPING note).
  const mine = useQuery({
    queryKey: computed(() => queryKeys.inbox("raw:mine")),
    queryFn: () =>
      fetchEventsOnce([{ kinds: [...RENDERABLE_MESSAGE_KINDS], authors: [session.pubkey as string], limit: MY_EVENTS_LIMIT }]),
    enabled,
    staleTime: FEED_REFRESH_MS,
    refetchInterval: FEED_REFRESH_MS,
  });
  const { data: conversations } = useDmList();

  const dmChannelIds = computed(() => new Set((conversations.value ?? []).map((c) => c.id)));

  const items = computed<InboxItem[]>(() =>
    buildInboxItems(
      {
        mentions: mentions.data.value ?? [],
        needsAction: needsAction.data.value ?? [],
        activity: activity.data.value ?? [],
      },
      session.pubkey ?? "",
      dmChannelIds.value,
      mine.data.value ?? [],
    ),
  );

  // Reactive through `lastSeenAt` (read inside the getter), so rows update the
  // moment a channel is read anywhere in the app.
  const lastSeenFor = (channelId: string) => {
    readState.ensureLoaded();
    return readState.lastSeenAt[channelId] ?? 0;
  };
  const unread = (item: InboxItem) => isUnread(item, lastSeenFor);

  const isLoading = computed(() => mentions.isPending.value || needsAction.isPending.value || activity.isPending.value);
  /** Honest error: only when every source failed do we have nothing trustworthy to show. */
  const isError = computed(() => mentions.isError.value && needsAction.isError.value && activity.isError.value);
  const partialError = computed(
    () => !isError.value && (mentions.isError.value || needsAction.isError.value || activity.isError.value),
  );

  /** Refetch every source; resolves when all have settled (callers that don't care may ignore it). */
  function refetch(): Promise<unknown> {
    return Promise.all([mentions.refetch(), needsAction.refetch(), activity.refetch(), mine.refetch()]);
  }

  /** Advance the synced read frontier (channels and DMs share it) to this item. */
  function markRead(item: InboxItem): void {
    if (!item.channelId) return;
    readState.markChannelSeen(item.channelId, item.createdAt);
  }

  /** Local-only rewind (see header), exactly what the channel "Mark unread" action does. */
  function markUnread(item: InboxItem): void {
    if (!item.channelId) return;
    readState.markUnreadFrom(item.channelId, item.createdAt, Math.max(1, readState.unreadCounts[item.channelId] ?? 0));
  }

  /** One frontier advance per channel, to the newest listed item in it. */
  function markAllRead(list: InboxItem[]): void {
    const newest = new Map<string, InboxItem>();
    for (const item of list) {
      if (!item.channelId || !unread(item)) continue;
      const held = newest.get(item.channelId);
      if (!held || held.createdAt < item.createdAt) newest.set(item.channelId, item);
    }
    for (const item of newest.values()) markRead(item);
  }

  return { items, unread, isLoading, isError, partialError, refetch, markRead, markUnread, markAllRead };
}
