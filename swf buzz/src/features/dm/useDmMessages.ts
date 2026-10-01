import { computed, onUnmounted, ref, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useThreadIndexStore } from "@/stores/threadIndex";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useConnectionStore } from "@/stores/connection";
import { logError } from "@/services/errors";
import {
  mergeMessages,
  newestCreatedAt,
  oldestCursor,
  type MessageCursor,
} from "@/features/messages/messageCursor";
import { backfillSince, liveSince } from "@/features/messages/reconnectRepair";
import {
  applyDelete,
  applyEdit,
  emptyOverlays,
  renderTimeline,
  type MessageOverlays,
} from "@/features/messages/messageOverlay";
import type { TimelinePage } from "@/features/messages/MessageService";
import { dmService } from "./DmService";
import type { Message } from "@/types/domain";

/**
 * A DM conversation's message timeline.
 *
 * Deliberately the same shape as `useChannelMessages`, because a DM is a
 * channel on the wire and every correctness property 4A/4B established for
 * channels applies unchanged: keyset paging, canonical merge order, event-id
 * dedup, `since` anchored to the newest event held, reconnect gap backfill, and
 * edit/delete overlays folded in at render time.
 *
 * It routes through `DmService`/`DmTransport` rather than `MessageService`
 * directly (docs/DECISIONS.md D1.F) so the protocol boundary stays real — the
 * shared *mechanics* are imported from `features/messages`, but the wire calls
 * remain the transport's.
 */
export function useDmMessages(conversationId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();
  const threadIndex = useThreadIndexStore();
  const connection = useConnectionStore();

  const overlays = ref<MessageOverlays>(emptyOverlays());
  const overlayVersion = ref(0);

  function absorb(page: TimelinePage): void {
    if (page.edits.length === 0 && page.deletes.length === 0) return;
    for (const edit of page.edits) applyEdit(overlays.value, edit);
    for (const del of page.deletes) applyDelete(overlays.value, del);
    overlayVersion.value += 1;
  }

  const query = useQuery({
    queryKey: computed(() => queryKeys.dm(toValue(conversationId) ?? "")),
    queryFn: async () => {
      const id = toValue(conversationId) as string;
      const page = await dmService.fetchHistory(id);
      // Thread rows are visible as soon as the messages are (see stores/threadIndex).
      threadIndex.absorb(id, page.summaries);
      absorb(page);
      if (toValue(conversationId) === id) applyBounds(page);
      return page.messages;
    },
    enabled: computed(() => !!toValue(conversationId)),
  });

  const timeline = computed<Message[]>(() => {
    void overlayVersion.value;
    return renderTimeline(query.data.value ?? [], overlays.value);
  });

  const hasOlderMessages = ref(true);
  const isLoadingOlder = ref(false);
  const olderMessagesError = ref(false);
  /** The relay's next-page cursor (kind:39006) — same rule as `useChannelMessages`. */
  let nextCursor: MessageCursor | null = null;

  function applyBounds(page: TimelinePage): void {
    if (page.hasMore === undefined) return;
    hasOlderMessages.value = page.hasMore;
    nextCursor = page.nextCursor ?? null;
  }

  watch(
    () => toValue(conversationId),
    () => {
      hasOlderMessages.value = true;
      isLoadingOlder.value = false;
      olderMessagesError.value = false;
      nextCursor = null;
      // Conversation-scoped, for the same reason channels reset theirs: an edit
      // retained across a switch could mask an unrelated message whose id
      // collides.
      overlays.value = emptyOverlays();
      overlayVersion.value += 1;
    },
  );

  function cached(id: string): Message[] {
    return queryClient.getQueryData<Message[]>(queryKeys.dm(id)) ?? [];
  }

  function commit(id: string, incoming: Message[]): void {
    if (incoming.length === 0) return;
    queryClient.setQueryData<Message[]>(queryKeys.dm(id), (existing) =>
      mergeMessages(existing ?? [], incoming),
    );
  }

  async function loadOlder(): Promise<void> {
    const id = toValue(conversationId);
    if (!id || isLoadingOlder.value || !hasOlderMessages.value) return;
    const cursor = nextCursor ?? oldestCursor(cached(id));
    if (!cursor) return;

    isLoadingOlder.value = true;
    olderMessagesError.value = false;
    try {
      const older = await dmService.fetchOlder(id, cursor);
      threadIndex.absorb(id, older.summaries);
      absorb(older);
      if (toValue(conversationId) === id) applyBounds(older);
      if (older.messages.length === 0) {
        hasOlderMessages.value = false;
        return;
      }
      commit(id, older.messages);
    } catch (err) {
      logError("useDmMessages.loadOlder", err);
      olderMessagesError.value = true;
    } finally {
      isLoadingOlder.value = false;
    }
  }

  let liveSub: ReturnType<typeof dmService.subscribeToConversation> | null = null;
  let repairing = false;

  function resubscribe(id: string | null): void {
    liveSub?.close();
    liveSub = null;
    if (!id) return;
    const since = liveSince(newestCreatedAt(cached(id)), Math.floor(Date.now() / 1000));
    liveSub = dmService.subscribeToConversation(id, since, (event) => {
      if (event.type === "message") {
        commit(id, [event.message]);
      } else if (event.type === "edit") {
        absorb({ messages: [], edits: [event.edit], deletes: [] });
      } else {
        absorb({ messages: [], edits: [], deletes: [event.del] });
      }
    });
  }

  async function repairGap(id: string): Promise<void> {
    if (repairing) return;
    const since = backfillSince(newestCreatedAt(cached(id)));
    if (since === null) {
      void query.refetch();
      return;
    }
    repairing = true;
    try {
      const page = await dmService.fetchSince(id, since);
      absorb(page);
      commit(id, page.messages);
    } catch (err) {
      logError("useDmMessages.repairGap", err);
    } finally {
      repairing = false;
    }
  }

  watch(
    () => toValue(conversationId),
    (id) => resubscribe(id),
    { immediate: true },
  );

  watch(
    () => connection.status,
    (status, previous) => {
      const id = toValue(conversationId);
      if (!id || status !== "connected" || previous === "connected") return;
      resubscribe(id);
      void repairGap(id);
    },
  );

  onUnmounted(() => liveSub?.close());

  return {
    ...query,
    data: timeline,
    rawMessages: query.data,
    overlays,
    loadOlder,
    hasOlderMessages,
    isLoadingOlder,
    olderMessagesError,
  };
}
