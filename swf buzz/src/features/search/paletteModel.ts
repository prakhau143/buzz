/**
 * "Search anything" palette model — pure, so every rule is unit-tested.
 *
 * Sections follow OLD BUZZ's TopbarSearch (docs/OLD_BUZZ_SIDEBAR_INBOX_MASTER_SPEC.md
 * §4) minus what SWF deliberately does not have:
 *   - Channels / Direct messages / People: local matches over what this
 *     community already showed you (sidebar channels, DMs, the member roster);
 *   - Messages: the relay's NIP-50 search (access re-checked by the relay).
 * NOT carried over: OLD BUZZ's hard-coded "Create a new agent" action and its
 * Agents section — SWF creates and ships no agents. The only action offered is
 * creating a channel, and only to someone the relay lets do it.
 */
export const MIN_QUERY = 2;
export const MAX_PER_SECTION = 5;

export type PaletteItem =
  | { kind: "channel"; id: string; label: string; sub?: string }
  | { kind: "dm"; id: string; label: string }
  | { kind: "person"; id: string; label: string; sub?: string }
  | {
      kind: "message";
      id: string;
      label: string;
      sub: string;
      channelId: string;
      mentions?: readonly string[];
      mentionsEveryone?: boolean;
    }
  | { kind: "action"; id: "create-channel"; label: string };

export interface PaletteSection {
  id: string;
  title: string;
  items: PaletteItem[];
}

export interface PaletteInput {
  query: string;
  channels: readonly { id: string; name: string; topic?: string }[];
  dms: readonly { id: string; name: string }[];
  people: readonly { pubkey: string; name: string }[];
  messages: readonly {
    id: string;
    content: string;
    channelId: string;
    channelName: string;
    /** The hit's `p` tags and `@everyone` tag, so its label renders as semantic tokens. */
    mentions?: readonly string[];
    mentionsEveryone?: boolean;
  }[];
  canCreateChannel: boolean;
}

/** Lower-case, accent-folded, for forgiving substring matches. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Prefix of a word beats a mid-word hit; shorter names win ties. `-1` = no match. */
export function matchScore(candidate: string, query: string): number {
  const c = fold(candidate);
  const q = fold(query);
  if (!q) return -1;
  const at = c.indexOf(q);
  if (at < 0) return -1;
  const wordStart = at === 0 || /[\s#\-_.]/.test(c[at - 1]);
  return (wordStart ? 1000 : 500) - at - c.length / 100;
}

function ranked<T>(items: readonly T[], label: (t: T) => string, query: string): T[] {
  return items
    .map((item) => ({ item, score: matchScore(label(item), query) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PER_SECTION)
    .map((r) => r.item);
}

/** Snippet around the first hit so the match is visible in a one-line row. */
export function snippet(content: string, query: string, width = 80): string {
  const flat = content.replace(/<!--[\s\S]*?-->/g, " ").replace(/\s+/g, " ").trim();
  const at = fold(flat).indexOf(fold(query));
  if (at < 0 || flat.length <= width) return flat.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + width)}${start + width < flat.length ? "…" : ""}`;
}

export function buildPalette(input: PaletteInput): PaletteSection[] {
  const q = input.query.trim();
  const sections: PaletteSection[] = [];

  if (q.length < MIN_QUERY) {
    // Empty state: quick access to where you already work, and the one action.
    if (input.channels.length) {
      sections.push({
        id: "channels",
        title: "Channels",
        items: input.channels.slice(0, MAX_PER_SECTION).map((c) => ({ kind: "channel", id: c.id, label: c.name })),
      });
    }
    if (input.dms.length) {
      sections.push({
        id: "dms",
        title: "Direct messages",
        items: input.dms.slice(0, MAX_PER_SECTION).map((d) => ({ kind: "dm", id: d.id, label: d.name })),
      });
    }
    if (input.canCreateChannel) {
      sections.push({
        id: "actions",
        title: "Actions",
        items: [{ kind: "action", id: "create-channel", label: "Create a new channel" }],
      });
    }
    return sections;
  }

  const channels = ranked(input.channels, (c) => c.name, q);
  if (channels.length) {
    sections.push({
      id: "channels",
      title: "Channels",
      items: channels.map((c) => ({ kind: "channel", id: c.id, label: c.name, sub: c.topic })),
    });
  }
  const dms = ranked(input.dms, (d) => d.name, q);
  if (dms.length) {
    sections.push({ id: "dms", title: "Direct messages", items: dms.map((d) => ({ kind: "dm", id: d.id, label: d.name })) });
  }
  const people = ranked(input.people, (p) => p.name, q);
  if (people.length) {
    sections.push({
      id: "people",
      title: "People",
      items: people.map((p) => ({ kind: "person", id: p.pubkey, label: p.name })),
    });
  }
  if (input.messages.length) {
    sections.push({
      id: "messages",
      title: "Messages",
      items: input.messages.slice(0, 8).map((m) => ({
        kind: "message",
        id: m.id,
        label: snippet(m.content, q),
        sub: `#${m.channelName}`,
        channelId: m.channelId,
        mentions: m.mentions,
        mentionsEveryone: m.mentionsEveryone,
      })),
    });
  }
  return sections;
}

/** Flat keyboard order across sections (↑/↓ walk this list). */
export function flatten(sections: readonly PaletteSection[]): PaletteItem[] {
  return sections.flatMap((s) => s.items);
}
