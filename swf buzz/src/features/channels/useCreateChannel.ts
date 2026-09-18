import { computed } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { channelService } from "./ChannelService";
import { logError, userMessageFor } from "@/services/errors";
import type { CreateChannelParams } from "@/protocol/channels";

export function useCreateChannel() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (params: CreateChannelParams) => channelService.createChannel(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.channels() });
    },
    onError: (err) => logError("useCreateChannel", err),
  });

  return {
    createChannel: mutation.mutateAsync,
    isCreating: mutation.isPending,
    errorMessage: computed(() =>
      mutation.error.value ? userMessageFor(mutation.error.value) : null,
    ),
    reset: mutation.reset,
  };
}
