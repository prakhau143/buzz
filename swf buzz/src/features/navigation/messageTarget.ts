import type { RouteLocationRaw } from "vue-router";
import type { NotificationTarget } from "@/features/notifications/notificationEngine";
import type { InboxItem } from "@/features/inbox/inboxModel";
import { KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2 } from "@/protocol/kinds";

/**
 * THE deep-link target: where a message lives and which message to reveal.
 * One model for every entry point — Inbox rows, notification clicks, and any
 * later surface — so each is resolved, validated and routed the same way.
 *
 * `threadRootId` is set only when the target is a REPLY (it differs from the
 * message); a root message is revealed in its conversation feed, where it
 * carries its thread summary.
 */
export interface MessageTarget {
  /** Community relay URL; null = the community already open. */
  community: string | null;
  kind: "channel" | "dm";
  /** Channel id, or DM conversation id. */
  conversationId: string;
  messageId: string | null;
  threadRootId: string | null;
  source: "inbox" | "notification" | "mention" | "thread-reply" | "search" | "other";
}

const HEX = /^[0-9a-f]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const RELAY = /^wss?:\/\/[^\s]+$/i;
const id = (v: unknown): string | null => (typeof v === "string" && (HEX.test(v) || SAFE_ID.test(v)) ? v : null);

/** Validate and normalise; anything incomplete or malformed is `null` — never routed, never guessed. */
export function normalizeMessageTarget(input: {
  community?: unknown;
  kind?: unknown;
  conversationId?: unknown;
  messageId?: unknown;
  threadRootId?: unknown;
  source?: MessageTarget["source"];
}): MessageTarget | null {
  if (input.kind !== "channel" && input.kind !== "dm") return null;
  const conversationId = id(input.conversationId);
  if (!conversationId) return null;
  let community: string | null = null;
  if (input.community !== undefined && input.community !== null) {
    if (typeof input.community !== "string" || !RELAY.test(input.community)) return null;
    community = input.community;
  }
  const messageId = id(input.messageId);
  const root = id(input.threadRootId);
  // A reply needs to know which message it is; a root "reply to itself" is just the root.
  const threadRootId = root && messageId && root !== messageId ? root : null;
  return { community, kind: input.kind, conversationId, messageId, threadRootId, source: input.source ?? "other" };
}

export function fromNotificationTarget(t: NotificationTarget): MessageTarget | null {
  if (t.kind === "inbox") return null;
  return normalizeMessageTarget({
    community: t.community,
    kind: t.kind,
    conversationId: t.channelId,
    messageId: t.messageId,
    threadRootId: t.threadRootId,
    source: "notification",
  });
}

const MESSAGE_KINDS: ReadonlySet<number> = new Set([KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2]);

/**
 * An Inbox row's target (the feed belongs to the open community). Only chat
 * messages have a message to reveal; other events with a conversation (e.g.
 * an approval request) open the conversation itself.
 */
export function fromInboxItem(item: InboxItem): MessageTarget | null {
  if (!item.channelId) return null;
  const isMessage = MESSAGE_KINDS.has(item.event.kind);
  return normalizeMessageTarget({
    community: null,
    kind: item.type === "dm" ? "dm" : "channel",
    conversationId: item.channelId,
    messageId: isMessage ? item.event.id : null,
    threadRootId: isMessage ? item.rootId : null,
    source: item.rootId ? "thread-reply" : item.mentionsMe ? "mention" : "inbox",
  });
}

/**
 * A message search hit's target (NIP-50 search runs in the open community).
 * The hit carries its conversation (`h`) and thread markers; whether that
 * conversation is a DM comes from the caller's DM list.
 */
export function fromSearchHit(hit: { channelId: string; message: { id: string; thread: { rootId?: string } } }, isDm: boolean): MessageTarget | null {
  return normalizeMessageTarget({
    community: null,
    kind: isDm ? "dm" : "channel",
    conversationId: hit.channelId,
    messageId: hit.message.id,
    threadRootId: hit.message.thread.rootId ?? null,
    source: "search",
  });
}

/** The desktop route — the existing `?messageId=&threadRootId=` reveal contract of ChannelsView / DmView. */
export function desktopRoute(t: MessageTarget): RouteLocationRaw {
  const reveal: Record<string, string> = {
    ...(t.messageId ? { messageId: t.messageId } : {}),
    ...(t.threadRootId ? { threadRootId: t.threadRootId } : {}),
  };
  return t.kind === "dm"
    ? { name: "dm", query: { conversationId: t.conversationId, ...reveal } }
    : { name: "channels", query: { channelId: t.conversationId, ...reveal } };
}

/**
 * The mobile route: a reply opens its thread page, anything else its
 * conversation; `?m=` is the message to reveal (removed once revealed).
 */
export function mobileRoute(t: MessageTarget): RouteLocationRaw {
  const query = t.messageId ? { m: t.messageId } : {};
  if (t.kind === "dm") {
    return t.threadRootId
      ? { name: "mobile-dm-thread", params: { conversationId: t.conversationId, rootId: t.threadRootId }, query }
      : { name: "mobile-dm", params: { conversationId: t.conversationId }, query };
  }
  return t.threadRootId
    ? { name: "mobile-thread", params: { channelId: t.conversationId, rootId: t.threadRootId }, query }
    : { name: "mobile-channel", params: { channelId: t.conversationId }, query };
}
