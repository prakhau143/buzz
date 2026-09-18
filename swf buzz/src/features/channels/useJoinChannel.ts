import { computed } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { channelService } from "./ChannelService";
import { logError, userMessageFor } from "@/services/errors";

export function useJoinChannel() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (channelId: string) => channelService.joinChannel(channelId),
    onSuccess: (_data, channelId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(channelId) });
    },
    onError: (err) => logError("useJoinChannel", err),
  });

  return {
    join: mutation.mutateAsync,
    isJoining: mutation.isPending,
    errorMessage: computed(() =>
      mutation.error.value ? userMessageFor(mutation.error.value) : null,
    ),
  };
}
