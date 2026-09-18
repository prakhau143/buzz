import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useSessionStore } from "@/stores/session";
import { logError } from "@/services/errors";
import { channelServiceHttp } from "./ChannelServiceHttp";
import type { ChannelVisibility } from "./ChannelServiceHttp";
import { resolveMyChannelRole } from "./channelPermissionsHttp";
import { currentCommunityId } from "@/features/communities/currentCommunity";

export const channelHttpQueryKeys = {
  list: (communityId: string) => ["http-channels", communityId] as const,
  members: (channelId: string) => ["http-channel-members", channelId] as const,
};

/** The new-backend equivalent of `useChannels()` — HTTP-backed, scoped to `currentCommunityId`. */
export function useChannelsHttp() {
  const query = useQuery({
    queryKey: computed(() => channelHttpQueryKeys.list(currentCommunityId.value ?? "")),
    queryFn: () => channelServiceHttp.listChannels(currentCommunityId.value as string),
    enabled: computed(() => currentCommunityId.value !== null),
  });

  const createMutation = useMutation({
    mutationFn: (params: { name: string; visibility: ChannelVisibility; description?: string }) =>
      channelServiceHttp.createChannel(
        currentCommunityId.value as string,
        params.name,
        params.visibility,
        params.description,
      ),
    onSuccess: () => void query.refetch(),
    onError: (err) => logError("useChannelsHttp.create", err),
  });

  return {
    ...query,
    createChannel: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    createError: createMutation.error,
  };
}

/** The new-backend equivalent of `useChannelMembers()` — HTTP-backed, `userId`-keyed. */
export function useChannelMembersHttp(channelId: MaybeRefOrGetter<string | null>) {
  const session = useSessionStore();
  const queryClient = useQueryClient();
  const id = () => toValue(channelId);

  const query = useQuery({
    queryKey: computed(() => channelHttpQueryKeys.members(id() ?? "")),
    queryFn: () => channelServiceHttp.listMembers(id() as string),
    enabled: computed(() => !!id()),
  });

  const myRole = computed(() =>
    resolveMyChannelRole(query.data.value ?? null, session.applicationUser?.id ?? null),
  );
  const isMember = computed(() => myRole.value !== null);

  function invalidate() {
    if (!id()) return Promise.resolve();
    return queryClient.invalidateQueries({ queryKey: channelHttpQueryKeys.members(id() as string) });
  }

  const joinMutation = useMutation({
    mutationFn: () => {
      const myUserId = session.applicationUser?.id;
      if (!myUserId) throw new Error("not signed in");
      return channelServiceHttp.joinChannel(id() as string, myUserId);
    },
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useChannelMembersHttp.join", err),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => channelServiceHttp.removeMember(id() as string, userId),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useChannelMembersHttp.remove", err),
  });

  const changeRoleMutation = useMutation({
    mutationFn: (params: { userId: string; role: "owner" | "admin" | "member" }) =>
      channelServiceHttp.changeRole(id() as string, params.userId, params.role),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useChannelMembersHttp.changeRole", err),
  });

  return {
    ...query,
    myRole,
    isMember,
    join: joinMutation.mutateAsync,
    isJoining: joinMutation.isPending,
    removeMember: removeMutation.mutateAsync,
    changeRole: changeRoleMutation.mutateAsync,
  };
}
