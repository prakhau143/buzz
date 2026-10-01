import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { capabilitiesFor, useCapabilities } from "@/features/access/capabilities";
import { useSessionStore } from "@/stores/session";

/**
 * Part E of the identity hardening pass: capabilities come only from the two
 * authoritative role planes, and neither plane implies the other.
 */
describe("capabilities — platform plane and community plane are independent", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("an OPERATOR with no community role reaches the Operator dashboard but has no community capabilities", () => {
    const c = capabilitiesFor("operator", null);
    expect(c.canAccessOperatorDashboard).toBe(true);
    expect(c.canManageDeployment).toBe(true);
    expect(c.canCreateCommunity).toBe(true);
    expect(c.canOpenCommunity).toBe(false);
    expect(c.canCreateChannel).toBe(false);
    expect(c.canManageCommunityMembers).toBe(false);
    expect(c.canModerateCommunity).toBe(false);
  });

  it("a community OWNER who is not an operator gets community management, never deployment actions", () => {
    const c = capabilitiesFor(null, "owner");
    expect(c.canAccessOperatorDashboard).toBe(false);
    expect(c.canManageDeployment).toBe(false);
    expect(c.canCreateCommunity).toBe(false);
    expect(c.canOpenCommunity).toBe(true);
    expect(c.canManageCommunityMembers).toBe(true);
    expect(c.canModerateCommunity).toBe(true);
    expect(c.canCreateChannel).toBe(true);
  });

  it("a MEMBER gets the member set only", () => {
    const c = capabilitiesFor(null, "member");
    expect(c.canAccessOperatorDashboard).toBe(false);
    expect(c.canCreateCommunity).toBe(false);
    expect(c.canOpenCommunity).toBe(true);
    expect(c.canCreateChannel).toBe(true); // any member may create a channel (kind:9007) and owns it
    expect(c.canManageCommunityMembers).toBe(false);
    expect(c.canModerateCommunity).toBe(false);
  });

  it("an operator who is ALSO an owner holds both planes at once, still separately", () => {
    const c = capabilitiesFor("operator", "owner");
    expect(c.canAccessOperatorDashboard).toBe(true);
    expect(c.canManageCommunityMembers).toBe(true);
  });

  it("signed in with no roles resolved grants nothing", () => {
    const c = capabilitiesFor(null, null);
    expect(Object.values(c).every((v) => v === false)).toBe(true);
  });

  it("useCapabilities is reactive to the session's role fields and to sign-out", () => {
    const session = useSessionStore();
    const can = useCapabilities();
    expect(can.value.canAccessOperatorDashboard).toBe(false);
    session.setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: "a".repeat(64) });
    session.setPlatformRole("operator");
    expect(can.value.canAccessOperatorDashboard).toBe(true);
    session.setCommunityRole("admin");
    expect(can.value.canManageCommunityMembers).toBe(true);
    session.clearSession();
    expect(can.value.canAccessOperatorDashboard).toBe(false);
    expect(can.value.canManageCommunityMembers).toBe(false);
  });
});
