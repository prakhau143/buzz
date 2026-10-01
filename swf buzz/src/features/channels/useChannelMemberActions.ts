import { computed } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { channelService } from "./ChannelService";
import { useCommunityMembers } from "@/features/community-members/useCommunityMembers";
import { AppError, logError, userMessageFor } from "@/services/errors";
import type { MemberRole } from "@/protocol/membership";

/** Add/remove/change-role mutations for a single channel's membership (kind:9000/9001). */
export function useChannelMemberActions(channelId: () => string) {
  const queryClient = useQueryClient();

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.members(channelId()) });
  }

  const community = useCommunityMembers();

  /**
   * A channel lives inside exactly one community, so only that community's
   * members can be added to it. This refuses a pubkey that is not in the active
   * community's roster BEFORE publishing — not by hiding rows, but on the
   * action itself, so a crafted call cannot reach the relay either.
   *
   * It is a fast-fail guard, not the security boundary: the relay enforces
   * membership regardless (`relay_admin.rs`). Its value is that a mistake fails
   * immediately and legibly instead of as an opaque relay rejection.
   *
   * When the relay publishes no roster at all (`data === null`, an open relay)
   * there is nothing to check against, and the relay remains the only authority.
   */
  function assertInCommunity(pubkey: string): void {
    const roster = community.data.value;
    if (!roster) return;
    const normalized = pubkey.trim().toLowerCase();
    if (!roster.some((m) => m.pubkey.toLowerCase() === normalized)) {
      throw new AppError(
        "permission_denied",
        "That person isn't a member of this community, so they can't be added to a channel in it.",
      );
    }
  }

  const addMutation = useMutation({
    mutationFn: (params: { pubkey: string; role?: MemberRole }) => {
      assertInCommunity(params.pubkey);
      return channelService.addMember({ channelId: channelId(), ...params });
    },
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
