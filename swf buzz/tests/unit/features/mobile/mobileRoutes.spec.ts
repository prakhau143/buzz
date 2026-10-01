/**
 * Mobile navigation model (Phase B): real routes per stack level, and the
 * desktop ⇄ mobile counterpart mapping used when crossing the breakpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { depthOf, desktopCounterpart, isMobileRoute, mobileCounterpart, parentOf } from "@/features/mobile/mobileRoutes";

const nav = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  current: { name: "mobile-thread", params: { channelId: "c1", rootId: "r1" } } as { name: string; params: Record<string, string> },
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ back: nav.back, replace: nav.replace }), useRoute: () => nav.current }));

const q = (name: string, query: Record<string, string> = {}) => ({ name, query });
const p = (name: string, params: Record<string, string> = {}) => ({ name, params });

describe("desktop → mobile", () => {
  it("maps in-community views to their mobile screen", () => {
    expect(mobileCounterpart(q("channels"))).toEqual({ name: "mobile-home" });
    expect(mobileCounterpart(q("channels", { channelId: "c1" }))).toEqual({ name: "mobile-channel", params: { channelId: "c1" } });
    expect(mobileCounterpart(q("channels", { channelId: "c1", threadRootId: "r1" }))).toEqual({
      name: "mobile-thread",
      params: { channelId: "c1", rootId: "r1" },
    });
    expect(mobileCounterpart(q("inbox"))).toEqual({ name: "mobile-inbox" });
    expect(mobileCounterpart(q("home"))).toEqual({ name: "mobile-home" });
    expect(mobileCounterpart(q("dm", { conversationId: "d1" }))).toEqual({ name: "mobile-dm", params: { conversationId: "d1" } });
    expect(mobileCounterpart(q("dm", { conversationId: "d1", threadRootId: "r1" }))).toEqual({
      name: "mobile-dm-thread",
      params: { conversationId: "d1", rootId: "r1" },
    });
    expect(mobileCounterpart(q("dm"))).toEqual({ name: "mobile-home" });
  });

  it("leaves sign-in, the community picker and Settings alone", () => {
    for (const name of ["login", "communities", "welcome", "join", "settings", "profile-setup"]) {
      expect(mobileCounterpart(q(name))).toBeNull();
    }
  });
});

describe("mobile → desktop", () => {
  it("returns to the same place on desktop", () => {
    expect(desktopCounterpart(p("mobile-home"))).toEqual({ name: "channels" });
    expect(desktopCounterpart(p("mobile-channel", { channelId: "c1" }))).toEqual({ name: "channels", query: { channelId: "c1" } });
    expect(desktopCounterpart(p("mobile-thread", { channelId: "c1", rootId: "r1" }))).toEqual({
      name: "channels",
      query: { channelId: "c1", threadRootId: "r1" },
    });
    expect(desktopCounterpart(p("mobile-inbox"))).toEqual({ name: "inbox" });
    expect(desktopCounterpart(p("mobile-dm", { conversationId: "d1" }))).toEqual({ name: "dm", query: { conversationId: "d1" } });
    expect(desktopCounterpart(p("mobile-dm-thread", { conversationId: "d1", rootId: "r1" }))).toEqual({
      name: "dm",
      query: { conversationId: "d1", threadRootId: "r1" },
    });
    expect(desktopCounterpart(p("channels"))).toBeNull();
  });

  it("round-trips a thread both ways", () => {
    const mobile = mobileCounterpart(q("channels", { channelId: "c1", threadRootId: "r1" })) as { name: string; params: Record<string, string> };
    expect(desktopCounterpart(mobile)).toEqual({ name: "channels", query: { channelId: "c1", threadRootId: "r1" } });
  });
});

describe("stack", () => {
  it("knows each screen's parent and depth", () => {
    expect(parentOf(p("mobile-thread", { channelId: "c1", rootId: "r1" }))).toEqual({ name: "mobile-channel", params: { channelId: "c1" } });
    expect(parentOf(p("mobile-channel", { channelId: "c1" }))).toEqual({ name: "mobile-home" });
    expect([depthOf("mobile-home"), depthOf("mobile-channel"), depthOf("mobile-thread"), depthOf("mobile-inbox")]).toEqual([0, 1, 2, 0]);
    expect([depthOf("mobile-dm"), depthOf("mobile-dm-thread")]).toEqual([1, 2]);
    expect(parentOf(p("mobile-dm-thread", { conversationId: "d1", rootId: "r1" }))).toEqual({
      name: "mobile-dm",
      params: { conversationId: "d1" },
    });
    expect(parentOf(p("mobile-dm", { conversationId: "d1" }))).toEqual({ name: "mobile-home" });
    expect(isMobileRoute("mobile-search")).toBe(true);
    expect(isMobileRoute("channels")).toBe(false);
  });
});

describe("header back", () => {
  beforeEach(() => {
    nav.back.mockReset();
    nav.replace.mockReset();
    nav.current = p("mobile-thread", { channelId: "c1", rootId: "r1" });
  });
  afterEach(() => window.history.replaceState(null, ""));

  it("walks the real history when the previous screen was in the mobile stack (platform back agrees)", async () => {
    const { useMobileNav } = await import("@/features/mobile/mobileNav");
    window.history.replaceState({ back: "/m/c/c1" }, "");
    useMobileNav().goBack();
    expect(nav.back).toHaveBeenCalledOnce();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("goes one level up when nothing in the app is behind (e.g. opened from a notification)", async () => {
    const { useMobileNav } = await import("@/features/mobile/mobileNav");
    window.history.replaceState({ back: null }, "");
    useMobileNav().goBack();
    expect(nav.back).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledWith({ name: "mobile-channel", params: { channelId: "c1" } });
  });

  it("from a conversation, one level up is Home", async () => {
    const { useMobileNav } = await import("@/features/mobile/mobileNav");
    nav.current = p("mobile-channel", { channelId: "c1" });
    useMobileNav().goBack();
    expect(nav.replace).toHaveBeenCalledWith({ name: "mobile-home" });
  });
});
