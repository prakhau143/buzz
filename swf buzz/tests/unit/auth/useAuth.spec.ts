import { describe, expect, it, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { useConnectionStore } from "@/stores/connection";
import { useSessionStore } from "@/stores/session";
import { useAccessStore } from "@/stores/access";
import { clearPendingLink, setPendingLink } from "@/features/deeplink/pendingLink";
import { activeRelayUrl, clearCommunitiesForTests } from "@/features/communities/relayCommunities";

// Development Mode's post-login flow now genuinely connects the relay and
// resolves community role (see useAuth.ts's resolveIdentityAndRole) before
// navigating — this is the fix for "dashboard renders before role is known"
// (docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md §7). Unit tests must not hit a
// real relay (see docs/TESTING.md), so both are mocked here; the mocked
// `connect()` marks the connection store "connected" itself, exactly as the
// real RelayConnectionService would once a socket opens.
vi.mock("@/services/RelayConnectionService", () => ({
  relayConnectionService: {
    connect: vi.fn(async () => {
      useConnectionStore().setStatus("connected");
    }),
    disconnect: vi.fn(),
  },
}));

vi.mock("@/features/community-members/RelayMembersService", () => ({
  relayMembersService: {
    fetchMembershipList: vi.fn(async () => null),
  },
}));

/**
 * The landing route asks for this identity's profile across every community it
 * knows about, then judges COMPLETENESS (features/profile/profileCompleteness.ts).
 * `true` here means "a complete v2 profile", `false` means "incomplete or none".
 */
const hasProfileMock = vi.fn(async (_pubkey: string) => true);
const completeProfile = (pubkey: string) => ({
  pubkey,
  displayName: "Complete Person",
  designation: "Solutions Architect",
  avatarUrl: "https://media.example/avatar.webp",
  profileVersion: 2,
  isAgent: false,
});
vi.mock("@/features/profile/identityProfile", () => ({
  resolveIdentityProfile: async (pubkey: string) => ({
    event: null,
    profile: (await hasProfileMock(pubkey)) ? completeProfile(pubkey) : null,
    presentInCurrentCommunity: false,
  }),
  hasIdentityProfileAnywhere: (pubkey: string) => hasProfileMock(pubkey),
}));
vi.mock("@/services/ProfileService", () => ({
  profileService: { hasProfile: (pubkey: string) => hasProfileMock(pubkey) },
}));

// Post-authentication routing asks the relay two things: "is this identity an
// operator?" and "which communities is it a member of?". Unit tests must not hit
// a relay, so both answers are controlled here (the live behaviour is covered by
// the real-relay tests in docs/PHASE_2_FINAL_AUDIT.md).
const discoverMock = vi.fn();
vi.mock("@/features/access/communityDiscovery", () => ({
  discoverMemberships: (...args: unknown[]) => discoverMock(...args),
}));
const isOperatorMock = vi.fn();
/**
 * The signer the mocked probe reports. By default the identity being asked
 * about (no mismatch); a test sets it to another key to exercise the Part A3
 * mismatch guard in `resolveAccess`.
 */
let probeSignerOverride: string | null = null;
vi.mock("@/features/communities/OperatorService", () => ({
  operatorService: {
    isOperator: (...args: unknown[]) => isOperatorMock(...args),
    probeOperator: async (relay: string, forPubkey: string | null = null) => ({
      status: (await isOperatorMock(relay)) ? 200 : 403,
      signerPubkey: probeSignerOverride ?? forPubkey,
      error: null,
      origin: "http://localhost:3000",
    }),
  },
}));

const HOME = { relayUrl: "ws://localhost:3000", host: "localhost:3000", name: "localhost:3000", role: "member" };
const found = (memberships: object[], unreachable: string[] = [], asked = memberships.length + unreachable.length) => ({
  memberships,
  unreachable,
  asked,
});

beforeEach(() => {
  discoverMock.mockReset();
  discoverMock.mockResolvedValue(found([HOME]));
  isOperatorMock.mockReset();
  isOperatorMock.mockResolvedValue(false);
  probeSignerOverride = null;
});

const invokeMock = vi.fn();
const isTauriMock = vi.fn(() => false);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

function mountRouterAndAuth() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", name: "login", component: { render: () => h("div") } },
      { path: "/", name: "home", component: { render: () => h("div") } },
      { path: "/channels", name: "channels", component: { render: () => h("div") } },
      { path: "/join", name: "join", component: { render: () => h("div") } },
      { path: "/welcome", name: "welcome", component: { render: () => h("div") } },
      { path: "/operator", name: "operator", component: { render: () => h("div") } },
      { path: "/communities", name: "communities", component: { render: () => h("div") } },
      { path: "/profile-setup", name: "profile-setup", component: { render: () => h("div") } },
    ],
  });

  let auth!: ReturnType<typeof import("@/features/auth/useAuth").useAuth>;
  return {
    router,
    async ready() {
      await router.push({ name: "login" });
      await router.isReady();
      const { useAuth } = await import("@/features/auth/useAuth");
      const TestComponent = defineComponent({
        setup() {
          auth = useAuth();
          return () => h("div");
        },
      });
      mount(TestComponent, { global: { plugins: [router] } });
      return auth;
    },
  };
}

// The "Continue in Development Mode" tests that used to live here were removed
// with the feature itself (2026-09-24). They covered two real regression
// classes — navigate only once the session reaches "ready", and surface a
// distinct error without navigating when the relay is unreachable — but used
// dev login only as the vehicle. Both are already covered against the REAL
// local-identity path below: see "continues with an existing identity: Tauri
// signer → relay → role → ready → channels" and "relay unreachable: distinct
// auth error, no navigation, identity untouched". No coverage was lost.

// DECISIONS.md D10 — silent session resume. Runs outside any component's
// setup() (see router/index.ts), so these tests import it directly rather
// than mounting a component, unlike the suite above.
describe("attemptLegacyOktaSilentResume", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does nothing (stays unauthenticated) when no token is stored", async () => {
    invokeMock.mockResolvedValueOnce(null); // secure_storage_get -> no token
    const { attemptLegacyOktaSilentResume } = await import("@/features/auth/useAuth");

    await attemptLegacyOktaSilentResume();

    const session = useSessionStore();
    expect(session.authStatus).toBe("unauthenticated");
    expect(session.applicationUser).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("with a valid stored token, resumes to a fully ready session (application user + pubkey + role)", async () => {
    invokeMock.mockResolvedValueOnce("valid-token"); // secure_storage_get
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          expires_at: "2026-01-01T00:00:00Z",
          user: { id: "u1", okta_sub: "okta-sub-1", email: "e@co.com", display_name: "Employee One" },
        }),
        { status: 200 },
      ),
    );
    const { attemptLegacyOktaSilentResume } = await import("@/features/auth/useAuth");

    await attemptLegacyOktaSilentResume();

    const session = useSessionStore();
    expect(session.authStatus).toBe("ready");
    expect(session.isReady).toBe(true);
    expect(session.applicationUser).toEqual({
      id: "u1",
      oktaSub: "okta-sub-1",
      email: "e@co.com",
      displayName: "Employee One",
    });
    expect(session.applicationUserId).toBe("okta-sub-1");
    expect(session.pubkey).toBeTruthy(); // deterministically derived, real value not asserted here
  });

  it("with an expired/invalid stored token, clears it and stays unauthenticated", async () => {
    invokeMock.mockResolvedValueOnce("dead-token"); // secure_storage_get
    vi.mocked(fetch).mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    invokeMock.mockResolvedValueOnce(undefined); // secure_storage_delete (from the 401 handler)
    const { attemptLegacyOktaSilentResume } = await import("@/features/auth/useAuth");

    await attemptLegacyOktaSilentResume();

    const session = useSessionStore();
    expect(session.authStatus).toBe("unauthenticated");
    expect(session.applicationUser).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("secure_storage_delete", { key: "swf_session_token" });
  });
});

// ── Local identity (OLD-BUZZ-style, no Okta) ──────────────────────────────
// The primary login path: Rust holds the key; the app asks Tauri for the
// public key, signs through Tauri, connects the relay (NIP-42), resolves the
// role from relay_members and only then becomes `ready`. The Tauri mock below
// REJECTS any command it was not told about, so a test fails if the local path
// ever touches Okta (`start_okta_login`) or the backend-session keychain
// (`secure_storage_*`).
const PUBKEY = "ab".repeat(32);

function identityInfo(overrides: Record<string, unknown> = {}) {
  return { pubkey: PUBKEY, storage: "system-keyring", recovery: "none", ...overrides };
}

function mockTauriCommands(handlers: Record<string, (args?: unknown) => unknown>) {
  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    const handler = handlers[command];
    if (!handler) throw new Error(`unexpected Tauri command in test: ${command}`);
    return handler(args);
  });
}

const invokedCommands = () => invokeMock.mock.calls.map((call) => call[0] as string);

describe("useAuth local identity login (no Okta)", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    invokeMock.mockReset();
    isTauriMock.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn());
    const { clearActiveSigningService } = await import("@/features/signing/signingServiceRegistry");
    clearActiveSigningService();
    const { relayMembersService } = await import("@/features/community-members/RelayMembersService");
    vi.mocked(relayMembersService.fetchMembershipList).mockResolvedValue(null);
  });

  it("continues with an existing identity: Tauri signer → CHOOSE a community → relay → role → ready → channels", async () => {
    mockTauriCommands({
      get_identity: () => identityInfo(),
      sign_event: (args) => ({ id: "e", pubkey: PUBKEY, sig: "s", created_at: 1, ...(args as object) }),
    });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();
    const { relayConnectionService } = await import("@/services/RelayConnectionService");

    await auth.continueWithLocalIdentity();
    // The community is a session choice: signed in, but nothing opened yet.
    expect(router.currentRoute.value.name).toBe("communities");
    expect(useSessionStore().isReady).toBe(false);
    expect(relayConnectionService.connect).not.toHaveBeenCalled();

    await auth.switchCommunity(HOME.relayUrl); // the person picks it

    const session = useSessionStore();
    expect(session.authStatus).toBe("ready");
    expect(session.authMode).toBe("local");
    expect(session.pubkey).toBe(PUBKEY);
    expect(session.applicationUser, "no Application User for the local identity").toBeNull();
    expect(session.applicationUserId).toBeNull();
    expect(session.employeeEmail).toBeNull();
    expect(router.currentRoute.value.name).toBe("channels");

    // The active signer is the Rust-backed one — it signs through Tauri.
    const { getActiveSigningService } = await import("@/features/signing/signingServiceRegistry");
    const signer = getActiveSigningService();
    await signer.signEvent({ kind: 22242, content: "", tags: [["relay", "ws://x"]], created_at: 123 });
    expect(invokeMock).toHaveBeenCalledWith("sign_event", {
      kind: 22242,
      content: "",
      createdAt: 123,
      tags: [["relay", "ws://x"]],
    });

    // Nothing Okta / backend-session related was touched.
    expect(fetch).not.toHaveBeenCalled();
    expect(invokedCommands().every((c) => ["get_identity", "sign_event"].includes(c))).toBe(true);
  });

  it("connects the relay and resolves the role from relay_members (owner / admin / member / non-member)", async () => {
    const { relayMembersService } = await import("@/features/community-members/RelayMembersService");
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    const roster = (role: "owner" | "admin" | "member") => [
      { pubkey: PUBKEY, role },
      { pubkey: "cd".repeat(32), role: "member" as const },
    ];

    const cases = [
      [roster("owner"), "owner"],
      [roster("admin"), "admin"],
      [roster("member"), "member"],
      [[{ pubkey: "cd".repeat(32), role: "owner" as const }], null], // roster exists, we are not in it
      [null, null], // open relay: no roster
    ] as const;

    for (const [members, expected] of cases) {
      setActivePinia(createPinia());
      vi.mocked(relayMembersService.fetchMembershipList).mockResolvedValueOnce(members as never);
      mockTauriCommands({ get_identity: () => identityInfo() });
      const { ready } = mountRouterAndAuth();
      const auth = await ready();

      await auth.continueWithLocalIdentity();
      await auth.switchCommunity(HOME.relayUrl);

      const session = useSessionStore();
      expect(session.communityRole).toBe(expected);
      expect(session.authStatus, `role ${String(expected)}`).toBe("ready");
    }
    expect(relayConnectionService.connect).toHaveBeenCalled();
  });

  it("creates a new identity in Rust when none exists, then logs in", async () => {
    let created = false;
    mockTauriCommands({
      get_identity: () => (created ? identityInfo() : identityInfo({ pubkey: null, storage: "none" })),
      create_identity: () => {
        created = true;
        return identityInfo();
      },
    });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();

    await auth.createNewIdentity();
    expect(router.currentRoute.value.name).toBe("communities");
    await auth.switchCommunity(HOME.relayUrl);

    const session = useSessionStore();
    expect(invokedCommands()).toContain("create_identity");
    expect(session.authStatus).toBe("ready");
    expect(session.pubkey).toBe(PUBKEY);
    expect(router.currentRoute.value.name).toBe("channels");
  });

  it("'continue' never creates an identity when none exists", async () => {
    mockTauriCommands({ get_identity: () => identityInfo({ pubkey: null, storage: "none" }) });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();

    await auth.continueWithLocalIdentity();

    const session = useSessionStore();
    expect(invokedCommands()).not.toContain("create_identity");
    expect(session.authStatus).toBe("authError");
    expect(session.authError).toContain("create one first");
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("surfaces Rust's refusal (e.g. locked keyring) and does not sign in", async () => {
    mockTauriCommands({
      get_identity: () => identityInfo({ pubkey: null, storage: "none", recovery: "keyring-locked" }),
      create_identity: () => {
        throw "secure storage is locked — unlock it and restart the app; not creating a new identity";
      },
    });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();

    await auth.createNewIdentity();

    const session = useSessionStore();
    expect(session.authStatus).toBe("authError");
    expect(session.authError).toContain("locked");
    expect(session.pubkey).toBeNull();
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("relay unreachable when entering the chosen community: distinct auth error, stays on the choice, identity untouched", async () => {
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    vi.mocked(relayConnectionService.connect).mockImplementationOnce(async () => {
      useConnectionStore().setStatus("error", "Can't reach the local Buzz relay. Make sure it's running.");
    });
    mockTauriCommands({ get_identity: () => identityInfo() });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();

    await auth.continueWithLocalIdentity();
    await auth.switchCommunity(HOME.relayUrl);

    const session = useSessionStore();
    expect(session.authStatus).toBe("authError");
    expect(session.authError).toContain("relay");
    expect(router.currentRoute.value.name).toBe("communities");
    expect(invokedCommands()).not.toContain("create_identity");
  });

  // SWF shared-device sign-out (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §3):
  // the session ends AND the identity is removed from the device, in Rust,
  // verified — never OLD BUZZ's "keep the key".
  it("logout ends the session, disconnects, and REMOVES the identity from the device via Rust (verified)", async () => {
    let stored: ReturnType<typeof identityInfo> | null = identityInfo();
    const order: string[] = [];
    mockTauriCommands({
      get_identity: () => stored ?? identityInfo({ pubkey: null, storage: "none" }),
      delete_identity: () => {
        order.push("delete_identity");
        stored = null;
        return identityInfo({ pubkey: null, storage: "none" });
      },
    });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();
    await auth.continueWithLocalIdentity();
    await auth.switchCommunity(HOME.relayUrl);
    expect(useSessionStore().isReady).toBe(true);
    invokeMock.mockClear();
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    vi.mocked(relayConnectionService.disconnect).mockImplementation(() => {
      order.push("disconnect");
    });
    const { getActiveSigningService } = await import("@/features/signing/signingServiceRegistry");

    await auth.logout();

    expect(useSessionStore().authStatus).toBe("unauthenticated");
    expect(useSessionStore().pubkey).toBeNull();
    expect(useSessionStore().communityRole).toBeNull();
    expect(useSessionStore().platformRole).toBeNull();
    expect(useSessionStore().identityRemovalError).toBeNull();
    expect(() => getActiveSigningService()).toThrow();
    expect(order, "session torn down BEFORE the key is removed").toEqual(["disconnect", "delete_identity"]);
    expect(invokedCommands()).toContain("delete_identity");
    expect(invokedCommands()).not.toContain("secure_storage_delete"); // never a frontend-side secret deletion
    expect(router.currentRoute.value.name).toBe("login");
    expect(fetch).not.toHaveBeenCalled();
    // The device is clean: get_identity now reports none.
    const { getLocalIdentity } = await import("@/features/signing/signingService.tauri");
    expect((await getLocalIdentity()).pubkey).toBeNull();
  });

  it("logout whose Rust removal FAILS: session still ended, identity still stored, error carried — never claimed complete", async () => {
    mockTauriCommands({
      get_identity: () => identityInfo(),
      delete_identity: () => {
        throw "couldn't remove the identity from secure storage: keyring delete denied";
      },
    });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();
    await auth.continueWithLocalIdentity();
    const { getActiveSigningService } = await import("@/features/signing/signingServiceRegistry");

    await auth.logout();

    // Safe logged-out state: nothing can act as the identity any more …
    expect(useSessionStore().pubkey).toBeNull();
    expect(() => getActiveSigningService()).toThrow();
    expect(router.currentRoute.value.name).toBe("login");
    // … but the device is NOT clean, and the app says so.
    expect(useSessionStore().identityRemovalError).toContain("keyring delete denied");
    expect(auth.error.value).toContain("keyring delete denied");
    const { getLocalIdentity } = await import("@/features/signing/signingService.tauri");
    expect((await getLocalIdentity()).pubkey).toBe(PUBKEY); // still there

    // Retry succeeds → clean.
    mockTauriCommands({
      get_identity: () => identityInfo({ pubkey: null, storage: "none" }),
      delete_identity: () => identityInfo({ pubkey: null, storage: "none" }),
    });
    expect(await auth.removeStoredIdentity()).toBe(true);
    expect(useSessionStore().identityRemovalError).toBeNull();
  });

  it("a removal that 'succeeds' but still reports a pubkey is treated as a failure", async () => {
    mockTauriCommands({
      get_identity: () => identityInfo(),
      delete_identity: () => identityInfo(), // lies: still loaded
    });
    const { ready } = mountRouterAndAuth();
    const auth = await ready();
    await auth.continueWithLocalIdentity();

    await auth.logout();

    expect(useSessionStore().identityRemovalError).toBe(
      "Couldn't remove this identity from this device. Please try again.",
    );
  });

  it("import after logout: the device was cleaned, B imports, B is the only identity and signs in as B", async () => {
    const A = identityInfo();
    const B = identityInfo({ pubkey: "cd".repeat(32) });
    let stored: ReturnType<typeof identityInfo> | null = A;
    mockTauriCommands({
      get_identity: () => stored ?? identityInfo({ pubkey: null, storage: "none" }),
      delete_identity: () => {
        stored = null;
        return identityInfo({ pubkey: null, storage: "none" });
      },
      import_identity: () => {
        if (stored) throw "an identity already exists on this device — importing would replace it";
        stored = B;
        return B;
      },
    });
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    vi.mocked(relayConnectionService.connect).mockImplementation(async () => {
      useConnectionStore().setStatus("connected");
      useConnectionStore().setAuthenticatedPubkey(useSessionStore().pubkey);
    });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();

    await auth.continueWithLocalIdentity();
    expect(useSessionStore().pubkey).toBe(A.pubkey);
    await auth.logout();
    expect(stored).toBeNull();

    expect(await auth.importAndLogin("nsec1forB")).toBe(true);
    expect(useSessionStore().pubkey).toBe(B.pubkey);
    expect(router.currentRoute.value.name).toBe("communities"); // B chooses where to work
    await auth.switchCommunity(HOME.relayUrl);
    expect(useConnectionStore().authenticatedPubkey).toBe(B.pubkey); // B's socket is B's
    expect(router.currentRoute.value.name).toBe("channels");
    // No replace_identity was needed: there was nothing on the device to replace.
    expect(invokedCommands()).not.toContain("replace_identity");
  });
});

describe("attemptSilentResume (local identity)", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    invokeMock.mockReset();
    isTauriMock.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn());
    const { clearActiveSigningService } = await import("@/features/signing/signingServiceRegistry");
    clearActiveSigningService();
  });

  it("with an existing identity, resumes the IDENTITY but not a community: lands on 'Choose a community'", async () => {
    mockTauriCommands({ get_identity: () => identityInfo() });
    const { attemptSilentResume } = await import("@/features/auth/useAuth");
    const { relayConnectionService } = await import("@/services/RelayConnectionService");

    await attemptSilentResume();

    const session = useSessionStore();
    expect(session.isReady).toBe(false);
    expect(session.authMode).toBe("local");
    expect(session.pubkey).toBe(PUBKEY);
    expect(useAccessStore().destination).toBe("communities");
    expect(relayConnectionService.connect).not.toHaveBeenCalled();
    expect(invokedCommands()).toEqual(["get_identity"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("with no identity (first launch), stays unauthenticated and creates nothing", async () => {
    mockTauriCommands({ get_identity: () => identityInfo({ pubkey: null, storage: "none" }) });
    const { attemptSilentResume } = await import("@/features/auth/useAuth");

    await attemptSilentResume();

    expect(useSessionStore().authStatus).toBe("unauthenticated");
    expect(invokedCommands()).toEqual(["get_identity"]);
  });

  it("outside Tauri it does nothing", async () => {
    isTauriMock.mockReturnValue(false);
    const { attemptSilentResume } = await import("@/features/auth/useAuth");

    await attemptSilentResume();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(useSessionStore().authStatus).toBe("unauthenticated");
  });

  it("if reading the identity fails, it does not throw and stays unauthenticated", async () => {
    mockTauriCommands({
      get_identity: () => {
        throw "boom";
      },
    });
    const { attemptSilentResume } = await import("@/features/auth/useAuth");

    await expect(attemptSilentResume()).resolves.toBeUndefined();
    expect(useSessionStore().authStatus).toBe("unauthenticated");
  });

  it("resume never opens a socket on its own, and keeps the signer active for the choice that follows", async () => {
    mockTauriCommands({ get_identity: () => identityInfo() });
    const { attemptSilentResume } = await import("@/features/auth/useAuth");
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    const { getActiveSigningService } = await import("@/features/signing/signingServiceRegistry");

    await attemptSilentResume();

    expect(useSessionStore().isReady).toBe(false);
    expect(relayConnectionService.connect).not.toHaveBeenCalled();
    expect(() => getActiveSigningService()).not.toThrow();
  });
});

// ── Phase 2: import, landing route, community switching, non-member ───────
describe("useAuth — Phase 2 (import, landing, communities, non-member)", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    invokeMock.mockReset();
    isTauriMock.mockReturnValue(true);
    hasProfileMock.mockReset();
    hasProfileMock.mockResolvedValue(true);
    localStorage.clear();
    clearPendingLink();
    clearCommunitiesForTests();
    vi.stubGlobal("fetch", vi.fn());
    const { clearActiveSigningService } = await import("@/features/signing/signingServiceRegistry");
    clearActiveSigningService();
  });

  it("IMPORT: imports in Rust, then signs in with the imported identity", async () => {
    mockTauriCommands({ import_identity: () => identityInfo(), get_identity: () => identityInfo() });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();

    const ok = await auth.importAndLogin("nsec1abcdef");

    expect(ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("import_identity", {
      input: "nsec1abcdef",
      password: null,
      allowRawHex: false,
    });
    expect(useSessionStore().pubkey).toBe(PUBKEY);
    expect(router.currentRoute.value.name).toBe("communities");
    await auth.switchCommunity(HOME.relayUrl);
    expect(useSessionStore().isReady).toBe(true);
    expect(router.currentRoute.value.name).toBe("channels");
  });

  it("IMPORT failure (e.g. wrong password): the error is shown and nobody is signed in", async () => {
    mockTauriCommands({
      import_identity: () => {
        throw "wrong backup password, or the backup is damaged";
      },
    });
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    const { ready } = mountRouterAndAuth();
    const auth = await ready();

    const ok = await auth.importAndLogin("ncryptsec1abc", "nope");

    expect(ok).toBe(false);
    expect(auth.error.value).toContain("wrong backup password");
    expect(useSessionStore().authStatus).toBe("unauthenticated");
    expect(relayConnectionService.connect).not.toHaveBeenCalled();
  });

  it("LANDING: a link that arrived while signing in is acted on first", async () => {
    mockTauriCommands({ get_identity: () => identityInfo() });
    setPendingLink({ kind: "join", relay: "ws://localhost:3000", code: "v2.abc" });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();
    await auth.continueWithLocalIdentity();
    expect(router.currentRoute.value.name).toBe("join");
    expect(hasProfileMock).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION: the gate used to ask only "does a kind:0 exist?" and could be
   * bypassed forever by a localStorage "Skip for now" flag. It now asks whether
   * the profile is COMPLETE, and there is no skip — an incomplete profile
   * cannot reach the app by any route.
   */
  it("LANDING: an incomplete profile goes to setup; a complete one goes to channels", async () => {
    mockTauriCommands({ get_identity: () => identityInfo() });

    hasProfileMock.mockResolvedValueOnce(false);
    let ctx = mountRouterAndAuth();
    let auth = await ctx.ready();
    await auth.continueWithLocalIdentity();
    await auth.switchCommunity(HOME.relayUrl);
    expect(ctx.router.currentRoute.value.name).toBe("profile-setup");
    expect(hasProfileMock).toHaveBeenCalledWith(PUBKEY);

    setActivePinia(createPinia());
    hasProfileMock.mockResolvedValueOnce(true);
    ctx = mountRouterAndAuth();
    auth = await ctx.ready();
    await auth.continueWithLocalIdentity();
    await auth.switchCommunity(HOME.relayUrl);
    expect(ctx.router.currentRoute.value.name).toBe("channels");
  });

  it("LANDING: an incomplete profile cannot be skipped past, however many attempts", async () => {
    mockTauriCommands({ get_identity: () => identityInfo() });
    for (let attempt = 0; attempt < 3; attempt++) {
      setActivePinia(createPinia());
      localStorage.clear();
      hasProfileMock.mockResolvedValueOnce(false);
      const ctx = mountRouterAndAuth();
      const auth = await ctx.ready();
      await auth.continueWithLocalIdentity();
      await auth.switchCommunity(HOME.relayUrl);
      expect(ctx.router.currentRoute.value.name, `attempt ${attempt}`).toBe("profile-setup");
    }
  });

  it("LANDING: a failing profile lookup never blocks sign-in", async () => {
    mockTauriCommands({ get_identity: () => identityInfo() });
    hasProfileMock.mockRejectedValueOnce(new Error("relay hiccup"));
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();
    await auth.continueWithLocalIdentity();
    await auth.switchCommunity(HOME.relayUrl);
    expect(useSessionStore().isReady).toBe(true);
    expect(router.currentRoute.value.name).toBe("channels");
  });

  it("SWITCH COMMUNITY: makes it the active relay, reconnects there, and signs in with the same identity", async () => {
    mockTauriCommands({ get_identity: () => identityInfo() });
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    const { ready } = mountRouterAndAuth();
    const auth = await ready();

    await auth.switchCommunity("ws://acme.localhost:3000");

    expect(activeRelayUrl.value).toBe("ws://acme.localhost:3000");
    expect(relayConnectionService.disconnect).toHaveBeenCalled();
    expect(relayConnectionService.connect).toHaveBeenLastCalledWith("ws://acme.localhost:3000");
    expect(useSessionStore().pubkey).toBe(PUBKEY);
  });

  it("NON-MEMBER: no community says yes → the identity lands on WELCOME (join with invite), signed in but in no community", async () => {
    discoverMock.mockResolvedValue(found([], [], 1)); // asked one community; it refused
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    mockTauriCommands({ get_identity: () => identityInfo() });
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();

    await auth.continueWithLocalIdentity();

    const session = useSessionStore();
    expect(session.isReady).toBe(false);
    expect(session.pubkey).toBe(PUBKEY); // the identity is known — it just belongs to no community yet
    expect(router.currentRoute.value.name).toBe("welcome");
    expect(relayConnectionService.connect).not.toHaveBeenCalled(); // no community was opened
    expect(useAccessStore().destination).toBe("welcome");
  });

  it("AUTHORIZATION: owner, admin and member each become ready with their own role; a non-member does not", async () => {
    const { relayMembersService } = await import("@/features/community-members/RelayMembersService");
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    const roster = (role: "owner" | "admin" | "member") => [{ pubkey: PUBKEY, role }];

    for (const role of ["owner", "admin", "member"] as const) {
      setActivePinia(createPinia());
      vi.mocked(relayMembersService.fetchMembershipList).mockResolvedValueOnce(roster(role));
      mockTauriCommands({ get_identity: () => identityInfo() });
      const { ready } = mountRouterAndAuth();
      const auth = await ready();
      await auth.continueWithLocalIdentity();
      await auth.switchCommunity(HOME.relayUrl);
      expect(useSessionStore().isReady, role).toBe(true);
      expect(useSessionStore().communityRole, role).toBe(role);
    }

    // a non-member: the relay says no to the membership probe, so nothing is opened
    // and the session never becomes ready
    setActivePinia(createPinia());
    discoverMock.mockResolvedValue(found([], [], 1));
    vi.mocked(relayConnectionService.connect).mockClear();
    mockTauriCommands({ get_identity: () => identityInfo() });
    const { ready } = mountRouterAndAuth();
    const auth = await ready();
    await auth.continueWithLocalIdentity();
    expect(useSessionStore().isReady).toBe(false);
    expect(useSessionStore().communityRole).toBeNull();
    expect(relayConnectionService.connect).not.toHaveBeenCalled();
  });
});

// ── The central post-authentication routing decision ───────────────────────
// (docs/PHASE_2_FINAL_AUDIT.md §"Automatic community routing")
describe("post-authentication routing (identity-first, no community URL)", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    isTauriMock.mockReturnValue(true);
    mockTauriCommands({
      get_identity: () => identityInfo(),
      sign_event: (args) => ({ id: "e", pubkey: PUBKEY, sig: "s", created_at: 1, ...(args as object) }),
    });
    const { clearActiveSigningService } = await import("@/features/signing/signingServiceRegistry");
    clearActiveSigningService();
    clearCommunitiesForTests();
    clearPendingLink();
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    vi.mocked(relayConnectionService.connect).mockClear();
    const { relayMembersService } = await import("@/features/community-members/RelayMembersService");
    vi.mocked(relayMembersService.fetchMembershipList).mockResolvedValue(null);
  });

  async function signIn() {
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();
    await auth.continueWithLocalIdentity();
    return { router, auth };
  }

  it("OPERATOR (the relay says so) → the Operator dashboard; no community is opened, even with memberships", async () => {
    isOperatorMock.mockResolvedValue(true);
    discoverMock.mockResolvedValue(found([HOME]));
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    const { router } = await signIn();

    expect(router.currentRoute.value.name).toBe("operator");
    expect(useAccessStore().isOperator).toBe(true);
    expect(relayConnectionService.connect).not.toHaveBeenCalled();
    expect(useSessionStore().isReady).toBe(false);
  });

  it("the operator decision is the relay's answer, made with the local key — nothing about a URL or a stored flag", async () => {
    isOperatorMock.mockResolvedValue(false);
    await signIn();
    expect(isOperatorMock).toHaveBeenCalledTimes(1);
    expect(isOperatorMock.mock.calls[0][0]).toBe("ws://localhost:3000"); // the deployment relay, from config — not typed by the user
    expect(useAccessStore().isOperator).toBe(false);
  });

  it("NO MEMBERSHIP → welcome (join with invite)", async () => {
    discoverMock.mockResolvedValue(found([], [], 1));
    const { router } = await signIn();
    expect(router.currentRoute.value.name).toBe("welcome");
  });

  it("IDENTITY MISMATCH (the probe was signed by a different key than the one signing in) → an explicit error, no routing, no member fallback", async () => {
    // The relay would even say "operator" — but for the OTHER key. Routing on
    // that answer would sign someone else in. Part A3 of the identity pass.
    isOperatorMock.mockResolvedValue(true);
    probeSignerOverride = "c".repeat(64);
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    const { router, auth } = await signIn();

    expect(router.currentRoute.value.name).toBe("login");
    expect(auth.error.value).toMatch(/Identity mismatch/);
    expect(useSessionStore().authError).toMatch(/Identity mismatch/);
    expect(useSessionStore().platformRole).toBeNull();
    expect(useSessionStore().communityRole).toBeNull();
    expect(useAccessStore().isOperator).toBe(false);
    expect(useAccessStore().destination).toBeNull();
    expect(relayConnectionService.connect).not.toHaveBeenCalled();
    const { useDiagnosticsStore } = await import("@/stores/diagnostics");
    const diag = useDiagnosticsStore();
    expect(diag.lastIdentityMismatch?.signer).toBe("c".repeat(64));
    expect(diag.lastAccessDecision?.kind).toBe("mismatch");
    // nothing may sign as the wrong key afterwards
    const { getActiveSigningService } = await import("@/features/signing/signingServiceRegistry");
    expect(() => getActiveSigningService()).toThrow();
  });

  it("the diagnostics trail records the probe's evidence (status + signer) for the identity being signed in", async () => {
    isOperatorMock.mockResolvedValue(true);
    await signIn();
    const { useDiagnosticsStore } = await import("@/stores/diagnostics");
    const diag = useDiagnosticsStore();
    expect(diag.lastOperatorProbe?.status).toBe(200);
    expect(diag.lastOperatorProbe?.signerPubkey).toBe(useSessionStore().pubkey);
    expect(diag.lastAccessDecision).toMatchObject({ kind: "route", destination: "operator" });
    expect(diag.lastIdentityMismatch).toBeNull();
  });

  it("EXACTLY ONE community → still the choice screen: a community is never opened on its own", async () => {
    const ACME = { relayUrl: "ws://acme.localhost:3000", host: "acme.localhost:3000", name: "Acme", role: "admin" };
    discoverMock.mockResolvedValue(found([ACME], [], 2)); // asked two, one said yes
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    const { router, auth } = await signIn();

    expect(router.currentRoute.value.name).toBe("communities");
    expect(relayConnectionService.connect).not.toHaveBeenCalled();
    expect(useSessionStore().isReady).toBe(false);
    expect(useAccessStore().memberships.map((m) => m.name)).toEqual(["Acme"]); // offered as a recent community

    await auth.switchCommunity(ACME.relayUrl); // one click — but the person's click
    expect(activeRelayUrl.value).toBe("ws://acme.localhost:3000");
    expect(useSessionStore().isReady).toBe(true);
    expect(router.currentRoute.value.name).toBe("channels");
  });

  it("SEVERAL communities → the picker, and nothing is opened until one is chosen", async () => {
    const ACME = { relayUrl: "ws://acme.localhost:3000", host: "acme.localhost:3000", name: "Acme", role: "member" };
    discoverMock.mockResolvedValue(found([HOME, ACME]));
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    const { router, auth } = await signIn();

    expect(router.currentRoute.value.name).toBe("communities");
    expect(useAccessStore().memberships.map((m) => m.name)).toEqual(["localhost:3000", "Acme"]);
    expect(relayConnectionService.connect).not.toHaveBeenCalled();

    await auth.switchCommunity("ws://acme.localhost:3000"); // the person picks one
    expect(relayConnectionService.connect).toHaveBeenCalledWith("ws://acme.localhost:3000");
    expect(useSessionStore().isReady).toBe(true);
    expect(router.currentRoute.value.name).toBe("channels");
  });

  it("RELAY UNAVAILABLE (nothing could be asked) → stays signed out on login with a clear error", async () => {
    discoverMock.mockResolvedValue(found([], ["ws://localhost:3000"], 1));
    const { router } = await signIn();

    const session = useSessionStore();
    expect(router.currentRoute.value.name).toBe("login");
    expect(session.isReady).toBe(false);
    expect(session.authStatus).toBe("authError");
    expect(session.authError).toContain("Can't reach");
    expect(invokedCommands()).not.toContain("create_identity"); // the identity is untouched
  });

  it("a partly unreachable answer is not an outage: the reachable membership is offered", async () => {
    discoverMock.mockResolvedValue(found([HOME], ["ws://down.localhost:3000"], 2));
    const { router } = await signIn();
    expect(router.currentRoute.value.name).toBe("communities");
    expect(useAccessStore().memberships).toHaveLength(1);
    expect(useAccessStore().unreachable).toEqual(["ws://down.localhost:3000"]);
  });

  it("an invite link waiting takes precedence over routing (it is the user's next step)", async () => {
    setPendingLink({ kind: "join", relay: "ws://acme.localhost:3000", code: "v2." + "A".repeat(43) });
    const { router } = await signIn();
    expect(router.currentRoute.value.name).toBe("join");
  });

  it("SILENT RESUME never re-enters a community: one / several → the choice; operator → dashboard; none → welcome", async () => {
    const { attemptSilentResume } = await import("@/features/auth/useAuth");
    const ACME = { relayUrl: "ws://acme.localhost:3000", host: "acme.localhost:3000", name: "Acme", role: "member" };

    await attemptSilentResume();
    expect(useSessionStore().isReady).toBe(false);
    expect(useAccessStore().destination).toBe("communities");

    for (const [setup, expected] of [
      [() => isOperatorMock.mockResolvedValue(true), "operator"],
      [() => { isOperatorMock.mockResolvedValue(false); discoverMock.mockResolvedValue(found([HOME, ACME])); }, "communities"],
      [() => discoverMock.mockResolvedValue(found([], [], 1)), "welcome"],
    ] as const) {
      setActivePinia(createPinia());
      setup();
      await attemptSilentResume();
      expect(useSessionStore().isReady, expected).toBe(false);
      expect(useAccessStore().destination, expected).toBe(expected);
    }
  });

  it("SILENT RESUME with nothing reachable: not ready, with the connection error", async () => {
    discoverMock.mockResolvedValue(found([], ["ws://localhost:3000"], 1));
    const { attemptSilentResume } = await import("@/features/auth/useAuth");
    await attemptSilentResume();
    expect(useSessionStore().isReady).toBe(false);
    expect(useSessionStore().authError).toContain("Can't reach");
  });

  describe("fresh login always asks where to work (acceptance tests A, B, C, E)", () => {
    const B_COMMUNITY = { relayUrl: "ws://b.localhost:3000", host: "b.localhost:3000", name: "Community B", role: "member" };
    let stored: ReturnType<typeof identityInfo> | null;

    beforeEach(() => {
      stored = identityInfo();
      mockTauriCommands({
        get_identity: () => stored ?? identityInfo({ pubkey: null, storage: "none" }),
        sign_event: (args) => ({ id: "e", pubkey: PUBKEY, sig: "s", created_at: 1, ...(args as object) }),
        delete_identity: () => {
          stored = null;
          return identityInfo({ pubkey: null, storage: "none" });
        },
        import_identity: () => (stored = identityInfo()),
      });
      discoverMock.mockResolvedValue(found([HOME, B_COMMUNITY]));
    });

    async function signOutAndBackIn(auth: Awaited<ReturnType<typeof signIn>>["auth"]) {
      await auth.logout();
      expect(await auth.importAndLogin("nsec1again")).toBe(true);
    }

    it("A: login → community A → logout → login → the community choice appears again", async () => {
      const { router, auth } = await signIn();
      await auth.switchCommunity(HOME.relayUrl);
      expect(router.currentRoute.value.name).toBe("channels");

      await signOutAndBackIn(auth);
      expect(router.currentRoute.value.name).toBe("communities");
      expect(useSessionStore().isReady).toBe(false);
    });

    it("B: login → A → logout → login → B opens, with nothing of A carried over", async () => {
      const { router, auth } = await signIn();
      await auth.switchCommunity(HOME.relayUrl);
      await signOutAndBackIn(auth);
      await auth.switchCommunity(B_COMMUNITY.relayUrl);
      expect(router.currentRoute.value.name).toBe("channels");
      expect(activeRelayUrl.value).toBe(B_COMMUNITY.relayUrl);
      const { queryKeys } = await import("@/app/providers/queryKeys");
      expect(queryKeys.channels()).toContain(B_COMMUNITY.relayUrl);
      expect(queryKeys.channels()).not.toContain(HOME.relayUrl);
    });

    it("C: login → A → logout → login → A again works — because the person chose it", async () => {
      const { relayConnectionService } = await import("@/services/RelayConnectionService");
      const { router, auth } = await signIn();
      await auth.switchCommunity(HOME.relayUrl);
      await signOutAndBackIn(auth);
      vi.mocked(relayConnectionService.connect).mockClear();
      expect(router.currentRoute.value.name).toBe("communities");
      expect(relayConnectionService.connect).not.toHaveBeenCalled(); // not silently re-entered
      await auth.switchCommunity(HOME.relayUrl);
      expect(relayConnectionService.connect).toHaveBeenCalledWith(HOME.relayUrl);
      expect(useSessionStore().isReady).toBe(true);
    });

    it("E: A → B → logout → login → the choice, NOT B automatically", async () => {
      const { relayConnectionService } = await import("@/services/RelayConnectionService");
      const { router, auth } = await signIn();
      await auth.switchCommunity(HOME.relayUrl);
      await auth.switchCommunity(B_COMMUNITY.relayUrl);
      expect(activeRelayUrl.value).toBe(B_COMMUNITY.relayUrl);
      await signOutAndBackIn(auth);
      vi.mocked(relayConnectionService.connect).mockClear();
      expect(router.currentRoute.value.name).toBe("communities");
      expect(relayConnectionService.connect).not.toHaveBeenCalled();
      expect(useSessionStore().isReady).toBe(false);
    });
  });

  it("LOGOUT forgets the access decision (operator / memberships) along with the session", async () => {
    isOperatorMock.mockResolvedValue(true);
    mockTauriCommands({
      get_identity: () => identityInfo(),
      sign_event: (args) => ({ id: "e", pubkey: PUBKEY, sig: "s", created_at: 1, ...(args as object) }),
      delete_identity: () => identityInfo({ pubkey: null, storage: "none" }),
    });
    const { auth } = await signIn();
    expect(useAccessStore().isOperator).toBe(true);
    await auth.logout();
    expect(useAccessStore().isOperator).toBe(false);
    expect(useAccessStore().memberships).toEqual([]);
    expect(useSessionStore().platformRole).toBeNull(); // the operator answer does not outlive the session
  });
});
