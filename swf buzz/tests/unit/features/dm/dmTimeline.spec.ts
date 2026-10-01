/**
 * Phase 4E — DM timeline parity with channels.
 *
 * A DM conversation is a channel on the wire, so every correctness property 4A
 * and 4B established for channels has to hold here too. Before 4E it did not:
 * `Kind41010Transport.subscribe` anchored `since` to wall-clock now (reopening
 * the gap 4A closed) and silently dropped the edit/delete events 4B added to
 * that same subscription.
 *
 * These tests assert the *wiring*, not the mechanics — merge order, keyset
 * paging and overlay folding are already proven against the channel timeline
 * (`messageCursor.spec.ts`, `messageOverlay.spec.ts`). What can still regress
 * is a DM quietly going back to its own weaker path, so each test below pins
 * one thing 4E connected.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineEvent, TimelinePage } from "@/features/messages/MessageService";
import type { MessageCursor } from "@/features/messages/messageCursor";
import type { Message } from "@/types/domain";

const subscribeToChannel = vi.fn();
const fetchMessages = vi.fn();
const fetchOlderMessages = vi.fn();
const fetchMessagesSince = vi.fn();

vi.mock("@/features/messages/MessageService", () => ({
  messageService: {
    subscribeToChannel: (...args: unknown[]) => subscribeToChannel(...args),
    fetchMessages: (...args: unknown[]) => fetchMessages(...args),
    fetchOlderMessages: (...args: unknown[]) => fetchOlderMessages(...args),
    fetchMessagesSince: (...args: unknown[]) => fetchMessagesSince(...args),
  },
}));

vi.mock("@/services/publish", () => ({
  signAndPublish: vi.fn(),
  signAndPublishWithResponse: vi.fn(),
}));

const { Kind41010Transport } = await import("@/features/dm/Kind41010Transport");

function message(id: string, createdAt: number): Message {
  return {
    id,
    channelId: "dm-1",
    authorPubkey: "a".repeat(64),
    content: id,
    createdAt,
    thread: {},
    mentions: [],
    reactions: [],
    attachments: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
  };
}

function page(messages: Message[] = []): TimelinePage {
  return { messages, edits: [], deletes: [] };
}

describe("Phase 4E — DM timeline rides the channel machinery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribeToChannel.mockReturnValue({ close: vi.fn() });
  });

  it("subscribes with the caller's `since`, not wall-clock now", () => {
    // The 4A fix: anchoring to the newest event held closes the window between
    // the history fetch completing and the socket opening. Passing Date.now()
    // here — as this transport used to — loses anything that lands in it.
    const transport = new Kind41010Transport();
    transport.subscribe("dm-1", 1_700_000_042, () => {});

    expect(subscribeToChannel).toHaveBeenCalledTimes(1);
    expect(subscribeToChannel.mock.calls[0][0]).toBe("dm-1");
    expect(subscribeToChannel.mock.calls[0][1]).toBe(1_700_000_042);
  });

  it("forwards edit and delete events instead of dropping them", () => {
    // Pre-4E this callback filtered to `event.type === "message"`, so a DM
    // showed stale text forever after an edit and kept rendering deleted rows.
    const seen: TimelineEvent[] = [];
    const transport = new Kind41010Transport();
    transport.subscribe("dm-1", 0, (event) => seen.push(event));

    const emit = subscribeToChannel.mock.calls[0][2] as (e: TimelineEvent) => void;
    emit({ type: "message", message: message("m1", 10) });
    emit({
      type: "edit",
      edit: {
        eventId: "e1",
        targetId: "m1",
        authorPubkey: "a".repeat(64),
        content: "edited",
        createdAt: 11,
      },
    });
    emit({
      type: "delete",
      del: { targetId: "m1", authorPubkey: "a".repeat(64), isAdminDelete: false },
    });

    expect(seen.map((e) => e.type)).toEqual(["message", "edit", "delete"]);
  });

  it("returns the whole page from fetchHistory, so overlays survive the initial load", async () => {
    // Returning only `.messages` would drop an edit that arrived in the same
    // page as its target — routine, since history and overlays share a filter.
    const withOverlay: TimelinePage = {
      messages: [message("m1", 10)],
      edits: [
        {
          eventId: "e1",
          targetId: "m1",
          authorPubkey: "a".repeat(64),
          content: "edited",
          createdAt: 11,
        },
      ],
      deletes: [],
    };
    fetchMessages.mockResolvedValue(withOverlay);

    const result = await new Kind41010Transport().fetchHistory("dm-1");

    expect(result.edits).toHaveLength(1);
    expect(result.messages).toHaveLength(1);
  });

  it("pages older history by keyset cursor, never a bare `until`", async () => {
    const cursor: MessageCursor = { createdAt: 500, id: "m9" };
    fetchOlderMessages.mockResolvedValue(page([message("m0", 499)]));

    await new Kind41010Transport().fetchOlder("dm-1", cursor);

    expect(fetchOlderMessages).toHaveBeenCalledWith("dm-1", cursor);
  });

  it("backfills a reconnect gap from `since`", async () => {
    fetchMessagesSince.mockResolvedValue(page([message("m5", 900)]));

    await new Kind41010Transport().fetchSince("dm-1", 880);

    expect(fetchMessagesSince).toHaveBeenCalledWith("dm-1", 880);
  });
});
