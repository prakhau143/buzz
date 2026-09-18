import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { logError } from "@/services/errors";
import { moderationService } from "./ModerationService";
import type { RelayMemberRole } from "@/protocol/relayMembers";

/** Ban/unban/timeout/untimeout a community member. Usable from any surface
 *  that knows the target's pubkey and community role (member row, per-message
 *  moderation menu, report detail). */
export function useModerationActions() {
  const queryClient = useQueryClient();

  function invalidateRestrictions() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.moderationRestrictions() });
  }

  const banMutation = useMutation({
    mutationFn: (params: {
      pubkey: string;
      targetRole: RelayMemberRole | null;
      actingRole: RelayMemberRole | null;
      expiresAt?: number;
      reason?: string;
    }) => moderationService.banMember(params),
    onSuccess: () => void invalidateRestrictions(),
    onError: (err) => logError("useModerationActions.ban", err),
  });

  const unbanMutation = useMutation({
    mutationFn: (params: { pubkey: string; actingRole: RelayMemberRole | null }) =>
      moderationService.unbanMember(params),
    onSuccess: () => void invalidateRestrictions(),
    onError: (err) => logError("useModerationActions.unban", err),
  });

  const timeoutMutation = useMutation({
    mutationFn: (params: {
      pubkey: string;
      targetRole: RelayMemberRole | null;
      actingRole: RelayMemberRole | null;
      expiresAt: number;
      reason?: string;
    }) => moderationService.timeoutMember(params),
    onSuccess: () => void invalidateRestrictions(),
    onError: (err) => logError("useModerationActions.timeout", err),
  });

  const untimeoutMutation = useMutation({
    mutationFn: (params: { pubkey: string; actingRole: RelayMemberRole | null }) =>
      moderationService.untimeoutMember(params),
    onSuccess: () => void invalidateRestrictions(),
    onError: (err) => logError("useModerationActions.untimeout", err),
  });

  return {
    ban: banMutation.mutateAsync,
    isBanning: banMutation.isPending,
    banError: banMutation.error,
    unban: unbanMutation.mutateAsync,
    isUnbanning: unbanMutation.isPending,
    timeout: timeoutMutation.mutateAsync,
    isTimingOut: timeoutMutation.isPending,
    timeoutError: timeoutMutation.error,
    untimeout: untimeoutMutation.mutateAsync,
    isUntimingOut: untimeoutMutation.isPending,
  };
}
