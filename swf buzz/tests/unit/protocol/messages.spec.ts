import { describe, expect, it } from "vitest";
import { buildMessageEvent, parseMessageEvent, parseSystemMessageEvent } from "@/protocol/messages";
import type { RawNostrEvent } from "@/protocol/types";

const CHANNEL_ID = "channel-uuid";
const ROOT = "a".repeat(64);
const PARENT_AUTHOR = "p".repeat(64);

function rawEvent(overrides: Partial<RawNostrEvent>): RawNostrEvent {
  return {
    id: "id".padEnd(64, "0"),
    pubkey: "author".padEnd(64, "0"),
    created_at: 1_700_000_000,
    kind: 9,
    tags: [],
    content: "hello",
    sig: "sig",
    ...overrides,
  };
}

describe("buildMessageEvent", () => {
  it("builds a top-level message with only an h tag", () => {
    const event = buildMessageEvent({ channelId: CHANNEL_ID, content: "hi" });
    expect(event.kind).toBe(9);
    expect(event.tags).toEqual([["h", CHANNEL_ID]]);
  });

  it("builds a direct reply, notifying the parent author and tagging thread markers", () => {
    const event = buildMessageEvent({
      channelId: CHANNEL_ID,
      content: "reply",
      reply: { rootEventId: ROOT, parentEventId: ROOT, parentAuthorPubkey: PARENT_AUTHOR },
    });
    expect(event.tags).toEqual([
      ["h", CHANNEL_ID],
      ["p", PARENT_AUTHOR],
      ["e", ROOT, "", "reply"],
    ]);
  });

  it("includes explicit @mentions alongside a reply notification", () => {
    const mention = "m".repeat(64);
    const event = buildMessageEvent({
      channelId: CHANNEL_ID,
      content: "hey @agent",
      mentionPubkeys: [mention],
    });
    expect(event.tags).toEqual([
      ["h", CHANNEL_ID],
      ["p", mention],
    ]);
  });
});

describe("parseMessageEvent", () => {
  it("parses channel id, thread markers, and mentions from a raw event", () => {
    const mention = "m".repeat(64);
    const message = parseMessageEvent(
      rawEvent({
        tags: [
          ["h", CHANNEL_ID],
          ["p", mention],
          ["e", ROOT, "", "reply"],
        ],
      }),
    );
    expect(message.channelId).toBe(CHANNEL_ID);
    expect(message.thread).toEqual({ rootId: ROOT, parentId: ROOT });
    expect(message.mentions).toEqual([mention]);
    expect(message.status).toBe("sent");
    expect(message.isSystemMessage).toBe(false);
  });
});

describe("parseSystemMessageEvent", () => {
  it("parses a well-formed system message payload", () => {
    const result = parseSystemMessageEvent(
      rawEvent({ tags: [["h", CHANNEL_ID]], content: JSON.stringify({ type: "topic_changed" }) }),
    );
    expect(result).toEqual({ channelId: CHANNEL_ID, payload: { type: "topic_changed" } });
  });

  it("returns null when the h tag is missing", () => {
    expect(parseSystemMessageEvent(rawEvent({ tags: [], content: "{}" }))).toBeNull();
  });

  it("returns null for malformed JSON content", () => {
    expect(
      parseSystemMessageEvent(rawEvent({ tags: [["h", CHANNEL_ID]], content: "not json" })),
    ).toBeNull();
  });
});
