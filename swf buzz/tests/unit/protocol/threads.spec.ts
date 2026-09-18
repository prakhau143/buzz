import { describe, expect, it } from "vitest";
import { buildThreadSummaryFilter, parseThreadSummaryEvent } from "@/protocol/threads";
import type { RawNostrEvent } from "@/protocol/types";

const ROOT = "a".repeat(64);

describe("buildThreadSummaryFilter", () => {
  it("filters only by #d — kind:39005 is parameterized-replaceable, so d is its guaranteed tag", () => {
    // Regression test: an earlier version ANDed #e and #d in one filter,
    // which silently matched nothing whenever the relay only set one of them.
    const filter = buildThreadSummaryFilter(ROOT);
    expect(filter).toEqual({ kinds: [39005], "#d": [ROOT], limit: 1 });
    expect(filter).not.toHaveProperty("#e");
  });
});

describe("parseThreadSummaryEvent", () => {
  function summaryEvent(overrides: Partial<RawNostrEvent>): RawNostrEvent {
    return {
      id: "id",
      pubkey: "relay",
      created_at: 1,
      kind: 39005,
      tags: [["d", ROOT]],
      content: JSON.stringify({ reply_count: 3, last_reply_at: 100, participants: ["a", "b"] }),
      sig: "sig",
      ...overrides,
    };
  }

  it("parses a well-formed thread summary", () => {
    expect(parseThreadSummaryEvent(summaryEvent({}))).toEqual({
      rootId: ROOT,
      replyCount: 3,
      lastReplyAt: 100,
      participants: ["a", "b"],
    });
  });

  it("falls back to the #e tag for rootId when #d is absent", () => {
    const event = summaryEvent({ tags: [["e", ROOT]] });
    expect(parseThreadSummaryEvent(event)?.rootId).toBe(ROOT);
  });

  it("returns null when neither #d nor #e is present", () => {
    expect(parseThreadSummaryEvent(summaryEvent({ tags: [] }))).toBeNull();
  });

  it("returns null for malformed JSON content", () => {
    expect(parseThreadSummaryEvent(summaryEvent({ content: "not json" }))).toBeNull();
  });
});
