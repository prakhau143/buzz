/**
 * Relay I/O for conversation pins (kind:40004) — fetch, live subscription,
 * publish, and the one-shot fetch of a pinned message that is not loaded.
 * Rules live in `pinModel.ts`; this file only moves events.
 */
import { relayConnectionService, type RelaySubscriptionHandle } from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import { KIND_STREAM_MESSAGE_PINNED, RENDERABLE_MESSAGE_KINDS } from "@/protocol/kinds";
import { buildPinEvent, parsePinEvent, type PinAction, type PinEvent } from "@/protocol/pins";
import { isRenderableMessageKind, parseMessageEvent } from "@/protocol/messages";
import type { Message } from "@/types/domain";

/**
 * How many pin events to read per conversation. Each pin/unpin is one event,
 * so this is the conversation's recent pin HISTORY, not a count of pins; the
 * newest events decide the active pin, and older ones are only ever replaced.
 */
export const PIN_HISTORY_LIMIT = 100;

function parseAll(events: { kind: number }[]): PinEvent[] {
  return (events as Parameters<typeof parsePinEvent>[0][])
    .map(parsePinEvent)
    .filter((e): e is PinEvent => e !== null);
}

class PinService {
  async fetchPinEvents(conversationId: string): Promise<PinEvent[]> {
    const events = await fetchEventsOnce([
      { kinds: [KIND_STREAM_MESSAGE_PINNED], "#h": [conversationId], limit: PIN_HISTORY_LIMIT },
    ]);
    return parseAll(events).filter((e) => e.conversationId === conversationId);
  }

  /** Live pin changes. Re-issued by the connection service after a reconnect. */
  subscribe(conversationId: string, since: number, onPin: (event: PinEvent) => void): RelaySubscriptionHandle {
    return relayConnectionService.subscribe(
      "conversation-pins",
      [{ kinds: [KIND_STREAM_MESSAGE_PINNED], "#h": [conversationId], since }],
      {
        onEvent: (raw) => {
          const parsed = parsePinEvent(raw);
          if (parsed && parsed.conversationId === conversationId) onPin(parsed);
        },
      },
    );
  }

  /** Publishes a pin or unpin; resolves with the signed event as the model sees it. */
  async publish(params: {
    conversationId: string;
    messageId: string;
    action: PinAction;
    messageAuthor?: string | null;
  }): Promise<PinEvent> {
    const signed = await signAndPublish(buildPinEvent(params));
    const parsed = parsePinEvent(signed);
    if (!parsed) throw new Error("pin event failed to round-trip");
    return parsed;
  }

  /**
   * A pinned message that is outside the loaded window — by id, scoped to its
   * conversation (`#h`), so the relay's own read gate applies. Null when the
   * relay has nothing (deleted, or not readable by this user).
   */
  async fetchMessage(conversationId: string, messageId: string): Promise<Message | null> {
    const events = await fetchEventsOnce([
      { ids: [messageId], kinds: [...RENDERABLE_MESSAGE_KINDS], "#h": [conversationId], limit: 1 },
    ]);
    const event = events.find((e) => e.id === messageId && isRenderableMessageKind(e.kind));
    return event ? parseMessageEvent(event) : null;
  }
}

export const pinService = new PinService();
