/**
 * HTTP-backed threads (DECISIONS.md D10, Phase 7 of `swf-buzz-backend`).
 * Deliberately parallel to `./ThreadService.ts` (the old NIP-10 version),
 * not a replacement — see `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §2. The
 * backend always computes `root_message_id`/`depth`/counters server-side
 * (see `swf buzz/docs/THREADS_DESIGN.md`); this module never does that math
 * itself.
 */
import { apiRequest } from "@/services/ApiClient";
import { messageFromDto, type HttpMessage } from "@/features/messages/MessageServiceHttp";

export interface HttpThreadSummary {
  rootMessageId: string;
  replyCount: number;
  descendantCount: number;
  lastReplyAt: string | null;
}

interface ThreadSummaryDto {
  root_message_id: string;
  reply_count: number;
  descendant_count: number;
  last_reply_at: string | null;
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

interface ThreadDto {
  root: MessageDto;
  replies: MessageDto[];
}

export interface HttpThread {
  root: HttpMessage;
  replies: HttpMessage[];
}

class ThreadServiceHttp {
  /** Replies are oldest-first — the natural reading order for a thread (opposite of the channel timeline). */
  async getThread(rootMessageId: string, afterSeq?: number, limit?: number): Promise<HttpThread> {
    const params = new URLSearchParams();
    if (afterSeq !== undefined) params.set("after_seq", String(afterSeq));
    if (limit !== undefined) params.set("limit", String(limit));
    const qs = params.toString();
    const thread = await apiRequest<ThreadDto>(
      `/api/messages/${rootMessageId}/thread${qs ? `?${qs}` : ""}`,
    );
    return {
      root: messageFromDto(thread.root),
      replies: thread.replies.map(messageFromDto),
    };
  }

  /** Best-effort batch lookup — silently omits ids that aren't threads / aren't visible to the caller. */
  async getThreadSummaries(rootMessageIds: string[]): Promise<HttpThreadSummary[]> {
    if (rootMessageIds.length === 0) return [];
    const summaries = await apiRequest<ThreadSummaryDto[]>(
      `/api/messages/thread-summaries?ids=${rootMessageIds.join(",")}`,
    );
    return summaries.map((s) => ({
      rootMessageId: s.root_message_id,
      replyCount: s.reply_count,
      descendantCount: s.descendant_count,
      lastReplyAt: s.last_reply_at,
    }));
  }
}

export const threadServiceHttp = new ThreadServiceHttp();
