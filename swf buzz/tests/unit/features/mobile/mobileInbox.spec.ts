/**
 * Phase D1 — mobile Inbox over the ONE feed: filters (existing semantics),
 * unread presentation (not colour alone), markRead / markAllRead through the
 * feed, loading skeleton, per-filter empty states, error vs partial error, the
 * filter kept in the URL for back navigation, and the bottom-nav badge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { h, ref } from "vue";
import type { InboxItem } from "@/features/inbox/inboxModel";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), route: { name: "mobile-inbox", params: {}, query: {} as Record<string, string> } }));
vi.mock("vue-router", async () => {
  const { reactive: r } = await import("vue");
  const route = r(nav.route);
  nav.route = route;
  return {
    useRouter: () => ({ push: nav.push, replace: nav.replace }),
    useRoute: () => route,
    RouterLink: { props: ["to"], setup: (_: unknown, { slots }: { slots: { default?: () => unknown } }) => () => h("a", slots.default?.()) },
  };
});
const opened = vi.hoisted(() => ({ calls: [] as unknown[], order: [] as string[] }));
vi.mock("@/features/navigation/useOpenMessageTarget", () => ({
  useOpenMessageTarget: () => ({
    openMessageTarget: async (t: unknown) => {
      opened.calls.push(t);
      opened.order.push("open");
      return true;
    },
  }),
}));
vi.mock("@/composables/useProfile", async () => {
  const { computed, ref: r } = await import("vue");
  return {
    useProfile: () => ({ data: computed(() => undefined) }),
    useProfileMap: () => ({ profiles: r(new Map()), displayNames: r(new Map([["b".repeat(64), "Prakhar"]])) }),
  };
});
vi.mock("@/features/channels/useChannels", () => ({ useChannels: () => ({ data: ref([{ id: "c1", name: "engineering" }]) }) }));

const feed = vi.hoisted(() => ({
  unreadKeys: new Set<string>(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  refetch: vi.fn(),
}));
const items = ref<InboxItem[]>([]);
const isLoading = ref(false);
const isError = ref(false);
const partialError = ref(false);
vi.mock("@/features/inbox/useInboxFeed", () => ({
  useInboxFeed: () => ({
    items,
    unread: (i: InboxItem) => feed.unreadKeys.has(i.key),
    isLoading,
    isError,
    partialError,
    refetch: feed.refetch,
    markRead: (i: InboxItem) => {
      opened.order.push("markRead");
      feed.markRead(i);
    },
    markAllRead: feed.markAllRead,
  }),
}));

const MobileInboxView = (await import("@/features/mobile/views/MobileInboxView.vue")).default;
const { EMPTY_STATE } = await import("@/features/inbox/inboxModel");
const { groupByDay, inboxVerb, inboxWhere, shortTime, badgeText } = await import("@/features/mobile/inboxPresentation");

const LayoutStub = { name: "MobileLayout", setup: (_: unknown, { slots }: { slots: Record<string, () => unknown> }) => () => h("div", [slots.header?.(), slots.default?.()]) };
const B = "b".repeat(64);
const now = Math.floor(Date.now() / 1000);
let n = 0;
const item = (over: Partial<InboxItem> & { kind?: number } = {}): InboxItem => {
  const id = (++n).toString(16).padStart(64, "0");
  return {
    key: over.key ?? `k${n}`,
    type: "mention",
    channelId: "c1",
    rootId: null,
    createdAt: now - n * 60,
    count: 1,
    mentionsMe: true,
    event: { id, kind: over.kind ?? 9, pubkey: B, content: "Deployment is done", created_at: now - n * 60, tags: [], sig: "" },
    ...over,
  } as InboxItem;
};

function mountInbox() {
  return mount(MobileInboxView, { global: { stubs: { MobileLayout: LayoutStub } } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  items.value = [];
  isLoading.value = false;
  isError.value = false;
  partialError.value = false;
  feed.unreadKeys.clear();
  feed.markRead.mockClear();
  feed.markAllRead.mockClear();
  feed.refetch.mockClear();
  nav.replace.mockClear();
  nav.route.query = {};
  opened.calls.length = 0;
  opened.order.length = 0;
});

describe("mobile Inbox — categories", () => {
  it("offers exactly the existing Inbox filters as tabs, All selected by default", () => {
    const w = mountInbox();
    const tabs = w.findAll("[role=tab]");
    expect(tabs.map((t) => t.text().replace(/\s+/g, " ").trim())).toEqual(["All", "Mentions", "Threads", "Needs action", "Reminders"]);
    expect(w.find("[data-testid=inbox-chip-all]").attributes("aria-selected")).toBe("true");
    expect(w.find("[role=tablist]").attributes("aria-label")).toBe("Inbox filters");
  });

  it("filters with the feed's own matchesFilter; the choice goes to ?f= (so back restores it)", async () => {
    items.value = [item({ key: "m" }), item({ key: "t", type: "thread", rootId: "r".repeat(64) }), item({ key: "r", type: "reminder", channelId: null })];
    const w = mountInbox();
    // All = everything but reminders
    expect(w.findAll("[data-testid=mobile-inbox-row]")).toHaveLength(2);
    await w.find("[data-testid=inbox-chip-threads]").trigger("click");
    expect(nav.replace).toHaveBeenCalledWith({ query: { f: "threads" } });
    nav.route.query = { f: "threads" };
    await flushPromises();
    expect(w.findAll("[data-testid=mobile-inbox-row]")).toHaveLength(1);
    nav.route.query = { f: "reminders" };
    await flushPromises();
    const rows = w.findAll("[data-testid=mobile-inbox-row]");
    expect(rows).toHaveLength(1);
    // A reminder with no conversation is shown but not actionable.
    expect(rows[0].attributes("disabled")).toBeDefined();
  });

  it("an unknown ?f= falls back to All", () => {
    nav.route.query = { f: "agents" };
    const w = mountInbox();
    expect(w.find("[data-testid=inbox-chip-all]").attributes("aria-selected")).toBe("true");
  });
});

describe("mobile Inbox — rows and unread", () => {
  it("a row shows sender, what happened, where, preview and time; unread is weight + dot + words, not colour alone", () => {
    const unread = item({ key: "u" });
    const read = item({ key: "r2" });
    items.value = [unread, read];
    feed.unreadKeys.add("u");
    const w = mountInbox();
    const [u, r] = w.findAll("[data-testid=mobile-inbox-row]");
    expect(u.text()).toContain("Prakhar");
    expect(u.text()).toContain("mentioned you");
    expect(u.text()).toContain("#engineering");
    expect(u.text()).toContain("Deployment is done");
    expect(u.classes()).toContain("unread");
    expect(u.find("[data-testid=inbox-unread-dot]").exists()).toBe(true);
    expect(u.attributes("aria-label")).toMatch(/Prakhar mentioned you in #engineering, .*, unread$/);
    expect(r.classes()).not.toContain("unread");
    expect(r.attributes("aria-label")).not.toContain("unread");
    // Header count and per-filter chip counts come from the same unread rule.
    expect(w.find("[data-testid=mobile-title]").exists()).toBe(true);
    expect(w.text()).toContain("1 unread");
    expect(w.find("[data-testid=inbox-chip-all] [data-testid=inbox-chip-count]").text()).toContain("1");
  });

  it("opening a row marks it read with the feed's rule, THEN opens its exact target", async () => {
    const it1 = item({ key: "x" });
    items.value = [it1];
    const w = mountInbox();
    await w.find("[data-testid=mobile-inbox-row]").trigger("click");
    await flushPromises();
    expect(feed.markRead).toHaveBeenCalledWith(it1);
    expect(opened.order).toEqual(["markRead", "open"]);
    expect(opened.calls[0]).toMatchObject({ kind: "channel", conversationId: "c1", messageId: it1.event.id, source: "mention" });
  });

  it("Mark all as read hands the visible rows to feed.markAllRead; disabled with nothing unread", async () => {
    items.value = [item({ key: "a" }), item({ key: "b" })];
    const w = mountInbox();
    expect(w.find("[data-testid=inbox-mark-all]").attributes("disabled")).toBeDefined();
    feed.unreadKeys.add("a");
    items.value = [...items.value];
    await flushPromises();
    await w.find("[data-testid=inbox-mark-all]").trigger("click");
    expect(feed.markAllRead).toHaveBeenCalledWith(items.value);
  });

  it("rows are grouped by day under readable headings", () => {
    items.value = [item({ key: "today" }), item({ key: "old", createdAt: now - 3 * 86_400 })];
    const w = mountInbox();
    const headings = w.findAll(".day-label").map((d) => d.text());
    expect(headings[0]).toBe("Today");
    expect(headings).toHaveLength(2);
  });
});

describe("mobile Inbox — loading, empty, error", () => {
  it("first load: a row skeleton (aria-busy), not a spinner; never once rows exist", async () => {
    isLoading.value = true;
    const w = mountInbox();
    const sk = w.find("[data-testid=list-skeleton]");
    expect(sk.attributes("aria-busy")).toBe("true");
    expect(sk.attributes("aria-label")).toBe("Loading inbox");
    items.value = [item()];
    await flushPromises();
    expect(w.find("[data-testid=list-skeleton]").exists()).toBe(false);
  });

  it("each filter has its own empty state (the Inbox's existing copy)", async () => {
    const w = mountInbox();
    expect(w.find("[data-testid=inbox-empty]").text()).toContain(EMPTY_STATE.all.title);
    nav.route.query = { f: "needs_action" };
    await flushPromises();
    expect(w.find("[data-testid=inbox-empty]").text()).toContain(EMPTY_STATE.needs_action.title);
  });

  it("nothing loaded and every source failed: 'Unable to load Inbox' with Retry", async () => {
    isError.value = true;
    const w = mountInbox();
    expect(w.text()).toContain("Unable to load Inbox");
    await w.find(".retry").trigger("click");
    expect(feed.refetch).toHaveBeenCalled();
  });

  it("a failed refresh never clears rows already shown", () => {
    items.value = [item()];
    isError.value = true;
    const w = mountInbox();
    expect(w.findAll("[data-testid=mobile-inbox-row]")).toHaveLength(1);
    expect(w.text()).not.toContain("Unable to load Inbox");
  });

  it("a partial failure keeps the data with a compact retry notice", async () => {
    items.value = [item()];
    partialError.value = true;
    const w = mountInbox();
    expect(w.find("[data-testid=inbox-partial]").exists()).toBe(true);
    await w.find(".partial-retry").trigger("click");
    expect(feed.refetch).toHaveBeenCalled();
    expect(w.findAll("[data-testid=mobile-inbox-row]")).toHaveLength(1);
  });
});

describe("Inbox presentation helpers", () => {
  it("verbs and context per existing item type", () => {
    const i = (over: Partial<InboxItem>) => ({ ...item(), ...over }) as InboxItem;
    expect(inboxVerb(i({ type: "dm" }))).toBe("sent you a direct message");
    expect(inboxVerb(i({ type: "thread", mentionsMe: false }))).toBe("replied in a thread");
    expect(inboxVerb(i({ type: "thread", mentionsMe: true }))).toBe("mentioned you in a thread");
    expect(inboxVerb(i({ type: "needs_action" }))).toBe("needs your action");
    expect(inboxWhere(i({ type: "dm" }), "d1")).toBeNull();
    expect(inboxWhere(i({ type: "mention" }), "general")).toBe("#general");
    expect(inboxWhere(i({ type: "reminder", channelId: null }), null)).toBeNull();
  });
  it("day groups keep feed order; compact times; 99+ badges", () => {
    const base = new Date(2026, 8, 30, 12).getTime();
    const s = base / 1000;
    const groups = groupByDay([item({ createdAt: s - 60 }), item({ createdAt: s - 86_400 }), item({ createdAt: s - 5 * 86_400 })], base);
    expect(groups.map((g) => g.label).slice(0, 2)).toEqual(["Today", "Yesterday"]);
    expect(groups).toHaveLength(3);
    expect(shortTime(s - 30, base)).toBe("now");
    expect(shortTime(s - 300, base)).toBe("5m");
    expect(shortTime(s - 3 * 3600, base)).toBe("3h");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(120)).toBe("99+");
  });
});

// ---------------------------------------------------------------------------
describe("bottom-nav Inbox badge", () => {
  it("shows the shared useInboxBadge count compactly (99+) and speaks it", async () => {
    vi.resetModules();
    vi.doMock("@/features/inbox/useInboxBadge", () => ({ useInboxBadge: () => ref(120) }));
    const Nav = (await import("@/features/mobile/ui/MobileBottomNav.vue")).default;
    const w = mount(Nav, { global: { stubs: { RouterLink: { props: ["to"], template: "<a v-bind='$attrs'><slot /></a>" } } } });
    const inbox = w.find("[data-testid=mobile-tab-inbox]");
    expect(inbox.attributes("aria-label")).toBe("Inbox, 120 unread");
    expect(inbox.find("[data-testid=mobile-tab-badge]").text()).toBe("99+");
    expect(inbox.find("[data-testid=mobile-tab-badge]").attributes("aria-hidden")).toBe("true");
    vi.doUnmock("@/features/inbox/useInboxBadge");
  });
});
