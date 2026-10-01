import { computed, onUnmounted, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { communitySessionGeneration } from "@/features/communities/communitySession";
import { channelService } from "./ChannelService";
import type { Channel } from "@/types/domain";

/**
 * Channel discovery list — initial fetch via Vue Query, kept live via a relay subscription.
 *
 * Both follow the active community. The sidebar that uses this stays mounted
 * across a community switch, so the key is recomputed (a key fixed at mount
 * kept showing the previous community's list) and the live subscription is
 * re-opened per community session (the switch's `disconnect()` closes it).
 */
export function useChannels() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: computed(() => queryKeys.channels()),
    queryFn: () => channelService.discoverChannels(),
  });

  let liveSub: ReturnType<typeof channelService.subscribeToChannelUpdates> | null = null;
  watch(
    communitySessionGeneration,
    () => {
      liveSub?.close();
      // Captured now: an update is written to THIS community's list, never to
      // whichever community happens to be active when it arrives.
      const key = queryKeys.channels();
      liveSub = channelService.subscribeToChannelUpdates((channel) => {
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
