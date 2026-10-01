/**
 * Phase C3 — the shared community switch remembers WHICH switch failed so the
 * mobile overlay can offer "Retry" (through the same verified path) and "Stay".
 * Nothing is bypassed: a retry re-verifies membership before leaving.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  active: { value: "wss://a.example.com" as string | null },
  connection: { status: "connected", lastError: null as string | null },
  verify: vi.fn(async (_url: string) => ({ ok: true, reason: "" })),
  switchCommunity: vi.fn(async (_url: string) => {}),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/stores/connection", () => ({ useConnectionStore: () => h.connection }));
vi.mock("@/features/auth/useAuth", async () => {
  const { ref } = await import("vue");
  return { useAuth: () => ({ switchCommunity: h.switchCommunity, isLoading: ref(false), error: ref(null) }) };
});
vi.mock("@/features/communities/useAccessibleCommunities", async () => {
  const { ref } = await import("vue");
  return {
    useAccessibleCommunities: () => ({
      accessible: ref([]),
      verifying: ref(false),
      verified: ref(true),
      refresh: vi.fn(async () => {}),
      verify: h.verify,
    }),
  };
});
vi.mock("@/features/communities/relayCommunities", async () => {
  const { ref } = await import("vue");
  const active = ref<string | null>("wss://a.example.com");
  Object.defineProperty(h, "active", { value: active });
  return { activeRelayUrl: active, communities: ref([]), relayHost: (u: string) => u.replace(/^wss?:\/\//, "") };
});

const mod = await import("@/features/communities/useCommunitySwitch");

beforeEach(() => {
  h.active.value = "wss://a.example.com";
  h.connection.status = "connected";
  h.verify.mockReset();
  h.switchCommunity.mockReset();
  mod.clearCommunitySwitchError();
});

describe("community switch — failure target, retry, stay", () => {
  it("a membership-verification failure keeps you where you are and records the target", async () => {
    h.verify.mockResolvedValueOnce({ ok: false, reason: "You're not a member of that community." });
    const sw = mod.useCommunitySwitch();
    const pending = sw.switchTo("wss://b.example.com");
    expect(mod.communitySwitchingTo.value).toBe("wss://b.example.com");
    expect(mod.communitySwitchingFrom.value).toBe("wss://a.example.com");
    expect(await pending).toBe(false);
    expect(h.switchCommunity).not.toHaveBeenCalled(); // never left A
    expect(mod.communitySwitchingTo.value).toBeNull();
    expect(mod.communitySwitchError.value).toBe("You're not a member of that community.");
    expect(mod.communitySwitchFailedTarget.value).toBe("wss://b.example.com");
  });

  it("a post-switch failure restores the previous community and records the target", async () => {
    h.verify.mockResolvedValueOnce({ ok: true, reason: "" });
    h.switchCommunity.mockImplementation(async (url: string) => {
      h.active.value = url;
      h.connection.status = url === "wss://b.example.com" ? "error" : "connected";
    });
    const ok = await mod.useCommunitySwitch().switchTo("wss://b.example.com");
    expect(ok).toBe(false);
    expect(h.switchCommunity.mock.calls.map((c) => c[0])).toEqual(["wss://b.example.com", "wss://a.example.com"]);
    expect(h.active.value).toBe("wss://a.example.com");
    expect(mod.communitySwitchFailedTarget.value).toBe("wss://b.example.com");
  });

  it("Retry runs the SAME verified switch again; success clears the failure", async () => {
    h.verify.mockResolvedValueOnce({ ok: false, reason: "offline" });
    const sw = mod.useCommunitySwitch();
    await sw.switchTo("wss://b.example.com");
    h.verify.mockResolvedValueOnce({ ok: true, reason: "" });
    h.switchCommunity.mockImplementation(async (url: string) => {
      h.active.value = url;
    });
    expect(await sw.retryFailed()).toBe(true);
    expect(h.verify).toHaveBeenCalledTimes(2); // re-verified, not bypassed
    expect(h.active.value).toBe("wss://b.example.com");
    expect(mod.communitySwitchError.value).toBeNull();
    expect(mod.communitySwitchFailedTarget.value).toBeNull();
  });

  it("Stay clears the error and the target; with nothing failed, retry does nothing", async () => {
    h.verify.mockResolvedValueOnce({ ok: false, reason: "offline" });
    const sw = mod.useCommunitySwitch();
    await sw.switchTo("wss://b.example.com");
    mod.clearCommunitySwitchError();
    expect(mod.communitySwitchError.value).toBeNull();
    expect(mod.communitySwitchFailedTarget.value).toBeNull();
    expect(await sw.retryFailed()).toBe(false);
    expect(h.verify).toHaveBeenCalledTimes(1);
  });
});
