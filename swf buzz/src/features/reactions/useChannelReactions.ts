import { computed, onUnmounted, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { reactionService, applyReaction, type ReactionsByMessage } from "./ReactionService";
import { useSessionStore } from "@/stores/session";

/** All reactions for a channel, grouped by target message id. Merge into message rendering client-side. */
export function useChannelReactions(channelId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();
  const session = useSessionStore();

  const query = useQuery({
    queryKey: computed(() => queryKeys.reactions(toValue(channelId) ?? "")),
    queryFn: () => reactionService.fetchChannelReactions(toValue(channelId) as string),
    enabled: computed(() => !!toValue(channelId)),
  });

  let liveSub: ReturnType<typeof reactionService.subscribeToChannel> | null = null;

  function resubscribe(id: string | null): void {
    liveSub?.close();
    liveSub = null;
    if (!id) return;
    liveSub = reactionService.subscribeToChannel(id, (reaction) => {
      queryClient.setQueryData<ReactionsByMessage>(queryKeys.reactions(id), (current) =>
        applyReaction(current ?? new Map(), reaction, session.pubkey),
      );
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
