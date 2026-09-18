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
