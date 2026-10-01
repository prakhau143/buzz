/**
 * SWF ships no agents — but a community may contain external Nostr participants
 * that happen to be agents (e.g. OLD BUZZ's Poseidon). Their ordinary messages
 * are ordinary protocol messages: parsed, threaded and mentioned like anyone's.
 * Removing SWF's own agent surfaces must not drop or re-route them.
 */
import { describe, expect, it } from "vitest";
import { parseMessageEvent, isRenderableMessageKind } from "@/protocol/messages";
import { buildReplyTags } from "@/protocol/nip10";
import { countsAsUnread } from "@/features/readState/unreadPolicy";
import type { RawNostrEvent } from "@/protocol/types";

const EXTERNAL_AGENT = "c".repeat(64);
const ME = "a".repeat(64);
const CHANNEL = "chan-1";

const event = (over: Partial<RawNostrEvent> = {}): RawNostrEvent => ({
  id: "d".repeat(64),
  pubkey: EXTERNAL_AGENT,
  created_at: 1000,
  kind: 9,
  tags: [["h", CHANNEL]],
  content: "Build finished: all checks green.",
  sig: "s",
  ...over,
});

describe("external participant messages stay normal protocol messages", () => {
  it("parses like any other kind:9 message, content intact", () => {
    const e = event();
    expect(isRenderableMessageKind(e.kind)).toBe(true);
    const m = parseMessageEvent(e);
    expect(m).toMatchObject({ id: e.id, channelId: CHANNEL, authorPubkey: EXTERNAL_AGENT, content: e.content });
    expect(m.isSystemMessage).toBe(false);
  });

  it("threads and mentions behave exactly as for a human", () => {
    const root = "e".repeat(64);
    const m = parseMessageEvent(
      event({ tags: [["h", CHANNEL], ...buildReplyTags({ rootEventId: root, parentEventId: root }), ["p", ME]] }),
    );
    expect(m.thread.rootId).toBe(root);
    expect(m.mentions).toContain(ME);
  });

  it("counts toward my unread like anyone else's message", () => {
    expect(countsAsUnread(parseMessageEvent(event()), ME)).toBe(true);
  });
});
