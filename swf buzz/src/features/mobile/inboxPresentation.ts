import type { InboxItem } from "@/features/inbox/inboxModel";

/**
 * Presentation of the ONE Inbox feed on mobile — wording and grouping only.
 * Which items exist, their type, and whether they are unread all come from
 * `useInboxFeed` / `inboxModel`; nothing here decides membership or read state.
 */

/** What happened, as a short verb phrase after the sender's name. */
export function inboxVerb(item: InboxItem): string {
  switch (item.type) {
    case "dm":
      return "sent you a direct message";
    case "thread":
      return item.mentionsMe ? "mentioned you in a thread" : "replied in a thread";
    case "mention":
      return "mentioned you";
    case "needs_action":
      return "needs your action";
    case "reminder":
      return "sent a reminder";
  }
}

/** Where it happened: "#engineering"; nothing for a DM (the verb says it) or an item outside a conversation. */
export function inboxWhere(item: InboxItem, channelName: string | null): string | null {
  if (item.type === "dm") return null;
  if (!item.channelId) return null;
  return channelName ? `#${channelName}` : "a channel";
}

/** Readable one-line preview (no NIP-27 comments, collapsed whitespace). */
export function inboxPreview(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface InboxDayGroup {
  key: string;
  label: string;
  items: InboxItem[];
}

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Today / Yesterday / "Mon, Sep 28" — items keep the feed's order (newest first). */
export function groupByDay(items: readonly InboxItem[], now: number = Date.now()): InboxDayGroup[] {
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const groups: InboxDayGroup[] = [];
  for (const item of items) {
    const day = startOfDay(item.createdAt * 1000);
    const key = String(day);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      const label =
        day === today
          ? "Today"
          : day === yesterday
            ? "Yesterday"
            : new Date(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** Compact time for a row: "now", "5m", "3h", then the clock / date. */
export function shortTime(unixSeconds: number, now: number = Date.now()): string {
  const diffMin = Math.floor((now - unixSeconds * 1000) / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Badge text: "1" … "99", then "99+". */
export const badgeText = (count: number) => (count > 99 ? "99+" : String(count));
