/**
 * The "Add members" picker UI: community members by NAME, existing channel
 * members shown as "Added ✓" and never addable twice, search over names, and
 * the Add action going through the existing kind:9000 channel-membership
 * mutation rather than any new API.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref, toValue, type MaybeRefOrGetter } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "@/stores/session";
import type { UserProfile } from "@/types/domain";
import type { RelayMemberRole } from "@/protocol/relayMembers";

const OWNER = "a".repeat(64);
const RAJU = "b".repeat(64);
const RAHUL = "c".repeat(64);

interface Candidate {
  pubkey: string;
  communityRole: RelayMemberRole;
  isInChannel: boolean;
}

const candidates = ref<Candidate[]>([]);
const canManage = ref(true);
const hasCommunityRoster = ref(true);
const isLoading = ref(false);
const isError = ref(false);
const refetch = vi.fn(async () => undefined);
const addMember = vi.fn(async () => undefined);
const addErrorMessage = ref<string | null>(null);

vi.mock("@/features/channels/useChannelMemberPicker", () => ({
  useChannelMemberPicker: () => ({
    candidates,
    available: computed(() => candidates.value.filter((c) => !c.isInChannel)),
    alreadyAdded: computed(() => candidates.value.filter((c) => c.isInChannel)),
    hasCommunityRoster,
    isLoading,
    isError,
    refetch,
    myCommunityRole: ref("owner"),
    canManage,
    channelId: ref("channel-1"),
  }),
}));

vi.mock("@/features/channels/useChannelMemberActions", () => ({
  useChannelMemberActions: () => ({
    addMember,
    isAdding: ref(false),
    addErrorMessage,
    removeMember: vi.fn(),
    isRemoving: ref(false),
    removeErrorMessage: ref(null),
  }),
}));

const profileData: Record<string, UserProfile> = {
  [OWNER]: { pubkey: OWNER, displayName: "Prakhar Mittal", isAgent: false },
  [RAJU]: { pubkey: RAJU, displayName: "Raju Sharma", about: "Software Engineer", isAgent: false },
  [RAHUL]: { pubkey: RAHUL, displayName: "Rahul Kumar", isAgent: false },
};

vi.mock("@/composables/useProfile", () => ({
  // The real composable takes a MaybeRefOrGetter, and the component passes a
  // computed — resolve it the same way rather than assuming a function.
  useProfileMap: (pubkeys: MaybeRefOrGetter<string[]>) => ({
    profiles: computed(
      () =>
        new Map(
          toValue(pubkeys)
            .map((p) => [p, profileData[p]] as const)
            .filter(([, v]) => v),
        ),
    ),
    displayNames: computed(
      () => new Map(toValue(pubkeys).map((p) => [p, profileData[p]?.displayName ?? p.slice(0, 8)])),
    ),
  }),
  useProfile: () => ({ data: ref(null) }),
  useDisplayName: () => ({ profile: ref(null), displayName: ref(""), isFallback: ref(true) }),
}));

const AddMembersModal = (await import("@/features/channels/ui/AddMembersModal.vue")).default;

function mountModal() {
  return mount(AddMembersModal, {
    props: { channelId: "channel-1", channelName: "conversation" },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().pubkey = OWNER;
  candidates.value = [
    { pubkey: OWNER, communityRole: "owner", isInChannel: true },
    { pubkey: RAJU, communityRole: "member", isInChannel: false },
    { pubkey: RAHUL, communityRole: "member", isInChannel: false },
  ];
  canManage.value = true;
  hasCommunityRoster.value = true;
  isLoading.value = false;
  isError.value = false;
  addMember.mockClear();
  refetch.mockClear();
  addErrorMessage.value = null;
});

describe("AddMembersModal", () => {
  it("lists community members who are not in the channel", () => {
    const text = mountModal().text();
    expect(text).toContain("Raju Sharma");
    expect(text).toContain("Rahul Kumar");
  });

  it("shows people by name, not by raw public key", () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain("Raju Sharma");
    expect(wrapper.text()).not.toContain(RAJU);
  });

  it("shows an Add button for each addable member", () => {
    const wrapper = mountModal();
    expect(wrapper.find(`[data-testid="add-member-${RAJU}"]`).exists()).toBe(true);
    expect(wrapper.find(`[data-testid="add-member-${RAHUL}"]`).exists()).toBe(true);
  });

  it("does not offer the signed-in user as a candidate", () => {
    const wrapper = mountModal();
    expect(wrapper.find(`[data-testid="member-picker-row-${OWNER}"]`).exists()).toBe(false);
  });

  it("marks an existing channel member as Added, with no Add button", () => {
    // Somebody other than the viewer who is already in the channel.
    candidates.value = [
      { pubkey: RAJU, communityRole: "member", isInChannel: true },
      { pubkey: RAHUL, communityRole: "member", isInChannel: false },
    ];
    const wrapper = mountModal();
    expect(wrapper.text()).toContain("Added ✓");
    expect(wrapper.find(`[data-testid="add-member-${RAJU}"]`).exists()).toBe(false);
    expect(wrapper.find(`[data-testid="add-member-${RAHUL}"]`).exists()).toBe(true);
  });

  it("never lists the same person twice", () => {
    const wrapper = mountModal();
    expect(wrapper.findAll(`[data-testid="member-picker-row-${RAJU}"]`)).toHaveLength(1);
  });

  it("filters by display name", async () => {
    const wrapper = mountModal();
    await wrapper.find('[data-testid="member-picker-search"]').setValue("rah");
    expect(wrapper.text()).toContain("Rahul Kumar");
    expect(wrapper.text()).not.toContain("Raju Sharma");
  });

  it("filters by designation/about text too", async () => {
    const wrapper = mountModal();
    await wrapper.find('[data-testid="member-picker-search"]').setValue("Software");
    expect(wrapper.text()).toContain("Raju Sharma");
    expect(wrapper.text()).not.toContain("Rahul Kumar");
  });

  it("publishes the channel add-member event and refreshes membership", async () => {
    const wrapper = mountModal();
    await wrapper.find(`[data-testid="add-member-${RAJU}"]`).trigger("click");
    await flushPromises();
    expect(addMember).toHaveBeenCalledWith({ pubkey: RAJU });
    expect(refetch).toHaveBeenCalled();
  });

  it("hides Add entirely for someone who cannot manage members", () => {
    canManage.value = false;
    const wrapper = mountModal();
    expect(wrapper.find(`[data-testid="add-member-${RAJU}"]`).exists()).toBe(false);
  });

  it("surfaces a relay rejection instead of pretending the add worked", async () => {
    addMember.mockRejectedValueOnce(new Error("refused"));
    const wrapper = mountModal();
    await wrapper.find(`[data-testid="add-member-${RAJU}"]`).trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="add-member-error"]').exists()).toBe(true);
  });

  it("says so when everyone is already in the channel, instead of showing an empty box", () => {
    candidates.value = [
      { pubkey: OWNER, communityRole: "owner", isInChannel: true },
      { pubkey: RAJU, communityRole: "member", isInChannel: true },
    ];
    expect(mountModal().text()).toContain("All community members are already in this channel.");
  });

  it("says so when the community has no other members", () => {
    candidates.value = [{ pubkey: OWNER, communityRole: "owner", isInChannel: true }];
    expect(mountModal().text()).toContain("All community members are already in this channel.");
  });

  it("says so when a search matches nobody", async () => {
    const wrapper = mountModal();
    await wrapper.find('[data-testid="member-picker-search"]').setValue("zzzz");
    expect(wrapper.text()).toContain("No members match that search.");
  });

  it("reports an error state with a retry instead of an empty list", () => {
    isError.value = true;
    expect(mountModal().text()).toContain("Couldn't load community members");
  });
});
