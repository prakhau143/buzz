import { computed, onUnmounted, ref, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useThreadIndexStore } from "@/stores/threadIndex";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useConnectionStore } from "@/stores/connection";
import { logError } from "@/services/errors";
import { messageService, type TimelinePage } from "./MessageService";
import { mergeMessages, newestCreatedAt, oldestCursor, type MessageCursor } from "./messageCursor";
import { backfillSince, liveSince } from "./reconnectRepair";
import {
  applyDelete,
  applyEdit,
  emptyOverlays,
  renderTimeline,
  type MessageOverlays,
} from "./messageOverlay";
import type { Message } from "@/types/domain";

/** A channel's message timeline — initial fetch via Vue Query, live-updated via a relay subscription. */
export function useChannelMessages(channelId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();
  const threadIndex = useThreadIndexStore();
  const connection = useConnectionStore();

  /**
   * Edit/delete overlays for the open channel.
   *
   * Held beside the message cache rather than folded into it, because the base
   * events must stay intact: an edit that arrives before the message it edits
   * (routine on a reconnect backfill) has to be retained and applied once the
   * target shows up, and an edit arriving out of order must not displace a
   * newer one. `overlayVersion` exists because a Map mutated in place is not
   * deeply reactive — bumping it is what re-renders the timeline.
   */
  const overlays = ref<MessageOverlays>(emptyOverlays());
  const overlayVersion = ref(0);

  function absorb(page: TimelinePage): void {
    if (page.edits.length === 0 && page.deletes.length === 0) return;
    for (const edit of page.edits) applyEdit(overlays.value, edit);
    for (const del of page.deletes) applyDelete(overlays.value, del);
    overlayVersion.value += 1;
  }

  const query = useQuery({
    queryKey: computed(() => queryKeys.channelMessages(toValue(channelId) ?? "")),
    queryFn: async () => {
      const id = toValue(channelId) as string;
      const page = await messageService.fetchMessages(id);
      // Thread rows are visible as soon as the messages are (see stores/threadIndex).
      threadIndex.absorb(id, page.summaries);
      absorb(page);
      // A page that lands after a channel switch must not become the new channel's cursor.
      if (toValue(channelId) === id) applyBounds(page);
      return page.messages;
    },
    enabled: computed(() => !!toValue(channelId)),
  });

  /**
   * What consumers render: base messages with overlays folded in. Deleted rows
   * are gone, edited rows carry the new text plus `editedAt`.
   */
  const timeline = computed<Message[]>(() => {
    void overlayVersion.value;
    return renderTimeline(query.data.value ?? [], overlays.value);
  });

  /**
   * `hasOlderMessages` starts optimistic and flips on the first empty older
   * page. That inference is only sound now that paging uses a `before_id`
   * keyset: the relay excludes the boundary itself, so an empty page really is
   * empty. Previously the client dropped the whole boundary second locally, so
   * a page made entirely of same-second messages looked empty and ended history
   * while history remained.
   */
  const hasOlderMessages = ref(true);
  const isLoadingOlder = ref(false);
  const olderMessagesError = ref(false);
  /** The relay's own next-page cursor (kind:39006), when the last page carried one. */
  let nextCursor: MessageCursor | null = null;

  /**
   * The channel window's kind:39006 is the authority on exhaustion — OLD BUZZ
   * never infers it from row counts. Pages without bounds leave the state as is.
   */
  function applyBounds(page: TimelinePage): void {
    if (page.hasMore === undefined) return;
    hasOlderMessages.value = page.hasMore;
    nextCursor = page.nextCursor ?? null;
  }

  watch(
    () => toValue(channelId),
    () => {
      hasOlderMessages.value = true;
      isLoadingOlder.value = false;
      olderMessagesError.value = false;
      nextCursor = null;
      // Overlays are channel-scoped; carrying another channel's edits across
      // would let a stale edit mask an unrelated message with a colliding id.
      overlays.value = emptyOverlays();
      overlayVersion.value += 1;
    },
  );

  function cached(id: string): Message[] {
    return queryClient.getQueryData<Message[]>(queryKeys.channelMessages(id)) ?? [];
  }

  /** The one write path into the timeline cache — merge is dedup + canonical order. */
  function commit(id: string, incoming: Message[]): void {
    if (incoming.length === 0) return;
    queryClient.setQueryData<Message[]>(queryKeys.channelMessages(id), (existing) =>
      mergeMessages(existing ?? [], incoming),
    );
  }

  async function loadOlder(): Promise<void> {
    const id = toValue(channelId);
    if (!id || isLoadingOlder.value || !hasOlderMessages.value) return;
    // Not simply `current[0]`: the cursor is the smallest createdAt and, among
    // ties, the LARGEST id — see oldestCursor().
    const cursor = nextCursor ?? oldestCursor(cached(id));
    if (!cursor) return;

    isLoadingOlder.value = true;
    olderMessagesError.value = false;
    try {
      const older = await messageService.fetchOlderMessages(id, cursor);
      threadIndex.absorb(id, older.summaries);
      absorb(older);
      if (toValue(channelId) === id) applyBounds(older);
      // Exhaustion is judged on base messages only: a page containing nothing
      // but edits/deletes still means there is no older *message* at this
      // cursor, and the cursor cannot advance past it either.
      if (older.messages.length === 0) {
        hasOlderMessages.value = false;
        return;
      }
      commit(id, older.messages);
    } catch (err) {
      logError("useChannelMessages.loadOlder", err);
      olderMessagesError.value = true;
    } finally {
      isLoadingOlder.value = false;
    }
  }

  let liveSub: ReturnType<typeof messageService.subscribeToChannel> | null = null;
  /** Guards against overlapping repairs when reconnects arrive in quick succession. */
  let repairing = false;

  function resubscribe(id: string | null): void {
    liveSub?.close();
    liveSub = null;
    if (!id) return;
    // Anchored to the newest message held, not to wall-clock now: that closes
    // the window between the history fetch completing and the socket opening.
    const since = liveSince(newestCreatedAt(cached(id)), Math.floor(Date.now() / 1000));
    liveSub = messageService.subscribeToChannel(id, since, (event) => {
      if (event.type === "message") {
        commit(id, [event.message]);
      } else if (event.type === "edit") {
        absorb({ messages: [], edits: [event.edit], deletes: [] });
      } else {
        absorb({ messages: [], edits: [], deletes: [event.del] });
      }
    });
  }

  /**
   * Reconnect gap repair. Re-issuing the original subscription is not enough:
   * its `since` was fixed when it was first opened, so it either replays the
   * entire session or — with the relay's page clamp — silently truncates.
   *
   * Instead, read forward from the newest message actually held, minus OLD
   * BUZZ's channel lookback. Overlap is expected and free: `commit` merges by
   * event id, so the same event arriving from both the backfill and the live
   * subscription renders once. No sleeps, no ordering assumptions.
   */
  async function repairGap(id: string): Promise<void> {
    if (repairing) return;
    const since = backfillSince(newestCreatedAt(cached(id)));
    if (since === null) {
      // Nothing held yet — a plain refetch is the correct repair.
      void query.refetch();
      return;
    }
    repairing = true;
    try {
      const page = await messageService.fetchMessagesSince(id, since);
      absorb(page);
      commit(id, page.messages);
    } catch (err) {
      logError("useChannelMessages.repairGap", err);
    } finally {
      repairing = false;
    }
  }

  watch(
    () => toValue(channelId),
    (id) => resubscribe(id),
    { immediate: true },
  );

  // A reconnect re-opens the socket, so the live subscription is re-anchored to
  // what we now hold and the gap is backfilled. Watching the transition into
  // "connected" (rather than every status change) keeps repeated reconnects
  // from stacking repairs.
  watch(
    () => connection.status,
    (status, previous) => {
      const id = toValue(channelId);
      if (!id || status !== "connected" || previous === "connected") return;
      resubscribe(id);
      void repairGap(id);
    },
  );

  onUnmounted(() => liveSub?.close());

  return {
    ...query,
    // `data` is deliberately the OVERLAID timeline, not the raw cache: every
    // consumer (feed, threads, summaries) must see the same edited/deleted view,
    // and giving them the base list would quietly reintroduce stale text.
    data: timeline,
    rawMessages: query.data,
    overlays,
    absorbTimelineEvents: absorb,
    loadOlder,
    hasOlderMessages,
    isLoadingOlder,
    olderMessagesError,
  };
}
