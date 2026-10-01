/**
 * Resolves a pubkey to a display profile (kind:0) and, per
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §10, separately checks whether
 * it's an agent (kind:30177). Cross-feature — used by messages, channels
 * (member lists), and agent mention autocomplete alike.
 */
import { fetchEventsOnce } from "./relayQuery";
import { buildProfileFilter, parseProfileEvent, type ProfileFields } from "@/protocol/profile";
import { saveMyProfile } from "@/features/profile/myProfile";
import { buildManagedAgentsFilter } from "@/protocol/agents";
import { KIND_MANAGED_AGENT } from "@/protocol/kinds";
import { firstTagValue } from "@/protocol/types";
import { absorbProfileEvents, markAgents, profileFor } from "@/features/profile/profileStore";
import type { RawNostrEvent } from "@/protocol/types";
import type { UserProfile } from "@/types/domain";

class ProfileService {
  /**
   * Resolve many pubkeys in ONE relay round trip.
   *
   * Two things made profile lookup N+1 (docs/U0_UI_PROFILE_AUDIT.md §2):
   * `fetchProfile` issued *two* separate `fetchEventsOnce` calls — one for the
   * kind:0, one for the agent check — and every list rendered avatars by calling
   * it once per row. A 50-member list therefore cost ~100 subscriptions.
   *
   * A Nostr REQ carries a LIST of filters, and `fetchEventsOnce` already accepts
   * one, so both questions for every pubkey fit in a single subscription with a
   * single EOSE: 50 members → 1 round trip.
   */
  async fetchProfiles(pubkeys: readonly string[]): Promise<Map<string, UserProfile>> {
    const unique = [...new Set(pubkeys.filter((p) => !!p))];
    const resolved = new Map<string, UserProfile>();
    // No pubkeys means nothing to ask: never open a subscription for an empty list.
    if (unique.length === 0) return resolved;

    const events = await fetchEventsOnce([
      buildProfileFilter(unique),
      buildManagedAgentsFilter(unique),
    ]);

    // A kind:0 is authored BY its subject; a kind:30177 is ABOUT the pubkey in
    // its `d` tag. Split on that rather than on author.
    const agentSubjects = new Set<string>();
    const profileEvents = new Map<string, RawNostrEvent>();
    for (const event of events) {
      if (event.kind === KIND_MANAGED_AGENT) {
        const subject = firstTagValue(event, "d");
        if (subject) agentSubjects.add(subject);
        continue;
      }
      // kind:0 is replaceable, but a relay may still hand back more than one
      // version — keep the newest.
      const existing = profileEvents.get(event.pubkey);
      if (!existing || event.created_at > existing.created_at) {
        profileEvents.set(event.pubkey, event);
      }
    }

    // Everything seen goes through the canonical registry, which keeps the
    // NEWEST event per pubkey — so this relay's answer can refine, but never
    // roll back, a profile already seen newer elsewhere (profileStore.ts).
    markAgents(agentSubjects);
    absorbProfileEvents(profileEvents.values());

    for (const pubkey of unique) {
      const isAgent = agentSubjects.has(pubkey);
      const canonical = profileFor(pubkey);
      const event = profileEvents.get(pubkey);
      resolved.set(
        pubkey,
        canonical ??
          (event ? parseProfileEvent(event, isAgent) : { pubkey, displayName: pubkey.slice(0, 8), isAgent }),
      );
    }
    return resolved;
  }

  /** Single-pubkey convenience — the batched path with a list of one. */
  async fetchProfile(pubkey: string): Promise<UserProfile> {
    const resolved = await this.fetchProfiles([pubkey]);
    return resolved.get(pubkey) ?? { pubkey, displayName: pubkey.slice(0, 8), isAgent: false };
  }

  /**
   * Whether `pubkey` has published a kind:0 at all. `fetchProfile` cannot tell —
   * it falls back to a pubkey-derived name — but onboarding must know whether to
   * ask for a profile.
   */
  async hasProfile(pubkey: string): Promise<boolean> {
    const events = await fetchEventsOnce([{ ...buildProfileFilter([pubkey]), limit: 1 }]);
    return events.length > 0;
  }

  /**
   * Publish (replace) the signed-in identity's kind:0 — the ONE write path
   * (`features/profile/myProfile.ts`): merges into the newest existing event so
   * fields SWF does not edit survive, updates every surface at once, and
   * replicates to every community this identity belongs to.
   */
  async publishProfile(fields: ProfileFields): Promise<void> {
    await saveMyProfile(fields);
  }
}

export const profileService = new ProfileService();
