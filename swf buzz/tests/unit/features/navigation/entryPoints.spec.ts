/**
 * Deep-link entry points: mobile Inbox rows and notification clicks both go
 * through the ONE opener with the ONE target model; the Inbox marks the item
 * read with its existing rule; foreign-identity and incomplete notifications
 * are never routed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { h, nextTick, ref } from "vue";
import type { InboxItem } from "@/features/inbox/inboxModel";
import type { MessageTarget } from "@/features/navigation/messageTarget";

const ME = "a".repeat(64);
const MSG = "1".repeat(64);
const ROOT = "2".repeat(64);

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
const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({ useRouter: () => ({ push }), useRoute: () => ({ name: "mobile-inbox", params: {}, query: {} }) }));
const switchTo = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/features/communities/useCommunitySwitch", () => ({
  useCommunitySwitch: () => ({ switchTo }),
  communitySwitchError: { value: null },
  communitySwitchingTo: { value: null },
  clearCommunitySwitchError: () => undefined,
}));

// ---- Inbox fixtures ----
const items = ref<InboxItem[]>([]);
const markRead = vi.fn((_: InboxItem) => opened.order.push("markRead"));
vi.mock("@/features/inbox/useInboxFeed", () => ({
  useInboxFeed: () => ({
    items,
    unread: () => true,
    isLoading: ref(false),
    isError: ref(false),
    partialError: ref(false),
    refetch: vi.fn(),
    markRead,
    markAllRead: vi.fn(),
  }),
}));
vi.mock("@/composables/useProfile", async () => {
  const { computed, ref: r } = await import("vue");
  return {
    useProfile: () => ({ data: computed(() => undefined) }),
    useProfileMap: () => ({ profiles: r(new Map()), displayNames: r(new Map()) }),
  };
});
vi.mock("@/features/channels/useChannels", () => ({ useChannels: () => ({ data: ref([{ id: "c1", name: "swf-project" }]) }) }));

// ---- Notification service fixtures (as in notificationService.spec) ----
let opener: ((t: unknown) => Promise<void>) | null = null;
vi.mock("@/features/notifications/inAppToasts", () => ({
  setInAppToastOpener: (fn: typeof opener) => (opener = fn),
  clearInAppToasts: () => undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@/features/dm/useDmList", () => ({ useDmList: () => ({ data: ref([]) }) }));
vi.mock("@/features/readState/useUnreadTracking", () => ({ useUnreadTracking: () => undefined }));
vi.mock("@/features/notifications/desktopNotifier", () => ({ alertIfAllowed: async () => true, setTaskbarIndicator: async () => undefined }));
vi.mock("@/features/communities/relayCommunities", async () => {
  const { ref: r } = await import("vue");
  return { activeRelayUrl: r("wss://a.example.com"), relayHost: (u: string) => u };
});

const { useSessionStore } = await import("@/stores/session");
const { setMobileForTests } = await import("@/features/mobile/breakpoints");
const { identityFingerprint } = await import("@/features/notifications/notificationEngine");
const MobileInboxView = (await import("@/features/mobile/views/MobileInboxView.vue")).default;
const { useNotificationService } = await import("@/features/notifications/useNotificationService");

const LayoutStub = { name: "MobileLayout", setup: (_: unknown, { slots }: { slots: Record<string, () => unknown> }) => () => h("div", [slots.header?.(), slots.default?.()]) };
const item = (over: Partial<InboxItem> & { kind?: number }): InboxItem =>
  ({
    key: over.key ?? "k",
    type: "mention",
    channelId: "c1",
    rootId: null,
    createdAt: 1_700_000_000,
    count: 1,
    mentionsMe: true,
    event: { id: MSG, kind: over.kind ?? 9, pubkey: "b".repeat(64), content: "hello", created_at: 1_700_000_000, tags: [], sig: "" },
    ...over,
  }) as InboxItem;

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().$patch({ pubkey: ME });
  opened.calls.length = 0;
  opened.order.length = 0;
  markRead.mockClear();
  push.mockClear();
  switchTo.mockReset();
  switchTo.mockResolvedValue(true);
  items.value = [];
  setMobileForTests(true);
});

describe("mobile Inbox → exact target", () => {
  function mountInbox() {
    return mount(MobileInboxView, { global: { stubs: { MobileLayout: LayoutStub, MobileHeader: true } } });
  }
  const rows = (w: ReturnType<typeof mountInbox>) => w.findAll("[data-testid=mobile-inbox-row]");

  it("mention → marks the item read (existing rule), THEN opens the exact channel message", async () => {
    items.value = [item({})];
    const w = mountInbox();
    await rows(w)[0].trigger("click");
    await flushPromises();
    expect(opened.order).toEqual(["markRead", "open"]);
    expect(opened.calls[0]).toMatchObject<Partial<MessageTarget>>({ kind: "channel", conversationId: "c1", messageId: MSG, threadRootId: null });
  });

  it("thread reply → the thread with the exact reply", async () => {
    items.value = [item({ type: "thread", rootId: ROOT })];
    const w = mountInbox();
    await rows(w)[0].trigger("click");
    await flushPromises();
    expect(opened.calls[0]).toMatchObject({ threadRootId: ROOT, messageId: MSG });
  });

  it("DM rows now open (exact DM message)", async () => {
    items.value = [item({ type: "dm", channelId: "d1" })];
    const w = mountInbox();
    expect(rows(w)[0].attributes("disabled")).toBeUndefined();
    await rows(w)[0].trigger("click");
    await flushPromises();
    expect(opened.calls[0]).toMatchObject({ kind: "dm", conversationId: "d1", messageId: MSG });
  });

  it("needs-action with a conversation opens it; a row with no conversation is disabled and does nothing", async () => {
    items.value = [item({ key: "a", type: "needs_action", kind: 46010, mentionsMe: false }), item({ key: "b", channelId: null })];
    const w = mountInbox();
    await rows(w)[0].trigger("click");
    await flushPromises();
    expect(opened.calls[0]).toMatchObject({ conversationId: "c1", messageId: null });
    expect(rows(w)[1].attributes("disabled")).toBeDefined();
    await rows(w)[1].trigger("click");
    await flushPromises();
    expect(opened.calls).toHaveLength(1);
  });
});

describe("notification click → the same opener", () => {
  async function mountService() {
    mount({ setup: () => (useNotificationService(), () => h("span")) });
    await nextTick();
    return opener!;
  }
  const target = (over: Record<string, unknown> = {}) => ({
    v: "1",
    identity: identityFingerprint(ME),
    community: "wss://b.example.com",
    kind: "channel",
    channelId: "c1",
    messageId: MSG,
    ...over,
  });

  it("a channel reply target is normalised and opened (community included)", async () => {
    const open = await mountService();
    await open(target({ threadRootId: ROOT }));
    expect(opened.calls[0]).toEqual({
      community: "wss://b.example.com", kind: "channel", conversationId: "c1", messageId: MSG, threadRootId: ROOT, source: "notification",
    });
  });

  it("a toast from another identity is never routed", async () => {
    const open = await mountService();
    await open(target({ identity: "0000000000000000" }));
    expect(opened.calls).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("an incomplete channel/DM target is ignored, not guessed", async () => {
    const open = await mountService();
    await open({ ...target(), channelId: undefined });
    expect(opened.calls).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("an Inbox target opens the Inbox of the current tier, after a verified switch; a refused switch goes nowhere", async () => {
    const open = await mountService();
    await open(target({ kind: "inbox", channelId: undefined, messageId: undefined, community: "wss://a.example.com" }));
    expect(push).toHaveBeenCalledWith({ name: "mobile-inbox" });
    push.mockClear();
    switchTo.mockResolvedValueOnce(false);
    await open(target({ kind: "inbox", channelId: undefined, messageId: undefined }));
    expect(switchTo).toHaveBeenCalledWith("wss://b.example.com");
    expect(push).not.toHaveBeenCalled();
  });
});
