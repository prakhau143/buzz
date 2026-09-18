import { describe, expect, it, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { useConnectionStore } from "@/stores/connection";
import { useSessionStore } from "@/stores/session";

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

// Regression test for the bug where clicking "Continue in Development Mode"
// (or completing Okta/bunker login) set session state but never navigated
// away from /login — the router guard only re-evaluates on a navigation
// *attempt*, so the user was stranded on the login screen despite being
// authenticated. See useAuth.ts's logout() for the original fix of this bug
// class; loginWithDevelopmentMode/loginWithOkta/completeBunkerPairing needed
// the same fix. Extended to cover the later identity/role-resolution fix:
// navigation must wait until the session actually reaches "ready", not just
// "identity known" (docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md §7).
describe("useAuth.loginWithDevelopmentMode", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("resolves identity, resolves role, and only then navigates to the dashboard", async () => {
    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();

    const session = useSessionStore();
    expect(session.authStatus).toBe("unauthenticated");

    await auth.loginWithDevelopmentMode();

    expect(session.authStatus, "must reach 'ready', not stop at resolvingIdentity/resolvingRole").toBe(
      "ready",
    );
    expect(session.isReady).toBe(true);
    expect(session.authMode).toBe("development");
    expect(session.communityRole).toBeNull(); // mocked relay has no membership snapshot
    expect(
      router.currentRoute.value.name,
      "must navigate away from /login only after the session is fully ready",
    ).toBe("home");
  });

  it("surfaces a distinct auth error and does not navigate when the relay is unreachable", async () => {
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    vi.mocked(relayConnectionService.connect).mockImplementationOnce(async () => {
      useConnectionStore().setStatus("error", "Can't reach the local Buzz relay. Make sure it's running.");
    });

    const { router, ready } = mountRouterAndAuth();
    const auth = await ready();

    await auth.loginWithDevelopmentMode();

    const session = useSessionStore();
    expect(session.authStatus).toBe("authError");
    expect(session.authError).toContain("relay");
    expect(router.currentRoute.value.name, "must not navigate to the dashboard on relay failure").toBe(
      "login",
    );
  });
});

// DECISIONS.md D10 — silent session resume. Runs outside any component's
// setup() (see router/index.ts), so these tests import it directly rather
// than mounting a component, unlike the suite above.
describe("attemptSilentResume", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does nothing (stays unauthenticated) when no token is stored", async () => {
    invokeMock.mockResolvedValueOnce(null); // secure_storage_get -> no token
    const { attemptSilentResume } = await import("@/features/auth/useAuth");

    await attemptSilentResume();

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
    const { attemptSilentResume } = await import("@/features/auth/useAuth");

    await attemptSilentResume();

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
    const { attemptSilentResume } = await import("@/features/auth/useAuth");

    await attemptSilentResume();

    const session = useSessionStore();
    expect(session.authStatus).toBe("unauthenticated");
    expect(session.applicationUser).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("secure_storage_delete", { key: "swf_session_token" });
  });
});
