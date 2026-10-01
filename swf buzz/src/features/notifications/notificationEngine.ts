import type { Message } from "@/types/domain";
import { parseWaveMessageContent } from "@/features/dm/wave";
import { messageMentionsMe } from "@/features/mentions/everyone";
import type { NotificationSlot } from "./notificationSettings";

/**
 * The one notification pipeline: CLASSIFY (what kind of event is this for me?)
 * → POLICY (fresh? not already alerted? allowed by settings?) → ACTION (native
 * toast via `desktopNotifier.deliverAlert`). Everything here is pure, so the
 * rules are unit-tested without a relay, a window or an OS.
 *
 * Safety: titles/previews are built from public profile names and message text
 * only; a toast's click target carries ids (community URL, channel, message,
 * thread root) — never a key, token or auth material — and nothing here logs.
 */

/** Messages older than this are history (a reconnect replay), never an alert. */
export const FRESHNESS_WINDOW_SECONDS = 120;
/** Longest preview shown in a toast body. */
export const PREVIEW_MAX = 140;

export interface ClassifyContext {
  /** My pubkey (the signed-in identity). */
  me: string | null;
  /** Whether `message.channelId` is one of my DM conversations. */
  isDm: boolean;
}

/** Which alert (if any) an incoming message is for me. */
export function classifyMessage(message: Message, ctx: ClassifyContext): NotificationSlot | null {
  if (!ctx.me || message.authorPubkey === ctx.me) return null;
  if (message.isSystemMessage) return null;
  if (ctx.isDm) return "dm";
  // A name mention OR the channel's @everyone (semantic tag only — never text).
  // Access needs no check here: this message reached us through a subscription
  // the relay already gated, so only people who can read the channel get here.
  if (!messageMentionsMe(message, ctx.me, { isDm: false })) return null;
  const isReply = message.thread.rootId !== undefined && message.thread.rootId !== message.id;
  return isReply ? "thread_reply" : "mention";
}

/** Recent enough to alert about (with some tolerance for a clock ahead of ours). */
export function isFresh(createdAt: number, nowSeconds = Math.floor(Date.now() / 1000), window = FRESHNESS_WINDOW_SECONDS): boolean {
  return createdAt >= nowSeconds - window;
}

/**
 * Remembers what has already been alerted, so a relay re-delivering an event
 * (reconnect, resubscribe, the same event from two subscriptions) never shows a
 * second toast. Scoped per identity + community by its keys; bounded.
 */
export class NotificationLedger {
  private seen = new Set<string>();
  constructor(private readonly cap = 1000) {}

  /** True the first time a key is claimed, false for every repeat. */
  claim(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > this.cap) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}

export const ledgerKey = (identity: string, community: string, eventId: string) => `${identity}|${community}|${eventId}`;

const NOSTR_REF = /nostr:(npub1|nprofile1)[02-9ac-hj-np-z]+/gi;
const NOSTR_EVENT_REF = /nostr:(note1|nevent1|naddr1)[02-9ac-hj-np-z]+/gi;
/** Secret key material must never reach an OS notification centre (it is persisted there). */
const SECRET = /\b(nsec1|ncryptsec1)[02-9ac-hj-np-z]+/gi;
const URL_RE = /https?:\/\/\S+/gi;
const IMAGE_URL = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?\S*)?$/i;

/**
 * Plain, short, safe toast text: the wave card's sentence instead of its marker;
 * markdown, HTML comments and code fences removed; mentions shown as names;
 * links shortened to their host; secret-looking keys hidden; one line; ≤ 140.
 */
export function safePreview(
  content: string,
  opts: { nameOf?: (npubOrProfile: string) => string | null; attachments?: number; max?: number } = {},
): string {
  const max = opts.max ?? PREVIEW_MAX;
  const wave = parseWaveMessageContent(content);
  let text = wave ? wave.text : content;
  text = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(SECRET, "[hidden]")
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? `[image: ${alt}]` : "[image]"))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(NOSTR_REF, (ref) => `@${opts.nameOf?.(ref.slice("nostr:".length)) ?? "someone"}`)
    .replace(NOSTR_EVENT_REF, "[link]")
    .replace(URL_RE, (url) => {
      if (IMAGE_URL.test(url)) return "[image]";
      try {
        return new URL(url).host;
      } catch {
        return "[link]";
      }
    })
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$)/g, "$1$2")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    if (opts.attachments) return opts.attachments === 1 ? "Sent an attachment" : `Sent ${opts.attachments} attachments`;
    return "New message";
  }
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * The toast title. Windows already shows "SWF Buzz" as the app header, so the
 * title names the person (and where): DM → "Devankit"; mention / thread reply
 * → "Devankit · #release"; needs-action → "SWF Buzz" (the sender goes in the
 * body, see `needsActionBody`).
 */
export function notificationTitle(slot: NotificationSlot, author: string, channelName?: string | null): string {
  switch (slot) {
    case "dm":
      return author;
    case "mention":
    case "thread_reply":
      return channelName ? `${author} · #${channelName}` : author;
    case "needs_action":
      return "SWF Buzz";
  }
}

export function needsActionBody(author: string, preview: string, reminder = false): string {
  return reminder ? `Reminder: ${preview}` : `${author} needs your action: ${preview}`;
}

/** The in-app card's context line ("#release · Thread reply"). */
export function notificationContext(slot: NotificationSlot, channelName?: string | null, reminder = false): string {
  const where = channelName ? `#${channelName}` : "Channel";
  switch (slot) {
    case "dm":
      return "Direct message";
    case "mention":
      return `${where} · Mentioned you`;
    case "thread_reply":
      return `${where} · Thread reply`;
    case "needs_action":
      return reminder ? "Reminder" : "Needs your action";
  }
}

/**
 * Where a click on the toast should land. Ids only; `identity` is a short
 * public-key FINGERPRINT (not a key) so a toast from a previous identity is
 * ignored rather than routed into another account. Every value is a string —
 * the native layer rejects anything else.
 */
export interface NotificationTarget {
  v: "1";
  identity: string;
  community: string;
  kind: "channel" | "dm" | "inbox";
  channelId?: string;
  messageId?: string;
  threadRootId?: string;
  /** Inbox row key (`kind: "inbox"`). */
  item?: string;
}

export const identityFingerprint = (pubkey: string) => pubkey.slice(0, 16).toLowerCase();

export function messageTarget(
  message: Message,
  ctx: { identity: string; community: string; isDm: boolean },
): NotificationTarget {
  const root = message.thread.rootId && message.thread.rootId !== message.id ? message.thread.rootId : undefined;
  return {
    v: "1",
    identity: identityFingerprint(ctx.identity),
    community: ctx.community,
    kind: ctx.isDm ? "dm" : "channel",
    channelId: message.channelId,
    messageId: message.id,
    ...(root ? { threadRootId: root } : {}),
  };
}

const HEX = /^[0-9a-f]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Parse a clicked toast's target; anything unexpected is dropped, never routed. */
export function parseNotificationTarget(raw: unknown): NotificationTarget | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const t = value as Record<string, unknown>;
  if (t.v !== "1" || typeof t.identity !== "string" || typeof t.community !== "string") return null;
  if (t.kind !== "channel" && t.kind !== "dm" && t.kind !== "inbox") return null;
  if (!/^wss?:\/\/[^\s]+$/i.test(t.community)) return null;
  const id = (v: unknown) => (typeof v === "string" && (HEX.test(v) || SAFE_ID.test(v)) ? v : undefined);
  const target: NotificationTarget = { v: "1", identity: t.identity, community: t.community, kind: t.kind };
  const channelId = id(t.channelId);
  const messageId = id(t.messageId);
  const threadRootId = id(t.threadRootId);
  const item = id(t.item);
  if (channelId) target.channelId = channelId;
  if (messageId) target.messageId = messageId;
  if (threadRootId) target.threadRootId = threadRootId;
  if (item) target.item = item;
  if (target.kind !== "inbox" && !target.channelId) return null;
  return target;
}

/** The router location for a target (the existing `?messageId=&threadRootId=` reveal). */
export function targetRoute(target: NotificationTarget): { name: string; query: Record<string, string> } {
  const reveal: Record<string, string> = {
    ...(target.messageId ? { messageId: target.messageId } : {}),
    ...(target.threadRootId ? { threadRootId: target.threadRootId } : {}),
  };
  if (target.kind === "dm") return { name: "dm", query: { conversationId: target.channelId as string, ...reveal } };
  if (target.kind === "channel") return { name: "channels", query: { channelId: target.channelId as string, ...reveal } };
  return { name: "inbox", query: target.item ? { item: target.item } : {} };
}

/**
 * Taskbar overlay: shown while something needs me — an unread DM, a channel
 * with an unread @mention, or an unread needs-action item. Ordinary channel
 * chatter alone never lights it.
 */
export function needsAttention(input: {
  unread: Record<string, number>;
  hasMention: Record<string, boolean>;
  dmIds: ReadonlySet<string>;
  needsActionUnread: number;
}): boolean {
  if (input.needsActionUnread > 0) return true;
  for (const [id, count] of Object.entries(input.unread)) {
    if (count <= 0) continue;
    if (input.dmIds.has(id) || input.hasMention[id]) return true;
  }
  return false;
}
