/**
 * Phase 4A — what MessageService actually asks the relay for, and what the
 * reconnect repair anchors to.
 *
 * The regression under test: `fetchOlderMessages` used to send `until` alone
 * (which the relay treats as `created_at <= until`, INCLUSIVE) and then drop
 * every returned event at that second client-side. Five messages in one second
 * meant four lost permanently, and a page made only of them looked empty and
 * ended history early.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrFilter, RawNostrEvent } from "@/protocol/types";

const fetchOnceMock = vi.fn<(filters: NostrFilter[]) => Promise<RawNostrEvent[]>>();
vi.mock("@/services/relayQuery", () => ({
  fetchEventsOnce: (filters: NostrFilter[]) => fetchOnceMock(filters),
}));

// History pages (initial + older) go through the relay's HTTP channel window,
// like OLD BUZZ; the reconnect backfill and live subscription stay on the socket.
const bridgeMock = vi.fn<(filters: Record<string, unknown>[]) => Promise<RawNostrEvent[]>>();
vi.mock("@/services/relayBridgeQuery", () => ({
  queryRelayBridge: (filters: Record<string, unknown>[]) => bridgeMock(filters),
}));

const subscribeMock = vi.fn(() => ({ close: vi.fn() }));
vi.mock("@/services/RelayConnectionService", () => ({
  relayConnectionService: { subscribe: (...a: unknown[]) => subscribeMock(...(a as [])) },
}));

const { messageService } = await import("@/features/messages/MessageService");
const {
  backfillSince,
  liveSince,
  RECONNECT_REPLAY_CHANNEL_LOOKBACK_SECS,
  RECONNECT_REPLAY_SKEW_SECS,
} = await import("@/features/messages/reconnectRepair");

const AUTHOR = "a".repeat(64);
function event(id: string, createdAt: number): RawNostrEvent {
  return {
    id,
    pubkey: AUTHOR,
    created_at: createdAt,
    kind: 9,
    tags: [["h", "ch1"]],
    content: id,
    sig: "s".repeat(128),
  };
}

beforeEach(() => {
  fetchOnceMock.mockReset();
  bridgeMock.mockReset();
  subscribeMock.mockClear();
});

describe("fetchOlderMessages — keyset cursor", () => {
  it("sends until + before_id, so the relay excludes the boundary itself", async () => {
    bridgeMock.mockResolvedValue([]);
    await messageService.fetchOlderMessages("ch1", { createdAt: 1700000000, id: "cursor-id" });

    const filter = bridgeMock.mock.calls[0][0][0];
    expect(filter.until).toBe(1700000000);
    expect(filter.before_id).toBe("cursor-id");
    expect(filter["#h"]).toEqual(["ch1"]);
  });

  it("keeps same-second messages the relay returns instead of discarding them", async () => {
    // With before_id the relay has already excluded the cursor, so everything
    // it returns at that second is genuinely older in keyset order.
    bridgeMock.mockResolvedValue([
      event("b", 1700000000),
      event("a", 1700000000),
      event("older", 1699999999),
    ]);

    const page = await messageService.fetchOlderMessages("ch1", {
      createdAt: 1700000000,
      id: "c",
    });

    expect(page.messages).toHaveLength(3);
    expect(page.messages.map((m) => m.id)).toEqual(["older", "a", "b"]);
  });

  it("returns an empty page only when the relay returns nothing", async () => {
    bridgeMock.mockResolvedValue([]);
    const page = await messageService.fetchOlderMessages("ch1", { createdAt: 1, id: "x" });
    expect(page.messages).toEqual([]);
    expect(page.edits).toEqual([]);
    expect(page.deletes).toEqual([]);
  });
});

describe("fetchMessagesSince — reconnect backfill", () => {
  it("asks for everything at or after the given instant", async () => {
    fetchOnceMock.mockResolvedValue([]);
    await messageService.fetchMessagesSince("ch1", 1699999000);

    const filter = fetchOnceMock.mock.calls[0][0][0];
    expect(filter.since).toBe(1699999000);
    expect(filter["#h"]).toEqual(["ch1"]);
    expect(filter.limit).toBeGreaterThan(0);
  });

  it("returns canonically ordered messages", async () => {
    fetchOnceMock.mockResolvedValue([event("c", 300), event("a", 100), event("b", 100)]);
    const got = await messageService.fetchMessagesSince("ch1", 0);
    expect(got.messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("timeline pages split overlays out of the message list (Phase 4B)", () => {
  function overlayEvent(kind: number, id: string, target: string): RawNostrEvent {
    return {
      id,
      pubkey: AUTHOR,
      created_at: 500,
      kind,
      tags: [
        ["h", "ch1"],
        ["e", target],
      ],
      content: kind === 40003 ? "edited text" : "",
      sig: "s".repeat(128),
    };
  }

  it("keeps edits and deletes out of `messages` so they never render as rows", async () => {
    bridgeMock.mockResolvedValue([
      event("m1", 100),
      overlayEvent(40003, "edit-1", "m1"),
      overlayEvent(5, "del-1", "m1"),
      overlayEvent(9005, "admin-del-1", "m1"),
    ]);

    const page = await messageService.fetchMessages("ch1");

    expect(page.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(page.edits).toHaveLength(1);
    expect(page.edits[0]).toMatchObject({ targetId: "m1", content: "edited text" });
    expect(page.deletes).toHaveLength(2);
    expect(page.deletes.map((d) => d.isAdminDelete)).toEqual([false, true]);
  });

  it("subscribes to edit and delete kinds on the same channel filter", () => {
    messageService.subscribeToChannel("ch1", 1, () => {});
    const filters = subscribeMock.mock.calls[0][1] as NostrFilter[];
    // One filter, not a second subscription: an edit must not be able to go
    // missing while its message arrives.
    expect(filters).toHaveLength(1);
    expect(filters[0].kinds).toEqual(expect.arrayContaining([9, 40003, 5, 9005]));
  });
});

describe("subscribeToChannel — anchored, not wall-clock", () => {
  it("subscribes from the caller-supplied instant", () => {
    messageService.subscribeToChannel("ch1", 1699999995, () => {});
    const filters = subscribeMock.mock.calls[0][1] as NostrFilter[];
    expect(filters[0].since).toBe(1699999995);
  });
});

describe("reconnect anchors", () => {
  it("backfills from the newest held message minus OLD BUZZ's channel lookback", () => {
    expect(backfillSince(1700000000)).toBe(1700000000 - RECONNECT_REPLAY_CHANNEL_LOOKBACK_SECS);
  });

  it("uses OLD BUZZ's actual constant (900 + 960 + 5), not a guess", () => {
    expect(RECONNECT_REPLAY_CHANNEL_LOOKBACK_SECS).toBe(1865);
  });

  it("has no anchor when nothing is held, so the caller refetches instead", () => {
    expect(backfillSince(null)).toBeNull();
  });

  it("never asks for a negative instant", () => {
    expect(backfillSince(10)).toBe(0);
  });

  it("anchors the live subscription to what is held, closing the fetch/subscribe gap", () => {
    expect(liveSince(1700000000, 1700009999)).toBe(1700000000 - RECONNECT_REPLAY_SKEW_SECS);
  });

  it("falls back to now (minus skew) only when the timeline is empty", () => {
    expect(liveSince(null, 1700000000)).toBe(1700000000 - RECONNECT_REPLAY_SKEW_SECS);
  });
});

describe("channel window — OLD BUZZ's top-level history query", () => {
  function bounds(content: object): RawNostrEvent {
    return {
      id: "bounds",
      pubkey: "r".repeat(64),
      created_at: 1,
      kind: 39006,
      tags: [["d", "ch1:head"]],
      content: JSON.stringify(content),
      sig: "s".repeat(128),
    };
  }

  it("asks the relay for top-level rows only, with their edits/deletes attached", async () => {
    bridgeMock.mockResolvedValue([]);
    await messageService.fetchMessages("ch1");

    const filter = bridgeMock.mock.calls[0][0][0];
    expect(filter).toMatchObject({ "#h": ["ch1"], limit: 50, top_level: true, include_aux: true });
    expect(filter.until).toBeUndefined();
    expect(filter.before_id).toBeUndefined();
  });

  it("never counts edits, deletions or reactions as rows (they are aux, not window rows)", async () => {
    bridgeMock.mockResolvedValue([]);
    await messageService.fetchMessages("ch1");
    const kinds = bridgeMock.mock.calls[0][0][0].kinds as number[];
    expect(kinds).toEqual(expect.arrayContaining([9, 40002, 40099]));
    for (const aux of [5, 7, 9005, 40003]) expect(kinds).not.toContain(aux);
  });

  it("older pages keep the keyset cursor on the same window", async () => {
    bridgeMock.mockResolvedValue([]);
    await messageService.fetchOlderMessages("ch1", { createdAt: 1700000000, id: "cursor-id" });
    expect(bridgeMock.mock.calls[0][0][0]).toMatchObject({
      top_level: true,
      until: 1700000000,
      before_id: "cursor-id",
    });
  });

  it("takes has-more and the next cursor from the relay's kind:39006, not from row counts", async () => {
    bridgeMock.mockResolvedValue([
      event("m1", 100),
      bounds({ has_more: true, next_cursor: { created_at: 100, id: "m1" } }),
    ]);
    const page = await messageService.fetchMessages("ch1");
    expect(page.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({ createdAt: 100, id: "m1" });

    bridgeMock.mockResolvedValue([event("m0", 50), bounds({ has_more: false, next_cursor: null })]);
    const last = await messageService.fetchOlderMessages("ch1", { createdAt: 100, id: "m1" });
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBeNull();
  });

  it("a channel whose newest events are thread replies still shows its top-level history (SWF Project)", async () => {
    // The relay's window already excluded the replies; what it returns are the
    // top-level rows further back — all of them must render.
    bridgeMock.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => event(`top-${i}`, 1000 + i)).concat(
        bounds({ has_more: true, next_cursor: { created_at: 1000, id: "top-0" } }),
      ),
    );
    const page = await messageService.fetchMessages("ch1");
    expect(page.messages).toHaveLength(50);
    expect(page.messages.every((m) => !m.thread.rootId)).toBe(true);
  });
});

describe("channel window — thread summaries arrive with the history page", () => {
  it("asks for the relay's summaries and parses them (whole-thread count, pubkey participants)", async () => {
    bridgeMock.mockResolvedValue([
      event("root-1", 100),
      {
        id: "sum-1",
        pubkey: "r".repeat(64),
        created_at: 200,
        kind: 39005,
        tags: [
          ["e", "root-1"],
          ["d", "root-1"],
          ["h", "ch1"],
        ],
        content: JSON.stringify({ reply_count: 2, descendant_count: 3, last_reply_at: 190, participants: ["p1", "p2"] }),
        sig: "s".repeat(128),
      },
    ]);
    const page = await messageService.fetchMessages("ch1");
    expect(bridgeMock.mock.calls[0][0][0]).toMatchObject({ include_summaries: true });
    expect(page.summaries).toEqual([{ rootId: "root-1", replyCount: 3, lastReplyAt: 190, participants: ["p1", "p2"] }]);
    expect(page.messages.map((m) => m.id)).toEqual(["root-1"]); // a summary is not a row
  });
});
