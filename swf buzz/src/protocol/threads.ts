/**
 * Thread read-side overlays — relay-synthesized, parameterized-replaceable,
 * never client-submitted. docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §9.
 * Reply composition itself lives in protocol/nip10.ts (buildReplyTags) since
 * it's shared with typing indicators.
 */
import type { ThreadSummary } from "@/types/domain";
import { KIND_THREAD_SUMMARY } from "./kinds";
import { firstTagValue, type NostrFilter, type RawNostrEvent } from "./types";

export function buildThreadSummaryFilter(rootEventId: string): NostrFilter {
  // Filter by #d only: kind:39005 is parameterized-replaceable (NIP-33), so `d`
  // is its guaranteed identifying tag. The reference doc's "e/d = root event
  // id" doesn't confirm both are always set together — ANDing #e and #d here
  // previously meant this silently matched nothing whenever only one was set.
  return { kinds: [KIND_THREAD_SUMMARY], "#d": [rootEventId], limit: 1 };
}

interface ThreadSummaryContent {
  reply_count: number;
  descendant_count?: number;
  last_reply_at?: number;
  participants?: string[];
}

export function parseThreadSummaryEvent(event: RawNostrEvent): ThreadSummary | null {
  const rootId = firstTagValue(event, "d") ?? firstTagValue(event, "e");
  if (!rootId) return null;
  try {
    const content = JSON.parse(event.content) as ThreadSummaryContent;
    return {
      rootId,
      replyCount: content.reply_count ?? 0,
      lastReplyAt: content.last_reply_at,
      participants: content.participants ?? [],
    };
  } catch {
    return null;
  }
}
