/**
 * Community roster UI — search, role filter, count, sorting, and the
 * destructive-confirmation contract.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { ref } from "vue";
import CommunityMembersPanel from "@/features/community-members/ui/CommunityMembersPanel.vue";
import CommunityMemberRow from "@/features/community-members/ui/CommunityMemberRow.vue";
import {
  addCommunity,
  clearCommunitiesForTests,
  setActiveRelay,
} from "@/features/communities/relayCommunities";

const OWNER = "1".repeat(64);
const ADMIN = "2".repeat(64);
const MEMBER = "3".repeat(64);

vi.mock("@/features/community-members/useCommunityMembers", () => ({
  useCommunityMembers: () => ({
    data: ref([
      // Deliberately unsorted, so the sort assertion means something.
      { pubkey: MEMBER, role: "member" },
      { pubkey: OWNER, role: "owner" },
      { pubkey: ADMIN, role: "admin" },
    ]),
    isLoading: ref(false),
    isError: ref(false),
    refetch: vi.fn(),
    myRole: ref("owner"),
    canManage: ref(true),
    addMember: vi.fn(),
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
  useModerationActions: () => ({
    ban: vi.fn(),
    unban: vi.fn(),
    timeout: vi.fn(),
    untimeout: vi.fn(),
  }),
}));
vi.mock("@/composables/useProfile", () => ({
  useProfile: () => ({ data: ref({ displayName: "Prakhar", designation: "Engineer" }) }),
  useProfileMap: () => ({
    profiles: ref(
      new Map([
        [OWNER, { displayName: "Alice", designation: "Founder" }],
        [ADMIN, { displayName: "Bob", designation: "Ops" }],
        [MEMBER, { displayName: "Carol", designation: "Design" }],
      ]),
    ),
    displayNames: ref(new Map()),
  }),
}));

function mountPanel() {
  return mount(CommunityMembersPanel, {
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  clearCommunitiesForTests();
  addCommunity("ws://swf.localhost:3000", "SWF");
  setActiveRelay("ws://swf.localhost:3000");
});

describe("community roster", () => {
  it("shows the member count", () => {
    expect(mountPanel().get('[data-testid="member-count"]').text()).toBe("3 members");
  });

  it("sorts owner, then admin, then member", () => {
    const rows = mountPanel().findAllComponents(CommunityMemberRow);
    expect(rows.map((r) => r.props("member").role)).toEqual(["owner", "admin", "member"]);
  });

  it("filters by name and reports the narrowed count", async () => {
    const panel = mountPanel();
    await panel.get('[data-testid="member-search"]').setValue("carol");

    expect(panel.findAllComponents(CommunityMemberRow)).toHaveLength(1);
    expect(panel.get('[data-testid="member-count"]').text()).toBe("1 of 3 members");
  });

  it("searches designation too, not just the name", async () => {
    const panel = mountPanel();
    await panel.get('[data-testid="member-search"]').setValue("ops");

    const rows = panel.findAllComponents(CommunityMemberRow);
    expect(rows).toHaveLength(1);
    expect(rows[0].props("member").pubkey).toBe(ADMIN);
  });

  it("finds a person by a pasted public key", async () => {
    const panel = mountPanel();
    await panel.get('[data-testid="member-search"]').setValue(MEMBER);

    expect(panel.findAllComponents(CommunityMemberRow)).toHaveLength(1);
  });

  it("shows an empty state rather than a bare list when nothing matches", async () => {
    const panel = mountPanel();
    await panel.get('[data-testid="member-search"]').setValue("nobody-by-that-name");

    expect(panel.findAllComponents(CommunityMemberRow)).toHaveLength(0);
    expect(panel.text()).toContain("No one matches");
  });
});

describe("member row destructive actions", () => {
  function mountRow(props: Record<string, unknown> = {}) {
    return mount(CommunityMemberRow, {
      global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
      props: {
        member: { pubkey: MEMBER, role: "member" },
        myRole: "owner",
        isSelf: false,
        canManage: true,
        busy: false,
        ...props,
      },
    });
  }

  it("does not ban on the first click — it asks, and names the person", async () => {
    const row = mountRow();
    await row.get(`[data-testid="member-actions-${MEMBER.slice(0, 8)}"]`).trigger("click");
    await row.get('[data-testid="member-ban"]').trigger("click");

    expect(row.emitted("ban")).toBeUndefined();
    expect(row.text()).toContain("Ban Prakhar?");
  });

  it("emits ban only after the confirmation is accepted", async () => {
    const row = mountRow();
    await row.get(`[data-testid="member-actions-${MEMBER.slice(0, 8)}"]`).trigger("click");
    await row.get('[data-testid="member-ban"]').trigger("click");
    await row.get('[data-testid="member-confirm-destructive"]').trigger("click");

    expect(row.emitted("ban")).toHaveLength(1);
  });

  it("names the person when removing, too", async () => {
    const row = mountRow();
    await row.get(`[data-testid="member-actions-${MEMBER.slice(0, 8)}"]`).trigger("click");
    await row.get('[data-testid="member-remove"]').trigger("click");

    expect(row.text()).toContain("Remove Prakhar?");
    expect(row.emitted("remove")).toBeUndefined();
  });

  it("emits a timeout DURATION, not a hard-coded 24h", async () => {
    const row = mountRow();
    await row.get(`[data-testid="member-actions-${MEMBER.slice(0, 8)}"]`).trigger("click");
    await row.get('[data-testid="member-timeout"]').trigger("click");
    await row.get('[data-testid="timeout-600"]').trigger("click");

    expect(row.emitted("timeout")).toEqual([[600]]);
  });

  it("offers a plain member no actions over an owner", () => {
    const row = mountRow({ member: { pubkey: OWNER, role: "owner" }, myRole: "member" });

    expect(row.find('[data-testid="member-ban"]').exists()).toBe(false);
    expect(row.find('[data-testid="member-remove"]').exists()).toBe(false);
  });
});
