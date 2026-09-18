import { onUnmounted } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { channelService } from "./ChannelService";
import type { Channel } from "@/types/domain";

/** Channel discovery list — initial fetch via Vue Query, kept live via a relay subscription. */
export function useChannels() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.channels(),
    queryFn: () => channelService.discoverChannels(),
  });

  const liveSub = channelService.subscribeToChannelUpdates((channel) => {
    queryClient.setQueryData<Channel[]>(queryKeys.channels(), (current) => {
      const next = (current ?? []).filter((c) => c.id !== channel.id);
      next.push(channel);
      return next;
    });
  });
  onUnmounted(() => liveSub.close());

  return query;
}
