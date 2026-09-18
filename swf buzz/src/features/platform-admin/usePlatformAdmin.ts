import { computed } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { logError } from "@/services/errors";
import { adminConsoleService } from "./AdminConsoleService";
import type { ResolutionAction } from "@/protocol/moderation";

/** Whether the deployment admin console is configured on this build at all. */
export function isPlatformAdminConfigured(): boolean {
  return adminConsoleService.isConfigured();
}

/** Discovers the signed-in identity's role/capabilities before rendering anything sensitive. */
export function useAdminProbe() {
  return useQuery({
    queryKey: queryKeys.adminProbe(),
    queryFn: () => adminConsoleService.probe(),
    enabled: isPlatformAdminConfigured(),
    staleTime: 60_000,
    retry: false,
  });
}

export function useAdminReports(status?: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.adminReports(status),
    queryFn: () => adminConsoleService.listReports(status ? { status } : { scope: "all" }),
    enabled: isPlatformAdminConfigured(),
    staleTime: 15_000,
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
  }

  const resolveMutation = useMutation({
    mutationFn: (params: { id: string; action: ResolutionAction | "delete"; reason?: string }) =>
      adminConsoleService.resolveReport({ ...params, requestId: crypto.randomUUID() }),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useAdminReports.resolve", err),
  });

  const reopenMutation = useMutation({
    mutationFn: (params: { id: string; reason?: string }) =>
      adminConsoleService.reopenReport({ ...params, requestId: crypto.randomUUID() }),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useAdminReports.reopen", err),
  });

  return {
    ...query,
    resolve: resolveMutation.mutateAsync,
    isResolving: resolveMutation.isPending,
    reopen: reopenMutation.mutateAsync,
    isReopening: reopenMutation.isPending,
  };
}

export function useAdminFeedback() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.adminFeedback(),
    queryFn: () => adminConsoleService.listFeedback(),
    enabled: isPlatformAdminConfigured(),
    staleTime: 15_000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: (params: { id: string; status: "new" | "reviewed" | "archived" }) =>
      adminConsoleService.updateFeedbackStatus(params.id, params.status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminFeedback() }),
    onError: (err) => logError("useAdminFeedback.updateStatus", err),
  });

  return {
    ...query,
    updateStatus: updateStatusMutation.mutateAsync,
    isUpdatingStatus: updateStatusMutation.isPending,
  };
}

export function useAdminOperators() {
  const queryClient = useQueryClient();
  const { data: probe } = useAdminProbe();
  const canStaff = computed(() => probe.value?.canStaff ?? false);

  const query = useQuery({
    queryKey: queryKeys.adminOperators(),
    queryFn: () => adminConsoleService.listOperators(),
    enabled: () => isPlatformAdminConfigured() && canStaff.value,
    staleTime: 30_000,
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.adminOperators() });
  }

  const upsertMutation = useMutation({
    mutationFn: (params: { pubkey: string; role: "operator" | "moderator" }) =>
      adminConsoleService.upsertOperator(params.pubkey, params.role),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useAdminOperators.upsert", err),
  });

  const deleteMutation = useMutation({
    mutationFn: (pubkey: string) => adminConsoleService.deleteOperator(pubkey),
    onSuccess: () => void invalidate(),
    onError: (err) => logError("useAdminOperators.delete", err),
  });

  return {
    ...query,
    canStaff,
    upsert: upsertMutation.mutateAsync,
    isUpserting: upsertMutation.isPending,
    upsertError: upsertMutation.error,
    remove: deleteMutation.mutateAsync,
    isRemoving: deleteMutation.isPending,
  };
}
