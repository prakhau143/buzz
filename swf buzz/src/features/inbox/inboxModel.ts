/**
 * Inbox model — turns the relay's feed rows into OLD BUZZ-style inbox items.
 * Pure functions only (no Vue, no I/O), so every rule here is unit-testable.
 *
 * Reference: docs/OLD_BUZZ_INBOX_AUDIT.md and the scoping rules in
 * docs/OLD_BUZZ_SIDEBAR_INBOX_MASTER_SPEC.md §2. SWF sources each filter from
 * REAL relay data (the `feed_types` categories of `POST /query`):
 *
 *   Mentions      ← `mentions`
 *   Needs action  ← `needs_action`, approval requests (46010)
 *   Reminders     ← `needs_action`, reminder events (40007)
 *   Threads       ← thread replies (NIP-10) in `mentions` + scoped `activity`
 *   All           ← every row except reminders
 *
 * Deliberately NOT offered (SWF product boundary): OLD BUZZ's "Agents" and
 * "Projects" filters — SWF ships no agents, managed agents or projects. An agent
 * or project event that genuinely mentions you still arrives, as a mention.
 * Drafts: SWF has no drafts feature to source it from.
 *
 * SCOPING. The relay's `activity` category is NOT user-scoped: it is everything
 * in channels you can read. Taking it wholesale leaked other people's threads
 * into your Inbox — live, 27 replies in two threads you never touched, most by
 * an external agent (Master Spec §2). An `activity` row is therefore admitted
 * only when it is (OLD BUZZ `shouldNotifyForEvent`):
 *   - in one of your DMs, or
 *   - p-tagged to you, or
 *   - a reply in a thread whose root you authored or replied in.
 * Who the author is — human or agent, owned or not — plays no part.
 * "Followed" threads are not supported: SWF has no follow feature.
 *
 * Rows are grouped per conversation like OLD BUZZ (a DM, or a thread root):
 * the newest event represents the group.
 */
import { resolveThreadMarkersFromEvent } from "@/protocol/nip10";
import { hasEveryoneMentionTag } from "@/protocol/messages";
import type { RawNostrEvent } from "@/protocol/types";

export const KIND_APPROVAL_REQUESTED = 46010;
export const KIND_REMINDER = 40007;
export type InboxItemType = "dm" | "mention" | "thread" | "needs_action" | "reminder";

export type InboxFilter = "all" | "mentions" | "threads" | "needs_action" | "reminders";

/** OLD BUZZ's order minus out-of-scope filters; the separator falls before Reminders. */
export const INBOX_FILTERS: readonly { value: InboxFilter; label: string; separatorBefore?: boolean }[] = [
  { value: "all", label: "All" },
  { value: "mentions", label: "Mentions" },
  { value: "threads", label: "Threads" },
  { value: "needs_action", label: "Needs action" },
  { value: "reminders", label: "Reminders", separatorBefore: true },
];

export const EMPTY_STATE: Record<InboxFilter, { title: string; description: string }> = {
  all: { title: "You're all caught up", description: "Mentions, replies, direct messages and requests will show up here." },
  mentions: { title: "No mentions", description: "When someone @mentions you, it shows up here." },
  threads: { title: "No thread activity", description: "Replies in threads show up here." },
  needs_action: { title: "Nothing needs your action", description: "Approval requests addressed to you appear here." },
  reminders: { title: "No reminders", description: "Reminders addressed to you appear here." },
};

export interface InboxItem {
  /** Stable row id = the group key (one row per conversation). */
  key: string;
  event: RawNostrEvent;
  type: InboxItemType;
  channelId: string | null;
  /** Thread root of the event, when it is a reply; otherwise null. */
  rootId: string | null;
  createdAt: number;
  /** How many events this row stands for (same DM / thread). */
  count: number;
  mentionsMe: boolean;
}

export interface FeedRows {
  mentions: RawNostrEvent[];
  needsAction: RawNostrEvent[];
  activity: RawNostrEvent[];
}

const channelOf = (e: RawNostrEvent) => e.tags.find((t) => t[0] === "h")?.[1] ?? null;

function classify(
  e: RawNostrEvent,
  source: keyof FeedRows,
  dmChannelIds: ReadonlySet<string>,
): { type: InboxItemType; rootId: string | null } {
  const rootId = resolveThreadMarkersFromEvent(e).rootId ?? null;
  const channelId = channelOf(e);
  if (source === "needsAction") return { type: e.kind === KIND_REMINDER ? "reminder" : "needs_action", rootId };
  if (channelId && dmChannelIds.has(channelId)) return { type: "dm", rootId };
  if (source === "mentions") return { type: rootId ? "thread" : "mention", rootId };
  return { type: rootId ? "thread" : "mention", rootId };
}

/**
 * Does an item belong in this filter? OLD BUZZ `inboxViewHelpers.ts`:
 * "All" is any DM / mention / thread / needs-action row, and reminders
 * (kind 40007) are kept out of every list except their own; "Mentions" is any
 * row whose categories include a mention.
 */
export function matchesFilter(item: InboxItem, filter: InboxFilter): boolean {
  switch (filter) {
    case "all":
      return item.type !== "reminder";
    case "mentions":
      return item.mentionsMe && item.type !== "needs_action" && item.type !== "reminder";
    case "threads":
      return item.rootId !== null && item.type !== "needs_action" && item.type !== "reminder";
    case "needs_action":
      return item.type === "needs_action";
    case "reminders":
      return item.type === "reminder";
  }
}

/**
 * The thread roots I am part of: roots I authored, plus the root of every reply
 * I wrote. Built from my own events (the caller supplies my recent messages;
 * my own rows in the feed are folded in too).
 */
export function threadRootsOf(myEvents: readonly RawNostrEvent[], me: string): Set<string> {
  const roots = new Set<string>();
  for (const e of myEvents) {
    if (!e || e.pubkey !== me) continue;
    const rootId = resolveThreadMarkersFromEvent(e).rootId;
    roots.add(rootId ?? e.id);
  }
  return roots;
}

/**
 * A channel `@everyone` (semantic tag, protocol/messages.ts) from someone else.
 * The relay's `mentions` category joins on indexed `p` tags only, so an
 * @everyone surfaces through the `activity` category — which the relay has
 * already restricted to channels this reader can access (see protocol/inbox.ts).
 */
function everyoneMentionsMe(e: RawNostrEvent, me: string, dmChannelIds: ReadonlySet<string>): boolean {
  if (e.pubkey === me || !hasEveryoneMentionTag(e)) return false;
  const channelId = channelOf(e);
  return !!channelId && !dmChannelIds.has(channelId);
}

/** Is this `activity` row about me? (see the SCOPING note in the header) */
function activityConcernsMe(
  e: RawNostrEvent,
  me: string,
  dmChannelIds: ReadonlySet<string>,
  myThreadRoots: ReadonlySet<string>,
): boolean {
  const channelId = channelOf(e);
  if (channelId && dmChannelIds.has(channelId)) return true;
  if (e.tags.some((t) => t[0] === "p" && t[1] === me)) return true;
  if (everyoneMentionsMe(e, me, dmChannelIds)) return true;
  const rootId = resolveThreadMarkersFromEvent(e).rootId;
  return !!rootId && myThreadRoots.has(rootId);
}

/**
 * Merge the three relay categories into grouped inbox rows, newest first.
 * - my own events never appear (you don't notify yourself);
 * - `activity` rows must concern me (DM / p-tag / my thread) — the category
 *   itself is channel-wide, not user-scoped;
 * - plain channel chatter is never a row (OLD BUZZ captures DM/thread rows only);
 * - duplicates across categories collapse by event id; groups collapse per
 *   DM channel or thread root, keeping the newest event.
 */
export function buildInboxItems(
  rows: FeedRows,
  me: string,
  dmChannelIds: ReadonlySet<string>,
  myEvents: readonly RawNostrEvent[] = [],
): InboxItem[] {
  const myThreadRoots = threadRootsOf([...myEvents, ...rows.activity, ...rows.mentions], me);
  const byEvent = new Map<string, { e: RawNostrEvent; source: keyof FeedRows }>();
  const mentionIds = new Set(rows.mentions.map((e) => e.id));
  for (const source of ["needsAction", "mentions", "activity"] as const) {
    for (const e of rows[source]) {
      if (!e?.id || e.pubkey === me || byEvent.has(e.id)) continue;
      if (source === "activity" && !activityConcernsMe(e, me, dmChannelIds, myThreadRoots)) continue;
      byEvent.set(e.id, { e, source });
    }
  }

  const groups = new Map<string, InboxItem>();
  for (const { e, source } of byEvent.values()) {
    const { type, rootId } = classify(e, source, dmChannelIds);
    const everyone = everyoneMentionsMe(e, me, dmChannelIds);
    if (source === "activity" && type === "mention" && !mentionIds.has(e.id) && !everyone) continue; // plain chatter
    const channelId = channelOf(e);
    const key =
      type === "dm" && channelId
        ? `dm:${channelId}`
        : rootId && (type === "thread" || type === "mention")
          ? `thread:${rootId}`
          : `event:${e.id}`;
    const mentionsMe = mentionIds.has(e.id) || e.tags.some((t) => t[0] === "p" && t[1] === me) || everyone;
    const held = groups.get(key);
    if (!held) {
      groups.set(key, { key, event: e, type, channelId, rootId, createdAt: e.created_at, count: 1, mentionsMe });
    } else {
      held.count += 1;
      held.mentionsMe ||= mentionsMe;
      if (e.created_at > held.createdAt) Object.assign(held, { event: e, type, rootId, createdAt: e.created_at });
    }
  }
  return [...groups.values()].sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key));
}

/**
 * Unread = newer than the channel's read frontier (the existing NIP-RS read
 * state SWF already syncs). Items without a channel have nothing to compare
 * against and count as read.
 */
export function isUnread(item: InboxItem, lastSeenFor: (channelId: string) => number): boolean {
  return !!item.channelId && item.createdAt > lastSeenFor(item.channelId);
}

/** "Mentioned in #x", "Thread in #x", "DM from X" … — the row's context line. */
export function contextLabel(item: InboxItem, channelName: string | null, senderName: string): string {
  const where = channelName ? `#${channelName}` : "a channel";
  switch (item.type) {
    case "dm":
      return `DM from ${senderName}`;
    case "thread":
      return `Thread in ${where}`;
    case "mention":
      return `Mentioned in ${where}`;
    case "needs_action":
      return `Needs action in ${where}`;
    case "reminder":
      return "Reminder";
  }
}

/** Detail header title: "Message in #x", "Thread in #x", "DM with X". */
export function detailTitle(item: InboxItem, channelName: string | null, senderName: string): string {
  const where = channelName ? `#${channelName}` : "a channel";
  if (item.type === "dm") return `DM with ${senderName}`;
  if (item.rootId) return `Thread in ${where}`;
  if (item.type === "needs_action") return `Needs action in ${where}`;
  return `Message in ${where}`;
}
