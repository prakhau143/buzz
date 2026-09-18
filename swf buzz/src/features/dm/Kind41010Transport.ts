/**
 * The only DmTransport implementation today — the verified live path per
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §8a: kind:41010 opens/finds a DM
 * channel, then all traffic is the ordinary kind:9 message set scoped by `h`.
 * See docs/DECISIONS.md D1 for why this was chosen over NIP-17 gift-wrap.
 */
import { AppError } from "@/services/errors";
import { signAndPublish, signAndPublishWithResponse } from "@/services/publish";
import { messageService } from "@/features/messages/MessageService";
import { buildDmHideEvent, buildDmOpenEvent } from "@/protocol/dm";
import { buildMessageEvent, parseMessageEvent } from "@/protocol/messages";
import type { DmTransport } from "./DmTransport";
import type { Message } from "@/types/domain";

interface DmOpenResponse {
  channel_id?: string;
}

export class Kind41010Transport implements DmTransport {
  async open(otherParticipantPubkeys: string[]): Promise<string> {
    const { okReason } = await signAndPublishWithResponse(
      buildDmOpenEvent(otherParticipantPubkeys),
    );
    let parsed: DmOpenResponse = {};
    try {
      parsed = JSON.parse(okReason) as DmOpenResponse;
    } catch {
      // Some relays may echo a non-JSON reason on success; fall through to the error below.
    }
    if (!parsed.channel_id) {
      throw new AppError(
        "relay_rejected",
        "The server didn't return a conversation id for this DM.",
      );
    }
    return parsed.channel_id;
  }

  async send(conversationId: string, content: string, mentionPubkeys?: string[]): Promise<Message> {
    const signed = await signAndPublish(
      buildMessageEvent({ channelId: conversationId, content, mentionPubkeys }),
    );
    return parseMessageEvent(signed);
  }

  async hide(conversationId: string): Promise<void> {
    await signAndPublish(buildDmHideEvent(conversationId));
  }

  subscribe(conversationId: string, onMessage: (message: Message) => void) {
    // DM traffic is wire-identical to channel messages — reuse MessageService's subscription.
    return messageService.subscribeToChannel(conversationId, onMessage);
  }

  fetchHistory(conversationId: string) {
    return messageService.fetchMessages(conversationId);
  }
}
