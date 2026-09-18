import { computed, onUnmounted, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { threadService, type ThreadData } from "./ThreadService";

export function useThread(rootEventId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: computed(() => queryKeys.thread(toValue(rootEventId) ?? "")),
    queryFn: () => threadService.fetchThread(toValue(rootEventId) as string),
    enabled: computed(() => !!toValue(rootEventId)),
  });

  let liveSub: ReturnType<typeof threadService.subscribeToThread> | null = null;

  function resubscribe(id: string | null): void {
    liveSub?.close();
    liveSub = null;
    if (!id) return;
    liveSub = threadService.subscribeToThread(id, (reply) => {
      queryClient.setQueryData<ThreadData>(queryKeys.thread(id), (current) => {
        if (!current) return current;
        if (current.replies.some((m) => m.id === reply.id)) return current;
        return {
          ...current,
          replies: [...current.replies, reply].sort((a, b) => a.createdAt - b.createdAt),
        };
      });
    });
  }

  watch(
    () => toValue(rootEventId),
    (id) => resubscribe(id),
    { immediate: true },
  );
  onUnmounted(() => liveSub?.close());

  return query;
}
