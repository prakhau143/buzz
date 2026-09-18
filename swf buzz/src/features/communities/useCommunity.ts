import { computed } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useSessionStore } from "@/stores/session";
import { logError } from "@/services/errors";
import { communityService } from "./CommunityService";
import type { CommunityRole } from "./CommunityService";
import { canManageCommunityMembers, resolveMyCommunityRole } from "./permissions";
import { currentCommunityId, setCurrentCommunityId } from "./currentCommunity";

export const communityQueryKeys = {
  members: (communityId: string) => ["communities", communityId, "members"] as const,
};

/** Create-community mutation, independent of `currentCommunityId` being set yet — see `currentCommunity.ts`. */
export function useCreateCommunity() {
  const mutation = useMutation({
    mutationFn: (name: string) => communityService.createCommunity(name),
    onSuccess: (community) => setCurrentCommunityId(community.id),
    onError: (err) => logError("useCreateCommunity", err),
  });
  return {
    createCommunity: mutation.mutateAsync,
    isCreating: mutation.isPending,
    createError: mutation.error,
  };
}

/**
 * The new-backend equivalent of `useCommunityMembers()` — same shape, but
 * `userId`-keyed and HTTP-backed. Returns an "empty" query (never fetches)
 * when `currentCommunityId` isn't resolved yet; callers should gate on
 * `communityId` being non-null before rendering member-management UI.
 */
export function useCommunity() {
  const session = useSessionStore();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: computed(() => communityQueryKeys.members(currentCommunityId.value ?? "")),
    queryFn: () => communityService.listMembers(currentCommunityId.value as string),
    enabled: computed(() => currentCommunityId.value !== null),
  });

  const myRole = computed<CommunityRole | null>(() =>
    resolveMyCommunityRole(query.data.value ?? null, session.applicationUser?.id ?? null),
  );
  const canManage = computed(() => canManageCommunityMembers(myRole.value));

  function invalidate() {
    if (!currentCommunityId.value) return Promise.resolve();
    return queryClient.invalidateQueries({
      queryKey: communityQueryKeys.members(currentCommunityId.value),
    });
  }

  const addMutation = useMutation({
    mutationFn: (params: { userId: string; role: CommunityRole }) =>
      communityService.addMember(currentCommunityId.value as string, params.userId, params.role),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useCommunity.add", err),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      communityService.removeMember(currentCommunityId.value as string, userId),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useCommunity.remove", err),
  });

  const changeRoleMutation = useMutation({
    mutationFn: (params: { userId: string; role: CommunityRole }) =>
      communityService.changeRole(currentCommunityId.value as string, params.userId, params.role),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useCommunity.changeRole", err),
  });

  return {
    ...query,
    communityId: currentCommunityId,
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
