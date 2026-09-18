import { computed } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { channelService } from "./ChannelService";
import { logError, userMessageFor } from "@/services/errors";
import type { MemberRole } from "@/protocol/membership";

/** Add/remove/change-role mutations for a single channel's membership (kind:9000/9001). */
export function useChannelMemberActions(channelId: () => string) {
  const queryClient = useQueryClient();

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.members(channelId()) });
  }

  const addMutation = useMutation({
    mutationFn: (params: { pubkey: string; role?: MemberRole }) =>
      channelService.addMember({ channelId: channelId(), ...params }),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useChannelMemberActions.add", err),
  });

  const removeMutation = useMutation({
    mutationFn: (params: { pubkey: string }) =>
      channelService.removeMember({ channelId: channelId(), ...params }),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useChannelMemberActions.remove", err),
  });

  return {
    addMember: addMutation.mutateAsync,
    isAdding: addMutation.isPending,
    addErrorMessage: computed(() =>
      addMutation.error.value ? userMessageFor(addMutation.error.value) : null,
    ),
    removeMember: removeMutation.mutateAsync,
    isRemoving: removeMutation.isPending,
    removeErrorMessage: computed(() =>
      removeMutation.error.value ? userMessageFor(removeMutation.error.value) : null,
    ),
  };
}
