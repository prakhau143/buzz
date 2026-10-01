import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { toValue, type MaybeRefOrGetter } from "vue";
import { queryKeys } from "@/app/providers/queryKeys";
import { reactionService, retractReactionLocally, type ReactionsByMessage } from "./ReactionService";
import { useSessionStore } from "@/stores/session";
import { logError } from "@/services/errors";

/**
 * Retracts my own reaction (kind:5 deletion of my kind:7 event). Patches the
 * local cache optimistically — the relay does not fan out a "removed" signal
 * to other live subscribers, so this only updates this client (see
 * docs/PHASE_3_IMPLEMENTATION_AUDIT.md §8 for that known limitation).
 */
export function useRemoveReaction(channelId: MaybeRefOrGetter<string | null>) {
  const queryClient = useQueryClient();
  const session = useSessionStore();

  const mutation = useMutation({
    mutationFn: (input: { reactionEventId: string; targetEventId: string; emoji: string }) =>
      reactionService.unreact(input.reactionEventId),
    onSuccess: (_void, input) => {
      const myPubkey = session.pubkey;
      const id = toValue(channelId);
      if (!myPubkey || !id) return;
      queryClient.setQueryData<ReactionsByMessage>(queryKeys.reactions(id), (current) =>
        retractReactionLocally(current ?? new Map(), input.targetEventId, input.emoji, myPubkey),
      );
    },
    onError: (err) => logError("useRemoveReaction", err),
  });

  return { unreact: mutation.mutateAsync, isRemoving: mutation.isPending };
}
