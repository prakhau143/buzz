import { describe, expect, it } from "vitest";
import {
  buildBanEvent,
  buildReportEvent,
  buildResolveReportEvent,
  buildTimeoutEvent,
  buildUnbanEvent,
  buildUntimeoutEvent,
  statusForAction,
} from "@/protocol/moderation";
import {
  KIND_MODERATION_BAN,
  KIND_MODERATION_RESOLVE_REPORT,
  KIND_MODERATION_TIMEOUT,
  KIND_MODERATION_UNBAN,
  KIND_MODERATION_UNTIMEOUT,
  KIND_REPORT,
} from "@/protocol/kinds";

const ALICE = "a".repeat(64);
const EVENT_ID = "e".repeat(64);

describe("buildReportEvent", () => {
  it("carries the p and e tags with the report type on the e tag", () => {
    const event = buildReportEvent({
      authorPubkey: ALICE,
      eventId: EVENT_ID,
      reportType: "spam",
    });
    expect(event.kind).toBe(KIND_REPORT);
    expect(event.tags).toEqual([
      ["p", ALICE],
      ["e", EVENT_ID, "spam"],
    ]);
    expect(event.content).toBe("");
  });

  it("carries a trimmed note as content", () => {
    const event = buildReportEvent({
      authorPubkey: ALICE,
      eventId: EVENT_ID,
      reportType: "other",
      note: "  looks fake  ",
    });
    expect(event.content).toBe("looks fake");
  });
});

describe("buildBanEvent", () => {
  it("builds a permanent ban with just a p tag", () => {
    const event = buildBanEvent({ pubkey: ALICE });
    expect(event.kind).toBe(KIND_MODERATION_BAN);
    expect(event.tags).toEqual([["p", ALICE]]);
  });

  it("adds expiration and reason tags when provided", () => {
    const event = buildBanEvent({ pubkey: ALICE, expiresAt: 1234, reason: "spamming" });
    expect(event.tags).toEqual([
      ["p", ALICE],
      ["expiration", "1234"],
      ["reason", "spamming"],
    ]);
  });
});

describe("buildUnbanEvent", () => {
  it("builds a kind:9041 event with only a p tag", () => {
    const event = buildUnbanEvent(ALICE);
    expect(event.kind).toBe(KIND_MODERATION_UNBAN);
    expect(event.tags).toEqual([["p", ALICE]]);
  });
});

describe("buildTimeoutEvent", () => {
  it("requires an expiration tag", () => {
    const event = buildTimeoutEvent({ pubkey: ALICE, expiresAt: 5678 });
    expect(event.kind).toBe(KIND_MODERATION_TIMEOUT);
    expect(event.tags).toEqual([
      ["p", ALICE],
      ["expiration", "5678"],
    ]);
  });
});

describe("buildUntimeoutEvent", () => {
  it("builds a kind:9043 event with only a p tag", () => {
    const event = buildUntimeoutEvent(ALICE);
    expect(event.kind).toBe(KIND_MODERATION_UNTIMEOUT);
    expect(event.tags).toEqual([["p", ALICE]]);
  });
});

describe("statusForAction", () => {
  it("pairs dismiss with dismissed", () => {
    expect(statusForAction("dismiss")).toBe("dismissed");
  });

  it("pairs every other action with resolved", () => {
    expect(statusForAction("escalate")).toBe("resolved");
    expect(statusForAction("ban")).toBe("resolved");
    expect(statusForAction("timeout")).toBe("resolved");
    expect(statusForAction("kick")).toBe("resolved");
  });
});

describe("buildResolveReportEvent", () => {
  it("builds the report/status/action tags", () => {
    const event = buildResolveReportEvent({
      reportEventId: EVENT_ID,
      status: "resolved",
      action: "ban",
      reason: "repeat offender",
    });
    expect(event.kind).toBe(KIND_MODERATION_RESOLVE_REPORT);
    expect(event.tags).toEqual([
      ["report", EVENT_ID],
      ["status", "resolved"],
      ["action", "ban"],
      ["reason", "repeat offender"],
    ]);
  });

  it("omits the reason tag when not provided", () => {
    const event = buildResolveReportEvent({
      reportEventId: EVENT_ID,
      status: "dismissed",
      action: "dismiss",
    });
    expect(event.tags).toEqual([
      ["report", EVENT_ID],
      ["status", "dismissed"],
      ["action", "dismiss"],
    ]);
  });
});
