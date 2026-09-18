import { describe, expect, it } from "vitest";
import {
  applyReaction,
  groupReactions,
  type ReactionsByMessage,
} from "@/features/reactions/ReactionService";
import type { ParsedReactionEvent } from "@/protocol/reactions";

const TARGET = "t1".padEnd(64, "0");
const OTHER_TARGET = "t2".padEnd(64, "0");

function reactionEvent(overrides: Partial<ParsedReactionEvent>): ParsedReactionEvent {
  return {
    id: "id",
    targetEventId: TARGET,
    reactorPubkey: "alice",
    emoji: "👍",
    createdAt: 1,
    ...overrides,
  };
}

describe("groupReactions", () => {
  it("groups multiple reactors of the same emoji into one entry with a count", () => {
    const grouped = groupReactions(
      [reactionEvent({ reactorPubkey: "alice" }), reactionEvent({ reactorPubkey: "bob" })],
      null,
    );
    expect(grouped.get(TARGET)).toEqual([
      { emoji: "👍", count: 2, reactedByMe: false, reactorPubkeys: ["alice", "bob"] },
    ]);
  });

  it("marks reactedByMe when the viewer's pubkey reacted", () => {
    const grouped = groupReactions([reactionEvent({ reactorPubkey: "me" })], "me");
    expect(grouped.get(TARGET)?.[0].reactedByMe).toBe(true);
  });

  it("does not double-count a repeated reaction from the same pubkey", () => {
    const grouped = groupReactions(
      [reactionEvent({ reactorPubkey: "alice" }), reactionEvent({ reactorPubkey: "alice" })],
      null,
    );
    expect(grouped.get(TARGET)?.[0].count).toBe(1);
  });

  it("keeps different targets separate", () => {
    const grouped = groupReactions(
      [reactionEvent({ targetEventId: TARGET }), reactionEvent({ targetEventId: OTHER_TARGET })],
      null,
    );
    expect(grouped.has(TARGET)).toBe(true);
    expect(grouped.has(OTHER_TARGET)).toBe(true);
  });
});

describe("applyReaction", () => {
  it("adds a new reaction without touching other targets' existing reactions", () => {
    // Regression test: an earlier implementation recomputed the whole map from only
    // "seen since subscribing" events, silently dropping historical reactions for any
    // target that received a new live reaction. applyReaction patches in place instead.
    const current: ReactionsByMessage = new Map([
      [TARGET, [{ emoji: "👍", count: 3, reactedByMe: false, reactorPubkeys: ["a", "b", "c"] }]],
    ]);
    const next = applyReaction(
      current,
      reactionEvent({ targetEventId: TARGET, emoji: "😄", reactorPubkey: "d" }),
      null,
    );
    expect(next.get(TARGET)).toEqual([
      { emoji: "👍", count: 3, reactedByMe: false, reactorPubkeys: ["a", "b", "c"] },
      { emoji: "😄", count: 1, reactedByMe: false, reactorPubkeys: ["d"] },
    ]);
  });

  it("increments an existing emoji's count for a new reactor", () => {
    const current: ReactionsByMessage = new Map([
      [TARGET, [{ emoji: "👍", count: 1, reactedByMe: false, reactorPubkeys: ["a"] }]],
    ]);
    const next = applyReaction(current, reactionEvent({ reactorPubkey: "b" }), null);
    expect(next.get(TARGET)?.[0]).toEqual({
      emoji: "👍",
      count: 2,
      reactedByMe: false,
      reactorPubkeys: ["a", "b"],
    });
  });

  it("is idempotent for a duplicate reaction from the same pubkey", () => {
    const current: ReactionsByMessage = new Map([
      [TARGET, [{ emoji: "👍", count: 1, reactedByMe: true, reactorPubkeys: ["me"] }]],
    ]);
    const next = applyReaction(current, reactionEvent({ reactorPubkey: "me" }), "me");
    expect(next).toBe(current);
  });

  it("leaves unrelated targets untouched", () => {
    const current: ReactionsByMessage = new Map([
      [OTHER_TARGET, [{ emoji: "❤️", count: 5, reactedByMe: false, reactorPubkeys: ["x"] }]],
    ]);
    const next = applyReaction(current, reactionEvent({ targetEventId: TARGET }), null);
    expect(next.get(OTHER_TARGET)).toEqual(current.get(OTHER_TARGET));
  });
});
