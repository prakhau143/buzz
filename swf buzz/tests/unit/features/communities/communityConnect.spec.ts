/**
 * Community connection: URL validation, the progress steps (driven by the real
 * session lifecycle), and failure classification. "Not a member" (the relay
 * answered no) must never be presented as "unreachable" (it never answered).
 */
import { describe, expect, it } from "vitest";
import {
  classifyConnectFailure,
  connectSteps,
  validateCommunityUrl,
} from "@/features/communities/useCommunityConnect";

describe("community URL validation", () => {
  it("accepts wss:// and loopback ws://, normalised", () => {
    expect(validateCommunityUrl("wss://buzz.lmdconsulting.com/")).toBe("wss://buzz.lmdconsulting.com");
    expect(validateCommunityUrl("ws://localhost:3000")).toBe("ws://localhost:3000");
  });

  it("rejects invalid or insecure addresses", () => {
    for (const bad of ["", "buzz", "http://x.com", "ws://example.com", "wss://x.com/path?q=1", "javascript:alert(1)"]) {
      expect(validateCommunityUrl(bad), bad).toBeNull();
    }
  });
});

describe("connection progress steps", () => {
  const states = (phase: string, failedAt: string | null, connecting: boolean) =>
    connectSteps(phase, failedAt, connecting).map((s) => s.state);

  it("identity is always verified on this screen; the relay step runs first", () => {
    expect(states("SIGNER_READY", null, true)).toEqual(["done", "active", "pending"]);
  });

  it("relay connected → checking membership", () => {
    expect(states("NIP42_AUTHENTICATED", null, true)).toEqual(["done", "done", "active"]);
    expect(states("ROLE_RESOLVED", null, true)).toEqual(["done", "done", "active"]);
  });

  it("all three done when the session is ready", () => {
    expect(states("READY", null, true)).toEqual(["done", "done", "done"]);
    expect(connectSteps("READY", null, true)[2].label).toBe("Membership confirmed");
  });

  it("a refused handshake fails the relay step and leaves membership pending", () => {
    expect(states("RELAY_CONNECTING", "NIP42_AUTHENTICATED", false)).toEqual(["done", "failed", "pending"]);
  });
});

describe("failure classification", () => {
  it("not a member", () => {
    const f = classifyConnectFailure({ authDenial: "not_member", failedAt: "RELAY_CONNECTING", lastError: null });
    expect(f.kind).toBe("not_member");
    expect(f.title).toMatch(/not a member/);
    expect(f.detail).toMatch(/invitation/);
  });

  it("blocked", () => {
    expect(classifyConnectFailure({ authDenial: "banned", failedAt: null, lastError: null }).kind).toBe("banned");
  });

  it("NIP-42 rejection is 'rejected', with the relay's reason", () => {
    const f = classifyConnectFailure({ authDenial: null, failedAt: "NIP42_AUTHENTICATED", lastError: "auth-required: bad sig" });
    expect(f.kind).toBe("rejected");
    expect(f.detail).toContain("bad sig");
  });

  it("relay unreachable", () => {
    const f = classifyConnectFailure({ authDenial: null, failedAt: "RELAY_CONNECTING", lastError: "timeout" });
    expect(f.kind).toBe("unreachable");
    expect(f.title).toBe("Community unavailable");
  });
});
