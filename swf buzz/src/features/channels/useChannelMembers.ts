import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { channelService } from "./ChannelService";

export function useChannelMembers(channelId: MaybeRefOrGetter<string | null>) {
  return useQuery({
    queryKey: computed(() => queryKeys.members(toValue(channelId) ?? "")),
    queryFn: () => channelService.fetchMembers(toValue(channelId) as string),
    enabled: computed(() => !!toValue(channelId)),
  });
}
