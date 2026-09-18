import { onUnmounted } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useSessionStore } from "@/stores/session";
import { dmService } from "./DmService";
import type { Channel } from "@/types/domain";

/** DM conversation list for the signed-in user, live-updated. */
export function useDmList() {
  const session = useSessionStore();
  const queryClient = useQueryClient();
  const myPubkey = session.pubkey ?? "";

  const query = useQuery({
    queryKey: queryKeys.dmList(),
    queryFn: () => dmService.discoverConversations(myPubkey),
    enabled: !!myPubkey,
  });

  const liveSub = myPubkey
    ? dmService.subscribeToConversationUpdates(myPubkey, (channel) => {
        queryClient.setQueryData<Channel[]>(queryKeys.dmList(), (current) => {
          const next = (current ?? []).filter((c) => c.id !== channel.id);
          next.push(channel);
          return next;
        });
      })
    : null;
  onUnmounted(() => liveSub?.close());

  return query;
}
