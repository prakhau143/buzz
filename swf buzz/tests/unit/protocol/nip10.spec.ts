import { describe, expect, it } from "vitest";
import { buildReplyTags, extractThreadMarkers, resolveThreadMarkers } from "@/protocol/nip10";

const ROOT = "a".repeat(64);
const PARENT = "b".repeat(64);

describe("resolveThreadMarkers", () => {
  it("resolves a nested reply when both root and reply markers are present", () => {
    expect(resolveThreadMarkers({ root: ROOT, reply: PARENT })).toEqual({
      rootId: ROOT,
      parentId: PARENT,
    });
  });

  it("resolves a direct reply to root when only the reply marker is present", () => {
    expect(resolveThreadMarkers({ reply: PARENT })).toEqual({ rootId: PARENT, parentId: PARENT });
  });

  it("does not treat a lone root marker as a reply", () => {
    expect(resolveThreadMarkers({ root: ROOT })).toEqual({});
  });

  it("returns no markers for a top-level message", () => {
    expect(resolveThreadMarkers({})).toEqual({});
  });
});

describe("extractThreadMarkers", () => {
  it("ignores e tags shorter than 4 elements", () => {
    expect(extractThreadMarkers([["e", ROOT]])).toEqual({});
  });

  it("ignores e tags with an invalid (non-64-hex) event id", () => {
    expect(extractThreadMarkers([["e", "not-hex", "", "root"]])).toEqual({});
  });

  it("takes the last valid occurrence of each marker", () => {
    const OTHER_ROOT = "c".repeat(64);
    const tags = [
      ["e", ROOT, "", "root"],
      ["e", OTHER_ROOT, "", "root"],
      ["e", PARENT, "", "reply"],
    ];
    expect(extractThreadMarkers(tags)).toEqual({ root: OTHER_ROOT, reply: PARENT });
  });
});

describe("buildReplyTags", () => {
  it("builds a single reply tag for a direct reply to root", () => {
    expect(buildReplyTags({ rootEventId: ROOT, parentEventId: ROOT })).toEqual([
      ["e", ROOT, "", "reply"],
    ]);
  });

  it("builds root + reply tags for a nested reply", () => {
    expect(buildReplyTags({ rootEventId: ROOT, parentEventId: PARENT })).toEqual([
      ["e", ROOT, "", "root"],
      ["e", PARENT, "", "reply"],
    ]);
  });
});
