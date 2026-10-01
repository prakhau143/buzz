import { describe, expect, it } from "vitest";
import { buildDmHideEvent, buildDmOpenEvent, parseDmVisibilityEvent } from "@/protocol/dm";
import type { RawNostrEvent } from "@/protocol/types";

describe("buildDmOpenEvent", () => {
  it("tags one p per other participant", () => {
    const event = buildDmOpenEvent(["a", "b"]);
    expect(event.kind).toBe(41010);
    expect(event.tags.filter((t) => t[0] === "p")).toEqual([
      ["p", "a"],
      ["p", "b"],
    ]);
  });

  // REGRESSION: without a unique d tag, two opens of the same conversation in
  // the same second hash to the same event id, and the relay answers the
  // second with "duplicate: already processed" — no channel_id, so the DM
  // never opens. See the note on buildDmOpenEvent.
  it("carries a d tag that differs on every call", () => {
    const first = buildDmOpenEvent(["a"]);
    const second = buildDmOpenEvent(["a"]);
    const dOf = (e: { tags: string[][] }) => e.tags.find((t) => t[0] === "d")?.[1];

    expect(dOf(first)).toBeTruthy();
    expect(dOf(second)).toBeTruthy();
    expect(dOf(first)).not.toBe(dOf(second));
  });

  it("puts exactly one d tag on the event", () => {
    expect(buildDmOpenEvent(["a", "b"]).tags.filter((t) => t[0] === "d")).toHaveLength(1);
  });

  it("rejects zero other participants", () => {
    expect(() => buildDmOpenEvent([])).toThrow();
  });

  it("rejects more than 8 other participants", () => {
    expect(() => buildDmOpenEvent(Array.from({ length: 9 }, (_, i) => `p${i}`))).toThrow();
  });
});

describe("buildDmHideEvent", () => {
  it("tags the dm channel id", () => {
    expect(buildDmHideEvent("dm-1").tags).toEqual([["h", "dm-1"]]);
  });
});

describe("parseDmVisibilityEvent", () => {
  it("collects hidden channel ids from h tags", () => {
    const event = {
      id: "id",
      pubkey: "pk",
      created_at: 0,
      kind: 30622,
      tags: [
        ["h", "dm-1"],
        ["h", "dm-2"],
        ["d", "viewer"],
      ],
      content: "",
      sig: "sig",
    } satisfies RawNostrEvent;
    expect(parseDmVisibilityEvent(event)).toEqual({ hiddenChannelIds: ["dm-1", "dm-2"] });
  });
});
