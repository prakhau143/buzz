import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { dmService } from "./DmService";
import { logError } from "@/services/errors";
import type { Channel } from "@/types/domain";

/** Hides a DM conversation (kind:41012) — re-publishing kind:41010 with the same participants unhides it. */
export function useHideDm() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (conversationId: string) => dmService.hideConversation(conversationId),
    onSuccess: (_data, conversationId) => {
      queryClient.setQueryData<Channel[]>(queryKeys.dmList(), (current) =>
        (current ?? []).filter((c) => c.id !== conversationId),
      );
    },
    onError: (err) => logError("useHideDm", err),
  });

  return { hide: mutation.mutateAsync, isHiding: mutation.isPending };
}
