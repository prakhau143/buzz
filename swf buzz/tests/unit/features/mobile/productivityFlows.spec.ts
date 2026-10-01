/**
 * Phase D4 — every productivity entry point (Search, Inbox, notification)
 * reaches the exact message through the ONE target model and the ONE opener:
 * same-community targets never switch, another community's target goes
 * through the verified switch, and a refused switch leaves you where you were.
 * Plus the shared read state the Inbox, badge and conversations all read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { h } from "vue";
import type { InboxItem } from "@/features/inbox/inboxModel";
import type { MessageTarget } from "@/features/navigation/messageTarget";

const nav = vi.hoisted(() => ({ push: vi.fn(async () => undefined) }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn() }), useRoute: () => ({ query: {} }) }));
const sw = vi.hoisted(() => ({ switchTo: vi.fn(async (_u: string) => true), active: { value: "wss://a.example.com" } }));
vi.mock("@/features/communities/useCommunitySwitch", () => ({ useCommunitySwitch: () => ({ switchTo: sw.switchTo }) }));
vi.mock("@/features/communities/relayCommunities", () => ({ activeRelayUrl: sw.active, relayHost: (u: string) => u }));

const { fromSearchHit, fromInboxItem, fromNotificationTarget } = await import("@/features/navigation/messageTarget");
const { useOpenMessageTarget } = await import("@/features/navigation/useOpenMessageTarget");
const { setMobileForTests } = await import("@/features/mobile/breakpoints");
const { NotificationLedger, ledgerKey, identityFingerprint, parseNotificationTarget } = await import("@/features/notifications/notificationEngine");
const { isUnread } = await import("@/features/inbox/inboxModel");
const { useReadStateStore } = await import("@/stores/readState");
const { useSessionStore } = await import("@/stores/session");

const A = "wss://a.example.com";
const B = "wss://b.example.com";
const ME = "a".repeat(64);
const MSG = "1".repeat(64);
const ROOT = "2".repeat(64);

function opener() {
  let api!: ReturnType<typeof useOpenMessageTarget>;
  mount({ setup: () => ((api = useOpenMessageTarget()), () => h("i")) });
  return api.openMessageTarget;
}
const searchTarget = (rootId?: string, isDm = false) =>
  fromSearchHit({ channelId: isDm ? "d1" : "c1", message: { id: MSG, thread: rootId ? { rootId } : {} } }, isDm)!;
const inboxItem = (over: Partial<InboxItem> = {}): InboxItem =>
  ({
    key: "k",
    type: "mention",
    channelId: "c1",
    rootId: null,
    createdAt: 200,
    count: 1,
    mentionsMe: true,
    event: { id: MSG, kind: 9, pubkey: "b".repeat(64), content: "x", created_at: 200, tags: [], sig: "" },
    ...over,
  }) as InboxItem;

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().$patch({ pubkey: ME });
  nav.push.mockClear();
  sw.switchTo.mockReset();
  sw.switchTo.mockImplementation(async (url: string) => {
    sw.active.value = url;
    return true;
  });
  sw.active.value = A;
  setMobileForTests(true);
});
afterEach(() => setMobileForTests(false));

describe("Search → exact message", () => {
  it("channel message: no switch (search runs in the open community), exact reveal route", async () => {
    await opener()(searchTarget());
    expect(sw.switchTo).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith({ name: "mobile-channel", params: { channelId: "c1" }, query: { m: MSG } });
  });
  it("thread reply → the thread page with the reply; DM → the DM", async () => {
    const open = opener();
    await open(searchTarget(ROOT));
    await open(searchTarget(undefined, true));
    expect(nav.push).toHaveBeenNthCalledWith(1, { name: "mobile-thread", params: { channelId: "c1", rootId: ROOT }, query: { m: MSG } });
    expect(nav.push).toHaveBeenNthCalledWith(2, { name: "mobile-dm", params: { conversationId: "d1" }, query: { m: MSG } });
  });
  it("desktop tier gets the existing ?messageId= reveal from the same target", async () => {
    setMobileForTests(false);
    await opener()(searchTarget(ROOT));
    expect(nav.push).toHaveBeenCalledWith({ name: "channels", query: { channelId: "c1", messageId: MSG, threadRootId: ROOT } });
  });
  it("a malformed hit is never routed", () => {
    expect(fromSearchHit({ channelId: "bad id!", message: { id: MSG, thread: {} } }, false)).toBeNull();
  });
});

describe("cross-community targets (one verified switch path)", () => {
  const inB = (t: MessageTarget): MessageTarget => ({ ...t, community: B });

  it("Search/Inbox targets carry the open community (null) — never a switch; the feed is per community", async () => {
    expect(searchTarget().community).toBeNull();
    expect(fromInboxItem(inboxItem())!.community).toBeNull();
    await opener()(fromInboxItem(inboxItem())!);
    expect(sw.switchTo).not.toHaveBeenCalled();
  });

  it("a target in community B (e.g. a notification) → verified switch → B conversation → exact message", async () => {
    const target = fromNotificationTarget(
      parseNotificationTarget(JSON.stringify({ v: "1", identity: identityFingerprint(ME), community: B, kind: "channel", channelId: "c9", messageId: MSG }))!,
    )!;
    expect(await opener()(target)).toBe(true);
    expect(sw.switchTo).toHaveBeenCalledWith(B);
    expect(nav.push).toHaveBeenCalledWith({ name: "mobile-channel", params: { channelId: "c9" }, query: { m: MSG } });
  });

  it("the same opener handles a search/inbox-shaped target pointed at B", async () => {
    await opener()(inB(searchTarget(ROOT)));
    expect(sw.switchTo).toHaveBeenCalledWith(B);
    expect(nav.push).toHaveBeenCalledWith({ name: "mobile-thread", params: { channelId: "c1", rootId: ROOT }, query: { m: MSG } });
  });

  it("a refused switch stays in A and navigates nowhere", async () => {
    sw.switchTo.mockImplementation(async () => false);
    expect(await opener()(inB(searchTarget()))).toBe(false);
    expect(sw.active.value).toBe(A);
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("notifications — dedup and target safety", () => {
  it("one alert per identity × community × event", () => {
    const ledger = new NotificationLedger();
    expect(ledger.claim(ledgerKey(ME, A, MSG))).toBe(true);
    expect(ledger.claim(ledgerKey(ME, A, MSG))).toBe(false);
    expect(ledger.claim(ledgerKey(ME, B, MSG))).toBe(true);
  });
  it("a payload is ID-only and validated; junk parses to nothing", () => {
    expect(parseNotificationTarget("{nope")).toBeNull();
    expect(parseNotificationTarget(JSON.stringify({ v: "1", identity: "x", community: "https://evil", kind: "channel", channelId: "c1" }))).toBeNull();
    const ok = parseNotificationTarget(JSON.stringify({ v: "1", identity: identityFingerprint(ME), community: A, kind: "dm", channelId: "d1", messageId: MSG }));
    expect(ok && fromNotificationTarget(ok)).toMatchObject({ kind: "dm", conversationId: "d1", messageId: MSG });
    expect(JSON.stringify(ok)).not.toMatch(/nsec|privkey|secret/i);
  });
});

describe("read-state consistency (one frontier for Inbox, badge, channels, DMs)", () => {
  it("opening an Inbox item advances the same frontier channels use; it never rewinds", () => {
    const rs = useReadStateStore();
    const lastSeen = (id: string) => rs.lastSeenAt[id] ?? 0;
    const item = inboxItem({ createdAt: 200 });
    expect(isUnread(item, lastSeen)).toBe(true);
    rs.markChannelSeen("c1", 200); // what feed.markRead does
    expect(isUnread(item, lastSeen)).toBe(false);
    expect(rs.unreadCounts.c1).toBe(0);
    rs.markChannelSeen("c1", 100); // an older view never moves it back
    expect(rs.lastSeenAt.c1).toBe(200);
    expect(rs.publishedFrontier.c1).toBe(200);
  });
  it("a DM is a channel on the wire: the same frontier decides its Inbox row", () => {
    const rs = useReadStateStore();
    const dm = inboxItem({ type: "dm", channelId: "d1", createdAt: 300 });
    rs.markChannelSeen("d1", 300);
    expect(isUnread(dm, (id) => rs.lastSeenAt[id] ?? 0)).toBe(false);
  });
});
