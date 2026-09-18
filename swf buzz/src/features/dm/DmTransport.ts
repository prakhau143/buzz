/**
 * Protocol-agnostic DM transport boundary — see docs/DECISIONS.md D1.F.
 * `DmService` depends on this interface, never on a concrete transport or on
 * `src/protocol/dm.ts` directly, so the underlying protocol (kind:41010 today,
 * possibly NIP-17 gift-wrap for some conversations later) can change without
 * touching `DmService`'s callers or the UI.
 */
import type { Message } from "@/types/domain";
import type { RelaySubscriptionHandle } from "@/services/RelayConnectionService";

export interface DmTransport {
  /** Opens (or re-opens/unhides) a DM with the given other participants. Returns the conversation id. */
  open(otherParticipantPubkeys: string[]): Promise<string>;
  send(conversationId: string, content: string, mentionPubkeys?: string[]): Promise<Message>;
  hide(conversationId: string): Promise<void>;
  subscribe(conversationId: string, onMessage: (message: Message) => void): RelaySubscriptionHandle;
  fetchHistory(conversationId: string): Promise<Message[]>;
}
