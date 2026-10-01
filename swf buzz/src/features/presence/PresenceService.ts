import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { queryRelayBridge } from "@/services/relayBridgeQuery";
import { signAndPublish } from "@/services/publish";
import {
  buildPresenceLiveFilters,
  buildPresenceSnapshotFilters,
  buildPresenceUpdateEvent,
  parseLivePresenceEvent,
  parsePresenceSnapshotEvent,
  type PresenceStatus,
} from "@/protocol/presence";
import type { PresenceInfo } from "@/types/domain";

/**
 * Presence transport, exactly as OLD BUZZ does it:
 *  - publish: kind:20001, content = status, over the WebSocket (the relay
 *    refuses presence over HTTP);
 *  - snapshot: `POST /query` `{kinds:[20001], authors}` — the relay answers
 *    from its presence store, so it is real current state, not a replay;
 *  - live: WS REQ `{kinds:[20001], authors, limit:0}`.
 *
 * The previous snapshot was a WS REQ for stored kind:20001 events. 20001 is
 * ephemeral and never stored, so it always came back empty — and every new
 * consumer's refetch replaced everyone's known status with that empty map.
 */
class PresenceService {
  async publish(status: PresenceStatus): Promise<void> {
    await signAndPublish(buildPresenceUpdateEvent(status));
  }

  /** Current status of each pubkey; anyone the relay omits is offline. */
  async fetchSnapshot(pubkeys: string[]): Promise<Map<string, PresenceInfo>> {
    const now = Math.floor(Date.now() / 1000);
    const result = new Map<string, PresenceInfo>(
      pubkeys.map((pubkey) => [pubkey, { pubkey, status: "offline", updatedAt: now }]),
    );
    if (pubkeys.length === 0) return result;
    const events = await queryRelayBridge(buildPresenceSnapshotFilters(pubkeys));
    for (const event of events) {
      const info = parsePresenceSnapshotEvent(event);
      if (info && result.has(info.pubkey)) result.set(info.pubkey, info);
    }
    return result;
  }

  subscribe(pubkeys: string[], onUpdate: (info: PresenceInfo) => void): RelaySubscriptionHandle {
    return relayConnectionService.subscribe("presence-live", buildPresenceLiveFilters(pubkeys), {
      onEvent: (event) => {
        const info = parseLivePresenceEvent(event);
        if (info) onUpdate(info);
      },
    });
  }
}

export const presenceService = new PresenceService();
