import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useSessionStore } from "@/stores/session";
import { inviteService } from "./InviteService";
import { logError } from "@/services/errors";

export function useChannelInvites(channelId: MaybeRefOrGetter<string | null>) {
  const session = useSessionStore();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: computed(() => queryKeys.invites(toValue(channelId) ?? "")),
    queryFn: () =>
      inviteService.listMyInvites(toValue(channelId) as string, session.pubkey as string),
    enabled: computed(() => !!toValue(channelId) && !!session.pubkey),
  });

  const createMutation = useMutation({
    mutationFn: () => inviteService.createInvite(toValue(channelId) as string),
    onSuccess: () => {
      const id = toValue(channelId);
      if (id) void queryClient.invalidateQueries({ queryKey: queryKeys.invites(id) });
    },
    onError: (err) => logError("useChannelInvites.create", err),
  });

  return { ...query, create: createMutation.mutateAsync, isCreating: createMutation.isPending };
}
