import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useChannelMembers } from "./useChannelMembers";
import { useCommunityMembers } from "@/features/community-members/useCommunityMembers";
import type { RelayMemberRole } from "@/protocol/relayMembers";

/**
 * View-model for the "Add members" picker.
 *
 * THE BUG THIS FIXES (docs/PRIVATE_CHANNEL_MEMBER_PICKER_AUDIT.md §1): the
 * picker used to be fed by `useChannelMembers()` alone, so it could only ever
 * list people who were already in the channel — with one member in the channel
 * it showed exactly one row and no way to add anyone.
 *
 * The candidate set is a difference of two DIFFERENT membership planes, which
 * stay in their own services and are merely compared here:
 *
 *   community members (NIP-43 roster)  ∖  channel members (NIP-29)  =  available
 *   community members  ∩  channel members                           =  already added
 *
 * Keeping them separate matters beyond this screen: the same community roster
 * feeds mentions, the members modal and any future DM picker.
 */

export interface PickerCandidate {
  pubkey: string;
  /** Community role — what this person is in the community, not in the channel. */
  communityRole: RelayMemberRole;
  /** True when they are already a member of this channel. */
  isInChannel: boolean;
}

/**
 * Hex public keys are case-insensitive; the relay emits lowercase but a roster
 * snapshot, an invite or a hand-typed key may not be. Comparing raw strings
 * would silently offer to add someone who is already in the channel, and the
 * relay would then answer with a duplicate error the user cannot act on.
 */
export function normalizePubkey(pubkey: string): string {
  return pubkey.trim().toLowerCase();
}

export function useChannelMemberPicker(channelId: MaybeRefOrGetter<string | null>) {
  const community = useCommunityMembers();
  const channel = useChannelMembers(channelId);

  const channelPubkeys = computed(
    () => new Set((channel.data.value ?? []).map((m) => normalizePubkey(m.pubkey))),
  );

  /**
   * Every community member, each tagged with whether they are already in the
   * channel. One list so the UI can render "available" and "already added"
   * from a single source and can never show the same person twice.
   */
  const candidates = computed<PickerCandidate[]>(() =>
    (community.data.value ?? []).map((m) => {
      const pubkey = normalizePubkey(m.pubkey);
      return { pubkey, communityRole: m.role, isInChannel: channelPubkeys.value.has(pubkey) };
    }),
  );

  const available = computed(() => candidates.value.filter((c) => !c.isInChannel));
  const alreadyAdded = computed(() => candidates.value.filter((c) => c.isInChannel));

  /**
   * `useCommunityMembers` resolves to `null` (not an error) when the relay
   * publishes no roster snapshot — an "open" relay, per
   * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2a. There is then no community
   * roster to pick from, which the UI must say plainly rather than showing an
   * empty list that looks like a loading bug.
   */
  const hasCommunityRoster = computed(() => community.data.value !== null);

  return {
    candidates,
    available,
    alreadyAdded,
    hasCommunityRoster,
    isLoading: computed(() => community.isLoading.value || channel.isLoading.value),
    isError: computed(() => community.isError.value || channel.isError.value),
    /** Refetch BOTH planes — either one being stale produces a wrong candidate set. */
    refetch: async () => {
      await Promise.all([community.refetch(), channel.refetch()]);
    },
    /** The signed-in person's COMMUNITY role, which is what gates adding members. */
    myCommunityRole: community.myRole,
    canManage: community.canManage,
    channelId: computed(() => toValue(channelId)),
  };
}
