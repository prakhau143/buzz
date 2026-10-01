/**
 * The "Add members" candidate set.
 *
 * REGRESSION: the picker used to be fed by the CHANNEL member query alone, so
 * it could only list people already in the channel — with one member in the
 * channel it showed exactly that one person and offered nobody to add
 * (docs/PRIVATE_CHANNEL_MEMBER_PICKER_AUDIT.md §1). The candidate set must be
 * community members MINUS channel members.
 */
import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { Member } from "@/types/domain";
import type { RelayMember } from "@/protocol/relayMembers";

const communityData = ref<RelayMember[] | null>([]);
const channelData = ref<Member[]>([]);
const myRole = ref<string | null>("owner");

vi.mock("@/features/community-members/useCommunityMembers", () => ({
  useCommunityMembers: () => ({
    data: communityData,
    isLoading: ref(false),
    isError: ref(false),
    refetch: vi.fn(async () => undefined),
    myRole,
    canManage: computed(() => myRole.value === "owner" || myRole.value === "admin"),
  }),
}));

vi.mock("@/features/channels/useChannelMembers", () => ({
  useChannelMembers: () => ({
    data: channelData,
    isLoading: ref(false),
    isError: ref(false),
    refetch: vi.fn(async () => undefined),
  }),
}));

const { useChannelMemberPicker, normalizePubkey } = await import(
  "@/features/channels/useChannelMemberPicker"
);

const OWNER = "a".repeat(64);
const RAJU = "b".repeat(64);
const RAHUL = "c".repeat(64);
const SONIA = "d".repeat(64);

function setup(community: RelayMember[] | null, channel: Member[]) {
  communityData.value = community;
  channelData.value = channel;
  return useChannelMemberPicker(() => "channel-1");
}

describe("useChannelMemberPicker", () => {
  it("offers every community member who is not yet in the channel", () => {
    const picker = setup(
      [
        { pubkey: OWNER, role: "owner" },
        { pubkey: RAJU, role: "member" },
        { pubkey: RAHUL, role: "member" },
        { pubkey: SONIA, role: "admin" },
      ],
      [{ pubkey: OWNER, role: "owner" }],
    );

    expect(picker.available.value.map((c) => c.pubkey)).toEqual([RAJU, RAHUL, SONIA]);
    expect(picker.alreadyAdded.value.map((c) => c.pubkey)).toEqual([OWNER]);
  });

  it("marks existing channel members as already added rather than omitting them", () => {
    const picker = setup(
      [
        { pubkey: OWNER, role: "owner" },
        { pubkey: RAJU, role: "member" },
      ],
      [{ pubkey: OWNER, role: "owner" }],
    );

    const owner = picker.candidates.value.find((c) => c.pubkey === OWNER);
    expect(owner?.isInChannel).toBe(true);
    expect(picker.candidates.value.find((c) => c.pubkey === RAJU)?.isInChannel).toBe(false);
  });

  it("never lists the same person twice", () => {
    const picker = setup(
      [
        { pubkey: OWNER, role: "owner" },
        { pubkey: RAJU, role: "member" },
      ],
      [
        { pubkey: OWNER, role: "owner" },
        { pubkey: RAJU, role: "member" },
      ],
    );

    const keys = picker.candidates.value.map((c) => c.pubkey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("compares keys case-insensitively, so an uppercase roster entry is not offered again", () => {
    const picker = setup(
      [{ pubkey: RAJU.toUpperCase(), role: "member" }],
      [{ pubkey: RAJU, role: "member" }],
    );

    expect(picker.available.value).toEqual([]);
    expect(picker.alreadyAdded.value.map((c) => c.pubkey)).toEqual([RAJU]);
  });

  it("carries the COMMUNITY role, not a channel role", () => {
    const picker = setup([{ pubkey: SONIA, role: "admin" }], []);
    expect(picker.candidates.value[0].communityRole).toBe("admin");
  });

  it("reports a relay with no roster snapshot as having no community roster", () => {
    // `null` means an open relay with no membership list — not an error.
    const picker = setup(null, [{ pubkey: OWNER, role: "owner" }]);
    expect(picker.hasCommunityRoster.value).toBe(false);
    expect(picker.candidates.value).toEqual([]);
  });

  it("says everyone is already added when the channel covers the whole community", () => {
    const picker = setup(
      [
        { pubkey: OWNER, role: "owner" },
        { pubkey: RAJU, role: "member" },
      ],
      [
        { pubkey: OWNER, role: "owner" },
        { pubkey: RAJU, role: "member" },
      ],
    );
    expect(picker.available.value).toEqual([]);
    expect(picker.alreadyAdded.value).toHaveLength(2);
  });

  it("gates management on the community role", () => {
    myRole.value = "member";
    expect(setup([{ pubkey: RAJU, role: "member" }], []).canManage.value).toBe(false);
    myRole.value = "admin";
    expect(setup([{ pubkey: RAJU, role: "member" }], []).canManage.value).toBe(true);
    myRole.value = "owner";
  });
});

describe("normalizePubkey", () => {
  it("lowercases and trims", () => {
    expect(normalizePubkey(`  ${RAJU.toUpperCase()} `)).toBe(RAJU);
  });
});
