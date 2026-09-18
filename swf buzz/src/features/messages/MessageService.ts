import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import {
  buildMessageEvent,
  isRenderableMessageKind,
  isSystemMessageKind,
  parseMessageEvent,
  parseSystemMessageEvent,
  type BuildMessageParams,
} from "@/protocol/messages";
import { KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2, KIND_SYSTEM_MESSAGE } from "@/protocol/kinds";
import type { RawNostrEvent } from "@/protocol/types";
import type { Message } from "@/types/domain";

const CHANNEL_TIMELINE_KINDS = [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2, KIND_SYSTEM_MESSAGE];

/** Turns a relay-emitted kind:40099 payload into a renderable (non-attributable) timeline entry. */
function systemMessageSummary(payload: Record<string, unknown>): string {
  const type = typeof payload.type === "string" ? payload.type : "update";
  switch (type) {
    case "member_joined":
      return "A member joined the channel.";
    case "member_left":
      return "A member left the channel.";
    case "topic_changed":
      return "The channel topic was changed.";
    default:
      return type.replace(/_/g, " ");
  }
}

function toDomainEvent(event: RawNostrEvent): Message | null {
  if (isRenderableMessageKind(event.kind)) {
    return parseMessageEvent(event);
  }
  if (isSystemMessageKind(event.kind)) {
    const parsed = parseSystemMessageEvent(event);
    if (!parsed) return null;
    return {
      id: event.id,
      channelId: parsed.channelId,
      authorPubkey: event.pubkey,
      content: systemMessageSummary(parsed.payload),
      createdAt: event.created_at,
      thread: {},
      mentions: [],
      reactions: [],
      status: "sent",
      isSystemMessage: true,
      isAgentMessage: false,
    };
  }
  return null;
}

class MessageService {
  async fetchMessages(channelId: string, limit = 100): Promise<Message[]> {
    const events = await fetchEventsOnce([
      { kinds: CHANNEL_TIMELINE_KINDS, "#h": [channelId], limit },
    ]);
    return events
      .map(toDomainEvent)
      .filter((m): m is Message => m !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  subscribeToChannel(
    channelId: string,
    onMessage: (message: Message) => void,
  ): RelaySubscriptionHandle {
    return relayConnectionService.subscribe(
      "channel-messages-live",
      [{ kinds: CHANNEL_TIMELINE_KINDS, "#h": [channelId], since: Math.floor(Date.now() / 1000) }],
      {
        onEvent: (event) => {
          const message = toDomainEvent(event);
          if (message) onMessage(message);
        },
      },
    );
  }

  /** Signs and publishes a message; caller (useSendMessage) handles optimistic UI. */
  async send(params: BuildMessageParams): Promise<Message> {
    const signed = await signAndPublish(buildMessageEvent(params));
    return parseMessageEvent(signed);
  }
}

export const messageService = new MessageService();
