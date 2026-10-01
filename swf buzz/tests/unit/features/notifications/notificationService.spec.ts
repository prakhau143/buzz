/**
 * The session-wide notification service: one alert per event, canonical names,
 * reconnect replays stay silent, identity isolation, and the taskbar dot is
 * set on change only and cleared on unmount (sign-out).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { Message } from "@/types/domain";

type Incoming = (m: Message, ctx: { viewing: boolean; mentionsMe: boolean }) => void;
let incoming: Incoming | null = null;
let trackedActive: (() => string | null) | null = null;
const alerts: { slot: string; title: string; body: string; viewing: boolean; target?: unknown; inApp?: unknown }[] = [];
const indicator: boolean[] = [];
const conversations = ref([{ id: "dm-1" }]);
const profiles = new Map<string, { displayName: string }>();
const inboxItems = ref<unknown[]>([]);

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn(), currentRoute: { value: { name: "settings" } } }) }));
vi.mock("@/features/dm/useDmList", () => ({ useDmList: () => ({ data: conversations }) }));
vi.mock("@/features/channels/useChannels", () => ({ useChannels: () => ({ data: ref([{ id: "chan-1", name: "general" }]) }) }));
vi.mock("@/features/inbox/useInboxFeed", () => ({
  useInboxFeed: () => ({ items: inboxItems, isLoading: ref(false), unread: () => true }),
}));
vi.mock("@/features/readState/useUnreadTracking", () => ({
  useUnreadTracking: (active: () => string | null, cb: Incoming) => {
    trackedActive = active;
    incoming = cb;
  },
}));
vi.mock("@/features/notifications/desktopNotifier", () => ({
  alertIfAllowed: async (input: (typeof alerts)[number]) => {
    alerts.push(input);
    return true;
  },
  setTaskbarIndicator: async (show: boolean) => {
    indicator.push(show);
  },
}));
vi.mock("@/features/profile/profileStore", () => ({ profileFor: (pk: string) => profiles.get(pk) ?? null }));
vi.mock("@/services/ProfileService", () => ({
  profileService: {
    fetchProfiles: async (pks: string[]) => {
      pks.forEach((pk) => profiles.set(pk, { displayName: "Fetched Name" }));
      return new Map();
    },
  },
}));
vi.mock("@/features/auth/useAuth", () => ({ useAuth: () => ({ switchCommunity: vi.fn() }) }));
vi.mock("@/features/communities/relayCommunities", async () => {
  const { ref: r } = await import("vue");
  return { activeRelayUrl: r("wss://buzz.example.com") };
});

const { useNotificationService, useReportActiveConversation } = await import("@/features/notifications/useNotificationService");
const { useSessionStore } = await import("@/stores/session");
const { useReadStateStore } = await import("@/stores/readState");

const ME = "a".repeat(64);
const RAHUL = "b".repeat(64);
let n = 0;
const msg = (over: Partial<Message> = {}): Message =>
  ({
    id: (++n).toString(16).padStart(64, "0"),
    channelId: "dm-1",
    authorPubkey: RAHUL,
    content: "hi there",
    createdAt: Math.floor(Date.now() / 1000),
    thread: {},
    mentions: [],
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    attachments: [],
    ...over,
  }) as Message;

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await nextTick();
};

function mountService() {
  return mount({ setup: () => (useNotificationService(), () => h("span")) });
}

beforeEach(() => {
  setActivePinia(createPinia());
  alerts.length = 0;
  indicator.length = 0;
  incoming = null;
  profiles.clear();
  profiles.set(RAHUL, { displayName: "Rahul" });
  const session = useSessionStore();
  session.pubkey = ME;
});

describe("notification service", () => {
  it("alerts once per event even when the relay re-delivers it", async () => {
    mountService();
    const m = msg();
    incoming!(m, { viewing: false, mentionsMe: false });
    incoming!(m, { viewing: false, mentionsMe: false });
    await flush();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ slot: "dm", title: "Rahul", body: "hi there" });
    // The in-app card gets the same event id (one ledger, one surface).
    expect(alerts[0]).toMatchObject({ inApp: { id: m.id, context: "Direct message", authorName: "Rahul" } });
    expect(alerts[0].target).toMatchObject({ kind: "dm", channelId: "dm-1", messageId: m.id });
  });

  it("a replay of old history after a reconnect is silent", async () => {
    mountService();
    incoming!(msg({ createdAt: Math.floor(Date.now() / 1000) - 3600 }), { viewing: false, mentionsMe: false });
    await flush();
    expect(alerts).toHaveLength(0);
  });

  it("uses the canonical profile name, fetching it when unknown", async () => {
    mountService();
    const stranger = "c".repeat(64);
    incoming!(msg({ authorPubkey: stranger }), { viewing: false, mentionsMe: false });
    await flush();
    expect(alerts[0].title).toBe("Fetched Name");
  });

  it("mentions carry the channel name; plain chatter never alerts", async () => {
    mountService();
    incoming!(msg({ channelId: "chan-1", mentions: [ME] }), { viewing: false, mentionsMe: true });
    incoming!(msg({ channelId: "chan-1" }), { viewing: false, mentionsMe: false });
    await flush();
    expect(alerts.map((a) => a.title)).toEqual(["Rahul · #general"]);
  });

  it("passes 'viewing' through for the Notify-while-viewing policy", async () => {
    mountService();
    incoming!(msg(), { viewing: true, mentionsMe: false });
    await flush();
    expect(alerts[0].viewing).toBe(true);
  });

  it("nothing is 'viewed' once the conversation's view is gone (e.g. in Settings)", async () => {
    mountService();
    const reporter = mount({ setup: () => (useReportActiveConversation(() => "dm-1"), () => h("i")) });
    expect(trackedActive!()).toBe("dm-1");
    reporter.unmount();
    expect(trackedActive!()).toBeNull();
  });

  it("identity switch: a new identity starts clean", async () => {
    mountService();
    const m = msg();
    incoming!(m, { viewing: false, mentionsMe: false });
    await flush();
    useSessionStore().pubkey = "d".repeat(64);
    await flush();
    expect(indicator.at(-1)).toBe(false);
    // The previous identity's toasts can't be claimed by or leak into the next one.
    expect(alerts).toHaveLength(1);
  });

  it("taskbar dot follows unread DMs, only on change, and clears on unmount (sign-out)", async () => {
    const w = mountService();
    const readState = useReadStateStore();
    readState.isReady = true;
    await flush();
    expect(indicator).toEqual([false]);
    readState.unreadCounts = { "chan-1": 3 }; // chatter only
    await flush();
    expect(indicator).toEqual([false]);
    readState.unreadCounts = { "chan-1": 3, "dm-1": 1 };
    await flush();
    readState.unreadCounts = { "chan-1": 3, "dm-1": 2 };
    await flush();
    expect(indicator).toEqual([false, true]); // no redundant calls
    w.unmount();
    expect(indicator.at(-1)).toBe(false);
  });
});
