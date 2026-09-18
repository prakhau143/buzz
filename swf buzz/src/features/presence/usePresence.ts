import { onUnmounted } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { presenceService } from "./PresenceService";
import type { PresenceInfo } from "@/types/domain";

/** Community-wide presence snapshot, live-updated. See PresenceService for the "best-effort" caveat. */
export function usePresence() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.presence(),
    queryFn: () => presenceService.fetchSnapshot(),
    staleTime: 30 * 1000,
  });

  const liveSub = presenceService.subscribe((info) => {
    queryClient.setQueryData<Map<string, PresenceInfo>>(queryKeys.presence(), (current) => {
      const next = new Map(current ?? []);
      next.set(info.pubkey, info);
      return next;
    });
  });
  onUnmounted(() => liveSub.close());

  return query;
}
