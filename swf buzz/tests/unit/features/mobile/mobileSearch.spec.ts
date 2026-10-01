/**
 * Phase D2 — mobile Search over the SAME search: the relay's NIP-50 message
 * search (`useMessageSearch`) and local channel / DM / people matches. Message
 * → MessageTarget → the one opener; person → the profile sheet; channel / DM →
 * their mobile routes; query + tab in the URL; loading / empty / error; a11y.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, h, ref, toValue, type MaybeRefOrGetter } from "vue";
import type { SearchHit } from "@/features/search/SearchService";

const ME = "a".repeat(64);
const PRAKHAR = "b".repeat(64);
const VIMAL = "c".repeat(64);
const MSG = "1".repeat(64);
const ROOT = "2".repeat(64);

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), route: null as unknown as { query: Record<string, string> } }));
vi.mock("vue-router", async () => {
  const { reactive } = await import("vue");
  nav.route = reactive({ name: "mobile-search", params: {}, query: {} as Record<string, string> });
  return { useRouter: () => ({ push: nav.push, replace: nav.replace }), useRoute: () => nav.route };
});
const opened = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/features/navigation/useOpenMessageTarget", () => ({
  useOpenMessageTarget: () => ({ openMessageTarget: async (t: unknown) => (opened.calls.push(t), true) }),
}));
vi.mock("@/composables/useProfile", async () => {
  const { computed: c, ref: r } = await import("vue");
  return {
    useProfile: () => ({ data: c(() => undefined) }),
    useProfileMap: () => ({
      profiles: r(new Map()),
      displayNames: r(new Map([[PRAKHAR, "Prakhar Mittal"], [VIMAL, "Vimal"], [ME, "Me"]])),
    }),
  };
});
vi.mock("@/features/channels/useChannels", () => ({
  useChannels: () => ({
    data: ref([
      { id: "c1", name: "engineering", visibility: "open", channelType: "stream", archived: false, topic: "Builds" },
      { id: "c2", name: "deploys", visibility: "private", channelType: "stream", archived: false },
    ]),
  }),
}));
vi.mock("@/features/dm/useDmList", () => ({
  useDmList: () => ({ data: ref([{ id: "d1", name: "", visibility: "private", channelType: "dm", archived: false, dmParticipants: [ME, VIMAL] }]) }),
}));
vi.mock("@/features/community-members/useCommunityMembers", () => ({
  useCommunityMembers: () => ({ data: ref([{ pubkey: ME, role: "member" }, { pubkey: PRAKHAR, role: "admin" }, { pubkey: VIMAL, role: "member" }]) }),
}));
vi.mock("@/features/communities/relayCommunities", async () => {
  const { ref: r } = await import("vue");
  return {
    activeRelayUrl: r("wss://a.example.com"),
    communities: r([{ relayUrl: "wss://a.example.com", name: "SWF Project", addedAt: 1 }]),
    relayHost: (u: string) => u.replace(/^wss?:\/\//, ""),
  };
});

const search = vi.hoisted(() => ({ refetch: vi.fn(), lastQuery: null as unknown }));
const data = ref<SearchHit[] | undefined>(undefined);
const isFetching = ref(false);
const isError = ref(false);
vi.mock("@/features/search/useMessageSearch", () => ({
  useMessageSearch: (q: MaybeRefOrGetter<string>) => {
    search.lastQuery = q;
    return { data, isFetching, isError, refetch: search.refetch, submittedQuery: computed(() => toValue(q).trim()) };
  },
}));

const { useSessionStore } = await import("@/stores/session");
const { useUiStore } = await import("@/stores/ui");
const MobileSearchView = (await import("@/features/mobile/views/MobileSearchView.vue")).default;

const LayoutStub = { name: "MobileLayout", setup: (_: unknown, { slots }: { slots: Record<string, () => unknown> }) => () => h("div", [slots.header?.(), slots.default?.()]) };
const hit = (over: { channelId?: string; rootId?: string; id?: string; content?: string } = {}): SearchHit => ({
  channelId: over.channelId ?? "c1",
  message: {
    id: over.id ?? MSG,
    channelId: over.channelId ?? "c1",
    authorPubkey: PRAKHAR,
    content: over.content ?? "The production deployment completed without errors",
    createdAt: Math.floor(Date.now() / 1000) - 120,
    thread: over.rootId ? { rootId: over.rootId, parentId: over.rootId } : {},
    mentions: [],
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    attachments: [],
  },
});

function mountSearch() {
  return mount(MobileSearchView, { attachTo: document.body, global: { stubs: { MobileLayout: LayoutStub } } });
}
async function type(w: ReturnType<typeof mountSearch>, text: string) {
  await w.find("[data-testid=mobile-search-input]").setValue(text);
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().$patch({ pubkey: ME });
  nav.route.query = {};
  nav.push.mockClear();
  nav.replace.mockClear();
  opened.calls.length = 0;
  data.value = undefined;
  isFetching.value = false;
  isError.value = false;
  search.refetch.mockClear();
  document.body.innerHTML = "";
});

describe("mobile Search — query and results", () => {
  it("the field is an accessible search box: labelled, type=search, 'search' enter key, focused on a fresh visit", () => {
    const w = mountSearch();
    const input = w.find("[data-testid=mobile-search-input]");
    expect(input.attributes("type")).toBe("search");
    expect(input.attributes("enterkeyhint")).toBe("search");
    expect(input.attributes("aria-label")).toBe("Search messages, people and channels");
    expect(document.activeElement).toBe(input.element);
    // Before a query: quick access to existing channels / DMs, no invented recent searches.
    expect(w.text()).toContain("Messages, people and channels in SWF Project.");
    expect(w.findAll("[data-testid=search-channel-row]")).toHaveLength(2);
    expect(w.text()).not.toMatch(/recent/i);
  });

  it("typing drives the SAME message search and records the query in ?q= (replace)", async () => {
    const w = mountSearch();
    await type(w, "deploy");
    expect(toValue(search.lastQuery as MaybeRefOrGetter<string>)).toBe("deploy");
    expect(nav.replace).toHaveBeenLastCalledWith({ query: { q: "deploy" } });
    expect(w.find("[role=tablist]").exists()).toBe(true);
  });

  it("renders message, people and channel results with their context", async () => {
    data.value = [hit(), hit({ id: "3".repeat(64), channelId: "d1", content: "deploy the DM thing" })];
    const w = mountSearch();
    await type(w, "deploy");
    const rows = w.findAll("[data-testid=search-message-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("Prakhar Mittal");
    expect(rows[0].text()).toContain("#engineering");
    expect(rows[0].text()).toContain("production deployment");
    expect(rows[1].text()).toContain("DM with Vimal");
    // "deploy" also matches the #deploys channel locally
    expect(w.findAll("[data-testid=search-channel-row]").map((r) => r.text())).toEqual([expect.stringContaining("deploys")]);
  });

  it("people results show role and community; tabs narrow to one kind (?t=)", async () => {
    const w = mountSearch();
    await type(w, "prak");
    const person = w.find("[data-testid=search-person-row]");
    expect(person.text()).toContain("Prakhar Mittal");
    expect(person.text()).toContain("Admin · SWF Project");
    await w.find("[data-testid=mobile-search-tab-people]").trigger("click");
    expect(nav.replace).toHaveBeenLastCalledWith({ query: { q: "prak", t: "people" } });
    nav.route.query = { q: "prak", t: "people" };
    await flushPromises();
    expect(w.find("[data-testid=mobile-search-tab-people]").attributes("aria-selected")).toBe("true");
    expect(w.findAll("[data-testid=search-message-row]")).toHaveLength(0);
  });
});

describe("mobile Search — opening results", () => {
  it("a message → its MessageTarget → the ONE opener (exact channel message)", async () => {
    data.value = [hit()];
    const w = mountSearch();
    await type(w, "deploy");
    await w.find("[data-testid=search-message-row]").trigger("click");
    await flushPromises();
    expect(opened.calls[0]).toEqual({
      community: null, kind: "channel", conversationId: "c1", messageId: MSG, threadRootId: null, source: "search",
    });
  });

  it("a thread reply opens its thread; a DM hit is a DM target", async () => {
    data.value = [hit({ rootId: ROOT }), hit({ id: "4".repeat(64), channelId: "d1" })];
    const w = mountSearch();
    await type(w, "deploy");
    const rows = w.findAll("[data-testid=search-message-row]");
    await rows[0].trigger("click");
    await rows[1].trigger("click");
    await flushPromises();
    expect(opened.calls[0]).toMatchObject({ kind: "channel", threadRootId: ROOT, messageId: MSG });
    expect(opened.calls[1]).toMatchObject({ kind: "dm", conversationId: "d1", threadRootId: null });
  });

  it("a person → the existing profile surface (ui.openProfile)", async () => {
    const w = mountSearch();
    await type(w, "prak");
    await w.find("[data-testid=search-person-row]").trigger("click");
    expect(useUiStore().contextPanel).toMatchObject({ kind: "profile", pubkey: PRAKHAR });
  });

  it("a channel → the mobile channel route; a DM → the mobile DM route", async () => {
    const w = mountSearch();
    await type(w, "deploys");
    await w.find("[data-testid=search-channel-row]").trigger("click");
    expect(nav.push).toHaveBeenCalledWith({ name: "mobile-channel", params: { channelId: "c2" } });
    await type(w, "vimal");
    await w.find("[data-testid=search-dm-row]").trigger("click");
    expect(nav.push).toHaveBeenCalledWith({ name: "mobile-dm", params: { conversationId: "d1" } });
  });
});

describe("mobile Search — states and back navigation", () => {
  it("loading: a busy row skeleton for messages", async () => {
    isFetching.value = true;
    const w = mountSearch();
    await type(w, "deploy");
    const sk = w.find("[data-testid=list-skeleton]");
    expect(sk.attributes("aria-busy")).toBe("true");
    expect(sk.attributes("aria-label")).toBe("Searching messages");
  });

  it("nothing matched anywhere: 'Nothing found'", async () => {
    data.value = [];
    const w = mountSearch();
    await type(w, "zzzz");
    expect(w.find("[data-testid=mobile-search-empty]").text()).toContain("Nothing found");
  });

  it("a failed search says so and retries the same query", async () => {
    isError.value = true;
    const w = mountSearch();
    await type(w, "deploy");
    expect(w.find("[data-testid=mobile-search-error]").attributes("role")).toBe("alert");
    await w.find("[data-testid=mobile-search-retry]").trigger("click");
    expect(search.refetch).toHaveBeenCalled();
    expect(w.find("[data-testid=mobile-search-empty]").exists()).toBe(false);
  });

  it("coming back restores the query and tab from the URL without popping the keyboard", async () => {
    nav.route.query = { q: "deploy", t: "messages" };
    data.value = [hit()];
    const w = mountSearch();
    await flushPromises();
    expect((w.find("[data-testid=mobile-search-input]").element as HTMLInputElement).value).toBe("deploy");
    expect(w.find("[data-testid=mobile-search-tab-messages]").attributes("aria-selected")).toBe("true");
    expect(document.activeElement).not.toBe(w.find("[data-testid=mobile-search-input]").element);
    expect(w.findAll("[data-testid=search-message-row]")).toHaveLength(1);
  });

  it("clear empties the query and returns focus to the field", async () => {
    const w = mountSearch();
    await type(w, "deploy");
    await w.find("[data-testid=mobile-search-clear]").trigger("click");
    expect((w.find("[data-testid=mobile-search-input]").element as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(w.find("[data-testid=mobile-search-input]").element);
  });
});
