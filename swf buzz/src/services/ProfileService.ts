/**
 * Resolves a pubkey to a display profile (kind:0) and, per
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §10, separately checks whether
 * it's an agent (kind:30177). Cross-feature — used by messages, channels
 * (member lists), and agent mention autocomplete alike.
 */
import { fetchEventsOnce } from "./relayQuery";
import { buildProfileFilter, parseProfileEvent } from "@/protocol/profile";
import { buildManagedAgentFilter } from "@/protocol/agents";
import type { UserProfile } from "@/types/domain";

class ProfileService {
  async fetchProfile(pubkey: string): Promise<UserProfile> {
    const [profileEvents, agentEvents] = await Promise.all([
      fetchEventsOnce([buildProfileFilter([pubkey])]),
      fetchEventsOnce([buildManagedAgentFilter(pubkey)]),
    ]);
    const isAgent = agentEvents.length > 0;
    if (profileEvents[0]) {
      return parseProfileEvent(profileEvents[0], isAgent);
    }
    return { pubkey, displayName: pubkey.slice(0, 8), isAgent };
  }
}

export const profileService = new ProfileService();
