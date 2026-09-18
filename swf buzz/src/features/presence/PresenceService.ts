import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import {
  buildPresenceFilter,
  buildPresenceUpdateEvent,
  parsePresenceEvent,
  type PresenceStatus,
} from "@/protocol/presence";
import type { PresenceInfo } from "@/types/domain";

/**
 * Best-effort presence — see docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §5:
 * community-global, ephemeral, local-node Redis pub/sub only (not confirmed
 * multi-node-safe). Don't build UI that promises cross-node accuracy.
 */
class PresenceService {
  async publish(status: PresenceStatus): Promise<void> {
    await signAndPublish(buildPresenceUpdateEvent(status));
  }

  /**
   * KNOWN LIMITATION (see docs/KNOWN_LIMITATIONS.md): kind:20001 is ephemeral
   * ("never persisted", per the protocol reference), so a relay is unlikely
   * to replay historical presence to a fresh REQ — this snapshot will often
   * come back empty until each member's next heartbeat lands while
   * connected. The reference names a `kind:40902` "bulk-presence sidecar"
   * that sounds like the right fix, but its payload shape isn't documented
   * anywhere source-verified — implementing against it would be guessing,
   * so this stays a one-shot REQ on 20001 until that's confirmed.
   */
  async fetchSnapshot(): Promise<Map<string, PresenceInfo>> {
    const events = await fetchEventsOnce([buildPresenceFilter()]);
    const byPubkey = new Map<string, PresenceInfo>();
    for (const event of events) {
      const info = parsePresenceEvent(event);
      const existing = byPubkey.get(info.pubkey);
      if (!existing || existing.updatedAt < info.updatedAt) byPubkey.set(info.pubkey, info);
    }
    return byPubkey;
  }

  subscribe(onUpdate: (info: PresenceInfo) => void): RelaySubscriptionHandle {
    return relayConnectionService.subscribe(
      "presence-live",
      [{ ...buildPresenceFilter(), since: Math.floor(Date.now() / 1000) }],
      { onEvent: (event) => onUpdate(parsePresenceEvent(event)) },
    );
  }
}

export const presenceService = new PresenceService();
