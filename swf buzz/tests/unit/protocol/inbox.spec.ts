import { describe, expect, it } from "vitest";
import {
  AGENT_ACTIVITY_KINDS,
  buildInboxFilter,
  INBOX_SERVER_CATEGORIES,
  INBOX_VIEWS,
  isAgentActivityKind,
  serverCategoryFor,
} from "@/protocol/inbox";
import {
  KIND_JOB_PROGRESS,
  KIND_JOB_REQUEST,
  KIND_JOB_RESULT,
  KIND_STREAM_MESSAGE,
} from "@/protocol/kinds";

/**
 * The load-bearing fact here: the relay canonicalizes `agent_activity` to
 * `activity` and de-duplicates by canonical name
 * (`crates/buzz-relay/src/api/bridge.rs:1226-1232`). The CLI advertising four
 * type names does not mean four server queries exist. A UI that requested both
 * would render one result set under two tab labels.
 */
describe("inbox categories", () => {
  it("requests exactly three categories from the relay", () => {
    expect([...INBOX_SERVER_CATEGORIES]).toEqual(["mentions", "needs_action", "activity"]);
  });

  it("presents four views, one of which is a client-side narrowing", () => {
    expect([...INBOX_VIEWS]).toEqual(["mentions", "needs_action", "activity", "agent_activity"]);
  });

  it("maps agent_activity onto the activity query, because the relay aliases it", () => {
    expect(serverCategoryFor("agent_activity")).toBe("activity");
  });

  it.each(["mentions", "needs_action", "activity"] as const)(
    "maps %s onto itself",
    (view) => {
      expect(serverCategoryFor(view)).toBe(view);
    },
  );
});

describe("inbox filter shape", () => {
  it("carries the feed_types extension the bridge two-pass parses", () => {
    const filter = buildInboxFilter({ category: "mentions", pubkey: "abc" });
    expect(filter.feed_types).toEqual(["mentions"]);
  });

  it("scopes to the caller's own pubkey with #p, matching the CLI", () => {
    expect(buildInboxFilter({ category: "activity", pubkey: "abc" })["#p"]).toEqual(["abc"]);
  });

  it("sends the aliased category name, never the view name", () => {
    const filter = buildInboxFilter({
      category: serverCategoryFor("agent_activity"),
      pubkey: "abc",
    });
    expect(filter.feed_types).toEqual(["activity"]);
  });

  it("omits `since` unless given, so an absent cursor is not sent as 0", () => {
    // `since: 0` would mean "everything since the epoch" rather than "no bound";
    // harmless here but it makes the query non-cacheable and the intent unclear.
    expect(buildInboxFilter({ category: "activity", pubkey: "a" }).since).toBeUndefined();
    expect(buildInboxFilter({ category: "activity", pubkey: "a", since: 5 }).since).toBe(5);
  });
});

describe("agent activity classification", () => {
  it("recognises the three agent job kinds", () => {
    expect([...AGENT_ACTIVITY_KINDS]).toEqual([
      KIND_JOB_REQUEST,
      KIND_JOB_PROGRESS,
      KIND_JOB_RESULT,
    ]);
  });

  it.each([KIND_JOB_REQUEST, KIND_JOB_PROGRESS, KIND_JOB_RESULT])(
    "classifies kind %i as agent activity",
    (kind) => {
      expect(isAgentActivityKind(kind)).toBe(true);
    },
  );

  it("does not classify a human chat message as agent activity", () => {
    expect(isAgentActivityKind(KIND_STREAM_MESSAGE)).toBe(false);
  });
});
