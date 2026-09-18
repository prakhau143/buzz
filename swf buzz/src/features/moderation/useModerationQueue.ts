import { type MaybeRefOrGetter, toValue } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { logError } from "@/services/errors";
import { moderationService } from "./ModerationService";
import type { ResolutionAction } from "@/protocol/moderation";
import type { RelayMemberRole } from "@/protocol/relayMembers";

/** The community moderation queue — `GET /moderation/reports`, mod-authz gated relay-side. */
export function useModerationReports(status: "open" | "all" = "open") {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.moderationReports(status),
    queryFn: () => moderationService.listReports(status === "open" ? { status: "open" } : undefined),
    staleTime: 15_000,
  });

  const resolveMutation = useMutation({
    mutationFn: (params: { reportEventId: string; action: ResolutionAction; actingRole: RelayMemberRole | null; reason?: string }) =>
      moderationService.resolveReport(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.moderationReports("open") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.moderationReports("all") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.moderationAudit() });
    },
    onError: (err) => logError("useModerationReports.resolve", err),
  });

  return {
    ...query,
    resolve: resolveMutation.mutateAsync,
    isResolving: resolveMutation.isPending,
    resolveError: resolveMutation.error,
  };
}

/** The community audit log — `GET /moderation/audit`, mod-authz gated relay-side. */
export function useModerationAudit() {
  return useQuery({
    queryKey: queryKeys.moderationAudit(),
    queryFn: () => moderationService.listAuditActions(100),
    staleTime: 15_000,
  });
}

/** Active bans/timeouts — `GET /moderation/restricted`, mod-authz gated relay-side. */
export function useModerationRestrictions(enabled: MaybeRefOrGetter<boolean> = true) {
  return useQuery({
    queryKey: queryKeys.moderationRestrictions(),
    queryFn: () => moderationService.listRestrictions(),
    enabled: () => toValue(enabled),
    staleTime: 15_000,
  });
}
