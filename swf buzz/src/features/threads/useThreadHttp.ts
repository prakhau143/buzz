import { computed, onUnmounted, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { logError } from "@/services/errors";
import { threadServiceHttp, type HttpThread } from "./ThreadServiceHttp";
import { messageServiceHttp, messageFromDto, type HttpMessage } from "@/features/messages/MessageServiceHttp";
import { realtimeService } from "@/services/RealtimeService";

export const threadHttpQueryKeys = {
  thread: (rootMessageId: string) => ["http-thread", rootMessageId] as const,
  summaries: (rootMessageIds: string[]) => ["http-thread-summaries", ...rootMessageIds] as const,
};

/** A single thread panel's data — root + replies, live-updated via realtime. The new-backend equivalent of `useThread()`. */
export function useThreadHttp(rootMessageId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();
  const id = () => toValue(rootMessageId);

  const query = useQuery({
    queryKey: computed(() => threadHttpQueryKeys.thread(id() ?? "")),
    queryFn: () => threadServiceHttp.getThread(id() as string),
    enabled: computed(() => !!id()),
  });

  let unsubscribe: (() => void) | null = null;

  function resubscribe(currentId: string | null): void {
    unsubscribe?.();
    unsubscribe = null;
    if (!currentId) return;
    unsubscribe = realtimeService.onEvent((event) => {
      if (event.type !== "message.created") return;
      const message = messageFromDto(event.message as Parameters<typeof messageFromDto>[0]);
      if (message.rootMessageId !== currentId) return;
      queryClient.setQueryData<HttpThread>(threadHttpQueryKeys.thread(currentId), (current) => {
        if (!current) return current;
        if (current.replies.some((r) => r.id === message.id)) return current;
        return { ...current, replies: [...current.replies, message].sort((a, b) => a.seq - b.seq) };
      });
    });
  }

  watch(() => id(), resubscribe, { immediate: true });
  onUnmounted(() => unsubscribe?.());

  const replyMutation = useMutation({
    mutationFn: (content: string) => messageServiceHttp.send(query.data.value!.root.channelId, content, id()),
    onSuccess: (message) => {
      queryClient.setQueryData<HttpThread>(threadHttpQueryKeys.thread(id() as string), (current) => {
        if (!current) return current;
        if (current.replies.some((r) => r.id === message.id)) return current;
        return { ...current, replies: [...current.replies, message].sort((a, b) => a.seq - b.seq) };
      });
    },
    onError: (err) => logError("useThreadHttp.reply", err),
  });

  return {
    ...query,
    reply: replyMutation.mutateAsync,
    isReplying: replyMutation.isPending,
  };
}

/** Batched reply-count badges for a list of messages — the new-backend equivalent of `useThreadSummaries()`. */
export function useThreadSummariesHttp(messages: MaybeRefOrGetter<HttpMessage[]>) {
  const ids = computed(() => toValue(messages).map((m) => m.id));
  const query = useQuery({
    queryKey: computed(() => threadHttpQueryKeys.summaries(ids.value)),
    queryFn: () => threadServiceHttp.getThreadSummaries(ids.value),
    enabled: computed(() => ids.value.length > 0),
  });
  return computed(() => {
    const map = new Map<string, { replyCount: number; descendantCount: number }>();
    for (const summary of query.data.value ?? []) {
      map.set(summary.rootMessageId, {
        replyCount: summary.replyCount,
        descendantCount: summary.descendantCount,
      });
    }
    return map;
  });
}
