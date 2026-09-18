import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import type { Member, UserProfile } from "@/types/domain";
import type { MentionCandidate } from "@/components/MessageComposer.vue";

/**
 * Builds the @mention dropdown list from a member list, using whatever
 * profile data (display name, agent badge) is already cached — per
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §10, mentions are a plain `p`
 * tag; there's no protocol-level distinction between mentioning a human and
 * an agent. Falls back to a pubkey prefix for members not cached yet (their
 * MemberList row will have triggered the fetch already in the common case).
 */
export function useMentionCandidates(members: MaybeRefOrGetter<Member[]>) {
  const queryClient = useQueryClient();

  return computed<MentionCandidate[]>(() =>
    toValue(members).map((member) => {
      const profile = queryClient.getQueryData<UserProfile>(queryKeys.profile(member.pubkey));
      return {
        pubkey: member.pubkey,
        displayName: profile?.displayName ?? member.pubkey.slice(0, 8),
        isAgent: profile?.isAgent,
      };
    }),
  );
}
