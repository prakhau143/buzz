import type { ScrollAnchor } from "@/features/messages/scrollAnchor";
import { navDirection } from "./mobileNav";

/**
 * Where the reader was in a mobile conversation when they opened one of its
 * threads — so "back" returns them to that spot instead of the bottom (the
 * conversation screen remounts on the way back).
 *
 * Deliberately narrow: an entry is written only on the way INTO a thread, read
 * only when arriving BACK at the same conversation, and forgotten on first
 * read either way. Any other arrival (a tab switch, a deep link, a fresh open)
 * discards it, so an old position is never restored after the reader has
 * intentionally gone elsewhere. Bounded by age as well.
 */
const MAX_AGE_MS = 30 * 60_000;
const memory = new Map<string, { anchor: ScrollAnchor; at: number }>();

const keyOf = (kind: "channel" | "dm", conversationId: string) => `${kind}:${conversationId}`;

export function rememberScroll(kind: "channel" | "dm", conversationId: string, anchor: ScrollAnchor | null): void {
  if (!anchor) return;
  memory.set(keyOf(kind, conversationId), { anchor, at: Date.now() });
}

/**
 * The anchor to restore on arrival, or null. Consumes the entry. Only a BACK
 * navigation (thread → conversation) restores; a pending deep reveal (`?m=`)
 * always wins over a remembered position.
 */
export function takeScroll(
  kind: "channel" | "dm",
  conversationId: string,
  opts: { revealing: boolean },
): ScrollAnchor | null {
  const key = keyOf(kind, conversationId);
  const entry = memory.get(key);
  memory.delete(key);
  if (!entry || opts.revealing || navDirection.value !== "back") return null;
  if (Date.now() - entry.at > MAX_AGE_MS) return null;
  return entry.anchor;
}

export function clearScrollMemoryForTests(): void {
  memory.clear();
}
