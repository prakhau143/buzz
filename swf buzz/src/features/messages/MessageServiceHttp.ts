/**
 * HTTP-backed channel messages, including thread replies (DECISIONS.md
 * D10, Phases 6/7 of `swf-buzz-backend`). Deliberately parallel to
 * `./MessageService.ts` (the old Nostr publish/subscribe version), not a
 * replacement — see `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §2's "build
 * alongside" sequencing. `sender_user_id` always comes from the caller's
 * session server-side; this module never sends one explicitly.
 */
import { apiRequest } from "@/services/ApiClient";

export interface HttpMessage {
  id: string;
  seq: number;
  channelId: string;
  senderUserId: string;
  content: string;
  parentMessageId: string | null;
  rootMessageId: string | null;
  depth: number;
  replyCount: number;
  descendantCount: number;
  lastReplyAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MessageDto {
  id: string;
  seq: number;
  channel_id: string;
  sender_user_id: string;
  content: string;
  parent_message_id: string | null;
  root_message_id: string | null;
  depth: number;
  reply_count: number;
  descendant_count: number;
  last_reply_at: string | null;
  created_at: string;
  updated_at: string;
}

export function messageFromDto(dto: MessageDto): HttpMessage {
  return {
    id: dto.id,
    seq: dto.seq,
    channelId: dto.channel_id,
    senderUserId: dto.sender_user_id,
    content: dto.content,
    parentMessageId: dto.parent_message_id,
    rootMessageId: dto.root_message_id,
    depth: dto.depth,
    replyCount: dto.reply_count,
    descendantCount: dto.descendant_count,
    lastReplyAt: dto.last_reply_at,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

class MessageServiceHttp {
  async send(channelId: string, content: string, parentMessageId?: string | null): Promise<HttpMessage> {
    const message = await apiRequest<MessageDto>(`/api/channels/${channelId}/messages`, {
      method: "POST",
      body: { content, parent_message_id: parentMessageId ?? null },
    });
    return messageFromDto(message);
  }

  /** Newest-first; pass the `seq` of the oldest item already loaded as `beforeSeq` to fetch the next (older) page. */
  async list(channelId: string, beforeSeq?: number, limit?: number): Promise<HttpMessage[]> {
    const params = new URLSearchParams();
    if (beforeSeq !== undefined) params.set("before_seq", String(beforeSeq));
    if (limit !== undefined) params.set("limit", String(limit));
    const qs = params.toString();
    const messages = await apiRequest<MessageDto[]>(
      `/api/channels/${channelId}/messages${qs ? `?${qs}` : ""}`,
    );
    return messages.map(messageFromDto);
  }
}

export const messageServiceHttp = new MessageServiceHttp();
