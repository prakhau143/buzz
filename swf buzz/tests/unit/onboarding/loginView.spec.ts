import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { defineComponent, h } from "vue";
import LoginView from "@/views/LoginView.vue";
import { useConnectionStore } from "@/stores/connection";
import { useSessionStore } from "@/stores/session";
import { clearPendingLink, pendingLink, setPendingLink } from "@/features/deeplink/pendingLink";
import {
  addCommunity,
  clearCommunitiesForTests,
} from "@/features/communities/relayCommunities";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { clearActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { json } from "../helpers/fakeSigner";

/** Flush promises, allow real timers/IO in the async claim chain to run, flush again. */
const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await flushPromises();
};

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => true,
}));
vi.mock("@/services/RelayConnectionService", () => ({
  relayConnectionService: {
    connect: vi.fn(async () => {
      useConnectionStore().setStatus("connected");
    }),
    disconnect: vi.fn(),
  },
}));
vi.mock("@/features/community-members/RelayMembersService", () => ({
  relayMembersService: { fetchMembershipList: vi.fn(async () => null) },
}));
// A profile belongs to the identity, not to a community: the landing route asks
// across every community this identity knows (features/profile/identityProfile.ts).
vi.mock("@/features/profile/identityProfile", () => ({
  hasIdentityProfileAnywhere: vi.fn(async () => true),
}));
vi.mock("@/services/ProfileService", () => ({
  profileService: { hasProfile: vi.fn(async () => true) },
}));
// Post-sign-in routing asks the relay "operator?" and "which communities?" — controlled here.
const discoverMock = vi.fn();
vi.mock("@/features/access/communityDiscovery", () => ({
  discoverMemberships: (...args: unknown[]) => discoverMock(...args),
}));
const isOperatorMock = vi.fn();
vi.mock("@/features/communities/OperatorService", () => ({
  operatorService: {
    isOperator: (...args: unknown[]) => isOperatorMock(...args),
    // Same answer with its evidence; the signer is the identity being asked about.
    probeOperator: async (relay: string, forPubkey: string | null = null) => ({
      status: (await isOperatorMock(relay)) ? 200 : 403,
      signerPubkey: forPubkey,
      error: null,
      origin: "http://localhost:3000",
    }),
  },
}));
const HOME = { relayUrl: "ws://localhost:3000", host: "localhost:3000", name: "localhost:3000", role: "member" };
const ACME = { relayUrl: "ws://acme.localhost:3000", host: "acme.localhost:3000", name: "Acme", role: "member" };
const found = (memberships: object[], unreachable: string[] = [], asked = memberships.length + unreachable.length) => ({
  memberships,
  unreachable,
  asked,
});

const PK = "ab".repeat(32);
const IDENTITY = { pubkey: PK, npub: "npub1x", storage: "system-keyring", recovery: "none" };
const NONE = { pubkey: null, npub: null, storage: "none", recovery: "none" };
const CODE = "v2." + "D".repeat(43);

let identity: Record<string, unknown> = IDENTITY;
function tauri(extra: Record<string, (args?: unknown) => unknown> = {}) {
  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (extra[command]) return extra[command](args);
    if (command === "get_identity") return identity;
    // The import form's "Check key" step (two-step import since the
    // operator-key incident) — answered by default; tests that care override it.
    if (command === "preview_identity_input") return { pubkey: PK, npub: "npub1x", looksLikeBareHex: false };
    throw new Error(`unexpected Tauri command: ${command}`);
  });
}

/** Import is two-step now: "Check key" (resolves the identity, stores nothing) → submit. */
async function checkThenSubmit(wrapper: { find: (s: string) => { trigger: (e: string) => Promise<unknown> } }) {
  await wrapper.find("[data-testid=import-check]").trigger("click");
  await settle();
  await wrapper.find("form").trigger("submit");
  await settle();
}

function makeRouter() {
  const page = { render: () => h("div") };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", name: "login", component: page },
      { path: "/join", name: "join", component: page },
      { path: "/channels", name: "channels", component: page },
      { path: "/profile-setup", name: "profile-setup", component: page },
      { path: "/welcome", name: "welcome", component: page },
      { path: "/operator", name: "operator", component: page },
      { path: "/communities", name: "communities", component: page },
      { path: "/", name: "home", component: page },
    ],
  });
}

/**
 * The person's community choice after sign-in — exactly what "Choose a
 * community" does (useAuth().switchCommunity). Sign-in itself never opens one.
 */
async function chooseCommunity(router: Router, relayUrl = HOME.relayUrl) {
  const { useAuth } = await import("@/features/auth/useAuth");
  let auth!: ReturnType<typeof useAuth>;
  mount(defineComponent({ setup: () => ((auth = useAuth()), () => h("div")) }), { global: { plugins: [router] } });
  await auth.switchCommunity(relayUrl);
  await settle();
}

async function mountLogin() {
  const router = makeRouter();
  await router.push("/login");
  const wrapper = mount(LoginView, { global: { plugins: [router] } });
  await settle();
  return { wrapper, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
  invokeMock.mockReset();
  vi.mocked(relayConnectionService.connect).mockClear();
  identity = IDENTITY;
  discoverMock.mockReset();
  discoverMock.mockResolvedValue(found([HOME]));
  isOperatorMock.mockReset();
  isOperatorMock.mockResolvedValue(false);
  tauri();
  localStorage.clear();
  clearCommunitiesForTests();
  clearPendingLink();
  clearActiveSigningService();
  vi.unstubAllGlobals();
});
afterEach(() => vi.unstubAllGlobals());

describe("LoginView — first launch and returning launch", () => {
  it("EXISTING IDENTITY: 'Continue with existing identity', no setup, no join panel", async () => {
    const { wrapper } = await mountLogin();
    expect(wrapper.find("[data-testid=continue-identity]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=identity-pubkey]").text()).toBe(`${PK.slice(0, 8)}…${PK.slice(-8)}`);
    expect(wrapper.find("[data-testid=create-identity]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=invite-input]").exists()).toBe(false);
    expect(wrapper.html()).not.toMatch(/okta/i);
  });

  it("NEW IDENTITY: first launch offers create/import — never a login form or a public-key box", async () => {
    identity = NONE;
    const { wrapper } = await mountLogin();
    expect(wrapper.find("[data-testid=create-identity]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=continue-identity]").exists()).toBe(false);
    // nothing on this screen accepts a public key / email / password as a way in
    const types = wrapper.findAll("input").map((i) => i.attributes("type"));
    expect(types.every((t) => t === "password" || t === "checkbox")).toBe(true);
    expect(wrapper.findAll("input[type=email], input[type=text]")).toHaveLength(0);
  });

  it("CREATE: backup password → key generated → keys SHOWN → backup CONFIRMED → only then signs in (Parts C/L)", async () => {
    identity = NONE;
    const REVEAL = { pubkey: PK, npub: "npub1x", nsec: "nsec1testonlyfixture", ncryptsec: "ncryptsec1testonlyfixture" };
    const createWithBackup = vi.fn(() => REVEAL);
    tauri({ create_identity_with_backup: createWithBackup });
    const { wrapper, router } = await mountLogin();

    await wrapper.find("[data-testid=create-identity]").trigger("click");
    await settle();
    // Step 1 — backup password, nothing generated yet
    expect(wrapper.find("[data-testid=create-backup-password]").exists()).toBe(true);
    expect(createWithBackup).not.toHaveBeenCalled();
    await wrapper.find("[data-testid=create-backup-password]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-backup-confirm]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-identity-submit]").trigger("click");
    await settle();
    identity = IDENTITY; // Rust now has the key
    expect(createWithBackup).toHaveBeenCalledTimes(1);
    expect((createWithBackup.mock.calls[0] as unknown[])[0]).toEqual({ password: "correct horse battery" });

    // Step 2 — the reveal: public key visible, private key hidden until "Show", encrypted backup visible
    expect(wrapper.find("[data-testid=reveal-npub]").text()).toBe("npub1x");
    expect(wrapper.find("[data-testid=reveal-nsec]").text()).not.toContain("nsec1");
    await wrapper.find("[data-testid=toggle-nsec]").trigger("click");
    expect(wrapper.find("[data-testid=reveal-nsec]").text()).toBe("nsec1testonlyfixture");
    expect(wrapper.find("[data-testid=reveal-ncryptsec]").text()).toBe("ncryptsec1testonlyfixture");
    expect(relayConnectionService.connect).not.toHaveBeenCalled(); // NOT signed in yet (Part L)
    expect(useSessionStore().pubkey).toBeNull();

    // Step 3 — the warning; Continue is disabled until both boxes are ticked
    await wrapper.find("[data-testid=reveal-next]").trigger("click");
    const cont = () => wrapper.find("[data-testid=continue-to-communities]");
    expect(cont().attributes("disabled")).toBeDefined();
    await wrapper.find("[data-testid=ack-stored]").setValue(true);
    expect(cont().attributes("disabled")).toBeDefined();
    await wrapper.find("[data-testid=ack-loss]").setValue(true);
    expect(cont().attributes("disabled")).toBeUndefined();
    expect(relayConnectionService.connect).not.toHaveBeenCalled();

    // Step 4 — confirmed: sign in, resolve access, and ASK where to work
    await cont().trigger("click");
    await settle();
    expect(useSessionStore().pubkey).toBe(PK);
    expect(router.currentRoute.value.name).toBe("communities");
    expect(relayConnectionService.connect).not.toHaveBeenCalled(); // nothing opened on its own
    await chooseCommunity(router);
    expect(relayConnectionService.connect).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("channels");
    // the private key is not in any store
    expect(JSON.stringify(useSessionStore().$state)).not.toContain("nsec1");
  });

  it("CREATE: leaving the reveal without confirming warns, then returns to 'Identity found' WITHOUT signing in", async () => {
    identity = NONE;
    tauri({ create_identity_with_backup: () => ({ pubkey: PK, npub: "npub1x", nsec: "nsec1testonlyfixture", ncryptsec: "ncryptsec1x" }) });
    const { wrapper } = await mountLogin();
    await wrapper.find("[data-testid=create-identity]").trigger("click");
    await wrapper.find("[data-testid=create-backup-password]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-backup-confirm]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-identity-submit]").trigger("click");
    await settle();
    identity = IDENTITY;

    await wrapper.find("[data-testid=reveal-back]").trigger("click");
    expect(wrapper.find("[data-testid=leave-warning]").exists()).toBe(true);
    await wrapper.find("[data-testid=leave-stay]").trigger("click");
    expect(wrapper.find("[data-testid=leave-warning]").exists()).toBe(false);
    await wrapper.find("[data-testid=reveal-back]").trigger("click");
    await wrapper.find("[data-testid=leave-anyway]").trigger("click");
    await settle();

    expect(wrapper.find("[data-testid=continue-identity]").exists()).toBe(true); // STATE 2, the key is on the device
    expect(relayConnectionService.connect).not.toHaveBeenCalled();
    expect(useSessionStore().pubkey).toBeNull();
    expect(wrapper.html()).not.toContain("nsec1"); // the secret is gone from the DOM
  });

  it("CREATE: a rejected passphrase generates nothing and stays on step 1 with the reason", async () => {
    identity = NONE;
    tauri({ create_identity_with_backup: () => { throw "the backup passphrase must be at least 12 characters"; } });
    const { wrapper } = await mountLogin();
    await wrapper.find("[data-testid=create-identity]").trigger("click");
    await wrapper.find("[data-testid=create-backup-password]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-backup-confirm]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-identity-submit]").trigger("click");
    await settle();
    expect(wrapper.find("[data-testid=create-error]").text()).toContain("at least 12 characters");
    expect(wrapper.find("[data-testid=create-backup-password]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=reveal-npub]").exists()).toBe(false);
  });

  it("importing an identity skips the backup step (it came from a backup) and signs in", async () => {
    identity = NONE;
    tauri({ import_identity: () => IDENTITY });
    const { wrapper, router } = await mountLogin();
    await wrapper.find("[data-testid=show-import]").trigger("click");
    await wrapper.find("[data-testid=import-secret]").setValue("nsec1abcdef");
    identity = IDENTITY;
    await checkThenSubmit(wrapper);

    expect(wrapper.find("[data-testid=backup-passphrase]").exists()).toBe(false);
    expect(router.currentRoute.value.name).toBe("communities");
    await chooseCommunity(router);
    expect(relayConnectionService.connect).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("channels");
  });

  it.each([
    ["keyring-locked", "recovery-locked"],
    ["lost", "recovery-lost"],
    ["corrupt", "recovery-corrupt"],
  ])("RECOVERY %s is explained on the login screen", async (recovery, testId) => {
    identity = { ...NONE, recovery };
    const { wrapper } = await mountLogin();
    expect(wrapper.find(`[data-testid=${testId}]`).exists()).toBe(true);
    if (recovery === "keyring-locked") expect(wrapper.find("[data-testid=create-identity]").exists()).toBe(false);
  });
});

describe("LoginView — identity only (communities are handled AFTER sign-in)", () => {
  it("NO 'Create community' on the login screen — not for a normal user, not even for an operator", async () => {
    const fetchMock = vi.fn(async () => json({ available: true, normalized_host: "operator-probe.invalid" })); // relay would say "operator"
    vi.stubGlobal("fetch", fetchMock);
    for (const who of [IDENTITY, NONE]) {
      identity = who;
      const { wrapper } = await mountLogin();
      expect(wrapper.text()).not.toMatch(/create community/i);
      expect(wrapper.find("[data-testid=login-create-community]").exists()).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled(); // and it doesn't even ask the relay whether you are an operator
  });

  it("NO IDENTITY (STATE 1): 'No identity is stored on this device.', Import existing identity + Create new identity", async () => {
    identity = NONE;
    const { wrapper } = await mountLogin();
    expect(wrapper.find("h1").text()).toBe("SWF Buzz"); // the exact STATE 1 layout: title, then the device truth
    expect(wrapper.find("[data-testid=no-identity]").text()).toBe("No identity is stored on this device.");
    expect(wrapper.find("[data-testid=show-import]").text()).toBe("Import existing identity");
    expect(wrapper.find("[data-testid=create-identity]").text()).toBe("Create new identity");
    expect(wrapper.find("[data-testid=continue-identity]").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Continue with this identity");
  });

  /**
   * The development-mode shortcut signed in with a throwaway in-memory key. Such
   * a key is in no community's `relay_members`, so it resolves to no role and
   * none of the owner/admin/member functionality applies — a confusing session,
   * not a convenient one. It must not come back on either login state.
   */
  it("offers no development-mode sign-in shortcut", async () => {
    for (const state of [NONE, undefined]) {
      if (state === NONE) identity = NONE;
      const { wrapper } = await mountLogin();
      expect(wrapper.text()).not.toContain("Continue in Development Mode");
      expect(wrapper.text()).not.toContain("Development only");
      expect(wrapper.find(".dev-section").exists()).toBe(false);
    }
  });

  it("IDENTITY FOUND (STATE 2): 'Identity found on this device.', the short key, Continue with this identity, Switch / Import another identity", async () => {
    const { wrapper } = await mountLogin();
    expect(wrapper.text()).toContain("Identity found on this device.");
    expect(wrapper.text()).not.toContain("An identity was found on this device."); // the old, confusing wording is gone
    expect(wrapper.text()).not.toContain("Existing identity found");
    expect(wrapper.find("[data-testid=identity-pubkey]").text()).toBe(`${PK.slice(0, 8)}…${PK.slice(-8)}`);
    expect(wrapper.find("[data-testid=continue-identity]").text()).toBe("Continue with this identity");
    expect(wrapper.find("[data-testid=import-another]").text()).toBe("Switch / Import another identity");
    expect(wrapper.find("[data-testid=create-identity]").exists()).toBe(false); // never a second identity by accident
    expect(wrapper.find("[data-testid=switch-success]").exists()).toBe(false); // nothing was switched
  });

  it("SWITCH (STATE 3): names the CURRENT identity, requires the switch tick, and the button says 'Switch identity'", async () => {
    const { wrapper } = await mountLogin();
    await wrapper.find("[data-testid=import-another]").trigger("click");
    expect(wrapper.text()).toContain("Switch identity");
    expect(wrapper.find("[data-testid=replace-warning]").text()).toContain(`Current identity: ${PK.slice(0, 8)}…${PK.slice(-8)}`);
    expect(wrapper.text()).toContain("Import another identity");
    expect(wrapper.find("[data-testid=import-confirm]").exists()).toBe(true);
    expect(wrapper.text()).toContain("I understand this will switch the active identity.");
    expect(wrapper.find("[data-testid=import-submit]").text()).toBe("Switch identity");
  });

  it("the login screen has no invite box and no public-key field", async () => {
    const { wrapper } = await mountLogin();
    expect(wrapper.find("[data-testid=invite-input]").exists()).toBe(false);
    await wrapper.find("[data-testid=import-another]").trigger("click");
    // the only inputs are the secret + confirmation — nothing labelled public key / npub
    expect(wrapper.text()).not.toMatch(/public key.*(login|sign in)/i);
    expect(wrapper.findAll("input[type=text]")).toHaveLength(0);
  });

  it("IMPORT ANOTHER: needs an explicit confirmation, names the swap, then Rust replaces it and the new identity signs in", async () => {
    const OTHER = { ...IDENTITY, pubkey: "cd".repeat(32) };
    const calls: string[] = [];
    tauri({
      replace_identity: (args) => {
        calls.push(JSON.stringify(args));
        identity = OTHER;
        return OTHER;
      },
    });
    const { wrapper, router } = await mountLogin();

    await wrapper.find("[data-testid=import-another]").trigger("click");
    expect(wrapper.find("[data-testid=replace-warning]").text()).toContain("already has an identity");
    await wrapper.find("[data-testid=import-secret]").setValue("nsec1other");
    expect(wrapper.find("[data-testid=import-submit]").attributes("disabled")).toBeDefined(); // not until ticked
    await wrapper.find("[data-testid=import-confirm]").setValue(true);
    await wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    await wrapper.find("form").trigger("submit");
    await settle();

    expect(calls).toEqual([JSON.stringify({ input: "nsec1other", password: null, allowRawHex: false })]);
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain("import_identity"); // never the non-replacing command
    // The IMPORTED identity is the active one — session, and what the screen names.
    expect(useSessionStore().pubkey).toBe(OTHER.pubkey);
    expect(wrapper.find("[data-testid=identity-pubkey]").text()).toBe(`${OTHER.pubkey.slice(0, 8)}…${OTHER.pubkey.slice(-8)}`);
    expect(wrapper.find("[data-testid=switch-success]").text()).toBe("Identity switched successfully");
    expect(router.currentRoute.value.name).toBe("communities"); // the new identity chooses where to work
  });

  it("SWITCH ends the previous session BEFORE Rust replaces the key, and the new identity gets a fresh socket", async () => {
    const OTHER = { ...IDENTITY, pubkey: "cd".repeat(32) };
    // Sign in as the first identity so there is a real session to end.
    const order: string[] = [];
    vi.mocked(relayConnectionService.disconnect).mockImplementation(() => order.push("disconnect"));
    vi.mocked(relayConnectionService.connect).mockImplementation(async (url: string) => {
      order.push(`connect:${url}`);
      useConnectionStore().setStatus("connected");
      useConnectionStore().setAuthenticatedPubkey(useSessionStore().pubkey);
    });
    tauri({
      replace_identity: () => {
        order.push("replace_identity");
        identity = OTHER;
        return OTHER;
      },
    });
    const { wrapper, router } = await mountLogin();
    await wrapper.find("[data-testid=continue-identity]").trigger("click");
    await settle();
    await chooseCommunity(router);
    expect(useSessionStore().pubkey).toBe(PK);
    expect(useConnectionStore().authenticatedPubkey).toBe(PK);
    order.length = 0;

    await wrapper.find("[data-testid=import-another]").trigger("click");
    await wrapper.find("[data-testid=import-secret]").setValue("nsec1other");
    await wrapper.find("[data-testid=import-confirm]").setValue(true);
    await wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    await wrapper.find("form").trigger("submit");
    await settle();
    await chooseCommunity(router); // B picks where to work

    // teardown of A happened before Rust swapped the key, then B connected on its own socket
    expect(order.indexOf("disconnect")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("disconnect")).toBeLessThan(order.indexOf("replace_identity"));
    expect(order.indexOf("replace_identity")).toBeLessThan(order.indexOf("connect:ws://localhost:3000"));
    expect(useSessionStore().pubkey).toBe(OTHER.pubkey);
    expect(useConnectionStore().authenticatedPubkey).toBe(OTHER.pubkey); // the socket is B's, not A's
  });

  it("IMPORT ANOTHER failure keeps the current identity and shows Rust's reason", async () => {
    tauri({
      replace_identity: () => {
        throw "couldn't safely keep your current identity, so nothing was replaced: archive denied";
      },
    });
    const { wrapper } = await mountLogin();
    await wrapper.find("[data-testid=import-another]").trigger("click");
    await wrapper.find("[data-testid=import-secret]").setValue("nsec1other");
    await wrapper.find("[data-testid=import-confirm]").setValue(true);
    await wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    await wrapper.find("form").trigger("submit");
    await settle();

    expect(wrapper.find("[data-testid=login-error]").text()).toContain("nothing was replaced");
    expect(wrapper.find("[data-testid=identity-pubkey]").text()).toContain(PK.slice(0, 8)); // still the old one
    expect(useSessionStore().isReady).toBe(false);
  });

  it("a banned or otherwise refused identity gets the error text", async () => {
    useSessionStore().setAuthError("This identity has been blocked from this community.");
    for (const denial of ["banned", "other", null] as const) {
      useConnectionStore().setAuthDenial(denial);
      const { wrapper } = await mountLogin();
      expect(wrapper.find("[data-testid=login-error]").text(), String(denial)).toContain("blocked");
    }
  });
});

describe("LoginView — after an SWF sign-out (the identity was removed from the device)", () => {
  it("shows STATE 1 — no stale identity, no 'Continue with this identity' — and B can import", async () => {
    // Sign in as A through the real auth composable, then sign out: Rust
    // removes the identity; the screen must then reflect the clean device.
    const OTHER = { ...IDENTITY, pubkey: "cd".repeat(32) };
    tauri({
      delete_identity: () => {
        identity = NONE;
        return NONE;
      },
      import_identity: () => {
        identity = OTHER;
        return OTHER;
      },
    });
    const { wrapper, router } = await mountLogin();
    await wrapper.find("[data-testid=continue-identity]").trigger("click");
    await settle();
    expect(useSessionStore().pubkey).toBe(PK);

    // Sign out — the same lifecycle call `useAuth().logout()` makes for a local identity.
    const { endIdentitySessionAndRemoveIdentity } = await import("@/features/auth/identitySession");
    const result = await endIdentitySessionAndRemoveIdentity();
    expect(result).toEqual({ removed: true });
    await router.push({ name: "login" });
    // A fresh login screen, as the router would render it after sign-out.
    const fresh = await mountLogin();

    expect(fresh.wrapper.find("[data-testid=no-identity]").text()).toBe("No identity is stored on this device.");
    expect(fresh.wrapper.find("[data-testid=continue-identity]").exists()).toBe(false);
    expect(fresh.wrapper.find("[data-testid=identity-pubkey]").exists()).toBe(false);
    expect(fresh.wrapper.text()).not.toContain(PK.slice(0, 8)); // A's fingerprint is nowhere
    expect(fresh.wrapper.find("[data-testid=removal-failed]").exists()).toBe(false);
    expect(useSessionStore().pubkey).toBeNull();

    // B imports on the clean device → B is the only identity, and signs in as B.
    await fresh.wrapper.find("[data-testid=show-import]").trigger("click");
    await fresh.wrapper.find("[data-testid=import-secret]").setValue("nsec1forB");
    await fresh.wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    await fresh.wrapper.find("form").trigger("submit");
    await settle();
    expect(useSessionStore().pubkey).toBe(OTHER.pubkey);
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain("replace_identity"); // nothing to replace
    expect(fresh.router.currentRoute.value.name).toBe("communities"); // asked again after a sign-out
    await chooseCommunity(fresh.router);
    expect(fresh.router.currentRoute.value.name).toBe("channels");
  });

  it("removal FAILED: the screen says the identity is still stored and offers to remove it again — never 'Continue' as if signed out cleanly", async () => {
    let attempts = 0;
    tauri({
      delete_identity: () => {
        attempts += 1;
        if (attempts === 1) throw "couldn't remove the identity from secure storage: keyring delete denied";
        identity = NONE;
        return NONE;
      },
    });
    const { endIdentitySessionAndRemoveIdentity } = await import("@/features/auth/identitySession");
    const result = await endIdentitySessionAndRemoveIdentity();
    expect(result.removed).toBe(false);
    expect(useSessionStore().identityRemovalError).toContain("keyring delete denied");

    const { wrapper } = await mountLogin();
    const failed = wrapper.find("[data-testid=removal-failed]");
    expect(failed.exists()).toBe(true);
    expect(failed.text()).toContain("keyring delete denied");
    expect(failed.text()).toContain("still stored on this device");
    expect(wrapper.find("[data-testid=identity-pubkey]").text()).toContain(PK.slice(0, 8)); // truthfully still here

    await wrapper.find("[data-testid=retry-remove-identity]").trigger("click");
    await settle();

    expect(attempts).toBe(2);
    expect(useSessionStore().identityRemovalError).toBeNull();
    expect(wrapper.find("[data-testid=removal-failed]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=no-identity]").exists()).toBe(true); // now STATE 1
  });
});

describe("LoginView — npub is a public key, never a way in", () => {
  it("refuses an npub on import with the exact explanation and never sends it to Rust", async () => {
    identity = NONE;
    const { wrapper } = await mountLogin();
    await wrapper.find("[data-testid=show-import]").trigger("click");
    await wrapper.find("[data-testid=import-secret]").setValue("npub1" + "q".repeat(58));

    expect(wrapper.find("[data-testid=import-npub-error]").text()).toBe(
      "This is a public identity key. A public key cannot be used to sign in. Import the matching nsec private key or ncryptsec encrypted backup.",
    );
    expect(wrapper.find("[data-testid=import-submit]").attributes("disabled")).toBeDefined();
    await wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    await wrapper.find("form").trigger("submit");
    await settle();
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain("import_identity");
    expect(useSessionStore().pubkey).toBeNull();
  });

  /**
   * The normal credential contract is nsec / ncryptsec only. Raw 64-char hex is
   * refused because a public key is the same length as a private key and the
   * two cannot be told apart by format (docs/DEV_RESET_2026_09_22.md); it is
   * covered separately, behind the developer opt-in, in onboardingUi.spec.ts.
   */
  it("nsec and ncryptsec (+password) are accepted and forwarded to Rust as typed", async () => {
    const seen: unknown[] = [];
    for (const [input, password] of [
      ["nsec1" + "q".repeat(58), null],
      ["ncryptsec1" + "q".repeat(60), "correct horse battery"],
    ] as const) {
      identity = NONE;
      setActivePinia(createPinia());
      tauri({
        import_identity: (args) => {
          seen.push(args);
          identity = IDENTITY;
          return IDENTITY;
        },
      });
      const { wrapper } = await mountLogin();
      await wrapper.find("[data-testid=show-import]").trigger("click");
      await wrapper.find("[data-testid=import-secret]").setValue(input);
      if (password) await wrapper.find("[data-testid=import-password]").setValue(password);
      expect(wrapper.find("[data-testid=import-npub-error]").exists()).toBe(false);
      await wrapper.find("[data-testid=import-check]").trigger("click");
      await settle();
      await wrapper.find("form").trigger("submit");
      await settle();
      expect(useSessionStore().pubkey).toBe(PK);
    }
    expect(seen).toEqual([
      { input: "nsec1" + "q".repeat(58), password: null, allowRawHex: false },
      { input: "ncryptsec1" + "q".repeat(60), password: "correct horse battery", allowRawHex: false },
    ]);
  });

  it("raw 64-char hex is refused on this screen — no Rust call, no import", async () => {
    identity = NONE;
    const seen: unknown[] = [];
    tauri({ import_identity: (args) => { seen.push(args); return IDENTITY; } });
    const { wrapper } = await mountLogin();
    await wrapper.find("[data-testid=show-import]").trigger("click");
    await wrapper.find("[data-testid=import-secret]").setValue("ab".repeat(32));

    expect(wrapper.find("[data-testid=import-npub-error]").text()).toContain("ambiguous");
    expect(wrapper.find("[data-testid=import-check]").attributes("disabled")).toBeDefined();
    await wrapper.find("form").trigger("submit");
    await settle();
    expect(seen).toEqual([]);
    expect(useSessionStore().pubkey).toBeNull();
  });
});

describe("LoginView — deep link waiting", () => {
  it("with an identity and a waiting link it goes straight to the join screen", async () => {
    setPendingLink({ kind: "join", relay: "ws://localhost:3000", code: CODE });
    const { router } = await mountLogin();
    expect(router.currentRoute.value.name).toBe("join");
  });

  it("with no identity it says so, and after setup (create → backup confirmed) continues to the link", async () => {
    identity = NONE;
    tauri({ create_identity_with_backup: () => ({ pubkey: PK, npub: "npub1x", nsec: "nsec1testonlyfixture", ncryptsec: "ncryptsec1x" }) });
    setPendingLink({ kind: "join", relay: "ws://localhost:3000", code: CODE });
    const { wrapper, router } = await mountLogin();
    expect(wrapper.find("[data-testid=pending-link-banner]").exists()).toBe(true);
    expect(router.currentRoute.value.name).toBe("login");

    await wrapper.find("[data-testid=create-identity]").trigger("click");
    await wrapper.find("[data-testid=create-backup-password]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-backup-confirm]").setValue("correct horse battery");
    await wrapper.find("[data-testid=create-identity-submit]").trigger("click");
    await settle();
    identity = IDENTITY;
    await wrapper.find("[data-testid=reveal-next]").trigger("click");
    await wrapper.find("[data-testid=ack-stored]").setValue(true);
    await wrapper.find("[data-testid=ack-loss]").setValue(true);
    await wrapper.find("[data-testid=continue-to-communities]").trigger("click");
    await settle();

    expect(router.currentRoute.value.name).toBe("join");
    expect(pendingLink.value).not.toBeNull(); // still waiting for the user's confirmation
  });
});

describe("LoginView — identity-first: no community URL, no dropdown, routing decided after sign-in", () => {
  it("shows no community address and no selector — even when the device knows several communities", async () => {
    addCommunity("ws://localhost:3000");
    addCommunity("ws://acme.localhost:3000");
    for (const who of [IDENTITY, NONE]) {
      identity = who;
      const { wrapper } = await mountLogin();
      expect(wrapper.text()).not.toMatch(/community:/i);
      expect(wrapper.text()).not.toContain("localhost:3000");
      expect(wrapper.find("[data-testid=active-community]").exists()).toBe(false);
      expect(wrapper.find("[data-testid=community-select]").exists()).toBe(false);
      expect(wrapper.find("select").exists()).toBe(false);
      expect(wrapper.findAll("input[type=text],input[type=url]")).toHaveLength(0);
    }
  });

  it("Continue: ONE membership → still the community choice — a community is never opened on its own", async () => {
    const { wrapper, router } = await mountLogin();
    await wrapper.find("[data-testid=continue-identity]").trigger("click");
    await settle();
    expect(router.currentRoute.value.name).toBe("communities");
    expect(relayConnectionService.connect).not.toHaveBeenCalled();
  });

  it("Continue: SEVERAL memberships → the picker; an operator → the dashboard; none → welcome", async () => {
    for (const [arrange, route] of [
      [() => discoverMock.mockResolvedValue(found([HOME, ACME])), "communities"],
      [() => isOperatorMock.mockResolvedValue(true), "operator"],
      [() => { isOperatorMock.mockResolvedValue(false); discoverMock.mockResolvedValue(found([], [], 1)); }, "welcome"],
    ] as const) {
      setActivePinia(createPinia());
      arrange();
      const { wrapper, router } = await mountLogin();
      await wrapper.find("[data-testid=continue-identity]").trigger("click");
      await settle();
      expect(router.currentRoute.value.name, route).toBe(route);
    }
  });

  it("Continue with the relay unreachable: stays on the login screen with a clear error", async () => {
    discoverMock.mockResolvedValue(found([], ["ws://localhost:3000"], 1));
    const { wrapper, router } = await mountLogin();
    await wrapper.find("[data-testid=continue-identity]").trigger("click");
    await settle();
    expect(router.currentRoute.value.name).toBe("login");
    expect(wrapper.find("[data-testid=login-error]").text()).toContain("Can't reach");
    expect(wrapper.find("[data-testid=continue-identity]").exists()).toBe(true); // can retry
  });
});
