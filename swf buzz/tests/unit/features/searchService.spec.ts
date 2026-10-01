import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrFilter, RawNostrEvent } from "@/protocol/types";
import { KIND_STREAM_MESSAGE, KIND_SYSTEM_MESSAGE } from "@/protocol/kinds";

const fetchEventsOnce = vi.fn();
vi.mock("@/services/relayQuery", () => ({
  fetchEventsOnce: (filters: NostrFilter[], opts?: unknown) => fetchEventsOnce(filters, opts),
}));

const { searchService } = await import("@/features/search/SearchService");

function message(overrides: Partial<RawNostrEvent> = {}): RawNostrEvent {
  return {
    id: overrides.id ?? "id-1",
    pubkey: overrides.pubkey ?? "author-1",
    created_at: overrides.created_at ?? 1000,
    kind: overrides.kind ?? KIND_STREAM_MESSAGE,
    tags: overrides.tags ?? [["h", "chan-1"]],
    content: overrides.content ?? "hello",
    sig: "sig",
  };
}

beforeEach(() => {
  fetchEventsOnce.mockReset();
  fetchEventsOnce.mockResolvedValue([]);
});

describe("SearchService", () => {
  it("issues exactly one one-shot request — search REQs register no subscription", async () => {
    await searchService.searchMessages("hello");
    expect(fetchEventsOnce).toHaveBeenCalledTimes(1);
  });

  it("does not hit the relay at all for a whitespace-only query", async () => {
    expect(await searchService.searchMessages("   ")).toEqual([]);
    expect(fetchEventsOnce).not.toHaveBeenCalled();
  });

  it("returns hits with the channel they belong to", async () => {
    fetchEventsOnce.mockResolvedValue([message({ id: "a", tags: [["h", "chan-7"]] })]);
    const hits = await searchService.searchMessages("hello");
    expect(hits).toHaveLength(1);
    expect(hits[0].channelId).toBe("chan-7");
    expect(hits[0].message.id).toBe("a");
  });

  it("orders newest first", async () => {
    fetchEventsOnce.mockResolvedValue([
      message({ id: "old", created_at: 100 }),
      message({ id: "new", created_at: 900 }),
      message({ id: "mid", created_at: 500 }),
    ]);
    const hits = await searchService.searchMessages("x");
    expect(hits.map((h) => h.message.id)).toEqual(["new", "mid", "old"]);
  });

  it("deduplicates repeated event ids", async () => {
    fetchEventsOnce.mockResolvedValue([message({ id: "dupe" }), message({ id: "dupe" })]);
    expect(await searchService.searchMessages("x")).toHaveLength(1);
  });

  it("drops a hit with no channel tag — it could not be navigated to", async () => {
    fetchEventsOnce.mockResolvedValue([message({ id: "orphan", tags: [] })]);
    expect(await searchService.searchMessages("x")).toEqual([]);
  });

  it("drops kinds the timeline cannot render", async () => {
    fetchEventsOnce.mockResolvedValue([message({ id: "sys", kind: KIND_SYSTEM_MESSAGE })]);
    expect(await searchService.searchMessages("x")).toEqual([]);
  });

  it("returns every relay-supplied hit — it does not second-guess access", async () => {
    // The relay already resolved accessible channels from the authenticated
    // pubkey and re-authorized each hit. Re-filtering against a local channel
    // list here would add no safety and would hide real results when that list
    // was stale. If someone adds such a filter, this fails.
    fetchEventsOnce.mockResolvedValue([
      message({ id: "a", tags: [["h", "channel-the-client-never-heard-of"]] }),
      message({ id: "b", tags: [["h", "another-unknown-channel"]] }),
    ]);
    const hits = await searchService.searchMessages("x");
    expect(hits.map((h) => h.message.id).sort()).toEqual(["a", "b"]);
  });

  it("passes the channel scope through when searching one channel", async () => {
    await searchService.searchMessages("x", { channelId: "chan-9" });
    const [filters] = fetchEventsOnce.mock.calls[0] as [NostrFilter[]];
    expect(filters[0]["#h"]).toEqual(["chan-9"]);
  });
});
