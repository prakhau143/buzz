import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "@/stores/session";

describe("useSessionStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts unauthenticated and not ready", () => {
    const store = useSessionStore();
    expect(store.authStatus).toBe("unauthenticated");
    expect(store.isAuthenticated).toBe(false);
    expect(store.isReady).toBe(false);
    expect(store.pubkey).toBeNull();
  });

  it("setIdentity moves to resolvingIdentity but is not yet ready", () => {
    const store = useSessionStore();
    store.setIdentity({
      authMode: "development",
      employeeEmail: "dev@local.test",
      applicationUserId: null,
      pubkey: "pk123",
    });
    expect(store.authStatus).toBe("resolvingIdentity");
    expect(store.isAuthenticated).toBe(true); // no longer unauthenticated/error
    expect(store.isReady).toBe(false); // role not resolved yet — the dashboard must not render
    expect(store.authMode).toBe("development");
    expect(store.employeeEmail).toBe("dev@local.test");
    expect(store.pubkey).toBe("pk123");
  });

  it("setCommunityRole completes the flow and marks the session ready", () => {
    const store = useSessionStore();
    store.setIdentity({
      authMode: "development",
      employeeEmail: "dev@local.test",
      applicationUserId: null,
      pubkey: "pk123",
    });
    store.setCommunityRole("owner");
    expect(store.authStatus).toBe("ready");
    expect(store.isReady).toBe(true);
    expect(store.communityRole).toBe("owner");
  });

  it("setCommunityRole(null) still reaches ready — no role is a valid resolved state", () => {
    const store = useSessionStore();
    store.setIdentity({
      authMode: "development",
      employeeEmail: "dev@local.test",
      applicationUserId: null,
      pubkey: "pk123",
    });
    store.setCommunityRole(null);
    expect(store.authStatus).toBe("ready");
    expect(store.isReady).toBe(true);
    expect(store.communityRole).toBeNull();
  });

  it("captures the Okta applicationUserId for production sign-in", () => {
    const store = useSessionStore();
    store.setIdentity({
      authMode: "production",
      employeeEmail: "e@co.com",
      applicationUserId: "okta-sub-123",
      pubkey: "pk",
    });
    expect(store.applicationUserId).toBe("okta-sub-123");
  });

  it("setAuthError marks the session errored, not authenticated", () => {
    const store = useSessionStore();
    store.setAuthError("Can't reach the Buzz server right now.");
    expect(store.authStatus).toBe("authError");
    expect(store.isAuthenticated).toBe(false);
    expect(store.authError).toBe("Can't reach the Buzz server right now.");
  });

  it("clearSession resets to signed-out state from any prior state", () => {
    const store = useSessionStore();
    store.setIdentity({
      authMode: "production",
      employeeEmail: "e@co.com",
      applicationUserId: "okta-sub-123",
      pubkey: "pk",
    });
    store.setCommunityRole("admin");
    store.clearSession();
    expect(store.authStatus).toBe("unauthenticated");
    expect(store.isAuthenticated).toBe(false);
    expect(store.isReady).toBe(false);
    expect(store.authMode).toBeNull();
    expect(store.employeeEmail).toBeNull();
    expect(store.applicationUserId).toBeNull();
    expect(store.pubkey).toBeNull();
    expect(store.communityRole).toBeNull();
  });

  // DECISIONS.md D10 — the swf-buzz-backend Application User, additive
  // alongside pubkey (see useAuth.ts's module doc comment for why it isn't
  // a replacement yet).
  describe("applicationUser (DECISIONS.md D10)", () => {
    it("starts null and is independent of authStatus", () => {
      const store = useSessionStore();
      expect(store.applicationUser).toBeNull();
    });

    it("setApplicationUser stores the value without touching authStatus", () => {
      const store = useSessionStore();
      const user = { id: "u1", oktaSub: "sub1", email: "a@b.com", displayName: "A B" };
      store.setApplicationUser(user);
      expect(store.applicationUser).toEqual(user);
      expect(store.authStatus).toBe("unauthenticated"); // unaffected
    });

    it("clearSession also clears applicationUser", () => {
      const store = useSessionStore();
      store.setApplicationUser({ id: "u1", oktaSub: "sub1", email: null, displayName: null });
      store.clearSession();
      expect(store.applicationUser).toBeNull();
    });
  });
});
