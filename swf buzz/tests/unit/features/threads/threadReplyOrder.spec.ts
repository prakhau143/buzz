import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrFilter, RawNostrEvent } from "@/protocol/types";
import { KIND_STREAM_MESSAGE } from "@/protocol/kinds";
import { buildReplyTags } from "@/protocol/nip10";

/**
 * Found by the Phase 4 final QA live run (`threadMedia.e2e.spec.ts`): replies
 * sent within the same second came back in relay order, because the thread
 * sorted by `createdAt` alone. The channel timeline has had a total order since
 * 4A — `compareMessages`, `(createdAt, id)` — and its own doc says what matters
 * is that it is the SAME rule everywhere. The thread was the exception, so two
 * loads of one thread could disagree about the order of simultaneous replies.
 */
const fetchEventsOnce = vi.fn();
vi.mock("@/services/relayQuery", () => ({
  fetchEventsOnce: (filters: NostrFilter[], opts?: unknown) => fetchEventsOnce(filters, opts),
}));

const { threadService } = await import("@/features/threads/ThreadService");

const ROOT = "a".repeat(64);

function event(id: string, createdAt: number, tags: string[][]): RawNostrEvent {
  return { id, pubkey: "b".repeat(64), created_at: createdAt, kind: KIND_STREAM_MESSAGE, tags, content: id, sig: "sig" };
}

const reply = (id: string, createdAt: number) =>
  event(id, createdAt, [["h", "chan-1"], ...buildReplyTags({ rootEventId: ROOT, parentEventId: ROOT })]);

/** Answer the root-by-id query with the root and the `#e` query with `replies`. */
function relayReturns(replies: RawNostrEvent[]): void {
  fetchEventsOnce.mockImplementation(async (filters: NostrFilter[]) => {
    const f = filters[0] as NostrFilter & { ids?: string[]; "#e"?: string[] };
    if (f.ids?.includes(ROOT)) return [event(ROOT, 100, [["h", "chan-1"]])];
    if (f["#e"]?.includes(ROOT)) return replies;
    return [];
  });
}

beforeEach(() => {
  fetchEventsOnce.mockReset();
});

describe("ThreadService.fetchThread — reply order", () => {
  it("orders same-second replies by id, whatever order the relay returns them in", async () => {
    const same = [reply("3".repeat(64), 200), reply("1".repeat(64), 200), reply("2".repeat(64), 200)];

    relayReturns(same);
    const first = (await threadService.fetchThread(ROOT)).replies.map((m) => m.id);
    relayReturns([...same].reverse());
    const second = (await threadService.fetchThread(ROOT)).replies.map((m) => m.id);

    expect(first).toEqual(["1".repeat(64), "2".repeat(64), "3".repeat(64)]);
    expect(second).toEqual(first);
  });

  it("still orders by time first", async () => {
    relayReturns([reply("1".repeat(64), 300), reply("9".repeat(64), 200)]);
    const ids = (await threadService.fetchThread(ROOT)).replies.map((m) => m.id);
    expect(ids).toEqual(["9".repeat(64), "1".repeat(64)]);
  });
});
