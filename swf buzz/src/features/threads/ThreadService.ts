import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { parseMessageEvent, isRenderableMessageKind } from "@/protocol/messages";
import { buildThreadSummaryFilter, parseThreadSummaryEvent } from "@/protocol/threads";
import { KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2, KIND_THREAD_SUMMARY } from "@/protocol/kinds";
import type { Message, ThreadSummary } from "@/types/domain";

export interface ThreadData {
  root: Message | null;
  replies: Message[];
  summary: ThreadSummary | null;
}

class ThreadService {
  /** Root + all replies (direct and nested — any event whose thread markers resolve to rootEventId). */
  async fetchThread(rootEventId: string): Promise<ThreadData> {
    const [rootEvents, replyEvents, summaryEvents] = await Promise.all([
      fetchEventsOnce([
        { ids: [rootEventId], kinds: [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2] },
      ]),
      fetchEventsOnce([
        { kinds: [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2], "#e": [rootEventId] },
      ]),
      fetchEventsOnce([buildThreadSummaryFilter(rootEventId)]),
    ]);

    const root = rootEvents[0] ? parseMessageEvent(rootEvents[0]) : null;
    const replies = replyEvents
      .filter((e) => isRenderableMessageKind(e.kind))
      .map(parseMessageEvent)
      .filter((m) => m.thread.rootId === rootEventId)
      .sort((a, b) => a.createdAt - b.createdAt);
    const summary = summaryEvents[0] ? parseThreadSummaryEvent(summaryEvents[0]) : null;

    return { root, replies, summary };
  }

  /**
   * Batched reply-count lookup for many root messages at once (one relay
   * REQ with an array `#d` filter — Nostr filters support multiple tag
   * values natively) — used to show "N replies" under every visible
   * top-level message without a per-message round trip.
   */
  async fetchSummaries(rootEventIds: string[]): Promise<Map<string, ThreadSummary>> {
    if (rootEventIds.length === 0) return new Map();
    const events = await fetchEventsOnce([{ kinds: [KIND_THREAD_SUMMARY], "#d": rootEventIds }]);
    const byRoot = new Map<string, ThreadSummary>();
    for (const event of events) {
      const summary = parseThreadSummaryEvent(event);
      if (summary) byRoot.set(summary.rootId, summary);
    }
    return byRoot;
  }

  subscribeToThread(
    rootEventId: string,
    onReply: (message: Message) => void,
  ): RelaySubscriptionHandle {
    return relayConnectionService.subscribe(
      "thread-live",
      [
        {
          kinds: [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2],
          "#e": [rootEventId],
          since: Math.floor(Date.now() / 1000),
        },
      ],
      {
        onEvent: (event) => {
          const message = parseMessageEvent(event);
          if (message.thread.rootId === rootEventId) onReply(message);
        },
      },
    );
  }
}

export const threadService = new ThreadService();
