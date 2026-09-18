import { describe, expect, it } from "vitest";
import { parseChannelEvent } from "@/protocol/channels";
import type { RawNostrEvent } from "@/protocol/types";

function discoveryEvent(tags: string[][]): RawNostrEvent {
  return {
    id: "id",
    pubkey: "relay",
    created_at: 0,
    kind: 39000,
    tags,
    content: "",
    sig: "sig",
  };
}

describe("parseChannelEvent", () => {
  it("returns null when required d/name tags are missing", () => {
    expect(parseChannelEvent(discoveryEvent([]))).toBeNull();
  });

  it("parses an open public channel", () => {
    const channel = parseChannelEvent(
      discoveryEvent([
        ["d", "chan-1"],
        ["name", "general"],
        ["public"],
        ["closed"],
        ["t", "stream"],
      ]),
    );
    expect(channel).toMatchObject({
      id: "chan-1",
      name: "general",
      visibility: "open",
      channelType: "stream",
      archived: false,
    });
  });

  it("parses a private channel", () => {
    const channel = parseChannelEvent(
      discoveryEvent([["d", "chan-2"], ["name", "leadership"], ["private"]]),
    );
    expect(channel?.visibility).toBe("private");
  });

  it("parses a hidden DM channel with participants", () => {
    const channel = parseChannelEvent(
      discoveryEvent([
        ["d", "dm-1"],
        ["name", "dm-1"],
        ["hidden"],
        ["t", "dm"],
        ["p", "alice"],
        ["p", "bob"],
      ]),
    );
    expect(channel).toMatchObject({ channelType: "dm", dmParticipants: ["alice", "bob"] });
  });

  it("marks an archived channel", () => {
    const channel = parseChannelEvent(
      discoveryEvent([
        ["d", "chan-3"],
        ["name", "old"],
        ["archived", "true"],
      ]),
    );
    expect(channel?.archived).toBe(true);
  });
});
