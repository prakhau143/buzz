/**
 * Presence — KIND_PRESENCE_UPDATE (20001), ephemeral, community-global, best-effort
 * (local-node Redis pub/sub only — not confirmed multi-node-safe).
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §5.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import type { PresenceInfo } from "@/types/domain";
import { KIND_PRESENCE_UPDATE } from "./kinds";
import type { NostrFilter, RawNostrEvent } from "./types";

export type PresenceStatus = "online" | "away" | "offline";

export function buildPresenceUpdateEvent(status: PresenceStatus): UnsignedEvent {
  return { kind: KIND_PRESENCE_UPDATE, content: status, tags: [] };
}

export function buildPresenceFilter(): NostrFilter {
  return { kinds: [KIND_PRESENCE_UPDATE] };
}

export function parsePresenceEvent(event: RawNostrEvent): PresenceInfo {
  let status: PresenceStatus = "offline";
  const raw = event.content.trim();
  if (raw === "online" || raw === "away" || raw === "offline") {
    status = raw;
  } else {
    try {
      const parsed = JSON.parse(raw) as { status?: string };
      if (parsed.status === "online" || parsed.status === "away" || parsed.status === "offline") {
        status = parsed.status;
      }
    } catch {
      // Unrecognized payload — treat as offline rather than guessing.
    }
  }
  return { pubkey: event.pubkey, status, updatedAt: event.created_at };
}

/**
 * OLD BUZZ presence semantics (desktop `features/presence/lib/presence.ts`,
 * relay `bridge.rs` `synthesize_presence`, `buzz-pubsub/src/presence.rs`):
 * a status lives in the relay's Redis for 180 s and is refreshed by each
 * member's 60 s heartbeat; 10 min without activity is "away"; a pubkey the
 * relay has no status for is offline.
 */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;
export const PRESENCE_IDLE_TIMEOUT_MS = 10 * 60_000;
/** The relay's own per-filter author cap (NIP-11 `limitation.max_authors`). */
const MAX_AUTHORS_PER_FILTER = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isPresenceStatus(value: string): value is PresenceStatus {
  return value === "online" || value === "away" || value === "offline";
}

/**
 * Snapshot filters for `POST /query`. With exactly one kind (20001) and
 * non-empty `authors` in every filter, the relay answers from Redis with
 * relay-signed kind:20001 events — `content` = status, `["p", subject]`.
 */
export function buildPresenceSnapshotFilters(pubkeys: string[]): NostrFilter[] {
  return chunk(pubkeys, MAX_AUTHORS_PER_FILTER).map((authors) => ({
    kinds: [KIND_PRESENCE_UPDATE],
    authors,
  }));
}

/** Live updates for exactly these people — nothing stored is replayed (`limit: 0`). */
export function buildPresenceLiveFilters(pubkeys: string[]): NostrFilter[] {
  return chunk(pubkeys, MAX_AUTHORS_PER_FILTER).map((authors) => ({
    kinds: [KIND_PRESENCE_UPDATE],
    authors,
    limit: 0,
  }));
}

/** A relay-synthesized snapshot event: the subject is the `p` tag (the relay signs it). */
export function parsePresenceSnapshotEvent(event: RawNostrEvent): PresenceInfo | null {
  if (event.kind !== KIND_PRESENCE_UPDATE) return null;
  const status = event.content.trim();
  if (!isPresenceStatus(status)) return null;
  const subject = event.tags.find((t) => t[0] === "p")?.[1] ?? event.pubkey;
  return { pubkey: subject, status, updatedAt: event.created_at };
}

/**
 * A live kind:20001: trust ONLY the signer. A `p` tag on a live event is
 * ignored — otherwise anyone could publish "offline" for someone else
 * (OLD BUZZ `parseLivePresenceEvent`).
 */
export function parseLivePresenceEvent(event: RawNostrEvent): PresenceInfo | null {
  if (event.kind !== KIND_PRESENCE_UPDATE) return null;
  const status = event.content.trim();
  if (!isPresenceStatus(status)) return null;
  return { pubkey: event.pubkey, status, updatedAt: event.created_at };
}
