import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { IncompleteRelayAnswerError } from "@/services/relayQuery";
import { StaleCommunitySessionError } from "@/features/communities/communitySession";
import { channelService } from "./ChannelService";

/** Retries for an incomplete roster answer (relay still authenticating / slow). */
const INCOMPLETE_RETRIES = 3;

export function useChannelMembers(channelId: MaybeRefOrGetter<string | null>) {
  return useQuery({
    // Identity + community scoped (queryKeys.ts): community A's roster can never
    // answer for community B, and A → B → A starts from a fresh session.
    queryKey: computed(() => queryKeys.members(toValue(channelId) ?? "")),
    queryFn: () => channelService.fetchMembers(toValue(channelId) as string),
    enabled: computed(() => !!toValue(channelId)),
    // A relay that has not finished authenticating a just-switched session
    // answers "auth-required" — retry that a few times with backoff instead of
    // ever presenting it as an answer. A result from an ended session is never retried.
    retry: (failureCount, error) => {
      if (error instanceof StaleCommunitySessionError) return false;
      if (error instanceof IncompleteRelayAnswerError) return failureCount < INCOMPLETE_RETRIES;
      return failureCount < 1;
    },
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4000),
  });
}
