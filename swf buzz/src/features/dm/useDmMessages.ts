import { computed, onUnmounted, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { dmService } from "./DmService";
import type { Message } from "@/types/domain";

/** A DM conversation's message timeline — goes through DmService/DmTransport, never MessageService directly. */
export function useDmMessages(conversationId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: computed(() => queryKeys.dm(toValue(conversationId) ?? "")),
    queryFn: () => dmService.fetchHistory(toValue(conversationId) as string),
    enabled: computed(() => !!toValue(conversationId)),
  });

  let liveSub: ReturnType<typeof dmService.subscribeToConversation> | null = null;

  function resubscribe(id: string | null): void {
    liveSub?.close();
    liveSub = null;
    if (!id) return;
    liveSub = dmService.subscribeToConversation(id, (message) => {
      queryClient.setQueryData<Message[]>(queryKeys.dm(id), (current) => {
        if (!current) return [message];
        if (current.some((m) => m.id === message.id)) return current;
        return [...current, message].sort((a, b) => a.createdAt - b.createdAt);
      });
    });
  }

  watch(
    () => toValue(conversationId),
    (id) => resubscribe(id),
    { immediate: true },
  );
  onUnmounted(() => liveSub?.close());

  return query;
}
