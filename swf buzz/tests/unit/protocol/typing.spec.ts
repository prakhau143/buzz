import { describe, expect, it } from "vitest";
import {
  buildTypingIndicatorEvent,
  parseTypingIndicatorEvent,
  TYPING_THROTTLE_MS,
} from "@/protocol/typing";
import type { RawNostrEvent } from "@/protocol/types";

const CHANNEL_ID = "channel-1";
const ROOT = "a".repeat(64);
const PARENT = "b".repeat(64);

function rawEvent(overrides: Partial<RawNostrEvent>): RawNostrEvent {
  return {
    id: "id",
    pubkey: "author",
    created_at: 1,
    kind: 20002,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  };
}

describe("buildTypingIndicatorEvent", () => {
  it("tags only the channel for a top-level typing signal", () => {
    const event = buildTypingIndicatorEvent({ channelId: CHANNEL_ID });
    expect(event.tags).toEqual([["h", CHANNEL_ID]]);
  });

  it("adds thread reply tags when typing inside a thread", () => {
    const event = buildTypingIndicatorEvent({
      channelId: CHANNEL_ID,
      thread: { rootEventId: ROOT, parentEventId: PARENT },
    });
    expect(event.tags).toEqual([
      ["h", CHANNEL_ID],
      ["e", ROOT, "", "root"],
      ["e", PARENT, "", "reply"],
    ]);
  });
});

describe("parseTypingIndicatorEvent", () => {
  it("returns null without an h tag", () => {
    expect(parseTypingIndicatorEvent(rawEvent({ tags: [] }))).toBeNull();
  });

  it("extracts channel and thread markers", () => {
    const parsed = parseTypingIndicatorEvent(
      rawEvent({
        tags: [
          ["h", CHANNEL_ID],
          ["e", ROOT, "", "root"],
          ["e", PARENT, "", "reply"],
        ],
      }),
    );
    expect(parsed).toMatchObject({
      channelId: CHANNEL_ID,
      rootEventId: ROOT,
      parentEventId: PARENT,
    });
  });
});

describe("TYPING_THROTTLE_MS", () => {
  it("matches the reference client's 3s throttle window", () => {
    expect(TYPING_THROTTLE_MS).toBe(3000);
  });
});
