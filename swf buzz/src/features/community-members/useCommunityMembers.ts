import { computed } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useSessionStore } from "@/stores/session";
import { logError } from "@/services/errors";
import { relayMembersService } from "./RelayMembersService";
import type { RelayMemberRole } from "@/protocol/relayMembers";
import { canManageCommunityMembers, resolveMyRole } from "./permissions";

/**
 * Community (relay-wide) membership roster + my own role in it. `data` is
 * `null` when the relay has no community-membership snapshot at all — an
 * "open" relay, not an error — see docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2a.
 */
export function useCommunityMembers() {
  const session = useSessionStore();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.relayMembers(),
    queryFn: () => relayMembersService.fetchMembershipList(),
    staleTime: 30_000,
  });

  const myRole = computed<RelayMemberRole | null>(() =>
    resolveMyRole(query.data.value ?? null, session.pubkey),
  );

  const canManage = computed(() => canManageCommunityMembers(myRole.value));

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.relayMembers() });
  }

  const addMutation = useMutation({
    mutationFn: (params: { pubkey: string; role: RelayMemberRole }) =>
      relayMembersService.addMember({ ...params, actingRole: myRole.value }),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useCommunityMembers.add", err),
  });

  const removeMutation = useMutation({
    mutationFn: (params: { pubkey: string; targetRole: RelayMemberRole }) =>
      relayMembersService.removeMember({
        ...params,
        actingRole: myRole.value,
        selfPubkey: session.pubkey,
      }),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useCommunityMembers.remove", err),
  });

  const changeRoleMutation = useMutation({
    mutationFn: (params: { pubkey: string; targetRole: RelayMemberRole; newRole: RelayMemberRole }) =>
      relayMembersService.changeRole({
        ...params,
        actingRole: myRole.value,
        selfPubkey: session.pubkey,
      }),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useCommunityMembers.changeRole", err),
  });

  return {
    ...query,
    myRole,
    canManage,
    addMember: addMutation.mutateAsync,
    isAdding: addMutation.isPending,
    addError: addMutation.error,
    removeMember: removeMutation.mutateAsync,
    isRemoving: removeMutation.isPending,
    changeRole: changeRoleMutation.mutateAsync,
    isChangingRole: changeRoleMutation.isPending,
  };
}
