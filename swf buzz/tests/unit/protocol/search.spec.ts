import { describe, expect, it } from "vitest";
import {
  buildMessageSearchFilter,
  isSearchableQuery,
  SEARCHABLE_MESSAGE_KINDS,
  SEARCH_PAGE_LIMIT,
} from "@/protocol/search";
import { KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2 } from "@/protocol/kinds";

/**
 * These pin the NIP-50 wire shape the relay expects
 * (`crates/buzz-relay/src/handlers/req.rs:596-628`) and — more importantly —
 * the fact that this client does NOT attempt to enforce access here. The relay
 * resolves accessible channels from the authenticated pubkey and re-authorizes
 * every hit; a client-side channel filter would be theatre over vetted data and
 * would hide legitimate results whenever the local list was stale.
 */
describe("NIP-50 message search — filter shape", () => {
  it("asks only for kinds the timeline can render", () => {
    expect([...SEARCHABLE_MESSAGE_KINDS]).toEqual([KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2]);
  });

  it("puts the query in the NIP-50 `search` field", () => {
    const filter = buildMessageSearchFilter({ query: "quarterly report" });
    expect(filter.search).toBe("quarterly report");
  });

  it("trims the query so a stray space is not sent as part of the search text", () => {
    expect(buildMessageSearchFilter({ query: "  deploy  " }).search).toBe("deploy");
  });

  it("defaults to the page limit and lets a caller override it", () => {
    expect(buildMessageSearchFilter({ query: "x" }).limit).toBe(SEARCH_PAGE_LIMIT);
    expect(buildMessageSearchFilter({ query: "x", limit: 5 }).limit).toBe(5);
  });

  it("omits #h entirely when the search is community-wide", () => {
    const filter = buildMessageSearchFilter({ query: "x" });
    expect(filter["#h"]).toBeUndefined();
  });

  it("scopes to one channel with #h when asked", () => {
    const filter = buildMessageSearchFilter({ query: "x", channelId: "chan-1" });
    expect(filter["#h"]).toEqual(["chan-1"]);
  });

  it("carries NO channel allowlist — access is the relay's to decide, not ours", () => {
    // If a future change starts shipping a list of "channels I can read", this
    // fails: that list is not an authorization mechanism, and a stale one
    // silently hides results the user is entitled to see.
    const filter = buildMessageSearchFilter({ query: "x" }) as Record<string, unknown>;
    const keys = Object.keys(filter).sort();
    expect(keys).toEqual(["kinds", "limit", "search"]);
  });
});

describe("query admissibility", () => {
  it.each(["", "   ", "\t", "\n"])("rejects whitespace-only query %j", (q) => {
    expect(isSearchableQuery(q)).toBe(false);
  });

  it("accepts a query with content", () => {
    expect(isSearchableQuery(" a ")).toBe(true);
  });
});
