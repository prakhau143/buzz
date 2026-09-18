import { useMutation } from "@tanstack/vue-query";
import { reactionService } from "./ReactionService";
import { logError } from "@/services/errors";

/**
 * There is no verified retraction mechanism for kind:7 reactions in
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md — this only adds a reaction.
 * The live subscription (useChannelReactions) reflects the new reaction once
 * the relay echoes it back, so no local cache write is needed here.
 */
export function useAddReaction() {
  const mutation = useMutation({
    mutationFn: (input: { targetEventId: string; emoji: string }) =>
      reactionService.react(input.targetEventId, input.emoji),
    onError: (err) => logError("useAddReaction", err),
  });

  return { react: mutation.mutateAsync, isReacting: mutation.isPending };
}
