import { computed, onUnmounted, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useSessionStore } from "@/stores/session";
import { logError } from "@/services/errors";
import {
  dmServiceHttp,
  dmMessageFromDto,
  type HttpDmConversation,
  type HttpDmMessage,
} from "./DmServiceHttp";
import { realtimeService, type RealtimeEventPayload } from "@/services/RealtimeService";

export const dmHttpQueryKeys = {
  conversations: ["http-dm-conversations"] as const,
  messages: (conversationId: string) => ["http-dm-messages", conversationId] as const,
};

function isDmMessageCreatedFor(
  event: RealtimeEventPayload,
  conversationId: string,
): event is Extract<RealtimeEventPayload, { type: "dm_message.created" }> {
  return event.type === "dm_message.created" && event.conversation_id === conversationId;
}

/**
 * The caller's DM conversations — initial fetch via Vue Query, plus an
 * `open` mutation for starting (or idempotently re-opening) one. This is
 * the new-backend equivalent of `useOpenDm()`/`dmService.discoverConversations()`
 * combined — there is no separate live-discovery subscription here because,
 * unlike the old kind:39000 mechanism, a newly-opened conversation is
 * already known to the caller who opened it (no third party can add you to
 * one, per `backend/src/routes/dm.rs::open_dm`), so a manual refetch/
 * `queryClient.invalidateQueries` after `open()` is sufficient.
 */
export function useConversationsHttp() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: dmHttpQueryKeys.conversations,
    queryFn: () => dmServiceHttp.listConversations(),
  });

  const openMutation = useMutation({
    mutationFn: (otherUserIds: string[]) => {
      const session = useSessionStore();
      const myUserId = session.applicationUser?.id;
      if (!myUserId) throw new Error("not signed in");
      const uniqueIds = [...new Set([myUserId, ...otherUserIds])];
      return dmServiceHttp.open(uniqueIds);
    },
    onSuccess: (conversation) => {
      queryClient.setQueryData<HttpDmConversation[]>(dmHttpQueryKeys.conversations, (current) => {
        if (!current) return [conversation];
        if (current.some((c) => c.id === conversation.id)) return current;
        return [conversation, ...current];
      });
    },
    onError: (err) => logError("useConversationsHttp.open", err),
  });

  return {
    ...query,
    open: openMutation.mutateAsync,
    isOpening: openMutation.isPending,
    openError: openMutation.error,
  };
}

/**
 * A single conversation's message timeline — initial fetch via Vue Query,
 * live-updated via `RealtimeService`. The new-backend equivalent of
 * `dmService.fetchHistory()`/`subscribeToConversation()`.
 */
export function useDmMessagesHttp(conversationId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();
  const id = () => toValue(conversationId);

  const query = useQuery({
    queryKey: computed(() => dmHttpQueryKeys.messages(id() ?? "")),
    queryFn: () => dmServiceHttp.listMessages(id() as string),
    enabled: computed(() => !!id()),
  });

  let unsubscribe: (() => void) | null = null;

  function resubscribe(currentId: string | null): void {
    unsubscribe?.();
    unsubscribe = null;
    if (!currentId) return;
    unsubscribe = realtimeService.onEvent((event) => {
      if (!isDmMessageCreatedFor(event, currentId)) return;
      const message = dmMessageFromDto(event.message as Parameters<typeof dmMessageFromDto>[0]);
      queryClient.setQueryData<HttpDmMessage[]>(dmHttpQueryKeys.messages(currentId), (current) => {
        if (!current) return [message];
        if (current.some((m) => m.id === message.id)) return current;
        return [...current, message].sort((a, b) => a.seq - b.seq);
      });
    });
  }

  watch(() => id(), resubscribe, { immediate: true });
  onUnmounted(() => unsubscribe?.());

  const sendMutation = useMutation({
    mutationFn: (content: string) => dmServiceHttp.send(id() as string, content),
    onSuccess: (message) => {
      queryClient.setQueryData<HttpDmMessage[]>(dmHttpQueryKeys.messages(id() as string), (current) => {
        if (!current) return [message];
        if (current.some((m) => m.id === message.id)) return current;
        return [...current, message].sort((a, b) => a.seq - b.seq);
      });
    },
    onError: (err) => logError("useDmMessagesHttp.send", err),
  });

  return {
    ...query,
    send: sendMutation.mutateAsync,
    isSending: sendMutation.isPending,
    sendError: sendMutation.error,
  };
}

/**
 * Opens (or re-opens) a DM with the given other participant(s) and returns
 * the conversation id — the new-backend equivalent of `useOpenDm()`, for
 * wiring a "Message" action on a user's profile. Intentionally the same
 * shape (`{ open, isOpening }`) as the old `useOpenDm()` so a future
 * profile-panel component can switch between them with a one-line import
 * change once a `userId`-keyed profile panel exists (none of the current
 * HTTP-backed views expose one yet — see this phase's report).
 */
export function useOpenDmHttp() {
  const queryClient = useQueryClient();
  const session = useSessionStore();

  const mutation = useMutation({
    mutationFn: (otherUserId: string) => {
      const myUserId = session.applicationUser?.id;
      if (!myUserId) throw new Error("not signed in");
      return dmServiceHttp.open([myUserId, otherUserId]);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dmHttpQueryKeys.conversations });
    },
    onError: (err) => logError("useOpenDmHttp", err),
  });

  return { open: mutation.mutateAsync, isOpening: mutation.isPending };
}
