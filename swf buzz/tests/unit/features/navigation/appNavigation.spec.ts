/**
 * Header Back / Forward over the app's own navigation history: records
 * channel / DM / thread visits (community-tagged), ignores everything else, and
 * never navigates to an entry from another community.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { useNavHistoryStore } from "@/stores/navHistory";
import { useUiStore } from "@/stores/ui";
import { clearCommunitiesForTests, setActiveRelay } from "@/features/communities/relayCommunities";
import { useAppNavigation } from "@/features/navigation/useAppNavigation";

const A = "wss://a.example.com";
const B = "wss://b.example.com";

let router: Router;
let nav: ReturnType<typeof useAppNavigation>;

async function setup() {
  const Stub = { render: () => h("div") };
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: Stub },
      { path: "/login", name: "login", component: Stub },
      { path: "/channels", name: "channels", component: Stub },
      { path: "/dm", name: "dm", component: Stub },
    ],
  });
  await router.push("/");
  mount(
    defineComponent({
      setup() {
        nav = useAppNavigation();
        return () => h("div");
      },
    }),
    { global: { plugins: [router] } },
  );
  await flushPromises();
}
const goChannel = async (id: string) => {
  await router.push({ name: "channels", query: { channelId: id } });
  await flushPromises();
};

beforeEach(async () => {
  setActivePinia(createPinia());
  clearCommunitiesForTests();
  setActiveRelay(A);
  await setup();
});

describe("recording", () => {
  it("records channel, DM and thread visits with the community", async () => {
    await goChannel("general");
    await goChannel("engineering");
    useUiStore().openThread("root-1");
    await flushPromises();
    await router.push({ name: "dm", query: { conversationId: "dm-1" } });
    await flushPromises();
    expect(useNavHistoryStore().entries).toEqual([
      { type: "channel", community: A, channelId: "general" },
      { type: "channel", community: A, channelId: "engineering" },
      { type: "thread", community: A, parent: "channel", parentId: "engineering", rootEventId: "root-1" },
      { type: "dm", community: A, conversationId: "dm-1" },
    ]);
  });

  it("login, home and non-navigation state changes create no entries", async () => {
    await router.push("/login");
    await router.push("/");
    await flushPromises();
    await goChannel("general");
    const ui = useUiStore();
    ui.openProfile("p".repeat(64)); // a panel, not a destination
    await flushPromises();
    ui.closeContextPanel();
    await flushPromises();
    expect(useNavHistoryStore().entries).toHaveLength(1);
  });
});

describe("back / forward", () => {
  it("walks back and forward through visits; buttons enable/disable accordingly", async () => {
    expect(nav.canGoBack.value).toBe(false);
    await goChannel("general");
    await goChannel("engineering");
    await router.push({ name: "dm", query: { conversationId: "dm-1" } });
    await flushPromises();
    expect(nav.canGoBack.value).toBe(true);
    expect(nav.canGoForward.value).toBe(false);

    await nav.back();
    await flushPromises();
    expect(router.currentRoute.value.query.channelId).toBe("engineering");
    await nav.back();
    await flushPromises();
    expect(router.currentRoute.value.query.channelId).toBe("general");
    expect(nav.canGoBack.value).toBe(false);
    expect(nav.canGoForward.value).toBe(true);

    await nav.forward();
    await flushPromises();
    expect(router.currentRoute.value.query.channelId).toBe("engineering");
    expect(useNavHistoryStore().entries).toHaveLength(3); // replaying did not record new entries
  });

  it("back into a thread reopens the thread", async () => {
    await goChannel("engineering");
    useUiStore().openThread("root-1");
    await flushPromises();
    await goChannel("random");
    await nav.back();
    await flushPromises();
    expect(router.currentRoute.value.query.channelId).toBe("engineering");
    expect(useUiStore().openThreadRootId).toBe("root-1");
  });

  it("a new visit after going back drops the forward branch", async () => {
    await goChannel("one");
    await goChannel("two");
    await nav.back();
    await flushPromises();
    await goChannel("three");
    expect(useNavHistoryStore().entries.map((e) => (e.type === "channel" ? e.channelId : ""))).toEqual(["one", "three"]);
    expect(nav.canGoForward.value).toBe(false);
  });

  it("never navigates to an entry from another community", async () => {
    await goChannel("a-general");
    setActiveRelay(B);
    await goChannel("b-general");
    expect(nav.canGoBack.value).toBe(false); // the only earlier entry is community A's
    await nav.back();
    await flushPromises();
    expect(router.currentRoute.value.query.channelId).toBe("b-general");
  });
});
