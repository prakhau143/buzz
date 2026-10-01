/**
 * Community switch at RUNTIME — the sidebar stays mounted while the community
 * changes underneath it.
 *
 * The bug this guards: after switching A → B the switcher named B, but the
 * sidebar kept listing A's channels and DMs. `communityIsolation.spec.ts`
 * passed throughout, because it only checks the key factory: `useChannels`
 * and `useDmList` computed their key ONCE, at mount, so the mounted sidebar
 * kept observing A's key (and `queryClient.clear()` does not reset a mounted
 * observer's data). Their live subscriptions were also closed by the switch's
 * `disconnect()` and never re-opened.
 *
 * These tests mount the real composables against a real QueryClient; only the
 * relay services are faked, and every fake answers with the data of the
 * community that is active when it is called. Channels in both communities are
 * deliberately named "welcome": assertions use ids, never names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import {
  activeRelayUrl,
  clearCommunitiesForTests,
  setActiveRelay,
} from "@/features/communities/relayCommunities";
import {
  beginCommunitySession,
  endCommunitySession,
} from "@/features/communities/communitySession";
import { channelAfterCommunitySwitch } from "@/features/communities/switchNavigation";
import { useSessionStore } from "@/stores/session";
import type { Channel } from "@/types/domain";

const A = "wss://community-a.example";
const B = "wss://community-b.example";
const ME = "a".repeat(64);

const channel = (id: string, name: string, archived = false): Channel => ({
  id,
  name,
  visibility: "open",
  channelType: "stream",
  archived,
});
const dm = (id: string): Channel => ({ ...channel(id, id), channelType: "dm" });

const CHANNELS: Record<string, Channel[]> = {
  [A]: [channel("a-welcome", "welcome"), channel("a-swf-project", "swf-project")],
  [B]: [channel("b-welcome", "welcome"), channel("b-general", "general")],
};
const DMS: Record<string, Channel[]> = {
  [A]: [dm("a-dm-sandeep"), dm("a-dm-devankit")],
  [B]: [dm("b-dm-rahul")],
};

interface LiveSub<T> {
  community: string;
  onUpdate: (value: T) => void;
  closed: boolean;
}
const channelSubs: LiveSub<Channel>[] = [];
const dmSubs: LiveSub<Channel>[] = [];

/** Pending answers, when a test wants to resolve them itself (the race test). */
let deferChannels = false;
const pendingChannels: Array<{ community: string; resolve: (value: Channel[]) => void }> = [];

vi.mock("@/features/channels/ChannelService", () => ({
  channelService: {
    discoverChannels: () => {
      const community = activeRelayUrl.value;
      if (deferChannels) {
        return new Promise<Channel[]>((resolve) => pendingChannels.push({ community, resolve }));
      }
      return Promise.resolve(CHANNELS[community] ?? []);
    },
    subscribeToChannelUpdates: (onUpdate: (c: Channel) => void) => {
      const sub: LiveSub<Channel> = { community: activeRelayUrl.value, onUpdate, closed: false };
      channelSubs.push(sub);
      return { close: () => (sub.closed = true) };
    },
  },
}));

vi.mock("@/features/dm/DmService", () => ({
  dmService: {
    discoverConversations: () => Promise.resolve(DMS[activeRelayUrl.value] ?? []),
    subscribeToConversationUpdates: (_me: string, onUpdate: (c: Channel) => void) => {
      const sub: LiveSub<Channel> = { community: activeRelayUrl.value, onUpdate, closed: false };
      dmSubs.push(sub);
      return { close: () => (sub.closed = true) };
    },
  },
}));

const { useChannels } = await import("@/features/channels/useChannels");
const { useDmList } = await import("@/features/dm/useDmList");

let queryClient: QueryClient;
let wrapper: VueWrapper | null = null;

/** The sidebar, reduced to what it lists: channel ids and DM ids. */
const Sidebar = defineComponent({
  setup() {
    const { data: channels } = useChannels();
    const { data: conversations } = useDmList();
    return () =>
      h("div", [
        h("ul", { "data-testid": "channels" }, (channels.value ?? []).map((c) => h("li", c.id))),
        h("ul", { "data-testid": "dms" }, (conversations.value ?? []).map((c) => h("li", c.id))),
      ]);
  },
});

/**
 * The switch's store-level effect, in the order the app performs it
 * (identitySession.ts): the old session ends and the caches are cleared, then
 * the new community becomes active and its session begins.
 */
function switchTo(relayUrl: string): void {
  endCommunitySession();
  queryClient.clear();
  setActiveRelay(relayUrl);
  beginCommunitySession(relayUrl);
}

async function mountSidebar(): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().$patch({ pubkey: ME });
  wrapper = mount(Sidebar, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
  await flushPromises();
  return wrapper;
}

const listed = (w: VueWrapper, testId: string) =>
  w.find(`[data-testid="${testId}"]`).findAll("li").map((li) => li.text());

beforeEach(() => {
  clearCommunitiesForTests();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  channelSubs.length = 0;
  dmSubs.length = 0;
  deferChannels = false;
  pendingChannels.length = 0;
  setActiveRelay(A);
  beginCommunitySession(A);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("community switch runtime: the mounted sidebar follows the community", () => {
  it("A → B shows ONLY B's channels and DMs (same channel name, different ids)", async () => {
    const w = await mountSidebar();
    expect(listed(w, "channels")).toEqual(["a-welcome", "a-swf-project"]);
    expect(listed(w, "dms")).toEqual(["a-dm-sandeep", "a-dm-devankit"]);

    switchTo(B);
    await flushPromises();

    expect(listed(w, "channels")).toEqual(["b-welcome", "b-general"]);
    expect(listed(w, "dms")).toEqual(["b-dm-rahul"]);
    for (const id of ["a-welcome", "a-swf-project", "a-dm-sandeep", "a-dm-devankit"]) {
      expect(w.text()).not.toContain(id);
    }
  });

  it("A → B → A → B never leaks the other community's lists", async () => {
    const w = await mountSidebar();
    for (const [community, channels, dms] of [
      [B, ["b-welcome", "b-general"], ["b-dm-rahul"]],
      [A, ["a-welcome", "a-swf-project"], ["a-dm-sandeep", "a-dm-devankit"]],
      [B, ["b-welcome", "b-general"], ["b-dm-rahul"]],
    ] as const) {
      switchTo(community);
      await flushPromises();
      expect(listed(w, "channels"), community).toEqual(channels);
      expect(listed(w, "dms"), community).toEqual(dms);
    }
  });

  it("a late channel answer from A cannot overwrite B's list (stale async response)", async () => {
    deferChannels = true;
    const w = await mountSidebar();
    const fromA = pendingChannels.find((p) => p.community === A)!;

    switchTo(B);
    await flushPromises();
    const fromB = pendingChannels.find((p) => p.community === B)!;

    // B answers first, then A's request — started before the switch — finishes late.
    fromB.resolve(CHANNELS[B]);
    await flushPromises();
    fromA.resolve(CHANNELS[A]);
    await flushPromises();

    expect(listed(w, "channels")).toEqual(["b-welcome", "b-general"]);
    expect(queryClient.getQueryData(queryKeys.channels())).toEqual(CHANNELS[B]);
  });
});

describe("community switch runtime: live subscriptions", () => {
  it("closes A's live subscriptions and opens B's", async () => {
    await mountSidebar();
    expect(channelSubs.map((s) => s.community)).toEqual([A]);
    expect(dmSubs.map((s) => s.community)).toEqual([A]);

    switchTo(B);
    await flushPromises();

    expect(channelSubs.map((s) => [s.community, s.closed])).toEqual([
      [A, true],
      [B, false],
    ]);
    expect(dmSubs.map((s) => [s.community, s.closed])).toEqual([
      [A, true],
      [B, false],
    ]);
  });

  it("an A update delivered after the switch does not change B's lists", async () => {
    const w = await mountSidebar();
    const aChannels = channelSubs[0]!;
    const aDms = dmSubs[0]!;

    switchTo(B);
    await flushPromises();

    aChannels.onUpdate(channel("a-late-channel", "late"));
    aDms.onUpdate(dm("a-late-dm"));
    await flushPromises();

    expect(listed(w, "channels")).toEqual(["b-welcome", "b-general"]);
    expect(listed(w, "dms")).toEqual(["b-dm-rahul"]);
  });

  it("B's live updates land in B's lists", async () => {
    const w = await mountSidebar();
    switchTo(B);
    await flushPromises();

    channelSubs.find((s) => s.community === B)!.onUpdate(channel("b-new", "new"));
    dmSubs.find((s) => s.community === B)!.onUpdate(dm("b-dm-priya"));
    await flushPromises();

    expect(listed(w, "channels")).toEqual(["b-welcome", "b-general", "b-new"]);
    expect(listed(w, "dms")).toEqual(["b-dm-rahul", "b-dm-priya"]);
  });
});

describe("channelAfterCommunitySwitch", () => {
  const b = CHANNELS[B]!;

  it("keeps the previous channel only if the new community lists that same id", () => {
    expect(channelAfterCommunitySwitch(b, "b-general")).toBe("b-general");
  });

  it("does not match by name: A's #welcome is not B's #welcome", () => {
    expect(channelAfterCommunitySwitch(b, "a-welcome")).toBe("b-welcome");
    expect(channelAfterCommunitySwitch(b, "a-swf-project")).toBe("b-welcome");
  });

  it("skips archived channels and returns null when nothing is listed", () => {
    expect(channelAfterCommunitySwitch([channel("x", "old", true), channel("y", "live")], null)).toBe("y");
    expect(channelAfterCommunitySwitch([], "a-welcome")).toBeNull();
    expect(channelAfterCommunitySwitch(undefined, null)).toBeNull();
  });
});
