/**
 * Community switcher: only communities the relay confirms (owner/admin/member)
 * are listed; remembered-but-not-member / unreachable / role-less candidates are
 * not. A switch re-verifies the target BEFORE leaving the current community, and
 * restores the current one if the target still fails.
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

const authError = ref<string | null>(null);
const switchCalls: string[] = [];
let switchBehaviour: (url: string) => void | Promise<void> = () => undefined;
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    switchCommunity: async (url: string) => {
      switchCalls.push(url);
      await switchBehaviour(url);
    },
    isLoading: ref(false),
    error: authError,
  }),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Community avatars read the relay's NIP-11 icon; no network in unit tests.
vi.mock("@/features/communities/communityIcon", () => ({ fetchCommunityIcon: async () => null }));

const rc = await import("@/features/communities/relayCommunities");
const { useConnectionStore } = await import("@/stores/connection");
const { useSessionStore } = await import("@/stores/session");
const { accessibleOnly, isAccessibleRole } = await import("@/features/communities/useAccessibleCommunities");
const CommunitySwitcher = (await import("@/layouts/CommunitySwitcher.vue")).default;

const m = (relayUrl: string, role: Membership["role"], name = relayUrl): Membership => ({
  relayUrl,
  host: relayUrl,
  name,
  role,
});

async function openSwitcher() {
  const w = mount(CommunitySwitcher, { attachTo: document.body });
  await w.find("[data-testid=community-switcher]").trigger("click");
  await flushPromises();
  return w;
}
const items = () => [...document.querySelectorAll<HTMLElement>("[data-testid=community-switcher-item]")];

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
  rc.clearCommunitiesForTests();
  for (const url of [A, B, C, D]) rc.addCommunity(url); // all remembered (candidates)
  rc.setActiveRelay(A);
  useSessionStore().$patch({ pubkey: "8".repeat(64) });
  useConnectionStore().setStatus("connected");
  discovered = [];
  probes = {};
  switchCalls.length = 0;
  switchBehaviour = (url) => rc.setActiveRelay(url);
  authError.value = null;
});

describe("accessibility rule", () => {
  it("owner, admin and member are accessible; anything else is not", () => {
    expect(["owner", "admin", "member"].every((r) => isAccessibleRole(r as never))).toBe(true);
    expect(isAccessibleRole(null)).toBe(false);
    expect(accessibleOnly([m(A, "owner"), m(B, "admin"), m(D, "member"), m(C, null)]).map((x) => x.relayUrl)).toEqual([A, B, D]);
  });
});

describe("CommunitySwitcher list", () => {
  it("shows only verified communities: the remembered non-member localhost relay is not listed", async () => {
    // Candidates A,B,C,D are remembered; the relays confirm B (admin) and D (member).
    // C answered not-member, so discovery doesn't return it.
    discovered = [m(A, "member"), m(B, "admin", "Acme"), m(D, "member", "LMD Development")];
    await openSwitcher();
    const labels = items().map((i) => i.textContent ?? "");
    expect(labels).toHaveLength(2);
    expect(labels.some((l) => l.includes("Acme") && l.includes("Admin"))).toBe(true);
    expect(labels.some((l) => l.includes("LMD Development") && l.includes("Member"))).toBe(true);
    expect(labels.some((l) => l.includes("swf-development"))).toBe(false);
  });

  it("a candidate the relay lets in without a roster role is not a verified member", async () => {
    discovered = [m(A, "member"), m(C, null)];
    await openSwitcher();
    expect(items()).toHaveLength(0);
  });

  it("only the current community when that's the only membership", async () => {
    discovered = [m(A, "owner")];
    await openSwitcher();
    expect(items()).toHaveLength(0);
    expect(document.querySelector("[data-testid=community-switcher-current]")?.textContent).toContain("buzz.lmdconsulting.com");
    expect(document.querySelector("[data-testid=community-switcher-add]")).not.toBeNull();
  });
});

describe("CommunitySwitcher switching", () => {
  it("verified target → switches (A → B)", async () => {
    discovered = [m(A, "member"), m(B, "member", "Acme")];
    probes[B] = { status: "member", role: "member" };
    await openSwitcher();
    items()[0].click();
    await flushPromises();
    expect(switchCalls).toEqual([B]);
    expect(rc.activeRelayUrl.value).toBe(B);
  });

  it("target no longer a member at click time → never leaves A", async () => {
    discovered = [m(A, "member"), m(B, "member", "Acme")];
    probes[B] = { status: "not_member" };
    await openSwitcher();
    items()[0].click();
    await flushPromises();
    expect(switchCalls).toEqual([]); // A was never torn down
    expect(rc.activeRelayUrl.value).toBe(A);
    expect(document.querySelector("[data-testid=community-switcher-error]")?.textContent).toContain("not a member");
  });

  it("target fails after verification → A is restored, with an explanation", async () => {
    discovered = [m(A, "member"), m(B, "member", "Acme")];
    probes[B] = { status: "member", role: "member" };
    switchBehaviour = (url) => {
      rc.setActiveRelay(url);
      useConnectionStore().setStatus(url === B ? "error" : "connected", url === B ? "refused" : null);
    };
    await openSwitcher();
    items()[0].click();
    await flushPromises();
    expect(switchCalls).toEqual([B, A]);
    expect(rc.activeRelayUrl.value).toBe(A);
    expect(document.querySelector("[data-testid=community-switcher-error]")?.textContent).toContain("still in buzz.lmdconsulting.com");
  });
});

describe("CommunitySwitcher header during a switch", () => {
  it("keeps naming A (with 'Switching to B…') until B is ready — the name never runs ahead of the content", async () => {
    discovered = [m(A, "member"), m(B, "member", "Acme")];
    probes[B] = { status: "member", role: "member" };
    let finish: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => (finish = resolve));
    switchBehaviour = (url) => {
      // The real switch makes B active right away, then connects/authenticates.
      rc.setActiveRelay(url);
      useConnectionStore().setStatus("connecting");
      return blocked;
    };
    const w = await openSwitcher();
    const name = () => w.find("[data-testid=community-switcher-name]").text();
    const status = () => w.find("[data-testid=community-switcher-status]").text();
    expect(name()).toBe("buzz.lmdconsulting.com");

    items()[0].click();
    await flushPromises();

    expect(rc.activeRelayUrl.value).toBe(B);
    expect(name()).toBe("buzz.lmdconsulting.com");
    expect(status()).toBe("Switching to acme.example.com…");

    useConnectionStore().setStatus("connected");
    finish();
    await flushPromises();
    expect(name()).toBe("acme.example.com");
    expect(status()).toBe("Connected");
  });
});
