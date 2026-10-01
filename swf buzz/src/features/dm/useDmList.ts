import { computed, onUnmounted, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { communitySessionGeneration } from "@/features/communities/communitySession";
import { useSessionStore } from "@/stores/session";
import { dmService } from "./DmService";
import type { Channel } from "@/types/domain";

/**
 * DM conversation list for the signed-in user, live-updated.
 *
 * Per community, like `useChannels`: the key follows the active community and
 * the live subscription is re-opened for each community session, so another
 * community's conversations are never listed here.
 */
export function useDmList() {
  const session = useSessionStore();
  const queryClient = useQueryClient();
  const myPubkey = computed(() => session.pubkey ?? "");

  const query = useQuery({
    queryKey: computed(() => queryKeys.dmList()),
    queryFn: () => dmService.discoverConversations(myPubkey.value),
    enabled: computed(() => !!myPubkey.value),
  });

  let liveSub: ReturnType<typeof dmService.subscribeToConversationUpdates> | null = null;
  watch(
    [communitySessionGeneration, myPubkey],
    ([, pubkey]) => {
      liveSub?.close();
      liveSub = null;
      if (!pubkey) return;
      const key = queryKeys.dmList();
      liveSub = dmService.subscribeToConversationUpdates(pubkey, (channel) => {
        queryClient.setQueryData<Channel[]>(key, (current) => {
          const next = (current ?? []).filter((c) => c.id !== channel.id);
          next.push(channel);
          return next;
        });
      });
    },
    { immediate: true },
  );
  onUnmounted(() => liveSub?.close());

  return query;
}
