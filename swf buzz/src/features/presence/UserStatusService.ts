import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import {
  buildClearStatusEvent,
  buildSetStatusEvent,
  buildStatusFetchFilter,
  buildStatusLiveFilter,
  parseStatusEvent,
  type UserStatus,
} from "@/protocol/userStatus";
import type { RawNostrEvent } from "@/protocol/types";

/** The relay's per-filter author cap (NIP-11 `limitation.max_authors`). */
const MAX_AUTHORS = 20;

export interface StatusUpdate {
  pubkey: string;
  status: UserStatus | null;
  updatedAt: number;
}

function toUpdate(event: RawNostrEvent): StatusUpdate {
  return { pubkey: event.pubkey, status: parseStatusEvent(event), updatedAt: event.created_at };
}

/**
 * NIP-38 statuses over the WebSocket, as OLD BUZZ reads and writes them
 * (there is no HTTP path for 30315). kind:30315 is parameterized-replaceable,
 * so the relay keeps each person's newest status and a fetch returns it.
 */
class UserStatusService {
  async set(params: { emoji: string; text: string; expiresAt: number | null }): Promise<StatusUpdate> {
    return toUpdate(await signAndPublish(buildSetStatusEvent(params)));
  }

  async clear(): Promise<StatusUpdate> {
    return toUpdate(await signAndPublish(buildClearStatusEvent()));
  }

  /** Newest status event per pubkey (a clear comes back as `status: null`). */
  async fetch(pubkeys: string[]): Promise<StatusUpdate[]> {
    const filters = [];
    for (let i = 0; i < pubkeys.length; i += MAX_AUTHORS) {
      filters.push(buildStatusFetchFilter(pubkeys.slice(i, i + MAX_AUTHORS)));
    }
    if (!filters.length) return [];
    const events = await fetchEventsOnce(filters);
    const newest = new Map<string, RawNostrEvent>();
    for (const e of events) {
      const held = newest.get(e.pubkey);
      if (!held || held.created_at < e.created_at) newest.set(e.pubkey, e);
    }
    return [...newest.values()].map(toUpdate);
  }

  subscribe(onUpdate: (update: StatusUpdate) => void): RelaySubscriptionHandle {
    return relayConnectionService.subscribe("status-live", [buildStatusLiveFilter()], {
      onEvent: (event) => onUpdate(toUpdate(event)),
    });
  }
}

export const userStatusService = new UserStatusService();
