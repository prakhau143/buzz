/**
 * The COMMUNITY session — one generation number per "this identity, in this
 * community, on this socket". Every community switch ends the current
 * generation and starts a new one (`identitySession.ts` owns the transitions).
 *
 * Why a generation and not just the active relay URL: the URL says which
 * community the UI *means*; it cannot say whether a given response or event
 * belongs to the session that is live now. A → B → A has the same URL at both
 * ends, and a request or subscription opened in the first A session must not
 * write into the second. So:
 *
 *  - the relay transport stamps each subscription and one-shot fetch with the
 *    generation it was opened under and drops what arrives for any other
 *    (`RelayConnectionService`, `relayQuery.ts`);
 *  - long-lived consumers (sidebar lists, unread tracking, presence) watch
 *    `communitySessionGeneration` and re-subscribe for the new community —
 *    `disconnect()` closes every subscription, and a component that stays
 *    mounted across the switch would otherwise never subscribe again.
 *
 * `ready` is set only once the session reached READY (socket open, NIP-42
 * accepted, role resolved) — the switcher uses it to present "switching" until
 * the new community is actually usable.
 */
import { computed, shallowRef } from "vue";

interface CommunitySessionState {
  generation: number;
  relayUrl: string | null;
  ready: boolean;
}

const state = shallowRef<CommunitySessionState>({ generation: 0, relayUrl: null, ready: false });

/** Changes on every begin/end — watch it to (re)start per-community work. */
export const communitySessionGeneration = computed(() => state.value.generation);
/** The community whose session is READY, or null while none is (or one is still being established). */
export const readyCommunityUrl = computed(() => (state.value.ready ? state.value.relayUrl : null));

export function currentCommunityGeneration(): number {
  return state.value.generation;
}

export function isCurrentCommunitySession(generation: number): boolean {
  return generation === state.value.generation;
}

/** Start establishing a session for `relayUrl`. Invalidates everything opened before. */
export function beginCommunitySession(relayUrl: string): number {
  const generation = state.value.generation + 1;
  state.value = { generation, relayUrl, ready: false };
  return generation;
}

/** Mark `generation` READY. A no-op (false) when a newer switch has already started. */
export function commitCommunitySession(generation: number): boolean {
  if (!isCurrentCommunitySession(generation)) return false;
  state.value = { ...state.value, ready: true };
  return true;
}

/** End the current session: nothing opened under it may deliver any more. */
export function endCommunitySession(): void {
  state.value = { generation: state.value.generation + 1, relayUrl: null, ready: false };
}

/**
 * Run a community-scoped request and refuse its answer if the community session
 * it started in has ended meanwhile (the HTTP counterpart of the transport guard).
 */
export async function withinCommunitySession<T>(request: () => Promise<T>): Promise<T> {
  const generation = state.value.generation;
  const result = await request();
  if (!isCurrentCommunitySession(generation)) throw new StaleCommunitySessionError();
  return result;
}

/** Thrown for a result that arrived after its community session ended. */
export class StaleCommunitySessionError extends Error {
  constructor() {
    super("The community session this request belonged to has ended.");
    this.name = "StaleCommunitySessionError";
  }
}
