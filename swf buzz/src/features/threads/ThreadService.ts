import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { parseMessageEvent, isRenderableMessageKind } from "@/protocol/messages";
import { buildThreadSummaryFilter, parseThreadSummaryEvent } from "@/protocol/threads";
import { KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2 } from "@/protocol/kinds";
import {
  CHANNEL_TIMELINE_KINDS,
  OVERLAY_KINDS,
  classifyTimelineEvent,
  splitTimeline,
  type TimelineEvent,
} from "@/features/messages/MessageService";
import { compareMessages } from "@/features/messages/messageCursor";
import type { EditOverlay, DeleteOverlay } from "@/features/messages/messageOverlay";
import type { Message, ThreadSummary } from "@/types/domain";

export interface ThreadData {
  root: Message | null;
  replies: Message[];
  summary: ThreadSummary | null;
  /**
   * Edit/delete records for the root and its replies, in the same shape the
   * channel timeline uses. Kept beside the messages rather than folded in, for
   * the same reason: an edit may arrive before its target.
   */
  edits: (EditOverlay & { eventId: string })[];
  deletes: DeleteOverlay[];
}

class ThreadService {
  /**
   * Root + all replies (direct and nested — any event whose thread markers
   * resolve to rootEventId), plus the edit/delete overlays that apply to them.
   *
   * Two round trips, not one, and the second is the point: replies are found by
   * `#e` against the **root**, but an edit or deletion of a *reply* carries
   * `e` = that reply's own id. A root-anchored query therefore returns replies
   * and modifications of the root, and is structurally blind to modifications of
   * the replies — which is exactly how the thread panel came to show stale text
   * after an edit and keep rendering deleted rows.
   */
  async fetchThread(rootEventId: string): Promise<ThreadData> {
    const [rootEvents, anchoredEvents, summaryEvents] = await Promise.all([
      fetchEventsOnce([
        { ids: [rootEventId], kinds: [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2] },
      ]),
      // Widened from message kinds to the full timeline set so the root's own
      // edits and deletions arrive with the replies rather than being filtered out.
      fetchEventsOnce([{ kinds: CHANNEL_TIMELINE_KINDS, "#e": [rootEventId] }]),
      fetchEventsOnce([buildThreadSummaryFilter(rootEventId)]),
    ]);

    const root = rootEvents[0] ? parseMessageEvent(rootEvents[0]) : null;
    const anchored = splitTimeline(anchoredEvents);
    const replies = anchoredEvents
      .filter((e) => isRenderableMessageKind(e.kind))
      .map(parseMessageEvent)
      .filter((m) => m.thread.rootId === rootEventId)
      .sort(compareMessages);
    const summary = summaryEvents[0] ? parseThreadSummaryEvent(summaryEvents[0]) : null;

    const replyOverlays =
      replies.length > 0
        ? splitTimeline(
            await fetchEventsOnce([
              { kinds: OVERLAY_KINDS, "#e": replies.map((m) => m.id) },
            ]),
          )
        : { messages: [], edits: [], deletes: [] };

    return {
      root,
      replies,
      summary,
      edits: [...anchored.edits, ...replyOverlays.edits],
      deletes: [...anchored.deletes, ...replyOverlays.deletes],
    };
  }

  /**
   * Batched reply-count lookup for many root messages at once (one relay
   * REQ with an array `#d` filter — Nostr filters support multiple tag
   * values natively) — used to show "N replies" under every visible
   * top-level message without a per-message round trip.
   */
  /**
   * Live thread updates: new replies *and* the edits/deletions that apply to
   * them.
   *
   * Filtered by `#h` (channel) rather than `#e` (root) deliberately. An edit of
   * a reply carries `e` = the reply's id, so a root-anchored filter cannot see
   * it, and anchoring to the reply ids instead would mean tearing down and
   * reopening the subscription every time a reply arrives — reintroducing the
   * miss-window that 4A closed. The channel filter is stable for the life of the
   * panel and is the same shape the channel timeline already uses.
   *
   * Overlays for messages outside this thread are still delivered; they are
   * harmless because overlays are keyed by target id and `renderTimeline` only
   * applies one when it matches a rendered row. Base messages, by contrast, are
   * filtered to the thread here — an unrelated channel message must not appear
   * among the replies.
   */
  subscribeToThread(
    rootEventId: string,
    channelId: string,
    since: number,
    onTimelineEvent: (event: TimelineEvent) => void,
  ): RelaySubscriptionHandle {
    return relayConnectionService.subscribe(
      "thread-live",
      [{ kinds: CHANNEL_TIMELINE_KINDS, "#h": [channelId], since }],
      {
        onEvent: (event) => {
          const classified = classifyTimelineEvent(event);
          if (!classified) return;
          if (classified.type === "message" && classified.message.thread.rootId !== rootEventId) {
            return;
          }
          onTimelineEvent(classified);
        },
      },
    );
  }
}

export const threadService = new ThreadService();
