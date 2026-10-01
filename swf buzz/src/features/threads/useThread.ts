import { computed, onUnmounted, ref, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import {
  applyDelete,
  applyEdit,
  emptyOverlays,
  renderTimeline,
  type MessageOverlays,
} from "@/features/messages/messageOverlay";
import { liveSince } from "@/features/messages/reconnectRepair";
import { compareMessages, newestCreatedAt } from "@/features/messages/messageCursor";
import { threadService, type ThreadData } from "./ThreadService";

/**
 * A thread timeline: root + replies, with edit/delete overlays folded in.
 *
 * The overlay mechanics are imported from `features/messages`, not reimplemented
 * — a thread reply is an ordinary channel message that happens to carry thread
 * markers, so "is this edited?" must be answered identically wherever it is
 * rendered. A second implementation here is how the panel and the feed would
 * drift into disagreeing about the same event.
 */
export function useThread(rootEventId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();

  const overlays = ref<MessageOverlays>(emptyOverlays());
  const overlayVersion = ref(0);

  function absorb(
    edits: ThreadData["edits"],
    deletes: ThreadData["deletes"],
  ): void {
    if (edits.length === 0 && deletes.length === 0) return;
    for (const edit of edits) applyEdit(overlays.value, edit);
    for (const del of deletes) applyDelete(overlays.value, del);
    overlayVersion.value += 1;
  }

  const query = useQuery({
    queryKey: computed(() => queryKeys.thread(toValue(rootEventId) ?? "")),
    queryFn: async () => {
      const data = await threadService.fetchThread(toValue(rootEventId) as string);
      absorb(data.edits, data.deletes);
      return data;
    },
    enabled: computed(() => !!toValue(rootEventId)),
  });

  /**
   * What the panel renders. The root is overlaid too: editing or deleting the
   * message a thread hangs off is legitimate, and leaving the root stale while
   * the replies updated would be the same bug one level up.
   */
  const thread = computed<ThreadData | undefined>(() => {
    void overlayVersion.value;
    const data = query.data.value;
    if (!data) return data;
    const [root] = data.root ? renderTimeline([data.root], overlays.value) : [];
    return {
      ...data,
      root: root ?? null,
      replies: renderTimeline(data.replies, overlays.value),
    };
  });

  watch(
    () => toValue(rootEventId),
    () => {
      // Overlays are thread-scoped for the same reason the channel's are
      // channel-scoped: a retained edit keyed by a colliding id would mask an
      // unrelated message in the next thread opened.
      overlays.value = emptyOverlays();
      overlayVersion.value += 1;
    },
  );

  let liveSub: ReturnType<typeof threadService.subscribeToThread> | null = null;

  function resubscribe(id: string | null): void {
    liveSub?.close();
    liveSub = null;
    if (!id) return;
    const data = queryClient.getQueryData<ThreadData>(queryKeys.thread(id));
    const channelId = data?.root?.channelId;
    // The subscription is channel-filtered, so it cannot open until the root is
    // known. The query's own `absorb` covers everything up to that point, and
    // this re-runs when the fetch resolves.
    if (!channelId) return;

    // Anchored to the newest reply held rather than wall-clock now, closing the
    // window between the fetch completing and the socket opening.
    const newest = newestCreatedAt(data?.replies ?? []);
    const since = liveSince(newest, Math.floor(Date.now() / 1000));

    liveSub = threadService.subscribeToThread(id, channelId, since, (event) => {
      if (event.type === "message") {
        // Re-checked here even though the service filters too. The subscription
        // is deliberately channel-wide (see ThreadService.subscribeToThread), so
        // "belongs to this thread" is the invariant protecting the thread cache
        // itself — it has to hold at the write, not only at the source.
        if (event.message.thread.rootId !== id) return;
        queryClient.setQueryData<ThreadData>(queryKeys.thread(id), (current) => {
          if (!current) return current;
          if (current.replies.some((m) => m.id === event.message.id)) return current;
          return {
            ...current,
            replies: [...current.replies, event.message].sort(compareMessages),
          };
        });
      } else if (event.type === "edit") {
        absorb([event.edit], []);
      } else {
        absorb([], [event.del]);
      }
    });
  }

  watch(
    () => toValue(rootEventId),
    (id) => resubscribe(id),
    { immediate: true },
  );

  // The root arrives with the fetch, and the channel-filtered subscription
  // cannot be opened before it. Re-running on data arrival is what actually
  // starts the live feed in the common case.
  watch(
    () => query.data.value?.root?.channelId,
    (channelId) => {
      if (channelId && !liveSub) resubscribe(toValue(rootEventId));
    },
  );

  onUnmounted(() => liveSub?.close());

  return {
    ...query,
    // Deliberately the overlaid view, matching useChannelMessages: every
    // consumer must see the same edited/deleted state for the same event.
    data: thread,
    rawThread: query.data,
    overlays,
  };
}
