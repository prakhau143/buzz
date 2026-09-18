import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { profileService } from "@/services/ProfileService";

/** Cached profile (display name, avatar, agent badge) lookup for a single pubkey. */
export function useProfile(pubkey: MaybeRefOrGetter<string | null | undefined>) {
  return useQuery({
    queryKey: computed(() => queryKeys.profile(toValue(pubkey) ?? "")),
    queryFn: () => profileService.fetchProfile(toValue(pubkey) as string),
    enabled: computed(() => !!toValue(pubkey)),
    staleTime: 5 * 60 * 1000,
  });
}
