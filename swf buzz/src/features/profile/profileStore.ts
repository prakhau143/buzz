import { shallowReactive } from "vue";
import { parseProfileEvent } from "@/protocol/profile";
import type { RawNostrEvent } from "@/protocol/types";
import type { UserProfile } from "@/types/domain";

/**
 * THE canonical profile registry — identity-level, keyed by pubkey only.
 *
 * Why: every surface used to show whatever its own Vue Query entry happened to
 * hold, fetched from whichever community was open at the time (single-profile
 * entries, batch entries per exact set of people, a 5-minute staleTime, no live
 * updates). So the same person could read "Prakhar Mittal" in the sidebar and an
 * older name in a member list, and a switch to another community — whose relay
 * held an older kind:0 — flipped the name back (docs/SWF_SETTINGS_FEEDBACK_IMPLEMENTATION.md §5).
 *
 * Now every signed kind:0 the app sees — from any community, a live
 * subscription, the local cache or a save — is ABSORBED here, and every surface
 * renders from here (`useProfile`, `useProfileMap`, mentions). The rule is the
 * NIP-01 replaceable-event rule: the newest `created_at` wins, ties go to the
 * lower event id. So a stale answer (an older relay, a cached copy) can never
 * overwrite a newer one, whatever order they arrive in.
 *
 * Not cleared on a community switch — that is the point: a newer profile seen
 * in community A still wins while B's relay serves an older one. Cleared when
 * the identity changes (identitySession.ts).
 */

const events = shallowReactive(new Map<string, RawNostrEvent>());
const agents = shallowReactive(new Set<string>());

/** True when `candidate` should replace `current` (NIP-01 replaceable ordering). */
export function isNewerProfileEvent(candidate: RawNostrEvent, current: RawNostrEvent | undefined): boolean {
  if (!current) return true;
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at;
  return candidate.id < current.id;
}

function isProfileEvent(event: RawNostrEvent | null | undefined): event is RawNostrEvent {
  return !!event && event.kind === 0 && typeof event.pubkey === "string" && typeof event.created_at === "number";
}

/** Offer events; each is kept only if it is newer than what is held. Returns the pubkeys that changed. */
export function absorbProfileEvents(incoming: Iterable<RawNostrEvent | null | undefined>): string[] {
  const changed: string[] = [];
  for (const event of incoming) {
    if (!isProfileEvent(event)) continue;
    if (isNewerProfileEvent(event, events.get(event.pubkey))) {
      events.set(event.pubkey, event);
      changed.push(event.pubkey);
    }
  }
  return changed;
}

export function markAgents(pubkeys: Iterable<string>): void {
  for (const pubkey of pubkeys) agents.add(pubkey);
}

export function profileEventFor(pubkey: string | null | undefined): RawNostrEvent | null {
  return pubkey ? (events.get(pubkey) ?? null) : null;
}

/** The profile to render, or `null` when no kind:0 has been seen for this pubkey yet. */
export function profileFor(pubkey: string | null | undefined): UserProfile | null {
  const event = profileEventFor(pubkey);
  return event ? parseProfileEvent(event, agents.has(event.pubkey)) : null;
}

export function isKnownAgent(pubkey: string): boolean {
  return agents.has(pubkey);
}

export function clearProfileStore(): void {
  events.clear();
  agents.clear();
}
