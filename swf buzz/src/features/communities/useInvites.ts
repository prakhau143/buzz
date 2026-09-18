import { useMutation, useQuery } from "@tanstack/vue-query";
import { logError } from "@/services/errors";
import { inviteHttpService } from "./InviteService";

export function useCreateInvite(communityId: () => string | null) {
  const mutation = useMutation({
    mutationFn: (opts: { ttlSecs?: number; maxUses?: number }) => {
      const id = communityId();
      if (!id) throw new Error("no current community to create an invite for");
      return inviteHttpService.createInvite(id, opts);
    },
    onError: (err) => logError("useCreateInvite", err),
  });
  return {
    createInvite: mutation.mutateAsync,
    isCreating: mutation.isPending,
    createError: mutation.error,
    createdInvite: mutation.data,
    reset: mutation.reset,
  };
}

export function useRevokeInvite() {
  const mutation = useMutation({
    mutationFn: (inviteId: string) => inviteHttpService.revokeInvite(inviteId),
    onError: (err) => logError("useRevokeInvite", err),
  });
  return { revokeInvite: mutation.mutateAsync, isRevoking: mutation.isPending };
}

/** Public preview for the `/invite/:token` landing page — no auth required. */
export function useInvitePreview(token: () => string) {
  return useQuery({
    queryKey: ["invite-preview", token()] as const,
    queryFn: () => inviteHttpService.previewInvite(token()),
    retry: false,
  });
}

export function useClaimInvite() {
  const mutation = useMutation({
    mutationFn: (code: string) => inviteHttpService.claimInvite(code),
    onError: (err) => logError("useClaimInvite", err),
  });
  return {
    claimInvite: mutation.mutateAsync,
    isClaiming: mutation.isPending,
    claimError: mutation.error,
    claimResult: mutation.data,
  };
}
