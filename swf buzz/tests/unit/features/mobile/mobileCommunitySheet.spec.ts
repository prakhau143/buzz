/**
 * The mobile community selector drives the SAME switch as the desktop rail and
 * sidebar switcher — no second source of truth.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { Membership, ProbeOutcome } from "@/features/access/communityDiscovery";

const A = "wss://buzz.lmdconsulting.com";
const B = "wss://buzzdev.lmdconsulting.com";

let discovered: Membership[] = [];
let probes: Record<string, ProbeOutcome> = {};
vi.mock("@/features/access/communityDiscovery", () => ({
  discoverMemberships: async () => ({ memberships: discovered, unreachable: [], gone: [], asked: discovered.length }),
  probeMembership: async (url: string) => probes[url] ?? { status: "unreachable" },
}));
const switchCalls: string[] = [];
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    switchCommunity: async (url: string) => {
      switchCalls.push(url);
      rc.setActiveRelay(url);
    },
    isLoading: ref(false),
    error: ref(null),
  }),
}));
const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/communities/communityIcon", () => ({ fetchCommunityIcon: async () => null }));

const rc = await import("@/features/communities/relayCommunities");
const { useConnectionStore } = await import("@/stores/connection");
const { useSessionStore } = await import("@/stores/session");
const { useAccessStore } = await import("@/stores/access");
const MobileCommunitySheet = (await import("@/features/mobile/ui/MobileCommunitySheet.vue")).default;
const CommunityRail = (await import("@/layouts/CommunityRail.vue")).default;

const m = (relayUrl: string, role: Membership["role"]): Membership => ({ relayUrl, host: relayUrl, name: relayUrl, role });
function members(list: Membership[]) {
  discovered = list;
  useAccessStore().$patch({ memberships: list });
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
  rc.clearCommunitiesForTests();
  rc.addCommunity(A);
  rc.addCommunity(B);
  rc.setActiveRelay(A);
  useSessionStore().$patch({ pubkey: "8".repeat(64) });
  useConnectionStore().setStatus("connected");
  switchCalls.length = 0;
  probes = {};
  push.mockReset();
  members([m(A, "member"), m(B, "member")]);
});

describe("MobileCommunitySheet", () => {
  it("shows CURRENT (with connection state) and OTHER verified communities", async () => {
    mount(MobileCommunitySheet, { attachTo: document.body });
    await flushPromises();
    expect(q("[data-testid=community-sheet-current]")?.textContent).toContain("buzz.lmdconsulting.com");
    expect(q("[data-testid=community-sheet-current]")?.textContent).toContain("Connected");
    expect(qa("[data-testid=community-sheet-item]").map((e) => e.textContent)).toEqual([
      expect.stringContaining("buzzdev.lmdconsulting.com"),
    ]);
  });

  it("switching uses the shared switch: verified, then switched; the desktop rail agrees; the sheet closes", async () => {
    probes[B] = { status: "member", role: "member" };
    const sheet = mount(MobileCommunitySheet, { attachTo: document.body });
    mount(CommunityRail, { attachTo: document.body });
    await flushPromises();
    qa("[data-testid=community-sheet-item]")[0].click();
    await flushPromises();
    expect(switchCalls).toEqual([B]);
    expect(rc.activeRelayUrl.value).toBe(B);
    expect(q(`[data-testid=community-rail-item][data-relay='${B}']`)?.getAttribute("aria-current")).toBe("true");
    expect(sheet.emitted("close")).toHaveLength(1);
  });

  it("a refused switch keeps the current community and shows the shared error", async () => {
    probes[B] = { status: "not_member" };
    mount(MobileCommunitySheet, { attachTo: document.body });
    await flushPromises();
    qa("[data-testid=community-sheet-item]")[0].click();
    await flushPromises();
    expect(switchCalls).toEqual([]);
    expect(rc.activeRelayUrl.value).toBe(A);
    expect(q("[data-testid=community-sheet-error]")?.textContent).toContain("not a member");
  });

  it("Add community opens the existing flow and closes the sheet", async () => {
    const sheet = mount(MobileCommunitySheet, { attachTo: document.body });
    await flushPromises();
    q("[data-testid=community-sheet-add]")!.click();
    expect(push).toHaveBeenCalledWith({ name: "communities" });
    expect(sheet.emitted("close")).toHaveLength(1);
  });

  it("is an accessible modal dialog", async () => {
    mount(MobileCommunitySheet, { attachTo: document.body });
    await flushPromises();
    const dialog = q("[data-testid=community-sheet]")!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(q("#community-sheet-title")?.textContent).toBe("Select community");
  });
});
