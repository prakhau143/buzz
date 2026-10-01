/**
 * Presence, OLD BUZZ-compatible, with ONE source of truth:
 *  - snapshot = `POST /query {kinds:[20001], authors}`; the relay answers with
 *    relay-signed events whose subject is the `p` tag; omitted pubkeys are offline;
 *  - live events trust only the signer (a `p` tag cannot speak for someone else);
 *  - every avatar reads the same store by pubkey, so the sidebar, the message
 *    row and the profile can never disagree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { RawNostrEvent } from "@/protocol/types";

const bridge: { filters: unknown[]; reply: RawNostrEvent[] } = { filters: [], reply: [] };
vi.mock("@/services/relayBridgeQuery", () => ({
  queryRelayBridge: async (filters: unknown[]) => {
    bridge.filters = filters;
    return bridge.reply;
  },
}));
vi.mock("@/services/RelayConnectionService", () => ({
  relayConnectionService: { subscribe: () => ({ close: () => undefined }) },
}));

const {
  buildPresenceSnapshotFilters,
  buildPresenceLiveFilters,
  parseLivePresenceEvent,
  parsePresenceSnapshotEvent,
} = await import("@/protocol/presence");
const { presenceService } = await import("@/features/presence/PresenceService");
const { usePresenceStore } = await import("@/stores/presence");
const AvatarCircle = (await import("@/components/AvatarCircle.vue")).default;

const RELAY = "r".repeat(64);
const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

function ev(pubkey: string, content: string, tags: string[][] = [], created_at = 100): RawNostrEvent {
  return { id: "i", pubkey, created_at, kind: 20001, tags, content, sig: "s" };
}

beforeEach(() => {
  setActivePinia(createPinia());
  bridge.filters = [];
  bridge.reply = [];
});

describe("presence protocol", () => {
  it("snapshot and live filters ask for kind 20001 by author, max 20 authors per filter", () => {
    const many = Array.from({ length: 45 }, (_, i) => i.toString(16).padStart(64, "0"));
    const snap = buildPresenceSnapshotFilters(many);
    expect(snap).toHaveLength(3);
    expect(snap.every((f) => f.kinds?.[0] === 20001 && (f.authors?.length ?? 0) <= 20)).toBe(true);
    expect(buildPresenceLiveFilters([ALICE])).toEqual([{ kinds: [20001], authors: [ALICE], limit: 0 }]);
  });

  it("a relay snapshot event is about its p-tag subject", () => {
    expect(parsePresenceSnapshotEvent(ev(RELAY, "away", [["p", ALICE]]))).toMatchObject({
      pubkey: ALICE,
      status: "away",
    });
  });

  it("a live event is only ever about its signer — a p tag cannot speak for someone else", () => {
    expect(parseLivePresenceEvent(ev(BOB, "offline", [["p", ALICE]]))).toMatchObject({ pubkey: BOB });
  });

  it("unknown status strings are ignored rather than guessed", () => {
    expect(parseLivePresenceEvent(ev(ALICE, "dnd"))).toBeNull();
    expect(parsePresenceSnapshotEvent(ev(RELAY, "busy", [["p", ALICE]]))).toBeNull();
  });
});

describe("PresenceService.fetchSnapshot", () => {
  it("uses the relay's answer, and anyone it omits is offline", async () => {
    bridge.reply = [ev(RELAY, "online", [["p", ALICE]])];
    const result = await presenceService.fetchSnapshot([ALICE, BOB]);
    expect(bridge.filters).toEqual([{ kinds: [20001], authors: [ALICE, BOB] }]);
    expect(result.get(ALICE)?.status).toBe("online");
    expect(result.get(BOB)?.status).toBe("offline");
  });

  it("ignores events about pubkeys that were not asked for", async () => {
    bridge.reply = [ev(RELAY, "online", [["p", BOB]])];
    const result = await presenceService.fetchSnapshot([ALICE]);
    expect([...result.keys()]).toEqual([ALICE]);
  });
});

describe("presence store", () => {
  it("is null until the relay answered (no guessed dot), then the answer", () => {
    const store = usePresenceStore();
    expect(store.statusOf(ALICE)).toBeNull();
    store.apply(ALICE, { status: "online", updatedAt: 1, source: "snapshot" });
    expect(store.statusOf(ALICE)).toBe("online");
  });

  it("a reordered older live event does not overwrite a newer one", () => {
    const store = usePresenceStore();
    store.apply(ALICE, { status: "away", updatedAt: 200, source: "live" });
    store.apply(ALICE, { status: "online", updatedAt: 100, source: "live" });
    expect(store.statusOf(ALICE)).toBe("away");
  });
});

describe("one source of truth in the UI", () => {
  it("every avatar of the same pubkey shows the same status, and follows one update", async () => {
    const store = usePresenceStore();
    store.apply(ALICE, { status: "online", updatedAt: 1, source: "snapshot" });
    const sidebar = mount(AvatarCircle, { props: { name: "Alice", pubkey: ALICE, size: 22 } });
    const profile = mount(AvatarCircle, { props: { name: "Alice", pubkey: ALICE, size: 80 } });
    const dot = (w: typeof sidebar) => w.find("[data-presence]").attributes("data-presence");
    expect(dot(sidebar)).toBe("online");
    expect(dot(profile)).toBe("online");

    store.apply(ALICE, { status: "away", updatedAt: 2, source: "live" });
    await flushPromises();
    expect(dot(sidebar)).toBe("away");
    expect(dot(profile)).toBe("away");
    expect(profile.find("[data-presence]").attributes("title")).toBe("Away");
  });

  it("an avatar without a pubkey shows no presence", () => {
    const wrapper = mount(AvatarCircle, { props: { name: "Thread" } });
    expect(wrapper.find("[data-presence]").exists()).toBe(false);
  });
});
