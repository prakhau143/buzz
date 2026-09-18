import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { dmService } from "./DmService";
import { logError } from "@/services/errors";

/** Opens (or re-opens) a DM with the given participants, returning the conversation id. */
export function useOpenDm() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (otherParticipantPubkeys: string[]) =>
      dmService.openConversation(otherParticipantPubkeys),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dmList() });
    },
    onError: (err) => logError("useOpenDm", err),
  });

  return { open: mutation.mutateAsync, isOpening: mutation.isPending };
}
