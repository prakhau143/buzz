/**
 * The identity session — ONE explicit lifecycle for "who is this app acting as
 * right now", shared by every entry point (continue / create / import / switch
 * / silent resume / sign out) and by the real-relay E2E tests, so the code
 * under test is the app's own switching logic, not a re-implementation.
 *
 *   NO_IDENTITY → IDENTITY_LOADED → SIGNER_READY → RELAY_CONNECTING
 *               → NIP42_AUTHENTICATED → ROLE_RESOLVED → READY
 *
 * and, on SWF sign-out (`endIdentitySessionAndRemoveIdentity`):
 *
 *   READY → disconnect → destroy signer → clear active identity → clear roles
 *         → clear community/channel/DM selection → clear identity-scoped caches
 *         → REMOVE the identity from this device (Rust) → verify none is left
 *         → NO_IDENTITY
 *
 * This differs from OLD BUZZ on purpose: OLD BUZZ's sign-out keeps the key on
 * the device; SWF Buzz runs on shared/work machines, so sign-out means the next
 * person can never see, continue with, or recover the previous identity. The
 * session-only teardown (`endIdentitySession`) still exists for the paths that
 * are NOT a sign-out: establishing a new session, switching community, and
 * "Switch / Import another identity" (where Rust archives-then-replaces).
 *
 * Invariants this module exists to enforce (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md):
 *  - `beginIdentitySession` ALWAYS tears the previous session down first, so
 *    two identities can never share the singleton signer or socket.
 *  - "authenticated" means the socket's NIP-42 AUTH was signed by THIS pubkey
 *    (`connection.authenticatedPubkey`), not merely that a socket is open.
 *  - Platform role (operator) and community role (owner/admin/member) are
 *    resolved by separate relay answers and stored in separate fields; neither
 *    is ever derived from the other, a label, a hostname, or a previous session.
 *  - Nothing here touches private key material. Signers are opaque; the local
 *    identity's key never leaves Rust.
 */
import { stopPresenceSync } from "@/features/presence/presenceSync";
import { clearProfileStore } from "@/features/profile/profileStore";
import { stopProfileSync } from "@/features/profile/profileSync";
import { useNavHistoryStore } from "@/stores/navHistory";
import { useThreadIndexStore } from "@/stores/threadIndex";
import { defineStore } from "pinia";
import { queryClient } from "@/app/providers/queryClient";
import { config } from "@/app/config";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { logError } from "@/services/errors";
import { relayMembersService } from "@/features/community-members/RelayMembersService";
import { resolveMyRole } from "@/features/community-members/permissions";
import { operatorService } from "@/features/communities/OperatorService";
import { clearActiveRelay, setActiveRelay } from "@/features/communities/relayCommunities";
import {
  beginCommunitySession,
  commitCommunitySession,
  endCommunitySession,
  isCurrentCommunitySession,
} from "@/features/communities/communitySession";
import {
  clearActiveSigningService,
  setActiveSigningService,
} from "@/features/signing/signingServiceRegistry";
import type { SigningService } from "@/features/signing/types";
import { deleteIdentity, IDENTITY_REMOVAL_FAILED_MESSAGE } from "@/features/identity/identityApi";
import type { LocalIdentityInfo } from "@/features/signing/signingService.tauri";
import { useSessionStore, type AuthMode, type PlatformRole } from "@/stores/session";
import { useAccessStore } from "@/stores/access";
import { useConnectionStore } from "@/stores/connection";
import { useUiStore } from "@/stores/ui";
import { useReadStateStore } from "@/stores/readState";
import { forgetReadStateIdentifiers } from "@/services/ReadStateService";
import { useDiagnosticsStore } from "@/stores/diagnostics";
import type { RelayMemberRole } from "@/protocol/relayMembers";

export type IdentitySessionPhase =
  | "NO_IDENTITY"
  | "IDENTITY_LOADED"
  | "SIGNER_READY"
  | "RELAY_CONNECTING"
  | "NIP42_AUTHENTICATED"
  | "ROLE_RESOLVED"
  | "READY";

/** Human-readable step list shown while a session is being established (LoginView). */
export const PHASE_LABELS: Record<IdentitySessionPhase, string> = {
  NO_IDENTITY: "No identity active",
  IDENTITY_LOADED: "Identity loaded",
  SIGNER_READY: "Authenticating…",
  RELAY_CONNECTING: "Connecting…",
  NIP42_AUTHENTICATED: "NIP-42 ✓",
  ROLE_RESOLVED: "Resolving permissions…",
  READY: "Ready",
};

/**
 * Small, client-only progress indicator for the lifecycle — what LoginView
 * renders as "Authenticating… → NIP-42 ✓ → Resolving permissions… → Ready".
 * Not authority: authority is the session/access/connection stores.
 */
export const useIdentitySessionStore = defineStore("identitySession", {
  state: () => ({
    phase: "NO_IDENTITY" as IdentitySessionPhase,
    /** Set when a phase fails, so the UI can show where it stopped. */
    failedAt: null as IdentitySessionPhase | null,
  }),
  actions: {
    setPhase(phase: IdentitySessionPhase) {
      this.phase = phase;
      this.failedAt = null;
    },
    fail(at: IdentitySessionPhase) {
      this.failedAt = at;
    },
    reset() {
      this.phase = "NO_IDENTITY";
      this.failedAt = null;
    },
  },
});

/**
 * Everything the UI is allowed to know about the established session — public
 * information only. Logged by the E2E tests after every switch in exactly this
 * shape (never a private key).
 */
export interface IdentitySessionReport {
  pubkey: string;
  authMode: AuthMode;
  /** The pubkey that signed this socket's NIP-42 AUTH, from the signed event. */
  relayAuthenticatedPubkey: string | null;
  communityRole: RelayMemberRole | null;
  platformRole: PlatformRole | null;
}

/**
 * End the SESSION completely and idempotently: nothing that belonged to the
 * previous identity remains reachable — not the signer, not the socket, not a
 * role, not a selected channel, not a cached roster. Does NOT touch the identity
 * in secure storage.
 *
 * This is the teardown half of every lifecycle transition. It is NOT the SWF
 * sign-out by itself — sign-out is `endIdentitySessionAndRemoveIdentity`, which
 * runs this and then removes the identity from the device. The session-only
 * form remains for: `beginIdentitySession` (a new session never inherits the
 * old one), `switchCommunity` (same person, another relay) and "Switch / Import
 * another identity" (Rust archives-then-replaces the key itself).
 */
export function endIdentitySession(): void {
  tearDownConnectionScopedState();
  // Profiles are identity-level (kept across community switches on purpose);
  // a new identity starts from nothing.
  stopProfileSync();
  clearProfileStore();
  // Identity, roles, routing decision, and the diagnostic trail of this attempt.
  useSessionStore().clearSession();
  useAccessStore().clear();
  useIdentitySessionStore().reset();
  useDiagnosticsStore().clear();
  // The "last opened community" is a per-person choice: the next identity's
  // community is decided again by `resolveAccess` for its own pubkey (Part D).
  clearActiveRelay();
}

/** Outcome of an SWF sign-out. `removed: false` means the identity is STILL on the device. */
export type SignOutResult = { removed: true } | { removed: false; error: string };

/**
 * THE SWF sign-out (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §3):
 * end the session, then remove the current identity from this device and
 * verify nothing is left. Order matters and is fixed:
 *
 *   disconnect → cancel reconnect (generation) → clear signer → clear
 *   session / roles / access / connection / selection / read state / agent
 *   activity → clear every cache → Rust `delete_identity` → `get_identity()`
 *   reports none → done.
 *
 * Sign-out is only *complete* after the verified removal. If Rust cannot remove
 * the identity, the session is still gone (nothing can sign or publish as the
 * old identity any more) but the device is NOT clean: the result says so and
 * `session.identityRemovalError` carries the reason for the login screen. The
 * caller must never present that as a successful sign-out.
 *
 * `remove` is injectable so the real-relay E2E (which has no desktop process to
 * host the Tauri command) can supply a fake device store; the app passes nothing.
 */
export async function endIdentitySessionAndRemoveIdentity(
  remove: () => Promise<LocalIdentityInfo> = deleteIdentity,
): Promise<SignOutResult> {
  const session = useSessionStore();
  // Captured before teardown clears it — needed to forget this identity's
  // read-state coordinate below.
  const removedPubkey = session.pubkey;
  endIdentitySession();
  try {
    const info = await remove();
    if (info.pubkey !== null) {
      // Rust resolved but a key is still loaded: not removed, whatever it said.
      throw new Error(IDENTITY_REMOVAL_FAILED_MESSAGE);
    }
    // The key is gone from this device, so the local NIP-RS slot/client ids for
    // it are unusable: without the key their blobs can no longer be decrypted
    // or rewritten. Leaving them would hand the next person on a shared machine
    // a stale coordinate naming the previous identity.
    if (removedPubkey) forgetReadStateIdentifiers(removedPubkey);
  } catch (err) {
    logError("identitySession.removeIdentity", err);
    const error =
      err instanceof Error && err.message ? err.message : IDENTITY_REMOVAL_FAILED_MESSAGE;
    session.setIdentityRemovalError(error);
    return { removed: false, error };
  }
  session.setIdentityRemovalError(null);
  return { removed: true };
}

/**
 * The part of teardown that is about the *connection* rather than the person:
 * socket, signer, connection verdicts, selected channel/DM/thread, read state,
 * agent activity and every relay-backed cache. Shared by sign-out and by
 * "same identity, different community" (`switchCommunity`), where the person
 * stays but nothing fetched from the previous relay may be shown as the new
 * one's (query keys are identity-scoped, not relay-scoped — see queryKeys.ts).
 */
function tearDownConnectionScopedState(): void {
  // 0. The community session: from here on nothing opened under it (a late
  //    fetch, an event already on the wire) may deliver into app state.
  endCommunitySession();
  // 1. The socket: unsubscribe everything, close, and invalidate in-flight connects.
  relayConnectionService.disconnect();
  // 2. The signer: the next session must set its own. (For the local identity
  //    the signer is a stateless proxy to Rust; clearing it here means "no one
  //    may sign until a session is established again".)
  clearActiveSigningService();
  // 3. Connection verdicts (auth denial, authenticated pubkey, reconnect count).
  useConnectionStore().resetForSignOut();
  // 4. Identity-scoped UI state.
  useUiStore().resetForSignOut();
  useReadStateStore().$reset();
  // Presence: close its subscription and forget every status (per-identity view).
  stopPresenceSync();
  // Back/Forward history belongs to this session's community (never carried across).
  useNavHistoryStore().reset();
  // Thread counts belong to this session's community.
  useThreadIndexStore().reset();
  // 5. Every relay-backed cache. Keys are identity-scoped as well
  //    (queryKeys.ts), so this frees memory rather than being the only guard.
  queryClient.clear();
}

/**
 * Resolve the PLATFORM role for `pubkey` — the relay's answer to a NIP-98
 * signed probe of `/operator/*`. Independent of any community; a failure or
 * refusal is simply "not an operator". Requires the signer to be active.
 */
export async function resolvePlatformRole(): Promise<PlatformRole | null> {
  const session = useSessionStore();
  const probe = await operatorService.probeOperator(config.relayUrl, session.pubkey);
  // A probe signed by someone other than the session's identity is not an
  // answer about this identity at all — treat it as "no", and record it.
  if (
    probe.signerPubkey !== null &&
    session.pubkey !== null &&
    probe.signerPubkey !== session.pubkey
  ) {
    useDiagnosticsStore().recordIdentityMismatch(session.pubkey, probe.signerPubkey);
    session.setPlatformRole(null);
    return null;
  }
  const role: PlatformRole | null = probe.status === 200 ? "operator" : null;
  session.setPlatformRole(role);
  return role;
}

export interface BeginIdentitySessionInput {
  signer: SigningService;
  pubkey: string;
  relayUrl: string;
  authMode?: AuthMode;
  /** Also run the operator probe here (default false — the app's `resolveAccess` already did). */
  resolvePlatform?: boolean;
}

/**
 * Establish a session for ONE identity on ONE community relay: tear down
 * whatever was active, install the signer, connect, require a NIP-42 AUTH
 * signed by this very pubkey, then resolve the community role (relay_members)
 * and, separately, the platform role (operator probe).
 *
 * Returns `null` when the relay could not be reached or refused the identity —
 * the session store then carries the reason (`authError`) and the signer is
 * left active on purpose so the background reconnect can still answer the
 * relay's challenge once it is back (the pre-existing silent-resume contract).
 */
export async function beginIdentitySession(
  input: BeginIdentitySessionInput,
): Promise<IdentitySessionReport | null> {
  const { signer, pubkey, relayUrl } = input;
  const authMode = input.authMode ?? "local";
  const lifecycle = useIdentitySessionStore();
  const session = useSessionStore();
  const connection = useConnectionStore();

  // A new session never inherits a socket, signer, selection or cache from the
  // previous one. If the PERSON changes too, the routing decision and platform
  // role go as well; if it is the same pubkey opening another community (or
  // continuing right after `resolveAccess`), those answers are still theirs.
  const samePerson = session.pubkey === pubkey;
  tearDownConnectionScopedState();
  if (!samePerson) {
    stopProfileSync();
    clearProfileStore();
    session.clearSession();
    useAccessStore().clear();
    useDiagnosticsStore().clear();
    clearActiveRelay();
  }
  lifecycle.reset();

  lifecycle.setPhase("IDENTITY_LOADED");
  setActiveSigningService(signer);
  lifecycle.setPhase("SIGNER_READY");
  session.setIdentity({ authMode, employeeEmail: null, applicationUserId: null, pubkey });

  lifecycle.setPhase("RELAY_CONNECTING");
  // This session's community — set here (after any teardown) so HTTP helpers
  // that read `activeRelayUrl` address the community this socket is in.
  setActiveRelay(relayUrl);
  const generation = beginCommunitySession(relayUrl);
  await relayConnectionService.connect(relayUrl);
  // Another switch started while this one was connecting: that one owns the
  // socket and the stores now, so this attempt must not touch either.
  if (!isCurrentCommunitySession(generation)) return null;
  if (!connection.isUsable) {
    lifecycle.fail("RELAY_CONNECTING");
    session.setAuthError(
      connection.lastError ?? "Can't reach the Buzz server right now. Please try again.",
    );
    return null;
  }

  // The relay challenged us and OUR signer answered: the signed AUTH event's
  // pubkey must be the identity we are establishing. A relay that never
  // challenges (no NIP-42) leaves this null — reported, not treated as a
  // mismatch. Any OTHER pubkey means the wrong signer answered: refuse.
  const authenticatedAs = connection.authenticatedPubkey;
  if (authenticatedAs !== null && authenticatedAs !== pubkey) {
    lifecycle.fail("NIP42_AUTHENTICATED");
    logError(
      "identitySession.beginIdentitySession",
      new Error(`NIP-42 AUTH was signed by a different identity than the one being established`),
    );
    endIdentitySession();
    session.setAuthError(
      "The connection was authenticated as a different identity. Please sign in again.",
    );
    return null;
  }
  lifecycle.setPhase("NIP42_AUTHENTICATED");

  session.setAuthStatus("resolvingRole");
  lifecycle.setPhase("ROLE_RESOLVED");
  let role: RelayMemberRole | null;
  try {
    const members = await relayMembersService.fetchMembershipList();
    role = resolveMyRole(members, pubkey);
  } catch (err) {
    logError("identitySession.resolveCommunityRole", err);
    role = null;
  }
  if (!isCurrentCommunitySession(generation)) return null;
  session.setCommunityRole(role);

  // Platform role is a separate relay answer. In the app, `resolveAccess` has
  // already probed for this pubkey before any community is opened, so the
  // default is not to ask twice; callers that establish a session directly
  // (E2E, tools) opt in.
  if (input.resolvePlatform === true) {
    await resolvePlatformRole();
  }

  lifecycle.setPhase("READY");
  commitCommunitySession(generation);

  // Merge the relay-hosted NIP-RS frontier (kind:30078) now that the socket is
  // authenticated. Deliberately not awaited: local read state already rendered
  // from localStorage, and this only ever advances it, so a slow relay delays
  // nothing the user can see. Its own failure path is silent.
  void useReadStateStore().hydrateFromRelay();

  // A signed-in identity is, by definition, one the user chose to keep on the
  // device: a stale "couldn't remove" notice from an earlier sign-out is moot.
  session.setIdentityRemovalError(null);
  logSessionReport("beginIdentitySession");
  return currentIdentitySessionReport();
}

/** Dev-only console line in the user-verified shape (public information only). */
function logSessionReport(stage: string): void {
  if (!import.meta.env.DEV) return;
  const r = currentIdentitySessionReport();
  if (!r) return;
  const fp = (k: string | null) => (k ? `${k.slice(0, 8)}…${k.slice(-8)}` : "—");
  console.info(
    `[identity:${stage}]\n  Active identity: ${fp(r.pubkey)}\n  Community role: ${r.communityRole ?? "null"}\n  Platform role: ${r.platformRole ?? "null"}\n  Relay auth: ${r.relayAuthenticatedPubkey ? `authenticated as ${fp(r.relayAuthenticatedPubkey)}` : "not authenticated"}`,
  );
}

/** Snapshot of the established session (public information only), or `null` when none. */
export function currentIdentitySessionReport(): IdentitySessionReport | null {
  const session = useSessionStore();
  if (!session.pubkey || !session.authMode) return null;
  return {
    pubkey: session.pubkey,
    authMode: session.authMode,
    relayAuthenticatedPubkey: useConnectionStore().authenticatedPubkey,
    communityRole: session.communityRole,
    platformRole: session.platformRole,
  };
}
