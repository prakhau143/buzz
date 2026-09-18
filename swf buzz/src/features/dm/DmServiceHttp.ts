/**
 * HTTP-backed direct messages (DECISIONS.md D10, Phase 8 of
 * `swf-buzz-backend`). Deliberately parallel to `./DmService.ts` (the old
 * `kind:41010`/`DmTransport` version), not a replacement — see
 * `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §2's "build alongside, verify, delete
 * old code only after everything is migrated" sequencing.
 *
 * Not implemented as a new `DmTransport` implementation: that interface's
 * `subscribe()` returns a `RelaySubscriptionHandle` (a Nostr-relay-specific
 * type) and its `Message`/pubkey-shaped domain types don't fit this
 * backend's `userId`-keyed model or `RealtimeService`'s plain
 * subscribe/unsubscribe-function shape. Forcing a fit would mean either
 * changing `DmTransport` (risking the still-working `Kind41010Transport`)
 * or wrapping incompatible types — a parallel service is the same call F3
 * made for channels, for the same reason.
 *
 * `sender_user_id` always comes from the caller's session server-side; this
 * module never sends one explicitly. `open()` requires the caller to
 * include their own id in the participant set — the backend rejects a call
 * that doesn't (`backend/src/routes/dm.rs::open_dm`).
 */
import { apiRequest } from "@/services/ApiClient";

export interface HttpDmConversation {
  id: string;
  participantIds: string[];
  createdAt: string;
}

export interface HttpDmMessage {
  id: string;
  seq: number;
  conversationId: string;
  senderUserId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface DmConversationDto {
  id: string;
  participant_ids: string[];
  created_at: string;
}

interface DmMessageDto {
  id: string;
  seq: number;
  conversation_id: string;
  sender_user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function dmConversationFromDto(dto: DmConversationDto): HttpDmConversation {
  return { id: dto.id, participantIds: dto.participant_ids, createdAt: dto.created_at };
}

export function dmMessageFromDto(dto: DmMessageDto): HttpDmMessage {
  return {
    id: dto.id,
    seq: dto.seq,
    conversationId: dto.conversation_id,
    senderUserId: dto.sender_user_id,
    content: dto.content,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

class DmServiceHttp {
  /** Idempotent find-or-create by exact participant set — `userIds` must include the caller. */
  async open(userIds: string[]): Promise<HttpDmConversation> {
    const conversation = await apiRequest<DmConversationDto>("/api/dm/open", {
      method: "POST",
      body: { user_ids: userIds },
    });
    return dmConversationFromDto(conversation);
  }

  /** The caller's own conversations, newest-created first. */
  async listConversations(): Promise<HttpDmConversation[]> {
    const conversations = await apiRequest<DmConversationDto[]>("/api/dm");
    return conversations.map(dmConversationFromDto);
  }

  async send(conversationId: string, content: string): Promise<HttpDmMessage> {
    const message = await apiRequest<DmMessageDto>(`/api/dm/${conversationId}/messages`, {
      method: "POST",
      body: { content },
    });
    return dmMessageFromDto(message);
  }

  /** Newest-first; pass the `seq` of the oldest item already loaded as `beforeSeq` to fetch the next (older) page. */
  async listMessages(conversationId: string, beforeSeq?: number, limit?: number): Promise<HttpDmMessage[]> {
    const params = new URLSearchParams();
    if (beforeSeq !== undefined) params.set("before_seq", String(beforeSeq));
    if (limit !== undefined) params.set("limit", String(limit));
    const qs = params.toString();
    const messages = await apiRequest<DmMessageDto[]>(`/api/dm/${conversationId}/messages${qs ? `?${qs}` : ""}`);
    return messages.map(dmMessageFromDto);
  }
}

export const dmServiceHttp = new DmServiceHttp();
