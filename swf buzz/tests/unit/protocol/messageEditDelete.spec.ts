import { describe, expect, it } from "vitest";
import {
  buildMessageDeleteEvent,
  buildMessageEditEvent,
  editOrDeleteTargetId,
  isMessageDeleteKind,
  isMessageEditKind,
} from "@/protocol/messages";
import {
  KIND_DELETION,
  KIND_NIP29_DELETE_EVENT,
  KIND_STREAM_MESSAGE_EDIT,
} from "@/protocol/kinds";
import type { RawNostrEvent } from "@/protocol/types";

function rawEvent(overrides: Partial<RawNostrEvent>): RawNostrEvent {
  return {
    id: "id",
    pubkey: "pk",
    created_at: 1,
    kind: 9,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  } as RawNostrEvent;
}

describe("edit event", () => {
  it("matches OLD BUZZ's build_message_edit tag shape", () => {
    const event = buildMessageEditEvent({
      channelId: "chan-1",
      targetEventId: "target-1",
      content: "new text",
    });

    expect(event.kind).toBe(KIND_STREAM_MESSAGE_EDIT);
    expect(event.kind).toBe(40003);
    expect(event.content).toBe("new text");
    expect(event.tags).toContainEqual(["h", "chan-1"]);
    expect(event.tags).toContainEqual(["e", "target-1"]);
  });

  it("carries mention p tags", () => {
    const event = buildMessageEditEvent({
      channelId: "chan-1",
      targetEventId: "target-1",
      content: "hi @bob",
      mentionPubkeys: ["bob"],
    });

    expect(event.tags).toContainEqual(["p", "bob"]);
  });
});

describe("delete event", () => {
  it("uses kind:5 for a self delete", () => {
    const event = buildMessageDeleteEvent({
      channelId: "chan-1",
      targetEventId: "target-1",
      mode: "self",
    });

    expect(event.kind).toBe(KIND_DELETION);
    expect(event.kind).toBe(5);
  });

  it("uses kind:9005 for an admin delete, NOT kind:5", () => {
    // The classic wrong implementation is kind:5 plus a local role check. The
    // relay gates kind:5 on authorship alone and would refuse it.
    const event = buildMessageDeleteEvent({
      channelId: "chan-1",
      targetEventId: "target-1",
      mode: "admin",
    });

    expect(event.kind).toBe(KIND_NIP29_DELETE_EVENT);
    expect(event.kind).toBe(9005);
    expect(event.kind).not.toBe(KIND_DELETION);
  });

  it("carries exactly one e tag — the relay rejects any other count", () => {
    for (const mode of ["self", "admin"] as const) {
      const event = buildMessageDeleteEvent({
        channelId: "chan-1",
        targetEventId: "target-1",
        mode,
      });
      expect(event.tags.filter((t) => t[0] === "e")).toHaveLength(1);
      // `h` is non-standard for NIP-09 but required so channel subscriptions see it.
      expect(event.tags).toContainEqual(["h", "chan-1"]);
    }
  });
});

describe("classification", () => {
  it("recognises edit and both delete kinds", () => {
    expect(isMessageEditKind(40003)).toBe(true);
    expect(isMessageEditKind(9)).toBe(false);
    expect(isMessageDeleteKind(5)).toBe(true);
    expect(isMessageDeleteKind(9005)).toBe(true);
    expect(isMessageDeleteKind(9)).toBe(false);
  });

  it("extracts the target id, and returns null when the e tag is missing", () => {
    expect(editOrDeleteTargetId(rawEvent({ tags: [["e", "target-1"]] }))).toBe("target-1");
    expect(editOrDeleteTargetId(rawEvent({ tags: [["h", "chan"]] }))).toBeNull();
  });
});
