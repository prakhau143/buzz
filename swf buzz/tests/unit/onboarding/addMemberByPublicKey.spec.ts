import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { nip19 } from "nostr-tools";
import { ref } from "vue";
import CommunityMembersPanel from "@/features/community-members/ui/CommunityMembersPanel.vue";
import { addCommunity, clearCommunitiesForTests, setActiveRelay } from "@/features/communities/relayCommunities";
import { parseInviteInput } from "@/features/communities/RelayInviteService";

/**
 * "Owner adds a person by their PUBLIC key". The relay already supports this
 * (NIP-43 kind 9030 from an owner/admin, `p` tag + optional role) — the app just
 * publishes that event through the existing RelayMembersService; there is no
 * frontend membership list.
 */
const RAHUL = "ab".repeat(32);
const RAHUL_NPUB = nip19.npubEncode(RAHUL);

const addMember = vi.fn();
vi.mock("@/features/community-members/useCommunityMembers", () => ({
  useCommunityMembers: () => ({
    data: ref([{ pubkey: "1".repeat(64), role: "owner" }]),
    isLoading: ref(false),
    isError: ref(false),
    refetch: vi.fn(),
    myRole: ref("owner"),
    canManage: ref(true),
    addMember: (...args: unknown[]) => addMember(...args),
    isAdding: ref(false),
    addError: ref(null),
    removeMember: vi.fn(),
    isRemoving: ref(false),
    changeRole: vi.fn(),
    isChangingRole: ref(false),
  }),
}));
vi.mock("@/features/moderation/useModerationQueue", () => ({
  useModerationRestrictions: () => ({ data: ref([]) }),
}));
vi.mock("@/features/moderation/useModerationActions", () => ({
  useModerationActions: () => ({ ban: vi.fn(), unban: vi.fn(), timeout: vi.fn(), untimeout: vi.fn() }),
}));

function mountPanel() {
  // The roster now resolves display names through the batched profile query
  // (`useProfileMap`) so search can match on name, so the panel needs a real
  // query client. Nothing about the add-member behaviour under test changed.
  return mount(CommunityMembersPanel, {
    global: {
      plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
      stubs: { CommunityMemberRow: true },
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  addMember.mockReset();
  addMember.mockResolvedValue(undefined);
  localStorage.clear();
  clearCommunitiesForTests();
  addCommunity("ws://swf.localhost:3000", "SWF Developers");
  setActiveRelay("ws://swf.localhost:3000");
});

describe("owner adds a member by public key", () => {
  it("accepts an npub: publishes the add-member request for the HEX key with the chosen role", async () => {
    const wrapper = mountPanel();
    await wrapper.find("[data-testid=add-member-pubkey]").setValue(RAHUL_NPUB);
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(addMember).toHaveBeenCalledWith({ pubkey: RAHUL, role: "member" });
  });

  it("accepts the 64-char hex key too", async () => {
    const wrapper = mountPanel();
    await wrapper.find("[data-testid=add-member-pubkey]").setValue(RAHUL.toUpperCase());
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(addMember).toHaveBeenCalledWith({ pubkey: RAHUL, role: "member" });
  });

  it("then shows the link to send them: swfbuzz://connect with the community address and name, and no secret", async () => {
    const wrapper = mountPanel();
    await wrapper.find("[data-testid=add-member-pubkey]").setValue(RAHUL_NPUB);
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    const link = wrapper.find("[data-testid=member-added-link]").text();
    expect(link).toBe("swfbuzz://connect?relay=ws%3A%2F%2Fswf.localhost%3A3000&name=SWF+Developers");
    expect(link).not.toMatch(/nsec|ncryptsec|code=|v2\./);
    expect(link.startsWith("buzz://")).toBe(false);
    expect(wrapper.find("[data-testid=member-added]").text()).toContain("Added");
  });

  it("does not add — and shows nothing — for something that is not a public key (a private key is refused too)", async () => {
    const wrapper = mountPanel();
    for (const bad of ["hello", "nsec1" + "q".repeat(58), "ab".repeat(31)]) {
      await wrapper.find("[data-testid=add-member-pubkey]").setValue(bad);
      expect(wrapper.find("[data-testid=add-member-problem]").exists(), bad).toBe(true);
      expect(wrapper.find("[data-testid=add-member-submit]").attributes("disabled"), bad).toBeDefined();
    }
    await wrapper.find("form").trigger("submit");
    expect(addMember).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid=member-added]").exists()).toBe(false);
  });

  it("when the relay refuses the add, no link is offered", async () => {
    addMember.mockRejectedValue(new Error("actor not authorized"));
    const wrapper = mountPanel();
    await wrapper.find("[data-testid=add-member-pubkey]").setValue(RAHUL_NPUB);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find("[data-testid=member-added]").exists()).toBe(false);
  });

  it("the link brings the person straight to the community: the app parses it as a connect link (the relay still decides)", () => {
    // The Rust parser is tested in deeplink.rs; here: what the *paste box* makes of it — a
    // connect link is not an invite, so it can never be used to claim anything.
    expect(parseInviteInput("swfbuzz://connect?relay=ws%3A%2F%2Fswf.localhost%3A3000&name=SWF", null)).toBeNull();
  });
});
