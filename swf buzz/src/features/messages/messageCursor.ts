import type { Message } from "@/types/domain";

/**
 * The single ordering / cursor / merge rule for channel timelines.
 *
 * Every source of messages — initial history, older pages, the live
 * subscription, reconnect backfill and optimistic reconciliation — goes through
 * here. Before this module each of those sorted independently with
 * `a.createdAt - b.createdAt` and no tiebreak, so two messages sharing a second
 * fell back to arrival order and history could disagree with live.
 *
 * Grounded in the relay's own page order
 * (`crates/buzz-db/src/store/event.rs:626-636`):
 *
 *   ORDER BY created_at DESC, id ASC
 *   next page: created_at < until OR (created_at = until AND id > before_id)
 */

/** A position in the timeline. `id` disambiguates messages sharing a second. */
export interface MessageCursor {
  createdAt: number;
  id: string;
}

/**
 * Canonical total order for display: oldest first, ties broken by event id.
 *
 * The tiebreak direction matches the relay's within-second `id ASC`, so the
 * order a page arrives in is the order it renders in. Messages sharing a second
 * are simultaneous, so any deterministic rule is correct — what matters is that
 * it is the SAME rule everywhere.
 */
export function compareMessages(a: Message, b: Message): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The cursor for requesting the NEXT older page.
 *
 * Subtle and easy to get wrong: this is NOT simply the first element after
 * sorting ascending. The relay walks `created_at DESC, id ASC`, so within the
 * oldest loaded second it has already returned ids in ascending order and the
 * next page continues at `id > cursor.id`. The cursor must therefore be the
 * smallest `createdAt` and, among ties, the LARGEST `id` — otherwise a
 * same-second message with a smaller id is skipped forever.
 */
export function oldestCursor(messages: readonly Message[]): MessageCursor | null {
  let cursor: MessageCursor | null = null;
  for (const m of messages) {
    if (
      cursor === null ||
      m.createdAt < cursor.createdAt ||
      (m.createdAt === cursor.createdAt && m.id > cursor.id)
    ) {
      cursor = { createdAt: m.createdAt, id: m.id };
    }
  }
  return cursor;
}

/** The newest `createdAt` seen, used as the reconnect backfill anchor. */
export function newestCreatedAt(messages: readonly Message[]): number | null {
  let newest: number | null = null;
  for (const m of messages) {
    if (newest === null || m.createdAt > newest) newest = m.createdAt;
  }
  return newest;
}

/**
 * Merge messages into a timeline: deduplicated by event id and canonically
 * ordered. Idempotent — merging the same events repeatedly cannot change the
 * result, which is what makes the live/backfill race safe without any timing
 * assumptions.
 *
 * `incoming` wins on an id collision so a confirmed relay event replaces the
 * optimistic copy of itself rather than being discarded as a duplicate.
 */
export function mergeMessages(
  existing: readonly Message[],
  incoming: readonly Message[],
): Message[] {
  if (incoming.length === 0) return [...existing];
  const byId = new Map<string, Message>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(compareMessages);
}
