/**
 * The only DmTransport implementation today — the verified live path per
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §8a: kind:41010 opens/finds a DM
 * channel, then all traffic is the ordinary kind:9 message set scoped by `h`.
 * See docs/DECISIONS.md D1 for why this was chosen over NIP-17 gift-wrap.
 *
 * CONFIRMED 2026-09-23 against the OLD BUZZ source
 * (docs/PHASE_4_OLD_BUZZ_PROTOCOL_AUDIT.md §6.3): this is the path OLD BUZZ's
 * own clients ship — desktop `commands/dms.rs:36-84` and mobile
 * `channel_management_actions.dart:59-78` both build kind:41010. No client
 * anywhere constructs a kind:1059 gift-wrap; the only 1059 code in that tree is
 * an interop test and a mock relay. OLD BUZZ's docs say otherwise and are
 * stale — do not migrate this stack on the strength of them.
 */
import { AppError } from "@/services/errors";
import { signAndPublish, signAndPublishWithResponse } from "@/services/publish";
import {
  messageService,
  type TimelineEvent,
  type TimelinePage,
} from "@/features/messages/MessageService";
import type { MessageCursor } from "@/features/messages/messageCursor";
import { parseCommandResponse } from "@/protocol/commandResponse";
import { buildDmHideEvent, buildDmOpenEvent } from "@/protocol/dm";
import { buildMessageEvent, parseMessageEvent } from "@/protocol/messages";
import type { DmTransport } from "./DmTransport";
import type { Message } from "@/types/domain";
import type { Attachment } from "@/protocol/imeta";

interface DmOpenResponse {
  channel_id?: string;
}

export class Kind41010Transport implements DmTransport {
  async open(otherParticipantPubkeys: string[]): Promise<string> {
    const { okReason } = await signAndPublishWithResponse(
      buildDmOpenEvent(otherParticipantPubkeys),
    );
    const parsed = parseCommandResponse<DmOpenResponse>(okReason) ?? {};
    if (!parsed.channel_id) {
      // Carry the relay's own words in `cause`: without them this failure is
      // indistinguishable between "wrong wire format", "duplicate replay" and
      // "the relay said no for a reason it told us", which cost a full
      // debugging cycle once already.
      throw new AppError(
        "relay_rejected",
        "The server didn't return a conversation id for this DM.",
        new Error(`relay OK reason: ${JSON.stringify(okReason)}`),
      );
    }
    return parsed.channel_id;
  }

  async send(
    conversationId: string,
    content: string,
    mentionPubkeys?: string[],
    attachments?: Attachment[],
  ): Promise<Message> {
    const signed = await signAndPublish(
      buildMessageEvent({ channelId: conversationId, content, mentionPubkeys, attachments }),
    );
    return parseMessageEvent(signed);
  }

  async hide(conversationId: string): Promise<void> {
    await signAndPublish(buildDmHideEvent(conversationId));
  }

  /**
   * DM traffic is wire-identical to channel messages, so this reuses
   * `MessageService`'s subscription rather than opening a parallel one.
   *
   * Phase 4E closed two gaps left open here. `since` is now the caller's, so a
   * DM can anchor to the newest event it holds instead of wall-clock now — the
   * same fix 4A made for channels, and the same gap it closes (events landing
   * between the history fetch and the socket opening). And edit/delete events
   * are no longer dropped: 4B made this subscription carry them, a DM is a
   * channel so they are real here, and the DM read model now has the overlay
   * pipeline to apply them.
   */
  subscribe(conversationId: string, since: number, onEvent: (event: TimelineEvent) => void) {
    return messageService.subscribeToChannel(conversationId, since, onEvent);
  }

  fetchHistory(conversationId: string): Promise<TimelinePage> {
    return messageService.fetchMessages(conversationId);
  }

  fetchOlder(conversationId: string, cursor: MessageCursor): Promise<TimelinePage> {
    return messageService.fetchOlderMessages(conversationId, cursor);
  }

  fetchSince(conversationId: string, since: number): Promise<TimelinePage> {
    return messageService.fetchMessagesSince(conversationId, since);
  }
}
