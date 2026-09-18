import { describe, expect, it } from "vitest";
import { buildDmHideEvent, buildDmOpenEvent, parseDmVisibilityEvent } from "@/protocol/dm";
import type { RawNostrEvent } from "@/protocol/types";

describe("buildDmOpenEvent", () => {
  it("tags one p per other participant", () => {
    const event = buildDmOpenEvent(["a", "b"]);
    expect(event.kind).toBe(41010);
    expect(event.tags).toEqual([
      ["p", "a"],
      ["p", "b"],
    ]);
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
