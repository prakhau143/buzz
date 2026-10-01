import { buildNip98AuthHeader } from "@/services/nip98";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { logError } from "@/services/errors";
import { buildProfileFilter, parseProfileEvent } from "@/protocol/profile";
import { communities, relayHttpBase } from "@/features/communities/relayCommunities";

import { config } from "@/app/config";
import type { RawNostrEvent } from "@/protocol/types";
import type { SignedEvent } from "@/features/signing/types";
import type { UserProfile } from "@/types/domain";
import { absorbProfileEvents } from "./profileStore";

/**
 * The profile belongs to the IDENTITY, not to a community.
 *
 * **Why this module exists.** A Buzz "community" is a relay tenant selected by
 * the HTTP `Host` (`relayCommunities.ts`), and each tenant has its own event
 * store. `ProfileService.hasProfile` asks `fetchEventsOnce`, which goes through
 * the singleton socket — i.e. only ever the community you are currently in. So
 * a kind:0 published while in community A genuinely does not exist in community
 * B, and onboarding asked for a profile again on every community entry.
 *
 * The fix is to resolve a profile across every community this identity knows
 * about, keep the NEWEST signed event per pubkey, and — when the community you
 * just entered does not have it — re-publish that **same already-signed event**
 * there in the background. Nothing is re-signed and the event format is
 * untouched, so this is a replication, not an edit.
 *
 * Other communities are queried over the relay's HTTP `POST /query` (the same
 * NIP-98-signed endpoint `communityDiscovery` uses for membership), because the
 * WebSocket singleton can only be connected to one community at a time.
 */

const CACHE_PREFIX = "swf_profile_event.";

/** The newest kind:0 seen for a pubkey, cached per identity (public data only). */
function readCache(pubkey: string): RawNostrEvent | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + pubkey);
    if (!raw) return null;
    const event = JSON.parse(raw) as RawNostrEvent;
    return event?.pubkey === pubkey && typeof event.created_at === "number" ? event : null;
  } catch {
    return null;
  }
}

function writeCache(event: RawNostrEvent): void {
  try {
    localStorage.setItem(CACHE_PREFIX + event.pubkey, JSON.stringify(event));
  } catch {
    // Storage blocked: resolution still works, just without the fast path.
  }
}

/** This device's newest signed kind:0 for `pubkey` (public data), if any. */
export function readCachedProfileEvent(pubkey: string): RawNostrEvent | null {
  return readCache(pubkey);
}

/** Remember a freshly published profile so other communities resolve it instantly. */
export function rememberProfileEvent(event: RawNostrEvent): void {
  writeCache(event);
}

export function clearProfileCache(pubkey: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + pubkey);
  } catch {
    // ignore
  }
}

/** Ask ONE community's relay over HTTP for this pubkey's kind:0. Never throws. */
async function fetchProfileFrom(relayUrl: string, pubkey: string): Promise<RawNostrEvent | null> {
  const url = `${relayHttpBase(relayUrl)}/query`;
  const body = JSON.stringify([{ ...buildProfileFilter([pubkey]), limit: 1 }]);
  try {
    const authorization = await buildNip98AuthHeader(url, "POST", body);
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null; // 403 = not a member here, 404 = no such community
    const events = (await response.json()) as RawNostrEvent[];
    return Array.isArray(events) ? (newest(events) ?? null) : null;
  } catch {
    return null;
  }
}

function newest(events: RawNostrEvent[]): RawNostrEvent | undefined {
  return events.length ? events.reduce((a, b) => (b.created_at > a.created_at ? b : a)) : undefined;
}

export interface ResolvedIdentityProfile {
  /** The newest signed kind:0 found anywhere, or `null` when this identity has none. */
  event: RawNostrEvent | null;
  profile: UserProfile | null;
  /** True when the CURRENT community's relay already had it. */
  presentInCurrentCommunity: boolean;
}

/**
 * Find this identity's profile anywhere it may live, newest wins:
 *   1. the local cache for this pubkey,
 *   2. the community currently open (over the live socket),
 *   3. every other community this device knows about, plus the home relay.
 *
 * Never throws: a community that is unreachable, refuses us, or no longer
 * exists simply contributes nothing.
 */
export async function resolveIdentityProfile(pubkey: string): Promise<ResolvedIdentityProfile> {
  const candidates: RawNostrEvent[] = [];

  const cached = readCache(pubkey);
  if (cached) candidates.push(cached);

  let here: RawNostrEvent | undefined;
  try {
    here = newest(await fetchEventsOnce([{ ...buildProfileFilter([pubkey]), limit: 1 }]));
    if (here) candidates.push(here);
  } catch (err) {
    logError("identityProfile.currentCommunity", err);
  }

  // Only ask elsewhere when the open community does not already have it.
  if (!here) {
    const others = new Set<string>([config.relayUrl, ...communities.value.map((c) => c.relayUrl)]);
    const results = await Promise.all(
      [...others].map((relayUrl) => fetchProfileFrom(relayUrl, pubkey)),
    );
    for (const event of results) if (event) candidates.push(event);
  }

  const event = newest(candidates) ?? null;
  if (event) writeCache(event);
  // Every copy seen feeds the canonical registry (newest wins), so the UI and
  // the onboarding gate can never disagree about the name.
  absorbProfileEvents(candidates);
  return {
    event,
    profile: event ? parseProfileEvent(event) : null,
    presentInCurrentCommunity: !!here,
  };
}

/**
 * Replicate an already-signed profile into the community currently open, when
 * that community does not have it. The event is published verbatim — same id,
 * same signature — so this never counts as an edit and never re-signs.
 *
 * Best effort by design: onboarding must not block on it, and a relay that
 * rejects it (not a member yet, transient failure) simply leaves the profile
 * unreplicated until next time.
 */
export async function replicateProfileHere(event: RawNostrEvent): Promise<boolean> {
  try {
    await relayConnectionService.publish(event as unknown as SignedEvent);
    return true;
  } catch (err) {
    logError("identityProfile.replicate", err);
    return false;
  }
}

/**
 * The onboarding question, answered across communities: does this identity have
 * a profile anywhere? If it does and the open community lacks it, replicate it
 * there in the background and answer `true` immediately — the person is never
 * asked again for a profile they already have.
 */
export async function hasIdentityProfileAnywhere(pubkey: string): Promise<boolean> {
  const resolved = await resolveIdentityProfile(pubkey);
  if (!resolved.event) return false;
  if (!resolved.presentInCurrentCommunity) {
    void replicateProfileHere(resolved.event);
  }
  return true;
}
