/**
 * Phase 4A — canonical ordering, keyset cursor and idempotent merge.
 *
 * These pin the behaviours that made same-second messages disappear:
 * a cursor that could not address two messages in the same second, and three
 * independent sorts with no tiebreak.
 */
import { describe, expect, it } from "vitest";
import {
  compareMessages,
  mergeMessages,
  newestCreatedAt,
  oldestCursor,
} from "@/features/messages/messageCursor";
import type { Message } from "@/types/domain";

function msg(id: string, createdAt: number, content = id): Message {
  return {
    id,
    channelId: "ch1",
    authorPubkey: "a".repeat(64),
    content,
    createdAt,
    thread: {},
    mentions: [],
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
  };
}

describe("compareMessages — one canonical order", () => {
  it("orders by createdAt, oldest first", () => {
    expect([msg("b", 200), msg("a", 100)].sort(compareMessages).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("breaks same-second ties by event id, deterministically", () => {
    const shuffled = [msg("c", 100), msg("a", 100), msg("b", 100)];
    expect(shuffled.sort(compareMessages).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("gives the same order regardless of input order", () => {
    const a = [msg("c", 100), msg("a", 100), msg("b", 99)].sort(compareMessages).map((m) => m.id);
    const b = [msg("b", 99), msg("c", 100), msg("a", 100)].sort(compareMessages).map((m) => m.id);
    expect(a).toEqual(b);
    expect(a).toEqual(["b", "a", "c"]);
  });
});

describe("oldestCursor — the next-older-page cursor", () => {
  it("is the smallest createdAt", () => {
    expect(oldestCursor([msg("a", 300), msg("b", 100), msg("c", 200)])).toEqual({
      createdAt: 100,
      id: "b",
    });
  });

  /**
   * THE subtle one. The relay walks `created_at DESC, id ASC`, so within the
   * oldest second it has already returned ids in ascending order and continues
   * at `id > cursor.id`. Taking the SMALLEST id would ask the relay for
   * `id > "a"` and silently skip nothing — but taking anything other than the
   * largest re-requests messages we have and, worse, a naive `current[0]`
   * after an ascending sort points at the smallest id, which makes the next
   * page re-deliver the ones we already hold instead of advancing.
   */
  it("uses the LARGEST id among messages sharing the oldest second", () => {
    expect(oldestCursor([msg("a", 100), msg("c", 100), msg("b", 100)])).toEqual({
      createdAt: 100,
      id: "c",
    });
  });

  it("is not simply the first element after an ascending sort", () => {
    const sorted = [msg("a", 100), msg("b", 100), msg("c", 100)].sort(compareMessages);
    expect(sorted[0].id).toBe("a");
    expect(oldestCursor(sorted)!.id).toBe("c"); // different on purpose
  });

  it("is null for an empty timeline", () => {
    expect(oldestCursor([])).toBeNull();
  });
});

describe("newestCreatedAt — the reconnect anchor", () => {
  it("returns the newest timestamp", () => {
    expect(newestCreatedAt([msg("a", 100), msg("b", 300), msg("c", 200)])).toBe(300);
  });
  it("is null for an empty timeline", () => {
    expect(newestCreatedAt([])).toBeNull();
  });
});

describe("mergeMessages — deduplicated, ordered, idempotent", () => {
  it("deduplicates by event id", () => {
    const merged = mergeMessages([msg("a", 100)], [msg("a", 100), msg("b", 200)]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("renders one message when the same event arrives from history, live and backfill", () => {
    const event = msg("dup", 100);
    let timeline = mergeMessages([], [event]);
    timeline = mergeMessages(timeline, [event]); // live
    timeline = mergeMessages(timeline, [event]); // reconnect backfill
    expect(timeline).toHaveLength(1);
  });

  it("is idempotent — re-merging cannot change the result", () => {
    const first = mergeMessages([msg("a", 100)], [msg("b", 200), msg("c", 100)]);
    const second = mergeMessages(first, [msg("b", 200), msg("c", 100)]);
    expect(second).toEqual(first);
  });

  it("keeps the canonical order after merging out-of-order input", () => {
    const merged = mergeMessages([msg("z", 300)], [msg("b", 100), msg("a", 100), msg("m", 200)]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "m", "z"]);
  });

  it("lets a confirmed event replace the optimistic copy of itself", () => {
    const optimistic = { ...msg("evt1", 100), status: "sending" as const };
    const confirmed = { ...msg("evt1", 100), status: "sent" as const };
    const merged = mergeMessages([optimistic], [confirmed]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("sent");
  });

  it("preserves same-second messages instead of collapsing them", () => {
    // The regression this whole phase exists for: five messages, one second.
    const burst = ["a", "b", "c", "d", "e"].map((id) => msg(id, 1700000000));
    expect(mergeMessages([], burst)).toHaveLength(5);
  });

  it("returns a copy when there is nothing to merge", () => {
    const existing = [msg("a", 100)];
    const merged = mergeMessages(existing, []);
    expect(merged).toEqual(existing);
    expect(merged).not.toBe(existing);
  });
});
