/**
 * Community rail: fast switching beside the existing switcher. Both drive the
 * one `useCommunitySwitch`, so they list the same verified communities, show
 * the same in-progress state and error, and agree on the active community.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { Membership, ProbeOutcome } from "@/features/access/communityDiscovery";

const A = "wss://buzz.lmdconsulting.com";
const B = "wss://acme.example.com";
const C = "ws://swf-development-179009.localhost:3000";
const D = "wss://dev.example.com";

let discovered: Membership[] = [];
let probes: Record<string, ProbeOutcome> = {};
vi.mock("@/features/access/communityDiscovery", () => ({
  discoverMemberships: async () => ({ memberships: discovered, unreachable: [], gone: [], asked: discovered.length }),
  probeMembership: async (url: string) => probes[url] ?? { status: "unreachable" },
}));

const switchCalls: string[] = [];
let switchBehaviour: (url: string) => void | Promise<void> = () => undefined;
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    switchCommunity: async (url: string) => {
      switchCalls.push(url);
      await switchBehaviour(url);
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
const CommunityRail = (await import("@/layouts/CommunityRail.vue")).default;
const CommunitySwitcher = (await import("@/layouts/CommunitySwitcher.vue")).default;

const m = (relayUrl: string, role: Membership["role"], name = relayUrl): Membership => ({ relayUrl, host: relayUrl, name, role });
/** What the relays confirm — the store AND discovery agree, as after a real sign-in. */
function members(list: Membership[]) {
  discovered = list;
  useAccessStore().$patch({ memberships: list });
}
const railItems = () => [...document.querySelectorAll<HTMLButtonElement>("[data-testid=community-rail-item]")];

function mountRail() {
  return mount(CommunityRail, { attachTo: document.body });
}

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
  rc.clearCommunitiesForTests();
  for (const url of [A, B, C, D]) rc.addCommunity(url); // remembered candidates, in added order
  rc.setActiveRelay(A);
  useSessionStore().$patch({ pubkey: "8".repeat(64) });
  useConnectionStore().setStatus("connected");
  discovered = [];
  probes = {};
  switchCalls.length = 0;
  switchBehaviour = (url) => rc.setActiveRelay(url);
  push.mockReset();
});

describe("CommunityRail list", () => {
  it("shows the current community plus verified memberships, in the order they were added", async () => {
    // Relays confirmed D and B; C (remembered) is not a member and is not listed.
    members([m(D, "member", "LMD Development"), m(A, "owner"), m(B, "admin", "Acme")]);
    mountRail();
    await flushPromises();
    expect(railItems().map((b) => b.dataset.relay)).toEqual([A, B, D]);
    expect(railItems()[0].getAttribute("aria-current")).toBe("true");
    expect(railItems()[0].getAttribute("aria-label")).toBe("buzz.lmdconsulting.com, current community");
    expect(railItems()[1].getAttribute("aria-label")).toBe("Switch to acme.example.com");
    expect(document.querySelector("[data-relay='" + C + "']")).toBeNull();
  });

  it("with no other membership, shows just the current community and Add", async () => {
    mountRail();
    await flushPromises();
    expect(railItems().map((b) => b.dataset.relay)).toEqual([A]);
    expect(document.querySelector("[data-testid=community-rail-add]")).not.toBeNull();
  });

  it("shows the active community's connection dot", async () => {
    mountRail();
    await flushPromises();
    expect(railItems()[0].querySelector(".status-dot.on")).not.toBeNull();
    useConnectionStore().setStatus("connecting");
    await flushPromises();
    expect(railItems()[0].querySelector(".status-dot.on")).toBeNull();
  });
});

describe("CommunityRail switching", () => {
  it("clicking another community switches immediately (verify, then switch)", async () => {
    members([m(A, "member"), m(B, "member", "Acme")]);
    probes[B] = { status: "member", role: "member" };
    mountRail();
    await flushPromises();
    railItems()[1].click();
    await flushPromises();
    expect(switchCalls).toEqual([B]);
    expect(rc.activeRelayUrl.value).toBe(B);
    expect(railItems().find((b) => b.dataset.relay === B)?.getAttribute("aria-current")).toBe("true");
  });

  it("clicking the active community does nothing", async () => {
    mountRail();
    await flushPromises();
    railItems()[0].click();
    await flushPromises();
    expect(switchCalls).toEqual([]);
  });

  it("a target that is no longer a member never tears down the current community; the error is shown", async () => {
    members([m(A, "member"), m(B, "member", "Acme")]);
    probes[B] = { status: "not_member" };
    mountRail();
    await flushPromises();
    railItems()[1].click();
    await flushPromises();
    expect(switchCalls).toEqual([]);
    expect(rc.activeRelayUrl.value).toBe(A);
    expect(document.querySelector("[data-testid=community-rail-error]")?.textContent).toContain("not a member");
  });

  it("+ opens the existing Add Community flow", async () => {
    mountRail();
    await flushPromises();
    (document.querySelector("[data-testid=community-rail-add]") as HTMLElement).click();
    expect(push).toHaveBeenCalledWith({ name: "communities" });
  });
});

describe("one source of truth with the sidebar switcher", () => {
  it("a switch from the rail shows as in progress in the switcher, and both land on the new community", async () => {
    members([m(A, "member"), m(B, "member", "Acme")]);
    probes[B] = { status: "member", role: "member" };
    let finish: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => (finish = resolve));
    switchBehaviour = (url) => {
      rc.setActiveRelay(url);
      useConnectionStore().setStatus("connecting");
      return blocked;
    };
    mountRail();
    const switcher = mount(CommunitySwitcher, { attachTo: document.body });
    await flushPromises();

    railItems()[1].click();
    await flushPromises();
    expect(railItems()[1].getAttribute("aria-busy")).toBe("true");
    expect(switcher.find("[data-testid=community-switcher-status]").text()).toBe("Switching to acme.example.com…");
    // Other rail items can't start a second switch meanwhile.
    expect(railItems()[0].disabled).toBe(true);

    useConnectionStore().setStatus("connected");
    finish();
    await flushPromises();
    expect(switcher.find("[data-testid=community-switcher-name]").text()).toBe("acme.example.com");
    expect(railItems().find((b) => b.dataset.relay === B)?.getAttribute("aria-current")).toBe("true");
  });
});

describe("CommunityRail accessibility", () => {
  it("is a labelled nav; arrow keys move between items; focus shows a tooltip with the name", async () => {
    members([m(A, "member"), m(B, "member", "Acme")]);
    const w = mountRail();
    await flushPromises();
    expect(w.find("nav").attributes("aria-label")).toBe("Communities");

    railItems()[0].focus();
    await w.findAll("[data-testid=community-rail-item]")[0].trigger("focus");
    expect(document.querySelector("[data-testid=community-rail-tooltip]")?.textContent).toContain("buzz.lmdconsulting.com");

    await w.find("nav").trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    expect(document.activeElement).toBe(railItems()[1]);
    await w.find("nav").trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    expect(document.activeElement?.getAttribute("data-testid")).toBe("community-rail-add");
  });
});
