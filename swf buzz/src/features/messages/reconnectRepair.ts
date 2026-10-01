/**
 * Reconnect gap repair for channel timelines.
 *
 * Constants and semantics are taken from OLD BUZZ's own reconnect replay
 * (`desktop/src/shared/api/relayReconnectReplay.ts:17-30`), not invented.
 */

/** Clock-skew allowance between this client and the relay. */
export const RECONNECT_REPLAY_SKEW_SECS = 5;

/**
 * The relay ACCEPTS events whose `created_at` is up to 900 s in the future, and
 * the DB floor allows 960 s — so an event that arrived while we were offline
 * can carry a timestamp well ahead of the newest one we hold. Looking back only
 * a few seconds would step straight over it. These are OLD BUZZ's numbers
 * (`relayReconnectReplay.ts:22-25`).
 */
export const RELAY_INGEST_FUTURE_TOLERANCE_SECS = 900;
export const DB_CREATED_AT_FLOOR_SECS = 960;
export const FENCE_CLOCK_MARGIN_SECS = 5;

export const RECONNECT_REPLAY_CHANNEL_LOOKBACK_SECS =
  RELAY_INGEST_FUTURE_TOLERANCE_SECS + DB_CREATED_AT_FLOOR_SECS + FENCE_CLOCK_MARGIN_SECS;

export const RECONNECT_REPLAY_PAGE_LIMIT = 500;

/**
 * Where a reconnect backfill should start reading from.
 *
 * `newestSeen` is the newest `created_at` the client holds. The lookback is
 * deliberately generous; re-reading events we already have costs one request
 * and is discarded by id-based dedup, whereas reading too late loses a message
 * silently and permanently. When nothing is held yet there is no anchor, so the
 * caller should do a normal initial fetch instead.
 */
export function backfillSince(newestSeen: number | null): number | null {
  if (newestSeen === null) return null;
  return Math.max(0, newestSeen - RECONNECT_REPLAY_CHANNEL_LOOKBACK_SECS);
}

/**
 * Where the live subscription should start.
 *
 * Anchored to what we hold (minus a small skew) rather than `Date.now()`: a
 * wall-clock `since` opens a hole between the history fetch finishing and the
 * socket subscribing, and anything published in that window is never delivered.
 */
export function liveSince(newestSeen: number | null, now: number): number {
  if (newestSeen === null) return now - RECONNECT_REPLAY_SKEW_SECS;
  return Math.max(0, newestSeen - RECONNECT_REPLAY_SKEW_SECS);
}
