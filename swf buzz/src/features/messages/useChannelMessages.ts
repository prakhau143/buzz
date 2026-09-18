import { computed, onUnmounted, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { messageService } from "./MessageService";
import type { Message } from "@/types/domain";

/** A channel's message timeline — initial fetch via Vue Query, live-updated via a relay subscription. */
export function useChannelMessages(channelId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: computed(() => queryKeys.channelMessages(toValue(channelId) ?? "")),
    queryFn: () => messageService.fetchMessages(toValue(channelId) as string),
    enabled: computed(() => !!toValue(channelId)),
  });

  let liveSub: ReturnType<typeof messageService.subscribeToChannel> | null = null;

  function resubscribe(id: string | null): void {
    liveSub?.close();
    liveSub = null;
    if (!id) return;
    liveSub = messageService.subscribeToChannel(id, (message) => {
      queryClient.setQueryData<Message[]>(queryKeys.channelMessages(id), (current) => {
        if (!current) return [message];
        if (current.some((m) => m.id === message.id)) return current;
        return [...current, message].sort((a, b) => a.createdAt - b.createdAt);
      });
    });
  }

  watch(
    () => toValue(channelId),
    (id) => resubscribe(id),
    { immediate: true },
  );
  onUnmounted(() => liveSub?.close());

  return query;
}
