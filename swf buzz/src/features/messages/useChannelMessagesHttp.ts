import { computed, onUnmounted, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { logError } from "@/services/errors";
import { messageServiceHttp, messageFromDto, type HttpMessage } from "./MessageServiceHttp";
import { realtimeService, type RealtimeEventPayload } from "@/services/RealtimeService";

export const messageHttpQueryKeys = {
  list: (channelId: string) => ["http-channel-messages", channelId] as const,
};

function isMessageCreatedFor(event: RealtimeEventPayload, channelId: string): event is Extract<
  RealtimeEventPayload,
  { type: "message.created" }
> {
  return event.type === "message.created" && event.channel_id === channelId;
}

/**
 * A channel's message timeline — initial fetch via Vue Query, live-updated
 * via `RealtimeService`. The new-backend equivalent of
 * `useChannelMessages()`. Only top-level messages (`parentMessageId ===
 * null`) are included — replies belong to a thread panel via
 * `useThreadHttp`, mirroring how the old `useThreadSummaries` keeps
 * replies out of the main timeline.
 */
export function useChannelMessagesHttp(channelId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();
  const id = () => toValue(channelId);

  const query = useQuery({
    queryKey: computed(() => messageHttpQueryKeys.list(id() ?? "")),
    queryFn: () => messageServiceHttp.list(id() as string),
    enabled: computed(() => !!id()),
    select: (messages: HttpMessage[]) => messages.filter((m) => m.parentMessageId === null),
  });

  let unsubscribe: (() => void) | null = null;

  function resubscribe(currentId: string | null): void {
    unsubscribe?.();
    unsubscribe = null;
    if (!currentId) return;
    unsubscribe = realtimeService.onEvent((event) => {
      if (!isMessageCreatedFor(event, currentId)) return;
      const message = messageFromDto(event.message as Parameters<typeof messageFromDto>[0]);
      if (message.parentMessageId !== null) return; // replies handled by the thread panel, not the main timeline
      queryClient.setQueryData<HttpMessage[]>(messageHttpQueryKeys.list(currentId), (current) => {
        if (!current) return [message];
        if (current.some((m) => m.id === message.id)) return current;
        return [...current, message].sort((a, b) => a.seq - b.seq);
      });
    });
  }

  watch(() => id(), resubscribe, { immediate: true });
  onUnmounted(() => unsubscribe?.());

  const sendMutation = useMutation({
    mutationFn: (params: { content: string; parentMessageId?: string | null }) =>
      messageServiceHttp.send(id() as string, params.content, params.parentMessageId),
    onSuccess: (message) => {
      if (message.parentMessageId !== null) return; // a reply belongs in the thread panel's own cache, not here
      queryClient.setQueryData<HttpMessage[]>(messageHttpQueryKeys.list(id() as string), (current) => {
        if (!current) return [message];
        if (current.some((m) => m.id === message.id)) return current;
        return [...current, message].sort((a, b) => a.seq - b.seq);
      });
    },
    onError: (err) => logError("useChannelMessagesHttp.send", err),
  });

  return {
    ...query,
    send: sendMutation.mutateAsync,
    isSending: sendMutation.isPending,
    sendError: sendMutation.error,
  };
}
