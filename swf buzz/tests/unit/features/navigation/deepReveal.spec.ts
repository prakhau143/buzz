/**
 * Phase C2 — deep links to the exact message: one target model, one opener
 * (verified community switch → tier route), the mobile `?m=` reveal, and the
 * reveal mechanics (already loaded, paging, not found, thread replies).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { h } from "vue";
import type { InboxItem } from "@/features/inbox/inboxModel";

const nav = vi.hoisted(() => ({
  push: vi.fn(async () => undefined),
  replace: vi.fn(async () => undefined),
  route: { name: "mobile-channel", params: { channelId: "c1" }, query: {} as Record<string, string> },
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn() }),
  useRoute: () => nav.route,
}));
const sw = vi.hoisted(() => ({ switchTo: vi.fn(async (_url: string) => true), active: { value: "wss://a.example.com" } }));
vi.mock("@/features/communities/useCommunitySwitch", () => ({
  useCommunitySwitch: () => ({ switchTo: sw.switchTo }),
}));
vi.mock("@/features/communities/relayCommunities", () => ({
  activeRelayUrl: sw.active,
  relayHost: (u: string) => u.replace(/^wss?:\/\//, ""),
}));

const { normalizeMessageTarget, fromInboxItem, fromNotificationTarget, mobileRoute, desktopRoute } = await import(
  "@/features/navigation/messageTarget"
);
const { useOpenMessageTarget, deepNavPhase } = await import("@/features/navigation/useOpenMessageTarget");
const { setMobileForTests } = await import("@/features/mobile/breakpoints");
const { useMobileReveal } = await import("@/features/mobile/useMobileReveal");
const { mobileCounterpart, desktopCounterpart } = await import("@/features/mobile/mobileRoutes");

const A = "wss://a.example.com";
const B = "wss://b.example.com";
const MSG = "1".repeat(64);
const ROOT = "2".repeat(64);

beforeEach(() => {
  setActivePinia(createPinia());
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.route.query = {};
  sw.switchTo.mockReset();
  sw.switchTo.mockImplementation(async (url: string) => {
    sw.active.value = url;
    return true;
  });
  sw.active.value = A;
  setMobileForTests(true);
});
afterEach(() => setMobileForTests(false));

// ---------------------------------------------------------------------------
describe("target model", () => {
  it("normalises a channel message, a DM message and a thread reply", () => {
    expect(normalizeMessageTarget({ kind: "channel", conversationId: "c1", messageId: MSG })).toEqual({
      community: null, kind: "channel", conversationId: "c1", messageId: MSG, threadRootId: null, source: "other",
    });
    expect(normalizeMessageTarget({ kind: "dm", conversationId: "d1", messageId: MSG, community: B })?.community).toBe(B);
    expect(normalizeMessageTarget({ kind: "channel", conversationId: "c1", messageId: MSG, threadRootId: ROOT })?.threadRootId).toBe(ROOT);
  });

  it("a root 'reply to itself' is the root; a root without a message is dropped", () => {
    expect(normalizeMessageTarget({ kind: "channel", conversationId: "c1", messageId: ROOT, threadRootId: ROOT })?.threadRootId).toBeNull();
    expect(normalizeMessageTarget({ kind: "channel", conversationId: "c1", threadRootId: ROOT })?.threadRootId).toBeNull();
  });

  it("rejects invalid targets instead of guessing", () => {
    expect(normalizeMessageTarget({ kind: "channel" })).toBeNull(); // missing channel
    expect(normalizeMessageTarget({ kind: "dm", conversationId: "" })).toBeNull(); // missing dm
    expect(normalizeMessageTarget({ kind: "thread", conversationId: "c1" })).toBeNull(); // bad kind
    expect(normalizeMessageTarget({ kind: "channel", conversationId: "c1", community: "https://evil" })).toBeNull(); // bad community
    expect(normalizeMessageTarget({ kind: "channel", conversationId: "c 1; drop" })).toBeNull(); // bad id
    // a bad message id degrades to "open the conversation", never a fabricated message
    expect(normalizeMessageTarget({ kind: "channel", conversationId: "c1", messageId: "<script>" })?.messageId).toBeNull();
  });

  const item = (over: Partial<InboxItem> & { kind?: number }): InboxItem =>
    ({
      key: "k", type: "mention", channelId: "c1", rootId: null, createdAt: 1, count: 1, mentionsMe: true,
      event: { id: MSG, kind: over.kind ?? 9, pubkey: "p", content: "", created_at: 1, tags: [], sig: "" },
      ...over,
    }) as InboxItem;

  it("Inbox rows: mention, thread reply, DM, needs-action, and a row with no conversation", () => {
    expect(fromInboxItem(item({}))).toMatchObject({ kind: "channel", conversationId: "c1", messageId: MSG, threadRootId: null, source: "mention" });
    expect(fromInboxItem(item({ type: "thread", rootId: ROOT }))).toMatchObject({ threadRootId: ROOT, source: "thread-reply" });
    expect(fromInboxItem(item({ type: "dm", channelId: "d1" }))).toMatchObject({ kind: "dm", conversationId: "d1", messageId: MSG });
    // needs-action that is not a chat message (e.g. kind 46010): open its conversation, no message to reveal
    expect(fromInboxItem(item({ type: "needs_action", kind: 46010, mentionsMe: false }))).toMatchObject({ messageId: null, source: "inbox" });
    expect(fromInboxItem(item({ channelId: null }))).toBeNull();
  });

  it("notification targets convert; Inbox and incomplete ones don't", () => {
    const base = { v: "1" as const, identity: "x", community: B };
    expect(fromNotificationTarget({ ...base, kind: "channel", channelId: "c1", messageId: MSG, threadRootId: ROOT })).toMatchObject({
      community: B, kind: "channel", threadRootId: ROOT, source: "notification",
    });
    expect(fromNotificationTarget({ ...base, kind: "inbox" })).toBeNull();
    expect(fromNotificationTarget({ ...base, kind: "dm" })).toBeNull();
  });

  it("routes: mobile pages carry ?m=, desktop keeps the existing ?messageId=&threadRootId= contract", () => {
    const reply = normalizeMessageTarget({ kind: "channel", conversationId: "c1", messageId: MSG, threadRootId: ROOT })!;
    expect(mobileRoute(reply)).toEqual({ name: "mobile-thread", params: { channelId: "c1", rootId: ROOT }, query: { m: MSG } });
    expect(desktopRoute(reply)).toEqual({ name: "channels", query: { channelId: "c1", messageId: MSG, threadRootId: ROOT } });
    const dm = normalizeMessageTarget({ kind: "dm", conversationId: "d1", messageId: MSG })!;
    expect(mobileRoute(dm)).toEqual({ name: "mobile-dm", params: { conversationId: "d1" }, query: { m: MSG } });
    const dmReply = normalizeMessageTarget({ kind: "dm", conversationId: "d1", messageId: MSG, threadRootId: ROOT })!;
    expect(mobileRoute(dmReply)).toEqual({ name: "mobile-dm-thread", params: { conversationId: "d1", rootId: ROOT }, query: { m: MSG } });
  });

  it("crossing the breakpoint keeps a pending reveal (messageId ⇄ m)", () => {
    expect(mobileCounterpart({ name: "channels", query: { channelId: "c1", messageId: MSG } })).toEqual({
      name: "mobile-channel", params: { channelId: "c1" }, query: { m: MSG },
    });
    expect(mobileCounterpart({ name: "channels", query: { channelId: "c1", messageId: MSG, threadRootId: ROOT } })).toEqual({
      name: "mobile-thread", params: { channelId: "c1", rootId: ROOT }, query: { m: MSG },
    });
    expect(desktopCounterpart({ name: "mobile-dm", params: { conversationId: "d1" }, query: { m: MSG } })).toEqual({
      name: "dm", query: { conversationId: "d1", messageId: MSG },
    });
  });
});

// ---------------------------------------------------------------------------
describe("the deep-link opener", () => {
  function opener() {
    let api!: ReturnType<typeof useOpenMessageTarget>;
    mount({ setup: () => ((api = useOpenMessageTarget()), () => h("div")) });
    return api;
  }
  const channelTarget = (community: string | null = null) =>
    normalizeMessageTarget({ kind: "channel", conversationId: "c1", messageId: MSG, community })!;

  it("same community: navigates straight to the mobile page (no switch)", async () => {
    const ok = await opener().openMessageTarget(channelTarget(A));
    expect(ok).toBe(true);
    expect(sw.switchTo).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith({ name: "mobile-channel", params: { channelId: "c1" }, query: { m: MSG } });
  });

  it("desktop tier: the desktop reveal route", async () => {
    setMobileForTests(false);
    await opener().openMessageTarget(channelTarget());
    expect(nav.push).toHaveBeenCalledWith({ name: "channels", query: { channelId: "c1", messageId: MSG } });
  });

  it("cross-community: resolves B through the verified switch first, then opens the target", async () => {
    let phaseDuringSwitch = "";
    sw.switchTo.mockImplementationOnce(async (url: string) => {
      phaseDuringSwitch = deepNavPhase.value;
      sw.active.value = url;
      return true;
    });
    const ok = await opener().openMessageTarget(channelTarget(B));
    expect(ok).toBe(true);
    expect(sw.switchTo).toHaveBeenCalledWith(B);
    expect(phaseDuringSwitch).toBe("community");
    expect(nav.push).toHaveBeenCalledOnce();
    expect(deepNavPhase.value).toBe("idle");
  });

  it("a refused / unreachable community: stays in A, navigates nowhere (the shared switch shows the error)", async () => {
    sw.switchTo.mockResolvedValueOnce(false);
    const ok = await opener().openMessageTarget(channelTarget(B));
    expect(ok).toBe(false);
    expect(sw.active.value).toBe(A);
    expect(nav.push).not.toHaveBeenCalled();
    expect(deepNavPhase.value).toBe("idle");
  });

  it("one deep navigation at a time (a double tap doesn't navigate twice)", async () => {
    let release: () => void = () => undefined;
    sw.switchTo.mockImplementationOnce(() => new Promise<boolean>((r) => (release = () => ((sw.active.value = B), r(true)))));
    const api = opener();
    const first = api.openMessageTarget(channelTarget(B));
    const second = await api.openMessageTarget(channelTarget(B));
    expect(second).toBe(false);
    release();
    await first;
    expect(nav.push).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
describe("mobile reveal state (?m=)", () => {
  function reveal() {
    let api!: ReturnType<typeof useMobileReveal>;
    mount({ setup: () => ((api = useMobileReveal()), () => h("div")) });
    return api;
  }

  it("finding → found: highlight, then m is dropped with replace (no extra history, no re-reveal)", () => {
    nav.route.query = { m: MSG, other: "keep" };
    const r = reveal();
    expect(r.target.value).toBe(MSG);
    expect(r.status.value).toBe("finding");
    r.done(true);
    expect(r.status.value).toBe("idle");
    expect(nav.replace).toHaveBeenCalledWith({ query: { other: "keep" } });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("not found → 'Message unavailable' (dismissible); nothing fabricated", () => {
    nav.route.query = { m: MSG };
    const r = reveal();
    r.done(false);
    expect(r.status.value).toBe("unavailable");
    r.dismiss();
    expect(r.status.value).toBe("idle");
  });

  it("no m → nothing to do", () => {
    const r = reveal();
    expect(r.target.value).toBeNull();
    expect(r.status.value).toBe("idle");
  });
});
