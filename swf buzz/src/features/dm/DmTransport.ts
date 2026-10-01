/**
 * Protocol-agnostic DM transport boundary — see docs/DECISIONS.md D1.F.
 * `DmService` depends on this interface, never on a concrete transport or on
 * `src/protocol/dm.ts` directly, so the underlying protocol (kind:41010 today,
 * possibly NIP-17 gift-wrap for some conversations later) can change without
 * touching `DmService`'s callers or the UI.
 *
 * Phase 4E widened this from "messages only" to the full timeline shape the
 * channel side already uses. A DM conversation is a channel on the wire, so it
 * has the same three correctness requirements: edits/deletes must ride the same
 * filter as the messages they modify (4B), paging must use the `before_id`
 * keyset rather than a bare `until` (4A), and a reconnect must backfill from
 * the newest event actually held. Expressing that here — rather than leaving
 * `DmService` to reach past the transport into `MessageService` — keeps the
 * boundary meaningful: a future NIP-17 transport has to satisfy the same
 * contract instead of silently regressing DMs to the pre-4A behaviour.
 */
import type { Message } from "@/types/domain";
import type { RelaySubscriptionHandle } from "@/services/RelayConnectionService";
import type { TimelineEvent, TimelinePage } from "@/features/messages/MessageService";
import type { MessageCursor } from "@/features/messages/messageCursor";
import type { Attachment } from "@/protocol/imeta";

export interface DmTransport {
  /** Opens (or re-opens/unhides) a DM with the given other participants. Returns the conversation id. */
  open(otherParticipantPubkeys: string[]): Promise<string>;
  /**
   * `attachments` are already uploaded — upload happens before send, never
   * during it, so an abandoned draft never orphans a relay blob. A DM message
   * is wire-identical to a channel message, so these ride the same NIP-92
   * `imeta` tags; a transport that cannot carry them must say so rather than
   * accepting and dropping them.
   */
  send(
    conversationId: string,
    content: string,
    mentionPubkeys?: string[],
    attachments?: Attachment[],
  ): Promise<Message>;
  hide(conversationId: string): Promise<void>;
  /**
   * Live timeline. `since` is supplied by the caller so it can be anchored to
   * the newest event already held, closing the window between the history fetch
   * completing and the socket opening.
   */
  subscribe(
    conversationId: string,
    since: number,
    onEvent: (event: TimelineEvent) => void,
  ): RelaySubscriptionHandle;
  fetchHistory(conversationId: string): Promise<TimelinePage>;
  /** One page strictly older than `cursor` — keyset paging, never a bare `until`. */
  fetchOlder(conversationId: string, cursor: MessageCursor): Promise<TimelinePage>;
  /** Everything at or after `since` — the reconnect gap backfill. */
  fetchSince(conversationId: string, since: number): Promise<TimelinePage>;
}
