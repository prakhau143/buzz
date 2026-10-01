import { describe, expect, it } from "vitest";
import {
  MAX_PARTICIPANTS,
  buildThreadSummaries,
  mergeThreadSummaries,
  replyCountLabel,
} from "@/features/threads/threadSummary";
import type { Message, ThreadSummary } from "@/types/domain";

/**
 * The selector behind the channel feed's thread summary row
 * ("👤👤 2 replies · Last reply 3m ago").
 */
const ROOT = "root-1";

function message(overrides: Partial<Message> & Pick<Message, "id">): Message {
  return {
    channelId: "channel-1",
    authorPubkey: "aa".repeat(32),
    content: "text",
    createdAt: 100,
    thread: {},
    mentions: [],
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    ...overrides,
  };
}
const reply = (id: string, author: string, createdAt: number, rootId = ROOT) =>
  message({ id, authorPubkey: author, createdAt, thread: { rootId, parentId: rootId } });

const A = "aa".repeat(32);
const B = "bb".repeat(32);
const C = "cc".repeat(32);
const D = "dd".repeat(32);

describe("buildThreadSummaries", () => {
  it("counts the replies under each root", () => {
    const summaries = buildThreadSummaries([
      message({ id: ROOT }),
      reply("r1", A, 110),
      reply("r2", B, 120),
      message({ id: "other-root" }),
      reply("r3", A, 130, "other-root"),
    ]);

    expect(summaries.get(ROOT)!.count).toBe(2);
    expect(summaries.get("other-root")!.count).toBe(1);
    // A message with no replies gets no entry at all — no row is rendered.
    expect(summaries.has("no-such-root")).toBe(false);
  });

  it("lists unique participants, most recent replier first, capped at 3", () => {
    const summaries = buildThreadSummaries([
      reply("r1", A, 100),
      reply("r2", B, 110),
      reply("r3", A, 120), // A again — must not appear twice
      reply("r4", C, 130),
      reply("r5", D, 140), // newest
    ]);

    const summary = summaries.get(ROOT)!;
    expect(summary.participantPubkeys).toEqual([D, C, A]);
    expect(summary.participantPubkeys).toHaveLength(MAX_PARTICIPANTS);
    expect(new Set(summary.participantPubkeys).size).toBe(summary.participantPubkeys.length);
    expect(summary.count).toBe(5); // the cap applies to faces, not to the count
  });

  it("reports the newest reply's time as lastReplyAt, whatever order they arrive in", () => {
    const summaries = buildThreadSummaries([reply("r2", B, 300), reply("r1", A, 100), reply("r3", C, 200)]);
    expect(summaries.get(ROOT)!.lastReplyAt).toBe(300);
  });

  it("attaches a reply-to-a-reply to the ROOT thread, never as a nested sub-thread", () => {
    const nested = message({
      id: "r2",
      authorPubkey: B,
      createdAt: 200,
      thread: { rootId: ROOT, parentId: "r1" },
    });
    const summaries = buildThreadSummaries([reply("r1", A, 100), nested]);

    expect(summaries.get(ROOT)!.count).toBe(2);
    expect(summaries.has("r1")).toBe(false); // no sub-thread under the reply
  });

  it("updates when a new reply arrives: count, participant order and time all move", () => {
    const before = buildThreadSummaries([reply("r1", A, 100)]).get(ROOT)!;
    expect(before).toMatchObject({ count: 1, participantPubkeys: [A], lastReplyAt: 100 });

    const after = buildThreadSummaries([reply("r1", A, 100), reply("r2", B, 200)]).get(ROOT)!;
    expect(after).toMatchObject({ count: 2, participantPubkeys: [B, A], lastReplyAt: 200 });
  });

  it("a parent gains its row on the FIRST reply, and loses it when replies drop to 0", () => {
    expect(buildThreadSummaries([message({ id: ROOT })]).has(ROOT)).toBe(false);
    expect(buildThreadSummaries([message({ id: ROOT }), reply("r1", A, 100)]).get(ROOT)!.count).toBe(1);
    // the reply is deleted → back to no entry, so the row disappears
    expect(buildThreadSummaries([message({ id: ROOT })]).has(ROOT)).toBe(false);
  });

  it("includes an optimistic reply that has not been confirmed yet", () => {
    const optimistic = message({
      id: "optimistic-1",
      authorPubkey: A,
      createdAt: 500,
      status: "sending",
      thread: { rootId: ROOT, parentId: ROOT },
    });
    const summary = buildThreadSummaries([optimistic]).get(ROOT)!;
    expect(summary).toMatchObject({ count: 1, participantPubkeys: [A], lastReplyAt: 500 });
  });
});

describe("mergeThreadSummaries — loaded replies + the relay's batched counts", () => {
  const relay = (rootId: string, replyCount: number, extra: Partial<ThreadSummary> = {}) =>
    new Map<string, ThreadSummary>([[rootId, { rootId, replyCount, participants: [], ...extra }]]);

  it("uses the relay's count for a thread whose replies are not loaded (correct on first render)", () => {
    const merged = mergeThreadSummaries(
      new Map(),
      relay(ROOT, 7, { participants: [A, B], lastReplyAt: 900 }),
    );
    expect(merged.get(ROOT)).toEqual({
      rootId: ROOT,
      count: 7,
      participantPubkeys: [A, B],
      lastReplyAt: 900,
      participantTotal: 2,
    });
  });

  it("prefers whichever source knows about more replies", () => {
    const local = buildThreadSummaries([reply("r1", A, 100)]); // 1 loaded
    expect(mergeThreadSummaries(local, relay(ROOT, 12)).get(ROOT)!.count).toBe(12);

    const manyLoaded = buildThreadSummaries([reply("r1", A, 100), reply("r2", B, 200)]);
    // a stale relay summary must not shrink what we can see
    expect(mergeThreadSummaries(manyLoaded, relay(ROOT, 1)).get(ROOT)!.count).toBe(2);
  });

  it("adds replies newer than the relay's summary on top of its count (live and own replies)", () => {
    // The relay counted 9 replies up to t=50; two more (t=100, t=200) arrived since.
    // max(local, relay) used to say 9 — so a reply to a known thread never moved the count.
    const local = buildThreadSummaries([reply("r1", A, 100), reply("r2", B, 200)]);
    const merged = mergeThreadSummaries(local, relay(ROOT, 9, { participants: [C], lastReplyAt: 50 }));
    expect(merged.get(ROOT)).toMatchObject({
      count: 11,
      participantPubkeys: [B, A, C], // live repliers first, then the relay's
      lastReplyAt: 200,
    });
  });

  it("after a reload: relay says 3, my new reply makes it 4 (not max(1, 3))", () => {
    const local = buildThreadSummaries([reply("mine", A, 1000)]);
    expect(mergeThreadSummaries(local, relay(ROOT, 3, { lastReplyAt: 900 })).get(ROOT)!.count).toBe(4);
  });

  it("replies the relay already counted are not counted twice", () => {
    // Thread opened: its replies (t <= relay.lastReplyAt) are now loaded too.
    const local = buildThreadSummaries([reply("r1", A, 800), reply("r2", B, 900)]);
    expect(mergeThreadSummaries(local, relay(ROOT, 2, { lastReplyAt: 900 })).get(ROOT)!.count).toBe(2);
  });

  it("ignores a relay summary reporting zero replies", () => {
    expect(mergeThreadSummaries(new Map(), relay(ROOT, 0)).has(ROOT)).toBe(false);
  });

  it("caps relay-provided participants at 3 as well", () => {
    const merged = mergeThreadSummaries(new Map(), relay(ROOT, 4, { participants: [A, B, C, D] }));
    expect(merged.get(ROOT)!.participantPubkeys).toEqual([A, B, C]);
  });
});

describe("replyCountLabel", () => {
  it("pluralizes correctly — never '2 reply'", () => {
    expect(replyCountLabel(1)).toBe("1 reply");
    expect(replyCountLabel(2)).toBe("2 replies");
    expect(replyCountLabel(17)).toBe("17 replies");
  });
});
