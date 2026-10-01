/**
 * Phase D3 — a needs-action alert while the Inbox (where the request already
 * shows) is on screen is "viewing" on BOTH tiers; elsewhere it is not. The
 * pipeline is the existing one: seed on first load, fresh-only, ledger dedup.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const alerts: { slot: string; viewing: boolean; target?: { kind?: string } }[] = [];
const inboxItems = ref<unknown[]>([]);
const routeName = vi.hoisted(() => ({ value: "mobile-inbox" }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn(), currentRoute: { get value() { return { name: routeName.value }; } } }) }));
vi.mock("@/features/dm/useDmList", () => ({ useDmList: () => ({ data: ref([]) }) }));
vi.mock("@/features/channels/useChannels", () => ({ useChannels: () => ({ data: ref([]) }) }));
vi.mock("@/features/inbox/useInboxFeed", () => ({
  useInboxFeed: () => ({ items: inboxItems, isLoading: ref(false), unread: () => true }),
}));
vi.mock("@/features/readState/useUnreadTracking", () => ({ useUnreadTracking: () => undefined }));
vi.mock("@/features/notifications/desktopNotifier", () => ({
  alertIfAllowed: async (input: (typeof alerts)[number]) => (alerts.push(input), true),
  setTaskbarIndicator: async () => undefined,
}));
vi.mock("@/features/profile/profileStore", () => ({ profileFor: () => ({ displayName: "Prakhar" }) }));
vi.mock("@/features/auth/useAuth", () => ({ useAuth: () => ({ switchCommunity: vi.fn() }) }));
vi.mock("@/features/communities/relayCommunities", async () => {
  const { ref: r } = await import("vue");
  return { activeRelayUrl: r("wss://buzz.example.com") };
});

const { useNotificationService } = await import("@/features/notifications/useNotificationService");
const { useSessionStore } = await import("@/stores/session");

const ME = "a".repeat(64);
let n = 0;
const request = () => {
  const id = (++n).toString(16).padStart(64, "0");
  const now = Math.floor(Date.now() / 1000);
  return { key: `event:${id}`, type: "needs_action", channelId: "c1", rootId: null, createdAt: now, count: 1, mentionsMe: true,
    event: { id, kind: 46010, pubkey: "b".repeat(64), content: "Approve deploy?", created_at: now, tags: [], sig: "" } };
};

let wrapper: ReturnType<typeof mount> | null = null;
async function start() {
  wrapper = mount({ setup: () => (useNotificationService(), () => h("i")) });
  await nextTick();
  inboxItems.value = []; // first load seeds (existing requests are not news)
  await flushPromises();
}

beforeEach(() => {
  wrapper?.unmount();
  wrapper = null;
  setActivePinia(createPinia());
  useSessionStore().$patch({ pubkey: ME });
  alerts.length = 0;
  inboxItems.value = [request()];
});

describe("needs-action alert — 'viewing' the Inbox on either tier", () => {
  for (const [name, viewing] of [["mobile-inbox", true], ["inbox", true], ["mobile-home", false], ["mobile-search", false]] as const) {
    it(`${name} → viewing=${viewing}`, async () => {
      routeName.value = name;
      await start();
      inboxItems.value = [request()];
      await flushPromises();
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ slot: "needs_action", viewing });
      expect(alerts[0].target?.kind).toBe("inbox");
    });
  }

  it("the same request re-delivered is not alerted twice", async () => {
    routeName.value = "mobile-home";
    await start();
    const r = request();
    inboxItems.value = [r];
    await flushPromises();
    inboxItems.value = [{ ...r }];
    await flushPromises();
    expect(alerts).toHaveLength(1);
  });
});
