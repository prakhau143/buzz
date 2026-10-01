/**
 * The @mention model — pure functions, no Vue, no I/O.
 *
 * Protocol (docs/OLD_BUZZ_MENTION_AUDIT.md §2): a mention is the literal text
 * `@Label` in the content PLUS a plain `["p", <hex>]` tag on the event. The tag
 * is the identity; the text is only where to draw it. Humans and agents are
 * the same mechanism — "agent" is identity metadata, never a separate path.
 *
 * Every rule here mirrors OLD BUZZ and names its source there, so a behaviour
 * difference is a bug, not a design choice.
 */

/** One identity the picker can offer — user, agent, anything with a pubkey. */
export interface MentionCandidate {
  pubkey: string;
  displayName: string;
  avatarUrl?: string;
  isAgent?: boolean;
  /**
   * A member of the conversation being written in. Ranks first, and only
   * members bind from a typed (not picked) name — OLD BUZZ `mentionRanking.ts`,
   * `extractMentionPubkeys.ts`. Defaults to true when omitted.
   */
  inChannel?: boolean;
}

/** Maximum `p` tags from mentions on one event — OLD BUZZ `events.rs` `MAX_MENTIONS`. */
export const MAX_MENTIONS = 50;
/** Maximum rows in the picker — OLD BUZZ `useMentions.ts` `MENTION_SUGGESTION_LIMIT`. */
export const MENTION_SUGGESTION_LIMIT = 50;
/** How far back a multi-word query may reach — OLD BUZZ `detectPrefixQuery.ts`. */
const MULTI_WORD_LOOKBACK = 80;

// ---------------------------------------------------------------------------
// Trigger detection (OLD BUZZ `shared/lib/detectPrefixQuery.ts`)
// ---------------------------------------------------------------------------

export interface MentionQuery {
  /** Index of the `@` in the text. */
  start: number;
  /** Text typed after the `@`, up to the caret. */
  query: string;
}

/** `@` may open a mention only at the start or after whitespace / an opening bracket. */
function isTriggerBoundary(text: string, atIndex: number): boolean {
  return atIndex === 0 || /[\s([{]/.test(text[atIndex - 1]);
}

/**
 * The mention being typed at `caret`, if any.
 *
 * A single word after `@` always counts. A query containing spaces stays open
 * only while it is still the prefix of a known name ("@Sonia Ma" → "Sonia
 * Malik"), so ordinary prose after an `@word` does not keep the picker open.
 * Never crosses a newline. `hello@example.com` never triggers: `@` there
 * follows a letter.
 */
export function detectMentionQuery(
  text: string,
  caret: number,
  knownNames: readonly string[] = [],
): MentionQuery | null {
  const before = text.slice(0, caret);

  const single = /(?:^|[\s([{])@([^\s@]*)$/.exec(before);
  if (single) return { start: before.length - single[1].length - 1, query: single[1] };

  const lineStart = before.lastIndexOf("\n") + 1;
  const windowStart = Math.max(lineStart, before.length - MULTI_WORD_LOOKBACK);
  const lowerNames = knownNames.map((name) => name.toLowerCase());
  for (let at = before.lastIndexOf("@"); at >= windowStart; at = before.lastIndexOf("@", at - 1)) {
    if (!isTriggerBoundary(before, at)) continue;
    const query = before.slice(at + 1);
    const lowered = query.toLowerCase();
    if (lowerNames.some((name) => name.startsWith(lowered))) return { start: at, query };
    // Only the nearest valid `@` is the one being typed.
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ranking (OLD BUZZ `features/messages/lib/mentionRanking.ts`)
// ---------------------------------------------------------------------------

/** Lower is better; null = no match. */
function labelScore(label: string, query: string): number | null {
  const l = label.toLowerCase();
  if (query && l === query) return 0;
  if (l.startsWith(query)) return 1;
  const words = l.split(/[\s\-_]+/).filter(Boolean);
  if (words.includes(query)) return 2;
  if (words.some((word) => word.startsWith(query))) return 3;
  return null;
}

function matchScore(candidate: MentionCandidate, query: string): number | null {
  const byLabel = labelScore(candidate.displayName, query);
  if (byLabel !== null) return byLabel;
  const key = candidate.pubkey.toLowerCase();
  if (query && key.startsWith(query)) return 4;
  if (query && key.includes(query)) return 5;
  return null;
}

/** Members of the conversation first, then other people, then other agents. */
function groupRank(candidate: MentionCandidate): number {
  if (candidate.inChannel !== false) return 0;
  return candidate.isAgent ? 3 : 2;
}

export function rankMentionCandidates(
  candidates: readonly MentionCandidate[],
  rawQuery: string,
  limit = MENTION_SUGGESTION_LIMIT,
): MentionCandidate[] {
  const query = rawQuery.trim().toLowerCase();
  return candidates
    .map((candidate, index) => ({ candidate, index, score: matchScore(candidate, query) }))
    .filter((row): row is { candidate: MentionCandidate; index: number; score: number } => row.score !== null)
    .sort(
      (a, b) =>
        groupRank(a.candidate) - groupRank(b.candidate) || a.score - b.score || a.index - b.index,
    )
    .slice(0, limit)
    .map((row) => row.candidate);
}

// ---------------------------------------------------------------------------
// Labels (OLD BUZZ `extractMentionPubkeys.ts` `selectedMentionLabel`)
// ---------------------------------------------------------------------------

/**
 * The label to insert for `candidate`. If this draft already uses the same
 * name for a DIFFERENT identity, the new one is qualified with its public key
 * — `Name (<hex>)` — so both stay unambiguous on the wire and on render.
 */
export function mentionLabelFor(
  candidate: Pick<MentionCandidate, "pubkey" | "displayName">,
  bindings: ReadonlyMap<string, string>,
): string {
  const base = candidate.displayName.trim() || candidate.pubkey.slice(0, 8);
  const boundTo = (label: string) => {
    for (const [key, pubkey] of bindings) if (key.toLowerCase() === label.toLowerCase()) return pubkey;
    return undefined;
  };
  const existing = boundTo(base);
  if (existing === undefined || existing === candidate.pubkey) return base;
  return `${base} (${candidate.pubkey.toLowerCase()})`;
}

/**
 * The chip text for an agent. Agent display names often carry their role in
 * a trailing parenthetical ("Scout (Support Agent)"); in running text that
 * reads heavy, and the chip already says "agent" with its glyph. Display only —
 * the label, aria-label and title keep the full name, and nothing on the wire
 * changes. A key-qualified label (`Name (<hex>)`) is left alone.
 */
export function agentMentionDisplayLabel(label: string): string {
  const stripped = label.replace(/\s*\((?:[^()]*\s)?agent\)$/i, "").trim();
  return stripped || label;
}

/** `Name (<64-hex>)` → `Name (abcd…wxyz)` for display; anything else unchanged. */
export function formatMentionDisplayLabel(label: string): string {
  return label.replace(/ \(([0-9a-f]{64})\)$/i, (_m, hex: string) => ` (${hex.slice(0, 4)}…${hex.slice(-4)})`);
}

// ---------------------------------------------------------------------------
// Masking — ranges where `@` is never a mention
// ---------------------------------------------------------------------------

/**
 * Same-length copy of `text` with code (fenced blocks, inline backtick spans)
 * and URLs blanked out, so offsets found in the mask are valid in the
 * original. OLD BUZZ `mentionBoundaries.ts` masks code the same way.
 */
export function maskNonMentionRanges(text: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, blank)
    .replace(/`[^`\n]+`/g, blank)
    .replace(/\b(?:https?|ftp|mailto):[^\s]+/gi, blank)
    .replace(/\bwww\.[^\s]+/gi, blank);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface MentionOccurrence {
  /** Index of the `@`. */
  start: number;
  /** Index just past the label. */
  end: number;
  /** The label as written in the text (without `@`). */
  label: string;
}

/**
 * Every `@Label` in `text` for the given labels, longest label first so
 * "@Sonia Malik" wins over "@Sonia". Boundaries are OLD BUZZ's send-side rule
 * (`mentionBoundaries.ts`): `@` must follow start / whitespace / `(` / markdown
 * emphasis / `||`, and the label must end at whitespace or punctuation. That
 * leading boundary is what keeps `hello@example.com` from ever binding.
 */
export function findMentionOccurrences(text: string, labels: Iterable<string>): MentionOccurrence[] {
  const sorted = [...new Set([...labels].map((l) => l.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (sorted.length === 0) return [];
  const pattern = new RegExp(
    `(^|[\\s([{]|[*_]{1,3}|\\|\\|)@(${sorted.map(escapeRegExp).join("|")})(?=\\|\\||[\\s,;.!?:)\\]}*_]|$)`,
    "gi",
  );
  const masked = maskNonMentionRanges(text);
  const found: MentionOccurrence[] = [];
  for (const match of masked.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[1].length;
    const end = start + 1 + match[2].length;
    found.push({ start, end, label: text.slice(start + 1, end) });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Send side (OLD BUZZ `extractMentionPubkeys.ts`)
// ---------------------------------------------------------------------------

export interface ExtractedMentions {
  pubkeys: string[];
  /** Typed names that match more than one member and were not picked. */
  ambiguous: string[];
}

/**
 * The recipients of a draft: every picked label still present in the text,
 * plus a typed `@Name` that exactly matches ONE member of the conversation.
 * A typed name shared by several members is reported, never guessed.
 */
export function extractMentionPubkeys(
  content: string,
  picked: ReadonlyMap<string, string>,
  members: readonly MentionCandidate[] = [],
): ExtractedMentions {
  const pickedByLower = new Map<string, string>();
  for (const [label, pubkey] of picked) pickedByLower.set(label.toLowerCase(), pubkey);

  const membersByName = new Map<string, Set<string>>();
  for (const member of members) {
    if (member.inChannel === false) continue;
    const name = member.displayName.trim().toLowerCase();
    if (!name) continue;
    const set = membersByName.get(name) ?? new Set<string>();
    set.add(member.pubkey);
    membersByName.set(name, set);
  }

  const labels = [...picked.keys(), ...members.filter((m) => m.inChannel !== false).map((m) => m.displayName)];
  const pubkeys: string[] = [];
  const ambiguous: string[] = [];
  for (const occurrence of findMentionOccurrences(content, labels)) {
    const key = occurrence.label.toLowerCase();
    const chosen = pickedByLower.get(key);
    if (chosen) {
      pubkeys.push(chosen);
      continue;
    }
    const matches = membersByName.get(key);
    if (!matches) continue;
    if (matches.size === 1) pubkeys.push([...matches][0]);
    else ambiguous.push(occurrence.label);
  }
  return { pubkeys: [...new Set(pubkeys)], ambiguous: [...new Set(ambiguous)] };
}

/**
 * Final `p` recipients for an event: lowercase hex, deduplicated, capped —
 * OLD BUZZ `events.rs` `mention_tags`.
 */
export function normalizeMentionPubkeys(pubkeys: Iterable<string>, exclude: Iterable<string> = []): string[] {
  const skip = new Set([...exclude].map((p) => p.toLowerCase()));
  const out: string[] = [];
  for (const raw of pubkeys) {
    const pubkey = raw.trim().toLowerCase();
    if (!pubkey || skip.has(pubkey) || out.includes(pubkey)) continue;
    out.push(pubkey);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Render side (OLD BUZZ `shared/lib/resolveMentionNames.ts`)
// ---------------------------------------------------------------------------

/** Lowercased label → bound pubkey, or null when the label is ambiguous. */
export type MentionBindings = Map<string, { label: string; pubkey: string | null }>;

/**
 * Which `@Label`s in a received message are mentions, and of whom.
 *
 * Only identities TAGGED on the event can bind; the text is never an authority
 * to add one. A tagged identity answers to each of its aliases (display name,
 * kind-0 `name`, NIP-05 local part). An alias shared by two tagged identities
 * is recognised but left unbound — plain text beats the wrong person. A
 * qualified `@Name (<hex>)` binds only when that hex is tagged.
 */
export function resolveMentionBindings(
  taggedPubkeys: Iterable<string>,
  aliasesOf: (pubkey: string) => readonly string[],
  content: string,
): MentionBindings {
  const tagged = new Set([...taggedPubkeys].map((p) => p.toLowerCase()));
  const keysByLabel = new Map<string, { label: string; keys: Set<string> }>();
  const add = (label: string, pubkey: string) => {
    const lower = label.toLowerCase();
    const entry = keysByLabel.get(lower) ?? { label, keys: new Set<string>() };
    entry.keys.add(pubkey);
    keysByLabel.set(lower, entry);
  };
  for (const pubkey of tagged) for (const alias of aliasesOf(pubkey)) if (alias.trim()) add(alias.trim(), pubkey);

  for (const match of content.matchAll(/@([^@\r\n]+?) \(([0-9a-f]{64})\)/gi)) {
    const pubkey = match[2].toLowerCase();
    if (tagged.has(pubkey)) add(`${match[1]} (${match[2]})`, pubkey);
  }

  const bindings: MentionBindings = new Map();
  for (const [lower, entry] of keysByLabel) {
    bindings.set(lower, { label: entry.label, pubkey: entry.keys.size === 1 ? [...entry.keys][0] : null });
  }
  return bindings;
}

export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; label: string; pubkey: string };

/** Splits message text into plain runs and bound mentions, in order. */
export function segmentMentions(content: string, bindings: MentionBindings): MentionSegment[] {
  if (bindings.size === 0 || !content.includes("@")) return content ? [{ kind: "text", text: content }] : [];
  const labels = [...bindings.values()].map((b) => b.label);
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const occurrence of findMentionOccurrences(content, labels)) {
    const pubkey = bindings.get(occurrence.label.toLowerCase())?.pubkey;
    if (!pubkey) continue; // ambiguous: stays plain text
    if (occurrence.start > cursor) segments.push({ kind: "text", text: content.slice(cursor, occurrence.start) });
    segments.push({
      kind: "mention",
      text: content.slice(occurrence.start, occurrence.end),
      label: occurrence.label,
      pubkey,
    });
    cursor = occurrence.end;
  }
  if (cursor < content.length) segments.push({ kind: "text", text: content.slice(cursor) });
  return segments;
}

/**
 * Every name a kind:0 answers to — OLD BUZZ `collectProfileAliases`:
 * `display_name`, `name`, and the NIP-05 local part (`_` is the root, not a handle).
 */
export function profileAliases(profileContent: string | null | undefined, fallbackName?: string): string[] {
  const aliases: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed && !aliases.some((a) => a.toLowerCase() === trimmed.toLowerCase())) aliases.push(trimmed);
  };
  if (profileContent) {
    try {
      const parsed = JSON.parse(profileContent) as Record<string, unknown>;
      push(parsed.display_name);
      push(parsed.name);
      const nip05 = typeof parsed.nip05 === "string" ? parsed.nip05.split("@")[0] : undefined;
      if (nip05 && nip05.trim() !== "_") push(nip05);
    } catch {
      // Malformed kind:0 — fall back to the rendered display name below.
    }
  }
  push(fallbackName);
  return aliases;
}
