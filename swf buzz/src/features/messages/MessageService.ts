import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { queryRelayBridge } from "@/services/relayBridgeQuery";
import { signAndPublish } from "@/services/publish";
import {
  buildMessageDeleteEvent,
  buildMessageEditEvent,
  buildMessageEvent,
  editOrDeleteTargetId,
  hasEveryoneMentionTag,
  isMessageDeleteKind,
  isMessageEditKind,
  isRenderableMessageKind,
  isSystemMessageKind,
  parseMessageEvent,
  parseSystemMessageEvent,
  type BuildMessageParams,
} from "@/protocol/messages";
import {
  KIND_DELETION,
  KIND_NIP29_DELETE_EVENT,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_STREAM_MESSAGE_V2,
  KIND_SYSTEM_MESSAGE,
  KIND_WINDOW_BOUNDS,
  KIND_THREAD_SUMMARY,
} from "@/protocol/kinds";
import type { RawNostrEvent } from "@/protocol/types";
import type { Message, ThreadSummary } from "@/types/domain";
import { parseThreadSummaryEvent } from "@/protocol/threads";
import { compareMessages, type MessageCursor } from "./messageCursor";
import { RECONNECT_REPLAY_PAGE_LIMIT } from "./reconnectRepair";
import type { EditOverlay, DeleteOverlay } from "./messageOverlay";

/**
 * Kinds the channel timeline subscribes to.
 *
 * Edits and deletions are part of this set, not a separate subscription: they
 * must travel the same `#h` filter, the same pagination cursor and the same
 * reconnect backfill as the messages they modify. A second subscription would
 * reintroduce exactly the gap class 4A closed — an edit could be missed while a
 * message was not, leaving stale text on screen indefinitely.
 */
export const CHANNEL_TIMELINE_KINDS = [
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
  KIND_SYSTEM_MESSAGE,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_DELETION,
  KIND_NIP29_DELETE_EVENT,
];

/**
 * Overlay kinds alone — edits and deletions without the base messages.
 *
 * Used where the base rows are already known and only their modifications are
 * still outstanding: the thread panel fetches its replies by `#e` against the
 * root, but an edit of a *reply* carries `e` = that reply's id, so it is invisible
 * to the root-anchored query and has to be asked for by target id.
 */
export const OVERLAY_KINDS = [KIND_STREAM_MESSAGE_EDIT, KIND_DELETION, KIND_NIP29_DELETE_EVENT];

/** One timeline event, already classified as a message or as an overlay. */
export type TimelineEvent =
  | { type: "message"; message: Message }
  | { type: "edit"; edit: EditOverlay & { eventId: string } }
  | { type: "delete"; del: DeleteOverlay };

export function classifyTimelineEvent(event: RawNostrEvent): TimelineEvent | null {
  if (isMessageEditKind(event.kind)) {
    const targetId = editOrDeleteTargetId(event);
    if (!targetId) return null;
    return {
      type: "edit",
      edit: {
        eventId: event.id,
        targetId,
        authorPubkey: event.pubkey,
        content: event.content,
        createdAt: event.created_at,
        ...(hasEveryoneMentionTag(event) ? { mentionsEveryone: true } : {}),
      },
    };
  }
  if (isMessageDeleteKind(event.kind)) {
    const targetId = editOrDeleteTargetId(event);
    if (!targetId) return null;
    return {
      type: "delete",
      del: {
        targetId,
        authorPubkey: event.pubkey,
        isAdminDelete: event.kind === KIND_NIP29_DELETE_EVENT,
      },
    };
  }
  const message = toDomainEvent(event);
  return message ? { type: "message", message } : null;
}

/** Turns a relay-emitted kind:40099 payload into a renderable (non-attributable) timeline entry. */
function systemMessageSummary(payload: Record<string, unknown>): string {
  const type = typeof payload.type === "string" ? payload.type : "update";
  switch (type) {
    case "member_joined":
      return "A member joined the channel.";
    case "member_left":
      return "A member left the channel.";
    case "topic_changed":
      return "The channel topic was changed.";
    default:
      return type.replace(/_/g, " ");
  }
}

function toDomainEvent(event: RawNostrEvent): Message | null {
  if (isRenderableMessageKind(event.kind)) {
    return parseMessageEvent(event);
  }
  if (isSystemMessageKind(event.kind)) {
    const parsed = parseSystemMessageEvent(event);
    if (!parsed) return null;
    return {
      id: event.id,
      channelId: parsed.channelId,
      authorPubkey: event.pubkey,
      content: systemMessageSummary(parsed.payload),
      createdAt: event.created_at,
      thread: {},
      mentions: [],
      reactions: [],
      // Relay-authored: a system message never carries user attachments.
      attachments: [],
      status: "sent",
      isSystemMessage: true,
      isAgentMessage: false,
    };
  }
  return null;
}

/** A page of timeline events, split into base messages and overlay records. */
export interface TimelinePage {
  messages: Message[];
  edits: (EditOverlay & { eventId: string })[];
  deletes: DeleteOverlay[];
  /**
   * From the relay-signed kind:39006 window bounds (channel-window pages only):
   * whether older top-level rows exist, and the keyset cursor to ask for them.
   * Undefined for pages that did not come from the channel window.
   */
  hasMore?: boolean;
  nextCursor?: MessageCursor | null;
  /** The relay's thread summaries (kind 39005) for rows on this page that have replies. */
  summaries?: ThreadSummary[];
}

/**
 * Row kinds of the channel window — what counts as a timeline row. Edits,
 * deletions and reactions are NOT rows: they have no thread metadata, so the
 * relay would count each as a top-level row and a burst of deletions could fill
 * the whole page. They come back as `include_aux` events attached to the rows.
 * (OLD BUZZ's list also has workflow/job/huddle kinds SWF does not render.)
 */
export const CHANNEL_WINDOW_ROW_KINDS = [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2, KIND_SYSTEM_MESSAGE];

/** The kind:39006 content: `{has_more, next_cursor: {created_at, id}}`. */
function parseWindowBounds(events: RawNostrEvent[]): Pick<TimelinePage, "hasMore" | "nextCursor"> {
  const bounds = events.find((e) => e.kind === KIND_WINDOW_BOUNDS);
  if (!bounds) return {};
  try {
    const parsed = JSON.parse(bounds.content) as {
      has_more?: unknown;
      next_cursor?: { created_at?: unknown; id?: unknown } | null;
    };
    const c = parsed.next_cursor;
    return {
      hasMore: parsed.has_more === true,
      nextCursor:
        c && typeof c.created_at === "number" && typeof c.id === "string"
          ? { createdAt: c.created_at, id: c.id }
          : null,
    };
  } catch {
    return {};
  }
}

export function splitTimeline(events: RawNostrEvent[]): TimelinePage {
  const page: TimelinePage = { messages: [], edits: [], deletes: [] };
  for (const event of events) {
    const classified = classifyTimelineEvent(event);
    if (!classified) continue;
    if (classified.type === "message") page.messages.push(classified.message);
    else if (classified.type === "edit") page.edits.push(classified.edit);
    else page.deletes.push(classified.del);
  }
  page.messages.sort(compareMessages);
  return page;
}

class MessageService {
  /**
   * One page of the channel's main timeline, exactly as OLD BUZZ asks for it
   * (desktop `commands/channel_window.rs`): the relay's channel window over the
   * HTTP bridge with `top_level: true`. Thread replies are excluded by the relay,
   * so `limit` counts real top-level rows. A plain REQ counted replies and
   * deletions toward the limit — a channel whose newest 50 events were thread
   * replies (SWF Project) rendered "No messages yet" with history on the server.
   */
  private async fetchChannelWindow(
    channelId: string,
    cursor: MessageCursor | null,
    limit: number,
  ): Promise<TimelinePage> {
    const events = await queryRelayBridge([
      {
        kinds: CHANNEL_WINDOW_ROW_KINDS,
        "#h": [channelId],
        limit,
        top_level: true,
        include_aux: true,
        // The relay's per-row thread summaries (kind 39005) — the only source of
        // reply counts for threads whose replies aren't loaded (i.e. after reload).
        include_summaries: true,
        ...(cursor ? { until: cursor.createdAt, before_id: cursor.id } : {}),
      },
    ]);
    const summaries = events
      .filter((e) => e.kind === KIND_THREAD_SUMMARY)
      .map(parseThreadSummaryEvent)
      .filter((s): s is ThreadSummary => s !== null);
    return { ...splitTimeline(events), ...parseWindowBounds(events), summaries };
  }

  async fetchMessages(channelId: string, limit = 50): Promise<TimelinePage> {
    return this.fetchChannelWindow(channelId, null, limit);
  }

  /**
   * Older-message page, by KEYSET cursor — `until` + `before_id`.
   *
   * This used to pass `until` alone and then drop every returned event with
   * `created_at >= until`. The relay's bare `until` is `created_at <= until`
   * (INCLUSIVE, `event.rs:638`), so that client-side filter threw away the
   * whole boundary second: with five messages sharing a second, four were lost
   * permanently, and a page made entirely of them came back "empty" and ended
   * history early.
   *
   * With `before_id` the relay excludes the boundary itself
   * (`event.rs:626-636`), so nothing is discarded here and an empty page is a
   * genuine empty result for the requested cursor. The channel window keeps
   * the same keyset (`bridge.rs` → `thread.rs:651-730`).
   */
  async fetchOlderMessages(
    channelId: string,
    cursor: MessageCursor,
    limit = 50,
  ): Promise<TimelinePage> {
    return this.fetchChannelWindow(channelId, cursor, limit);
  }

  /**
   * One-shot backfill of everything at or after `since` — the reconnect gap
   * repair. Overlap with what is already held is expected and harmless: the
   * caller merges by event id.
   */
  async fetchMessagesSince(
    channelId: string,
    since: number,
    limit = RECONNECT_REPLAY_PAGE_LIMIT,
  ): Promise<TimelinePage> {
    return splitTimeline(
      await fetchEventsOnce([{ kinds: CHANNEL_TIMELINE_KINDS, "#h": [channelId], since, limit }]),
    );
  }

  /**
   * Live subscription. `since` is a parameter rather than `Date.now()` so the
   * caller can anchor it to the newest message it actually holds — a fixed
   * mount-time `since` left a gap between the history fetch completing and the
   * subscription opening, and never advanced, so every reconnect replayed the
   * whole session.
   */
  subscribeToChannel(
    channelId: string,
    since: number,
    onTimelineEvent: (event: TimelineEvent) => void,
  ): RelaySubscriptionHandle {
    return relayConnectionService.subscribe(
      "channel-messages-live",
      [{ kinds: CHANNEL_TIMELINE_KINDS, "#h": [channelId], since }],
      {
        onEvent: (event) => {
          const classified = classifyTimelineEvent(event);
          if (classified) onTimelineEvent(classified);
        },
      },
    );
  }

  /** Signs and publishes a message; caller (useSendMessage) handles optimistic UI. */
  async send(params: BuildMessageParams): Promise<Message> {
    const signed = await signAndPublish(buildMessageEvent(params));
    return parseMessageEvent(signed);
  }

  /**
   * Publishes a kind:40003 edit. The relay is the authority on whether this is
   * permitted; a refusal surfaces as a rejected publish, which the caller shows
   * verbatim rather than silently swallowing.
   */
  async edit(params: {
    channelId: string;
    targetEventId: string;
    content: string;
    mentionPubkeys?: string[];
    mentionsEveryone?: boolean;
  }): Promise<EditOverlay & { eventId: string }> {
    const signed = await signAndPublish(buildMessageEditEvent(params));
    return {
      eventId: signed.id,
      targetId: params.targetEventId,
      authorPubkey: signed.pubkey,
      content: params.content,
      createdAt: signed.created_at,
      ...(params.mentionsEveryone ? { mentionsEveryone: true } : {}),
    };
  }

  /**
   * Publishes a deletion. `mode: "self"` is kind:5, `mode: "admin"` is kind:9005
   * — see `buildMessageDeleteEvent` for why the admin case cannot be kind:5.
   */
  async remove(params: {
    channelId: string;
    targetEventId: string;
    mode: "self" | "admin";
  }): Promise<DeleteOverlay> {
    const signed = await signAndPublish(buildMessageDeleteEvent(params));
    return {
      targetId: params.targetEventId,
      authorPubkey: signed.pubkey,
      isAdminDelete: params.mode === "admin",
    };
  }
}

export const messageService = new MessageService();
