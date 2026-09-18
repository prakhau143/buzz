import { describe, expect, it } from "vitest";
import { buildReactionEvent, buildReactionFilter, parseReactionEvent } from "@/protocol/reactions";
import type { RawNostrEvent } from "@/protocol/types";

const TARGET = "1".repeat(64);

function rawEvent(overrides: Partial<RawNostrEvent>): RawNostrEvent {
  return {
    id: "id".padEnd(64, "0"),
    pubkey: "author".padEnd(64, "0"),
    created_at: 1_700_000_000,
    kind: 7,
    tags: [["e", TARGET]],
    content: "+",
    sig: "sig",
    ...overrides,
  };
}

describe("buildReactionEvent", () => {
  it("builds a plain emoji reaction with only an e tag", () => {
    const event = buildReactionEvent({ targetEventId: TARGET, emoji: "+" });
    expect(event.kind).toBe(7);
    expect(event.content).toBe("+");
    expect(event.tags).toEqual([["e", TARGET]]);
  });

  it("throws for a custom-emoji shortcode without a URL", () => {
    const longShortcode = `:${"x".repeat(70)}:`;
    expect(() => buildReactionEvent({ targetEventId: TARGET, emoji: longShortcode })).toThrow();
  });

  it("adds a lowercased emoji tag for a valid custom-emoji shortcode", () => {
    const longShortcode = `:${"X".repeat(70)}:`;
    const event = buildReactionEvent({
      targetEventId: TARGET,
      emoji: longShortcode,
      customEmojiUrl: "https://example.com/e.png",
    });
    expect(event.tags).toContainEqual(["emoji", "x".repeat(70), "https://example.com/e.png"]);
  });
});

describe("parseReactionEvent", () => {
  it("uses the last valid 64-hex e tag as the target", () => {
    const other = "2".repeat(64);
    const parsed = parseReactionEvent(
      rawEvent({
        tags: [
          ["e", other],
          ["e", TARGET],
        ],
      }),
    );
    expect(parsed?.targetEventId).toBe(TARGET);
  });

  it("returns null when no valid e tag exists", () => {
    expect(parseReactionEvent(rawEvent({ tags: [] }))).toBeNull();
  });
});

describe("buildReactionFilter", () => {
  it("always scopes by channel — a bare {kinds:[7]} filter delivers nothing server-side", () => {
    expect(buildReactionFilter("channel-1")).toEqual({ kinds: [7], "#h": ["channel-1"] });
  });
});
