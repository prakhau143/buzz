import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { channelService } from "@/features/channels/ChannelService";
import { relayMembersService } from "@/features/community-members/RelayMembersService";
import { isKnownAgent, profileFor } from "@/features/profile/profileStore";
import { useProfileMap } from "@/composables/useProfile";
import { shortKey } from "@/features/identity/format";
import { useSessionStore } from "@/stores/session";
import type { UserProfile } from "@/types/domain";
import type { MentionCandidate } from "./mentionModel";

/**
 * Who can be mentioned where the user is writing.
 *
 * - `channel`: the channel's members first, then the rest of the community
 *   (marked "not in channel"), as OLD BUZZ offers (`buildMentionCandidates.ts`).
 * - `dm`: the conversation's participants only. A DM is private; offering the
 *   whole community there would suggest pinging people who cannot read it.
 */
export interface MentionScope {
  kind: "channel" | "dm";
  channelId: string | null;
  /** DM participants already known to the view (used before members load). */
  participants?: readonly string[];
}

/**
 * The single identity source for the mention picker. Every candidate is a
 * pubkey resolved through the canonical profile registry (`profileStore.ts`) —
 * the same name, avatar and agent flag the sidebar, message author, profile
 * drawer and member lists show — so a person reads identically everywhere.
 * Humans and agents are the same shape; `isAgent` is metadata only.
 *
 * Nothing is fetched until `active` turns true (the first `@` typed). After
 * that the rosters and profiles come from cached queries — typing more
 * characters filters locally and never hits the network.
 */
export function useMentionDirectory(
  scope: MaybeRefOrGetter<MentionScope>,
  active: MaybeRefOrGetter<boolean>,
) {
  const session = useSessionStore();
  const queryClient = useQueryClient();

  const channelId = computed(() => toValue(scope).channelId);
  const isDm = computed(() => toValue(scope).kind === "dm");

  // Same keys as useChannelMembers / useCommunityMembers, so an already-open
  // member list is reused; a disabled query still serves what is cached.
  const members = useQuery({
    queryKey: computed(() => queryKeys.members(channelId.value ?? "")),
    queryFn: () => channelService.fetchMembers(channelId.value as string),
    enabled: computed(() => !!channelId.value && !!toValue(active)),
  });
  const community = useQuery({
    queryKey: computed(() => queryKeys.relayMembers()),
    queryFn: () => relayMembersService.fetchMembershipList(),
    staleTime: 30_000,
    enabled: computed(() => !isDm.value && !!toValue(active)),
  });

  const memberKeys = computed(() => {
    const keys = new Set<string>(toValue(scope).participants ?? []);
    for (const member of members.data.value ?? []) keys.add(member.pubkey);
    return keys;
  });

  const embedded = computed(() => {
    const map = new Map<string, UserProfile>();
    for (const m of members.data.value ?? []) if (m.profile) map.set(m.pubkey, m.profile);
    return map;
  });

  const allKeys = computed(() => {
    const keys = [...memberKeys.value];
    if (!isDm.value) for (const m of community.data.value ?? []) if (!memberKeys.value.has(m.pubkey)) keys.push(m.pubkey);
    return keys.filter((key) => key !== session.pubkey);
  });

  // One batched profile fetch for anyone not resolved yet — never per keystroke.
  const unresolved = computed(() =>
    toValue(active) ? allKeys.value.filter((key) => !profileFor(key) && !embedded.value.has(key)) : [],
  );
  const { profiles: fetched } = useProfileMap(unresolved);

  const candidates = computed<MentionCandidate[]>(() =>
    allKeys.value.map((pubkey) => {
      const profile =
        profileFor(pubkey) ??
        embedded.value.get(pubkey) ??
        fetched.value.get(pubkey) ??
        queryClient.getQueryData<UserProfile>(queryKeys.profile(pubkey));
      return {
        pubkey,
        displayName: profile?.displayName?.trim() || shortKey(pubkey),
        avatarUrl: profile?.avatarUrl,
        isAgent: !!profile?.isAgent || isKnownAgent(pubkey),
        inChannel: isDm.value || memberKeys.value.has(pubkey),
      };
    }),
  );

  const isLoading = computed(
    () => !!toValue(active) && (members.isLoading.value || (!isDm.value && community.isLoading.value)),
  );

  return { candidates, isLoading };
}
