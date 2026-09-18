import { describe, expect, it } from "vitest";
import { reconcileOptimisticMessage } from "@/features/messages/optimisticMessage";
import type { Message } from "@/types/domain";

function message(overrides: Partial<Message>): Message {
  return {
    id: "id",
    channelId: "channel-1",
    authorPubkey: "me",
    content: "hi",
    createdAt: 1,
    thread: {},
    mentions: [],
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    ...overrides,
  };
}

describe("reconcileOptimisticMessage", () => {
  it("replaces the optimistic entry with the real message in the common case", () => {
    const optimistic = message({ id: "optimistic-1", status: "sending" });
    const sent = message({ id: "real-1" });
    const result = reconcileOptimisticMessage([optimistic], "optimistic-1", sent);
    expect(result).toEqual([sent]);
  });

  it("drops the optimistic placeholder instead of duplicating when the live subscription already delivered it", () => {
    // Regression test: the relay can echo a published event back through the
    // live subscription before publish()'s promise resolves locally. Without
    // this check, `sent` would be appended a second time alongside the
    // now-orphaned optimistic entry.
    const optimistic = message({ id: "optimistic-1", status: "sending" });
    const sent = message({ id: "real-1" });
    const current = [optimistic, sent]; // live delivery already inserted `sent`
    const result = reconcileOptimisticMessage(current, "optimistic-1", sent);
    expect(result).toEqual([sent]);
  });

  it("leaves other messages untouched", () => {
    const other = message({ id: "other-1" });
    const optimistic = message({ id: "optimistic-1", status: "sending" });
    const sent = message({ id: "real-1" });
    const result = reconcileOptimisticMessage([other, optimistic], "optimistic-1", sent);
    expect(result).toEqual([other, sent]);
  });

  it("does not throw on an undefined current list (defensive; the optimistic entry is always seeded first in practice)", () => {
    const sent = message({ id: "real-1" });
    expect(reconcileOptimisticMessage(undefined, "optimistic-1", sent)).toEqual([]);
  });
});
