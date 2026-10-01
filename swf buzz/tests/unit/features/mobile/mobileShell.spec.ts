/**
 * Mobile shell (Phase B): bottom navigation, Home, and the breakpoint.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, h, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { Channel } from "@/types/domain";

const badge = ref(0);
vi.mock("@/features/inbox/useInboxBadge", () => ({ useInboxBadge: () => computed(() => badge.value) }));

const channels = ref<Channel[] | undefined>(undefined);
const channelsLoading = ref(false);
vi.mock("@/features/channels/useChannels", () => ({
  useChannels: () => ({ data: channels, isLoading: channelsLoading, isError: ref(false), refetch: vi.fn() }),
}));
vi.mock("@/features/channels/channelVisibility", () => ({ sidebarChannels: (c: Channel[] | undefined) => c ?? [] }));
const names = ref(new Map<string, string>());
vi.mock("@/composables/useProfile", () => ({
  useProfile: () => ({ data: ref({ displayName: "Prakhar" }) }),
  useProfileMap: () => ({ profiles: ref(new Map()), displayNames: names }),
}));
const conversations = ref<Channel[] | undefined>([]);
const dmLoading = ref(false);
vi.mock("@/features/dm/useDmList", () => ({
  useDmList: () => ({ data: conversations, isLoading: dmLoading, isError: ref(false), refetch: vi.fn() }),
}));
vi.mock("@/features/readState/useUnreadCatchUp", () => ({ useUnreadCatchUp: vi.fn() }));
vi.mock("@/features/notifications/useNotificationService", () => ({ useReportActiveConversation: vi.fn() }));
vi.mock("@/features/communities/communityIcon", () => ({ fetchCommunityIcon: async () => null }));

const current = ref({ url: "wss://buzz.lmdconsulting.com" as string | null, name: "buzz.lmdconsulting.com", host: "buzz.lmdconsulting.com" });
vi.mock("@/features/communities/useCommunitySwitch", () => ({
  communitySwitchError: ref(null),
  communitySwitchingTo: ref(null),
  clearCommunitySwitchError: vi.fn(),
  useCommunitySwitch: () => ({
    current,
    others: ref([]),
    connected: ref(true),
    switchingTo: ref(null),
    switchError: ref(null),
    verifying: ref(false),
    verified: ref(true),
    refresh: vi.fn(),
    switchTo: vi.fn(),
    clearError: vi.fn(),
    openAddCommunity: vi.fn(),
  }),
}));

const { QueryClient, VueQueryPlugin } = await import("@tanstack/vue-query");
type QueryClient = InstanceType<typeof QueryClient>;
const { queryKeys } = await import("@/app/providers/queryKeys");
const { useSessionStore } = await import("@/stores/session");
const { useReadStateStore } = await import("@/stores/readState");
const MobileBottomNav = (await import("@/features/mobile/ui/MobileBottomNav.vue")).default;
const MobileHomeView = (await import("@/features/mobile/views/MobileHomeView.vue")).default;
const { MOBILE_QUERY, useIsMobile } = await import("@/features/mobile/breakpoints");

const Blank = { render: () => h("div") };
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/m", name: "mobile-home", component: Blank },
      { path: "/m/c/:channelId", name: "mobile-channel", component: Blank },
      { path: "/m/c/:channelId/t/:rootId", name: "mobile-thread", component: Blank },
      { path: "/m/d/:conversationId", name: "mobile-dm", component: Blank },
      { path: "/m/inbox", name: "mobile-inbox", component: Blank },
      { path: "/m/search", name: "mobile-search", component: Blank },
      { path: "/m/profile", name: "mobile-profile", component: Blank },
    ],
  });
}

const chan = (id: string, name: string, visibility: "open" | "private" = "open") => ({ id, name, visibility }) as unknown as Channel;

beforeEach(() => {
  setActivePinia(createPinia());
  badge.value = 0;
  channels.value = undefined;
  channelsLoading.value = false;
  current.value = { url: "wss://buzz.lmdconsulting.com", name: "buzz.lmdconsulting.com", host: "buzz.lmdconsulting.com" };
  conversations.value = [];
  dmLoading.value = false;
  names.value = new Map();
  document.body.innerHTML = "";
});

describe("MobileBottomNav", () => {
  async function mountAt(path: string) {
    const router = makeRouter();
    await router.push(path);
    const w = mount(MobileBottomNav, { global: { plugins: [router] } });
    await flushPromises();
    return { w, router };
  }
  const active = (w: Awaited<ReturnType<typeof mountAt>>["w"]) =>
    w.findAll("[aria-current=page]").map((a) => a.attributes("data-testid"));

  it("has exactly Home, Inbox, Search, Profile — no Communities tab", async () => {
    const { w } = await mountAt("/m");
    expect(w.findAll("a").map((a) => a.attributes("data-testid"))).toEqual([
      "mobile-tab-home",
      "mobile-tab-inbox",
      "mobile-tab-search",
      "mobile-tab-profile",
    ]);
  });

  it("marks the active destination; Home stays lit through its conversation and thread", async () => {
    expect(active((await mountAt("/m")).w)).toEqual(["mobile-tab-home"]);
    expect(active((await mountAt("/m/c/c1")).w)).toEqual(["mobile-tab-home"]);
    expect(active((await mountAt("/m/c/c1/t/r1")).w)).toEqual(["mobile-tab-home"]);
    expect(active((await mountAt("/m/inbox")).w)).toEqual(["mobile-tab-inbox"]);
    expect(active((await mountAt("/m/profile")).w)).toEqual(["mobile-tab-profile"]);
  });

  it("shows the Inbox unread badge (the desktop sidebar's rule) with an accessible label", async () => {
    badge.value = 3;
    const { w } = await mountAt("/m");
    const inbox = w.find("[data-testid=mobile-tab-inbox]");
    expect(inbox.find("[data-testid=mobile-tab-badge]").text()).toBe("3");
    expect(inbox.attributes("aria-label")).toBe("Inbox, 3 unread");
    badge.value = 150;
    await flushPromises();
    expect(inbox.find("[data-testid=mobile-tab-badge]").text()).toBe("99+");
  });

  it("navigates between destinations", async () => {
    const { w, router } = await mountAt("/m");
    await w.find("[data-testid=mobile-tab-search]").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("mobile-search");
  });
});

describe("MobileHomeView", () => {
  let queryClient: QueryClient;
  async function mountHome() {
    const router = makeRouter();
    await router.push("/m");
    const w = mount(MobileHomeView, { global: { plugins: [router, [VueQueryPlugin, { queryClient }]] }, attachTo: document.body });
    await flushPromises();
    return { w, router };
  }
  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it("lists direct messages with the partner, unread count and the latest message when this session holds it; tap opens the DM", async () => {
    const ME = "8".repeat(64);
    const BINOD = "b".repeat(64);
    useSessionStore().$patch({ pubkey: ME });
    names.value = new Map([[BINOD, "Binod"]]);
    conversations.value = [{ id: "d1", name: "", visibility: "private", channelType: "dm", archived: false, dmParticipants: [ME, BINOD] } as Channel];
    const readState = useReadStateStore();
    vi.spyOn(readState, "visibleUnread").mockImplementation((id: string) => (id === "d1" ? 2 : 0));
    queryClient.setQueryData(queryKeys.dm("d1"), [
      { id: "m1", authorPubkey: BINOD, content: "Can you check the deploy?", createdAt: Math.floor(Date.now() / 1000) - 120 },
    ]);
    const { w, router } = await mountHome();
    const row = w.find("[data-testid=mobile-dm-row]");
    expect(row.text()).toContain("Binod");
    expect(row.text()).toContain("Can you check the deploy?");
    expect(row.find("[data-testid=mobile-dm-badge]").text()).toBe("2");
    expect(row.attributes("aria-label")).toBe("Binod, 2 unread");
    await row.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("mobile-dm");
    expect(router.currentRoute.value.params.conversationId).toBe("d1");
  });

  it("shows the DM empty state, and skeletons while loading", async () => {
    channels.value = [];
    const { w } = await mountHome();
    expect(w.find("[data-testid=mobile-dm-empty]").text()).toBe("Your direct conversations will appear here.");
    channelsLoading.value = true;
    await flushPromises();
    expect(w.find("[data-testid=mobile-skeleton]").exists()).toBe(true);
  });

  it("shows the current community and its channels; tapping a channel opens its conversation", async () => {
    channels.value = [chan("c1", "Welcome", "private"), chan("c2", "SWF Project")];
    const { w, router } = await mountHome();
    expect(w.find("[data-testid=mobile-community-card]").text()).toContain("buzz.lmdconsulting.com");
    expect(w.find("[data-testid=mobile-community-card]").text()).toContain("Connected");
    const rows = w.findAll("[data-testid=mobile-channel-row]");
    expect(rows.map((r) => r.text())).toEqual(["Welcome(private channel)", "SWF Project"]);
    await rows[1].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("mobile-channel");
    expect(router.currentRoute.value.params.channelId).toBe("c2");
  });

  it("the community card opens the community selector sheet", async () => {
    channels.value = [];
    const { w } = await mountHome();
    await w.find("[data-testid=mobile-community-card]").trigger("click");
    await flushPromises();
    expect(document.querySelector("[data-testid=community-sheet]")).not.toBeNull();
    expect(document.querySelector("[data-testid=community-sheet-current]")?.textContent).toContain("buzz.lmdconsulting.com");
  });

  it("renders safely with no channels and with no community", async () => {
    channels.value = [];
    current.value = { url: null, name: "", host: "" };
    const { w } = await mountHome();
    expect(w.find("[data-testid=mobile-community-card]").text()).toContain("No community");
    expect(w.text()).toContain("No channels yet");
    expect(w.find("[data-testid=mobile-bottom-nav]").exists()).toBe(true);
  });
});

describe("breakpoint", () => {
  it("is < 768px, and follows the media query live", async () => {
    expect(MOBILE_QUERY).toBe("(max-width: 767.98px)");
    const listeners: ((e: { matches: boolean }) => void)[] = [];
    const mql = { matches: true, addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn), removeEventListener: vi.fn() };
    window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia;
    let tier: ReturnType<typeof useIsMobile> | null = null;
    const Probe = { setup: () => ((tier = useIsMobile()), () => h("div")) };
    const w = mount(Probe);
    await flushPromises();
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 767.98px)");
    expect(tier!.value).toBe(true);
    listeners.forEach((fn) => fn({ matches: false }));
    expect(tier!.value).toBe(false);
    w.unmount();
  });
});
