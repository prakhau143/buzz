/**
 * Read / unread correctness across restarts (Master Spec §1).
 *
 * Two opposite defects are pinned here:
 *   1. DMs were unread after every restart: DM read state lived in an in-memory
 *      store (`dmReadState`) that no restart survived. DMs now share the NIP-RS
 *      frontier with channels (kind:30078, keyed by the DM's channel UUID).
 *   2. Messages that arrived while the app was closed never became unread: only
 *      LIVE arrivals were counted. A startup catch-up now counts them.
 * Plus the hydration gate: nothing renders as unread before the frontier is in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { buildReplyTags } from "@/protocol/nip10";
import type { NostrFilter, RawNostrEvent } from "@/protocol/types";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const DM = "dm-11111111-1111-1111-1111-111111111111";
const CHAN = "chan-22222222-2222-2222-2222-222222222222";

const fetchReadState = vi.fn(async () => ({ contexts: {} as Record<string, number>, hydrated: true }));
vi.mock("@/services/ReadStateService", () => ({
  publishReadState: vi.fn(async () => {}),
  fetchReadState: (...a: unknown[]) => fetchReadState(...(a as [])),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ pubkey: ME }) }));

let relayEvents: RawNostrEvent[] = [];
const fetchEventsOnce = vi.fn(async (filters: NostrFilter[]) => {
  const f = filters[0] as NostrFilter & { "#h": string[]; since: number };
  return relayEvents.filter((e) => e.tags.some((t) => t[0] === "h" && f["#h"].includes(t[1])) && e.created_at >= f.since);
});
vi.mock("@/services/relayQuery", () => ({ fetchEventsOnce: (f: NostrFilter[]) => fetchEventsOnce(f) }));

const { useReadStateStore } = await import("@/stores/readState");
const { runUnreadCatchUp } = await import("@/features/readState/unreadCatchUp");

let seq = 0;
function msg(channelId: string, createdAt: number, author = OTHER, extraTags: string[][] = []): RawNostrEvent {
  seq += 1;
  return {
    id: seq.toString(16).padStart(64, "0"),
    pubkey: author,
    created_at: createdAt,
    kind: 9,
    tags: [["h", channelId], ...extraTags],
    content: `m${seq}`,
    sig: "sig",
  };
}

/** A fresh Pinia = a restarted app; localStorage survives, like the real device. */
function restart() {
  setActivePinia(createPinia());
  return useReadStateStore();
}

beforeEach(() => {
  localStorage.clear();
  relayEvents = [];
  fetchEventsOnce.mockClear();
  fetchReadState.mockReset();
  fetchReadState.mockResolvedValue({ contexts: {}, hydrated: true });
  setActivePinia(createPinia());
});

describe("hydration gate", () => {
  it("shows no unread before hydration, then the real count", async () => {
    const store = useReadStateStore();
    store.recordUnseenMessage(CHAN, false, "e1", 100);
    expect(store.visibleUnread(CHAN)).toBe(0);
    await store.hydrateFromRelay();
    expect(store.isReady).toBe(true);
    expect(store.visibleUnread(CHAN)).toBe(1);
  });

  it("an unreachable relay still opens the gate — the local mirror is authoritative (OLD BUZZ .finally)", async () => {
    fetchReadState.mockRejectedValueOnce(new Error("offline"));
    const store = useReadStateStore();
    await store.hydrateFromRelay();
    expect(store.isReady).toBe(true);
  });
});

describe("DM read state survives a restart", () => {
  it("a read DM is still read after restart: catch-up finds nothing newer than the frontier", async () => {
    relayEvents = [msg(DM, 1000), msg(DM, 1001)];
    let store = useReadStateStore();
    store.markChannelSeen(DM, 1001); // opened the DM; newest message on screen

    store = restart();
    await store.hydrateFromRelay();
    await runUnreadCatchUp([DM], ME, null, 2000);
    expect(store.visibleUnread(DM)).toBe(0);
  });

  it("the frontier also comes back from the RELAY (another device read it)", async () => {
    relayEvents = [msg(DM, 1000)];
    fetchReadState.mockResolvedValue({ contexts: { [DM]: 1000 }, hydrated: true });
    const store = restart();
    await store.hydrateFromRelay();
    await runUnreadCatchUp([DM], ME, null, 2000);
    expect(store.visibleUnread(DM)).toBe(0);
  });
});

describe("startup catch-up — offline arrivals become unread", () => {
  it("a message from someone else after the frontier is unread", async () => {
    let store = useReadStateStore();
    store.markChannelSeen(CHAN, 1000);
    relayEvents = [msg(CHAN, 999), msg(CHAN, 1000), msg(CHAN, 1500)];
    store = restart();
    await store.hydrateFromRelay();
    await runUnreadCatchUp([CHAN], ME, null, 2000);
    expect(store.visibleUnread(CHAN)).toBe(1);
  });

  it("my own messages never make anything unread", async () => {
    relayEvents = [msg(DM, 1500, ME), msg(DM, 1600, ME)];
    const store = useReadStateStore();
    await store.hydrateFromRelay();
    await runUnreadCatchUp([DM], ME, null, 2000);
    expect(store.visibleUnread(DM)).toBe(0);
  });

  it("a thread reply counts only when it mentions me", async () => {
    const root = msg(CHAN, 1000);
    relayEvents = [
      msg(CHAN, 1500, OTHER, buildReplyTags({ rootEventId: root.id, parentEventId: root.id })),
      msg(CHAN, 1600, OTHER, [...buildReplyTags({ rootEventId: root.id, parentEventId: root.id }), ["p", ME]]),
    ];
    const store = useReadStateStore();
    store.markChannelSeen(CHAN, 1000);
    await store.hydrateFromRelay();
    await runUnreadCatchUp([CHAN], ME, null, 2000);
    expect(store.visibleUnread(CHAN)).toBe(1);
    expect(store.hasMention[CHAN]).toBe(true);
  });

  it("never runs before the gate", async () => {
    relayEvents = [msg(CHAN, 1500)];
    const store = useReadStateStore();
    await runUnreadCatchUp([CHAN], ME, null, 2000);
    expect(fetchEventsOnce).not.toHaveBeenCalled();
    expect(store.unreadCounts[CHAN]).toBeUndefined();
  });

  it("skips the open context — it is being read right now", async () => {
    relayEvents = [msg(CHAN, 1500)];
    const store = useReadStateStore();
    await store.hydrateFromRelay();
    await runUnreadCatchUp([CHAN], ME, CHAN, 2000);
    expect(store.visibleUnread(CHAN)).toBe(0);
  });

  it("an event seen by BOTH catch-up and the live subscription counts once", async () => {
    const late = msg(CHAN, 1500);
    relayEvents = [late];
    const store = useReadStateStore();
    await store.hydrateFromRelay();
    await runUnreadCatchUp([CHAN], ME, null, 2000);
    store.recordUnseenMessage(CHAN, false, late.id, late.created_at); // the live copy
    expect(store.visibleUnread(CHAN)).toBe(1);
  });

  it("a never-read context looks back a bounded window, not all of history", async () => {
    const store = useReadStateStore();
    await store.hydrateFromRelay();
    await runUnreadCatchUp([DM], ME, null, 10_000_000);
    const since = (fetchEventsOnce.mock.calls[0][0][0] as NostrFilter & { since: number }).since;
    expect(since).toBe(10_000_000 - 7 * 24 * 60 * 60);
  });

  it("reading clears the count and a re-arrival of an already-counted id cannot resurrect it", async () => {
    const m = msg(CHAN, 1500);
    relayEvents = [m];
    const store = useReadStateStore();
    await store.hydrateFromRelay();
    await runUnreadCatchUp([CHAN], ME, null, 2000);
    store.markChannelSeen(CHAN, 1500);
    store.recordUnseenMessage(CHAN, false, m.id, m.created_at);
    expect(store.visibleUnread(CHAN)).toBe(0);
  });
});
