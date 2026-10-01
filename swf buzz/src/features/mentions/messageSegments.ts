/**
 * Message text → render tokens, in order: plain text, person mentions,
 * `@everyone`, and links. Pure; the ONE tokenizer every message surface uses
 * (through `MessageContent`), so a channel row, a thread reply, a DM and the
 * Inbox detail draw the same message the same way.
 *
 * Mentions bind exactly as before (`mentionModel.segmentMentions` rules): only
 * identities tagged on the event, at mention boundaries, outside code and URLs.
 * `@everyone` binds only when the event carries the semantic tag. Links are
 * found in the remaining plain runs, outside code spans, so a URL never
 * contains a mention chip and a mention never contains a link — no nesting.
 */
import { findMentionOccurrences, type MentionBindings } from "./mentionModel";
import { EVERYONE_LABEL } from "./everyone";
import { findLinks } from "@/features/links/urlModel";

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; label: string; pubkey: string }
  | { kind: "everyone"; text: string }
  | { kind: "link"; text: string; href: string };

/** Same-length copy with code blanked out (offsets stay valid in the original). */
function maskCode(text: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return text.replace(/```[\s\S]*?(?:```|$)/g, blank).replace(/`[^`\n]+`/g, blank);
}

function splitLinks(text: string): MessageSegment[] {
  const links = findLinks(maskCode(text));
  if (links.length === 0) return text ? [{ kind: "text", text }] : [];
  const out: MessageSegment[] = [];
  let cursor = 0;
  for (const link of links) {
    if (link.start > cursor) out.push({ kind: "text", text: text.slice(cursor, link.start) });
    out.push({ kind: "link", text: text.slice(link.start, link.end), href: link.href });
    cursor = link.end;
  }
  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
  return out;
}

export function segmentMessage(
  content: string,
  bindings: MentionBindings,
  opts: { everyone?: boolean } = {},
): MessageSegment[] {
  if (!content) return [];
  const labels = [...bindings.values()].map((b) => b.label);
  if (opts.everyone) labels.push(EVERYONE_LABEL);
  const occurrences = labels.length && content.includes("@") ? findMentionOccurrences(content, labels) : [];

  const out: MessageSegment[] = [];
  let cursor = 0;
  const pushText = (end: number) => {
    if (end > cursor) out.push(...splitLinks(content.slice(cursor, end)));
  };
  for (const occurrence of occurrences) {
    const lower = occurrence.label.toLowerCase();
    const text = content.slice(occurrence.start, occurrence.end);
    if (opts.everyone && lower === EVERYONE_LABEL) {
      pushText(occurrence.start);
      out.push({ kind: "everyone", text });
      cursor = occurrence.end;
      continue;
    }
    const pubkey = bindings.get(lower)?.pubkey;
    if (!pubkey) continue; // ambiguous or unbound: stays plain text
    pushText(occurrence.start);
    out.push({ kind: "mention", text, label: occurrence.label, pubkey });
    cursor = occurrence.end;
  }
  pushText(content.length);
  return out;
}
