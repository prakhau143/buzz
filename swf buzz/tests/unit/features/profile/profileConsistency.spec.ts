/**
 * Identity-level profile: one canonical registry, newest signed kind:0 wins,
 * every surface renders from it, saves preserve fields SWF doesn't edit and
 * are replicated to every other community over the relay's real `/events`
 * route with the outcome checked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { RawNostrEvent } from "@/protocol/types";
import type { UnsignedEvent } from "@/features/signing/types";

const ME = "a".repeat(64);
const A = "wss://community-a.example";
const B = "wss://community-b.example";

const published: UnsignedEvent[] = [];
vi.mock("@/services/publish", () => ({
  signAndPublish: async (event: UnsignedEvent) => {
    published.push(event);
    return { ...event, id: `id-${published.length}`, pubkey: ME, sig: "s", created_at: event.created_at ?? 1 };
  },
}));
vi.mock("@/services/nip98", () => ({ buildNip98AuthHeader: async () => "Nostr signed" }));
let relayProfiles: RawNostrEvent[] = [];
vi.mock("@/services/relayQuery", () => ({ fetchEventsOnce: async () => relayProfiles }));

const store = await import("@/features/profile/profileStore");
const my = await import("@/features/profile/myProfile");
const { useProfile, useDisplayName, useProfileMap } = await import("@/composables/useProfile");
const { useSessionStore } = await import("@/stores/session");
const { useAccessStore } = await import("@/stores/access");
const rc = await import("@/features/communities/relayCommunities");

const kind0 = (content: Record<string, unknown>, created_at: number, id = `e${created_at}`): RawNostrEvent =>
  ({ id, pubkey: ME, kind: 0, created_at, content: JSON.stringify(content), tags: [], sig: "s" }) as RawNostrEvent;

beforeEach(() => {
  setActivePinia(createPinia());
  store.clearProfileStore();
  published.length = 0;
  relayProfiles = [];
  useSessionStore().$patch({ pubkey: ME });
  rc.clearCommunitiesForTests();
  rc.setActiveRelay(A);
  localStorage.clear();
});

describe("canonical profile registry", () => {
  it("newest wins in any arrival order; an older copy can never overwrite a newer one", () => {
    const newer = kind0({ display_name: "Prakhar Mittal" }, 200);
    const older = kind0({ display_name: "Old Name" }, 100);
    store.absorbProfileEvents([newer]);
    store.absorbProfileEvents([older]);
    expect(store.profileFor(ME)?.displayName).toBe("Prakhar Mittal");
  });

  it("ties on created_at go to the lower event id (NIP-01)", () => {
    store.absorbProfileEvents([kind0({ display_name: "Z" }, 100, "ff")]);
    store.absorbProfileEvents([kind0({ display_name: "A" }, 100, "00")]);
    expect(store.profileFor(ME)?.displayName).toBe("A");
  });

  it("every surface (single, display name, batch) shows the same newest name — and updates live", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    relayProfiles = [kind0({ display_name: "Old Name" }, 100)];
    const Surface = defineComponent({
      setup() {
        const single = useProfile(ME);
        const { displayName } = useDisplayName(ME);
        const { displayNames } = useProfileMap([ME]);
        return () => h("div", [single.data.value?.displayName ?? "", "|", displayName.value, "|", displayNames.value.get(ME)]);
      },
    });
    const w = mount(Surface, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } });
    await flushPromises();
    expect(w.text()).toBe("Old Name|Old Name|Old Name");

    // A newer profile arrives (a save, or a live kind:0): all three change at once.
    store.absorbProfileEvents([kind0({ display_name: "Prakhar Mittal" }, 200)]);
    await flushPromises();
    expect(w.text()).toBe("Prakhar Mittal|Prakhar Mittal|Prakhar Mittal");

    // A refetch returning the STALE copy (another community's relay) can't roll it back.
    await client.invalidateQueries();
    await flushPromises();
    expect(w.text()).toBe("Prakhar Mittal|Prakhar Mittal|Prakhar Mittal");
  });
});

describe("saving my profile", () => {
  it("merges into the newest event: unknown fields survive, cleared fields are removed", () => {
    const previous = kind0({ display_name: "Old", nip05: "p@swf.example", website: "https://x", about: "hi" }, 100);
    const content = JSON.parse(my.mergeProfileContent(previous, { displayName: "New", about: "" }));
    expect(content).toMatchObject({ display_name: "New", name: "New", nip05: "p@swf.example", website: "https://x" });
    expect(content).not.toHaveProperty("about");
  });

  it("created_at is strictly after the version it replaces", () => {
    const previous = kind0({}, 5_000_000_000);
    expect(my.nextProfileCreatedAt(previous, 10)).toBe(5_000_000_001);
    expect(my.nextProfileCreatedAt(null, 10)).toBe(10);
  });

  it("publishes, becomes canonical immediately, and replicates to every OTHER membership via POST /events", async () => {
    useAccessStore().setResult({
      isOperator: false,
      memberships: [
        { relayUrl: A, host: "a", name: "A", role: "member" },
        { relayUrl: B, host: "b", name: "B", role: "member" },
      ],
      unreachable: [],
      destination: null,
    });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return new Response("{}", { status: 200 });
    }));
    const result = await my.saveMyProfile({ displayName: "Prakhar Mittal", about: "Dev" });
    expect(published).toHaveLength(1);
    expect(published[0].kind).toBe(0);
    expect(store.profileFor(ME)?.displayName).toBe("Prakhar Mittal");
    const replication = await result.replication;
    expect(calls).toEqual(["https://community-b.example/events"]);
    expect(replication).toEqual([{ relayUrl: B, ok: true }]);
    vi.unstubAllGlobals();
  });

  it("a community that refuses the replica is reported, not assumed synced", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    const result = await my.replicateProfileTo(B, kind0({ display_name: "X" }, 1));
    expect(result).toEqual({ relayUrl: B, ok: false, error: "not a member there" });
    vi.unstubAllGlobals();
  });

  it("an empty display name is refused before anything is signed", async () => {
    await expect(my.saveMyProfile({ displayName: "   " })).rejects.toThrow(/display name/i);
    expect(published).toHaveLength(0);
  });
});
