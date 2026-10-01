/** Phase G — the kind:40004 pin event shape (protocol/pins.ts). */
import { describe, expect, it } from "vitest";
import { buildPinEvent, parsePinEvent } from "@/protocol/pins";
import { KIND_STREAM_MESSAGE_PINNED } from "@/protocol/kinds";
import type { RawNostrEvent } from "@/protocol/types";

const AUTHOR = "A".repeat(64);

function signed(partial: { kind?: number; tags: string[][]; pubkey?: string }): RawNostrEvent {
  return {
    id: "f".repeat(64),
    pubkey: partial.pubkey ?? "B".repeat(64),
    created_at: 1_700_000_000,
    kind: partial.kind ?? KIND_STREAM_MESSAGE_PINNED,
    tags: partial.tags,
    content: "",
    sig: "",
  };
}

describe("buildPinEvent", () => {
  it("26. emits kind 40004 with h, e, action and a lowercased author claim", () => {
    const event = buildPinEvent({ conversationId: "ch", messageId: "m1", action: "pin", messageAuthor: AUTHOR });
    expect(event.kind).toBe(40004);
    expect(event.content).toBe("");
    expect(event.tags).toEqual([
      ["h", "ch"],
      ["e", "m1"],
      ["action", "pin"],
      ["author", AUTHOR.toLowerCase()],
    ]);
  });

  it("never adds a p tag (that would turn a pin into a mention)", () => {
    const event = buildPinEvent({ conversationId: "ch", messageId: "m1", action: "pin", messageAuthor: AUTHOR });
    expect(event.tags.some((t) => t[0] === "p")).toBe(false);
  });

  it("an unpin carries no author", () => {
    const event = buildPinEvent({ conversationId: "ch", messageId: "m1", action: "unpin", messageAuthor: AUTHOR });
    expect(event.tags).toEqual([
      ["h", "ch"],
      ["e", "m1"],
      ["action", "unpin"],
    ]);
  });
});

describe("parsePinEvent", () => {
  it("round-trips", () => {
    const parsed = parsePinEvent(
      signed({ tags: [["h", "ch"], ["e", "m1"], ["action", "unpin"]] }),
    );
    expect(parsed).toMatchObject({ conversationId: "ch", messageId: "m1", action: "unpin", actorPubkey: "b".repeat(64) });
  });

  it("drops malformed events instead of guessing", () => {
    expect(parsePinEvent(signed({ tags: [["e", "m1"]] }))).toBeNull();
    expect(parsePinEvent(signed({ tags: [["h", "ch"]] }))).toBeNull();
    expect(parsePinEvent(signed({ tags: [["h", "ch"], ["e", "m1"], ["action", "delete"]] }))).toBeNull();
    expect(parsePinEvent(signed({ kind: 9, tags: [["h", "ch"], ["e", "m1"]] }))).toBeNull();
  });

  it("ignores an author claim that is not a 64-hex key", () => {
    const parsed = parsePinEvent(signed({ tags: [["h", "ch"], ["e", "m1"], ["author", "nope"]] }));
    expect(parsed?.claimedAuthor).toBeNull();
  });
});
