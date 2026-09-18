import { useMutation } from "@tanstack/vue-query";
import { logError } from "@/services/errors";
import { moderationService } from "./ModerationService";
import type { ReportType } from "@/protocol/moderation";

export function useSubmitReport() {
  const mutation = useMutation({
    mutationFn: (params: { authorPubkey: string; eventId: string; reportType: ReportType; note?: string }) =>
      moderationService.submitReport(params),
    onError: (err) => logError("useSubmitReport", err),
  });

  return {
    submit: mutation.mutateAsync,
    isSubmitting: mutation.isPending,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
    reset: mutation.reset,
  };
}
