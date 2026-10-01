import { ref } from "vue";
import { useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import { useSessionStore } from "@/stores/session";
import type { ApplicationUser } from "@/stores/session";
import { useConnectionStore } from "@/stores/connection";
import { useAccessStore, type AccessDestination } from "@/stores/access";
import { useDiagnosticsStore } from "@/stores/diagnostics";
import { useUiStore } from "@/stores/ui";
import { discoverMemberships } from "@/features/access/communityDiscovery";
import { operatorService } from "@/features/communities/OperatorService";
import { config } from "@/app/config";
import { AppError, logError, userMessageFor } from "@/services/errors";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { relayMembersService } from "@/features/community-members/RelayMembersService";
import { resolveMyRole } from "@/features/community-members/permissions";
import { activeRelayUrl, setActiveRelay } from "@/features/communities/relayCommunities";
import { importIdentity, replaceIdentity } from "@/features/identity/identityApi";
import {
  beginIdentitySession,
  endIdentitySession,
  endIdentitySessionAndRemoveIdentity,
  useIdentitySessionStore,
} from "./identitySession";
import { resolveIdentityProfile } from "@/features/profile/identityProfile";
import { isProfileComplete } from "@/features/profile/profileCompleteness";
import { pendingLink } from "@/features/deeplink/pendingLink";
import { DevSigningService } from "@/features/signing/signingService.dev";
import { Nip46SigningService } from "@/features/signing/signingService.nip46";
import {
  TauriSigningService,
  createLocalIdentity,
  getLocalIdentity,
} from "@/features/signing/signingService.tauri";
import {
  setActiveSigningService,
  clearActiveSigningService,
} from "@/features/signing/signingServiceRegistry";
import {
  getStoredSessionToken,
  getSession,
  clearStoredSessionToken,
  logoutSession,
} from "@/services/ApiClient";
import { OktaAuthService } from "./authService.okta";
import { OktaAuthServiceBrowser } from "./authService.okta.browser";
import type { AuthResult } from "./types";

// One signing-service instance per kind, reused across login attempts within a session.
// NOTE: the `DevSigningService` CLASS is still imported and used below via
// `DevSigningService.forLocalIdentity(...)`, which derives a deterministic
// keypair for the Okta path — that is not the removed development login, and
// every real-relay E2E depends on the class too. Only the shared-default-key
// *instance* that backed "Continue in Development Mode" is gone.
const nip46SigningService = new Nip46SigningService();
// Primary signer: the OLD-BUZZ-style local identity. The key lives in Rust
// (src-tauri/src/identity/); this instance only holds Tauri command calls.
const tauriSigningService = new TauriSigningService();

// Two Okta implementations, chosen at call time via `isTauri()` — never both
// active at once. `oktaAuthService` drives the native custom-URL-scheme deep
// link flow (`src-tauri/src/auth/oidc.rs`); `oktaAuthServiceBrowser` drives
// the plain-Chrome redirect+/callback flow (`oktaBrowserFlow.ts`). See
// docs/WEB_LOCAL_DEVELOPMENT.md for why these can't be unified into one
// implementation: a browser tab has no way to register a custom URL scheme.
const oktaAuthService = new OktaAuthService(nip46SigningService);
const oktaAuthServiceBrowser = new OktaAuthServiceBrowser(nip46SigningService);

export type PendingBunkerPairing = { employeeEmail: string | null };

function applicationUserFromDto(dto: {
  id: string;
  okta_sub: string;
  email: string | null;
  display_name: string | null;
}): ApplicationUser {
  return { id: dto.id, oktaSub: dto.okta_sub, email: dto.email, displayName: dto.display_name };
}

/**
 * Best-effort `swf-buzz-backend` session check (DECISIONS.md D10) — reads
 * whatever bearer token `src-tauri/src/auth/oidc.rs::login()` already
 * persisted to the OS keychain (or nothing, on Development Mode / browser
 * builds / a bootstrap that failed) and, if it's still valid, populates
 * `session.applicationUser`. Never throws, never affects `authStatus` —
 * this is additive alongside the pubkey/relay path below, not a
 * replacement for it (see this module's file-level note in
 * docs/OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md §2: community/channel/message/DM
 * features still run on the Nostr path until their own migration phase, so
 * ripping pubkey out of this module now would silently break ~35
 * dependent files for no gain this phase).
 */
async function bootstrapApplicationUserFromStoredToken(
  session: ReturnType<typeof useSessionStore>,
) {
  try {
    const token = await getStoredSessionToken();
    if (!token) return;
    const info = await getSession(token);
    session.setApplicationUser(applicationUserFromDto(info.user));
  } catch (err) {
    // Expired/invalid token, backend unreachable, or no Tauri runtime — all
    // non-fatal. `getSession` already cleared a dead stored token on 401.
    logError("useAuth.bootstrapApplicationUserFromStoredToken", err);
  }
}

/**
 * The shared core of "I have an `AuthResult`, make the app reflect it" —
 * everything `resolveIdentityAndRole` below does EXCEPT the final
 * navigation, factored out so `attemptSilentResume` (called from the
 * router guard, outside any component's `setup()`, where `useRouter()`
 * cannot be called) can reuse the identical relay-connect/role-resolution
 * logic instead of duplicating it.
 */
async function applyIdentityAndResolveRole(result: AuthResult): Promise<boolean> {
  const session = useSessionStore();
  const connection = useConnectionStore();

  session.setIdentity({
    authMode: result.authMode,
    employeeEmail: result.employeeEmail,
    applicationUserId: result.applicationUserId,
    pubkey: result.pubkey as string,
  });

  await relayConnectionService.connect(activeRelayUrl.value);
  if (!connection.isUsable) {
    session.setAuthError(
      connection.lastError ?? "Can't reach the Buzz server right now. Please try again.",
    );
    return false;
  }

  session.setAuthStatus("resolvingRole");
  let role;
  try {
    const members = await relayMembersService.fetchMembershipList();
    role = resolveMyRole(members, session.pubkey);
  } catch (err) {
    logError("useAuth.applyIdentityAndResolveRole", err);
    role = null;
  }
  session.setCommunityRole(role);
  return true;
}

const UNREACHABLE_MESSAGE =
  "Can't reach your community server right now. Check your connection and try again.";

/** The outcome of the central post-authentication routing decision. */
export type AccessDecision =
  | { kind: "route"; destination: AccessDestination }
  | { kind: "unreachable" }
  /** The active signer signed as a DIFFERENT pubkey than the one being signed in. Never routed. */
  | { kind: "mismatch"; expected: string; signer: string };

export const IDENTITY_MISMATCH_MESSAGE = (expected: string, signer: string) =>
  `Identity mismatch: this sign-in is for ${expected.slice(0, 8)}… but requests are being signed by ${signer.slice(0, 8)}…. Sign out and sign in again.`;

/**
 * THE routing decision after a local identity is available (the signer must
 * already be active).
 *
 *   operator (the relay says so)   → Operator dashboard
 *   otherwise, ask the relay which known communities this identity belongs to:
 *     none                         → welcome (enter a community URL / invite)
 *     one or more                  → "Choose a community" (the picker)
 *   nothing could be asked at all  → unreachable (stay signed out, clear error)
 *
 * NEVER opens a community on its own. The community is a SESSION routing
 * choice, not part of the identity: identity answers "who am I", the community
 * answers "where do I work this session". Every fresh sign-in and every app
 * start therefore ends on a screen where the person picks — a recent community
 * is one click, but it is still their click. (It used to open the only
 * membership automatically, so signing out and back in silently re-entered the
 * last community and never offered another.) Membership is still decided by
 * the relay, per community, after NIP-42 — the picker's recent list is only a
 * list of addresses this device has used.
 *
 * "Operator" and "member" are the relay's answers to NIP-98-signed requests, kept
 * only in the access store for this session; nothing is stored on disk.
 */
export async function resolveAccess(pubkey: string): Promise<AccessDecision> {
  const session = useSessionStore();
  const access = useAccessStore();
  const diag = useDiagnosticsStore();
  session.setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey });

  // Two SEPARATE relay answers for the same signer: platform authority
  // (NIP-98 on the operator routes) and community membership (per community).
  // Neither implies the other — see docs/SWF_ROLE_MODEL.md.
  const [probe, found] = await Promise.all([
    operatorService.probeOperator(config.relayUrl, pubkey),
    discoverMemberships(pubkey),
  ]);
  diag.recordOperatorProbe({
    forPubkey: pubkey,
    signerPubkey: probe.signerPubkey,
    status: probe.status,
    error: probe.error,
    origin: probe.origin,
    at: Date.now(),
  });

  // The probe was signed by the active signer. If that signer is not the
  // identity being signed in, nothing below may run: routing on the relay's
  // answer would be routing on someone else's key. This is an error, surfaced
  // as such — never a silent fall-through to "member" (docs §10 / Part A3).
  if (probe.signerPubkey !== null && probe.signerPubkey !== pubkey) {
    diag.recordIdentityMismatch(pubkey, probe.signerPubkey);
    diag.recordAccessDecision({
      pubkey,
      kind: "mismatch",
      destination: null,
      membershipCount: 0,
      at: Date.now(),
    });
    logError(
      "useAuth.resolveAccess",
      new Error(
        `NIP-98 probe signed by ${probe.signerPubkey.slice(0, 8)}… while signing in ${pubkey.slice(0, 8)}…`,
      ),
    );
    session.setPlatformRole(null);
    access.clear();
    return { kind: "mismatch", expected: pubkey, signer: probe.signerPubkey };
  }

  const operator = probe.status === 200;
  session.setPlatformRole(operator ? "operator" : null);

  let decision: AccessDecision;
  if (operator) {
    decision = { kind: "route", destination: "operator" };
  } else if (found.memberships.length === 0) {
    const nothingAnswered = found.asked > 0 && found.unreachable.length === found.asked;
    decision = nothingAnswered
      ? { kind: "unreachable" }
      : { kind: "route", destination: "welcome" };
  } else {
    decision = { kind: "route", destination: "communities" };
  }

  access.setResult({
    isOperator: operator,
    memberships: found.memberships,
    unreachable: found.unreachable,
    destination: decision.kind === "route" ? decision.destination : null,
  });
  diag.recordAccessDecision({
    pubkey,
    kind: decision.kind,
    destination: decision.kind === "route" ? decision.destination : null,
    membershipCount: found.memberships.length,
    at: Date.now(),
  });
  logIdentityDiagnostics("resolveAccess");
  return decision;
}

/**
 * Development-only console trail (public information only) in the exact shape
 * the user verifies after every sign-in/switch. No key material can appear
 * here: everything read is a public key, a role, a status or a route.
 */
export function logIdentityDiagnostics(stage: string): void {
  if (!import.meta.env.DEV) return;
  try {
    const session = useSessionStore();
    const connection = useConnectionStore();
    const diag = useDiagnosticsStore();
    const fp = (k: string | null | undefined) => (k ? `${k.slice(0, 8)}…${k.slice(-8)}` : "—");
    const probe = diag.lastOperatorProbe;
    console.info(
      [
        `[identity:${stage}]`,
        `Active identity: ${fp(session.pubkey)}`,
        `Relay auth: ${connection.authenticatedPubkey ? `authenticated as ${fp(connection.authenticatedPubkey)}` : "not authenticated (no NIP-42 socket)"}`,
        `NIP-98 probe: ${probe ? `${probe.status ?? probe.error} signed by ${fp(probe.signerPubkey)}` : "not run"}`,
        `Platform role: ${session.platformRole ?? "null"}`,
        `Community role: ${session.communityRole ?? "null"}`,
        `Decision: ${diag.lastAccessDecision ? `${diag.lastAccessDecision.kind}${diag.lastAccessDecision.destination ? ` → ${diag.lastAccessDecision.destination}` : ""}` : "—"}`,
      ].join("\n  "),
    );
  } catch {
    // Outside Pinia — nothing to report.
  }
}

/**
 * Point the app at one community and sign in there (NIP-42 + role) — through
 * the one identity-session lifecycle (`identitySession.ts`): tear down whatever
 * socket/signer/cache was active, install the Rust-backed signer, connect,
 * require the socket's AUTH to be signed by `pubkey`, resolve the role.
 */
async function openRelay(pubkey: string, relayUrl: string): Promise<boolean> {
  setActiveRelay(relayUrl);
  const report = await beginIdentitySession({ signer: tauriSigningService, pubkey, relayUrl });
  return report !== null;
}

/**
 * Silent resume at app start for the **local identity** (primary path).
 *
 * `get_identity()` → pubkey → activate the Tauri signer → connect the relay
 * (NIP-42) → fetch `relay_members` → resolve role → `ready`. No Okta, no
 * backend session, no derived key. Called once from the router's first
 * navigation guard (`src/app/router/index.ts`).
 *
 * Every failure leaves the session not-`ready` so the guard sends the user to
 * `/login`, where they can retry. It never deletes or replaces the identity:
 * an unreachable relay must not cost the user anything.
 */
export async function attemptSilentResume(): Promise<void> {
  // The identity module only exists in the Tauri build.
  if (!isTauri()) return;
  try {
    const info = await getLocalIdentity();
    if (!info.pubkey) return; // first launch / recovery state → login screen
    setActiveSigningService(tauriSigningService);
    // Never re-enters a community on its own: the app start is a new session,
    // so it lands on the community choice (see resolveAccess).
    const decision = await resolveAccess(info.pubkey);
    if (decision.kind === "unreachable") {
      useSessionStore().setAuthError(UNREACHABLE_MESSAGE);
    } else if (decision.kind === "mismatch") {
      clearActiveSigningService();
      useSessionStore().setAuthError(IDENTITY_MISMATCH_MESSAGE(decision.expected, decision.signer));
    }
    // "route": the access store now holds the destination; the router guard sends
    // the (not-yet-ready) session there instead of to /login.
  } catch (err) {
    logError("useAuth.attemptSilentResume", err);
    clearActiveSigningService();
  }
}

/**
 * Makes the local (Rust-backed) signer the active one, without connecting to a
 * relay. Used by flows that only need to *sign an HTTP request* — claiming an
 * invite, creating one — and so must work before the user is a member of any
 * community. Returns the identity's public key, or `null` if there is no identity.
 */
export async function ensureLocalSigner(): Promise<string | null> {
  if (!isTauri()) return null;
  const info = await getLocalIdentity();
  if (!info.pubkey) return null;
  setActiveSigningService(tauriSigningService);
  return info.pubkey;
}

/**
 * TODO(identity-migration): legacy Okta-era resume — restores a
 * `swf-buzz-backend` session from the OS keychain and derives a Nostr key from
 * the Okta `sub`. No longer called by the router; kept (exported) only until the
 * Okta code is removed (docs/SWF_BUZZ_OLD_BUZZ_IDENTITY_MIGRATION_PLAN.md §26).
 *
 * Original doc — Silent session resume at app start (DECISIONS.md D10) — new
 * functionality, not adapted from anything: the pre-D10 session store's own
 * doc comment states a fresh process always starts `"unauthenticated"`,
 * i.e. there was no resume of any kind before this. Called once from the
 * router's first navigation guard (`src/app/router/index.ts`), not from a
 * component, so it cannot use `useAuth()`/`useRouter()` — Pinia stores are
 * still safely callable here because `app.use(createPinia())` in
 * `main.ts` sets the process-wide active Pinia instance before the router
 * is installed.
 *
 * Resumes the FULL identity (backend session + the deterministic
 * dev-derived pubkey + relay role), not just the backend session, so a
 * resumed session behaves identically to a fresh login for every
 * pubkey-dependent feature (member lists, message authorship, etc.) — a
 * resume that only restored the backend session would leave those
 * silently broken. Does not attempt to restore a real NIP-46 bunker
 * connection (that requires a live round trip to a remote signer; if one
 * was paired, the user re-pairs on next manual login, same as today).
 * Failure at any step leaves the session `"unauthenticated"` — this is
 * strictly no worse than the pre-D10 baseline of always requiring login.
 */
export async function attemptLegacyOktaSilentResume(): Promise<void> {
  const session = useSessionStore();
  try {
    const token = await getStoredSessionToken();
    if (!token) return;
    const info = await getSession(token);
    session.setApplicationUser(applicationUserFromDto(info.user));

    const pubkey = await resolveLocalIdentitySigningServiceStandalone(info.user.okta_sub);
    await applyIdentityAndResolveRole({
      authMode: "production",
      employeeEmail: info.user.email,
      applicationUserId: info.user.okta_sub,
      pubkey,
    });
  } catch (err) {
    logError("useAuth.attemptSilentResume", err);
    await clearStoredSessionToken().catch(() => undefined);
  }
}

/** Same derivation `resolveLocalIdentitySigningService` (inside `useAuth()`) uses — duplicated as a standalone function because `attemptSilentResume` runs outside any composable's scope. */
async function resolveLocalIdentitySigningServiceStandalone(applicationUserId: string) {
  const service = await DevSigningService.forLocalIdentity(applicationUserId);
  setActiveSigningService(service);
  return service.getPublicKey();
}

/**
 * Orchestrates: AuthService (who is this employee) → SigningService (which
 * Nostr identity may they act as) → identity-resolution (community role).
 * These are deliberately independent stages — see docs/ARCHITECTURE.md §6,
 * docs/DECISIONS.md D3, and docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md §7/§14
 * for why the dashboard must not render until role resolution completes,
 * for BOTH Development Mode and Okta identically (never branch on
 * `authMode` inside the resolution step — see the audit's §12 guidance).
 */
export function useAuth() {
  const session = useSessionStore();
  const router = useRouter();
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const pendingBunkerPairing = ref<PendingBunkerPairing | null>(null);

  /**
   * Runs after `AuthService.login()` resolves for EITHER auth mode: connects
   * the relay, resolves the signed-in pubkey's community role, and only
   * then navigates to the dashboard. On relay failure, surfaces a distinct
   * "relay unavailable" auth error rather than silently showing a dashboard
   * that can't do anything — the user can retry (this function is safe to
   * re-run; it doesn't assume anything about prior attempts).
   */
  async function resolveIdentityAndRole(result: AuthResult): Promise<void> {
    const ok = await applyIdentityAndResolveRole(result);
    // Best-effort, additive (DECISIONS.md D10) — runs regardless of `ok`,
    // since the backend session is independent of relay/role resolution
    // succeeding; a relay outage shouldn't also block Application User
    // identity from being known. See `bootstrapApplicationUserFromStoredToken`'s
    // doc comment for why this stays separate from the pubkey path above.
    // Legacy Okta/dev logins only. The local identity has no backend session,
    // and must not pick up a stale Okta-era token left in the keychain.
    if (result.authMode !== "local") {
      await bootstrapApplicationUserFromStoredToken(session);
    }
    if (!ok) return;
    // Legacy logins land on Home ("/"); the local identity lands on the Nostr
    // channels view, which is the primary UI for it (Home is HTTP-backend based
    // and needs a backend session the local identity does not have).
    if (result.authMode === "local") {
      await router.push(await localLandingRoute(result.pubkey as string));
    } else {
      await router.push({ name: "home" });
    }
  }

  /**
   * Where a freshly signed-in local identity goes:
   *  1. a `swfbuzz://` link that arrived while signing in (act on it first);
   *  2. profile setup, if this identity's profile is not COMPLETE;
   *  3. the channels view.
   *
   * This runs on sign-in AND on every community entry (`switchCommunity` and
   * the silent resume both route through it), so an incomplete profile cannot
   * be reached by opening a different community.
   *
   * It asks for completeness, not mere existence: an older v1 profile has no
   * designation and possibly no photo, so it comes here to be upgraded rather
   * than being waved through. Nobody's existing profile is deleted — the user
   * republishes it from their own key.
   *
   * There is deliberately no "skip". A relay lookup FAILURE still falls through
   * to channels: an unreachable relay must not lock someone out of the app.
   */
  async function localLandingRoute(pubkey: string) {
    if (pendingLink.value) return { name: "join" } as const;
    try {
      // The profile belongs to the identity, not to the community being
      // entered: a kind:0 published in another community counts, and is
      // replicated into this one in the background (features/profile/identityProfile.ts).
      const profile = await resolveIdentityProfile(pubkey);
      if (!isProfileComplete(profile.profile)) return { name: "profile-setup" } as const;
    } catch (err) {
      logError("useAuth.localLandingRoute", err);
    }
    return { name: "channels" } as const;
  }

  /**
   * Primary login. `continue`: the identity must already exist on this device.
   * `create`: Rust generates it first (only if none exists — it can never
   * replace a key). Either way the flow is identical afterwards: activate the
   * Tauri signer → connect the relay (NIP-42) → `relay_members` role → `ready`.
   * Needs no Okta configuration and no backend.
   */
  async function loginWithLocalIdentity(action: "continue" | "create") {
    isLoading.value = true;
    error.value = null;
    // Whatever was signed in before (a previous identity's socket, signer,
    // caches, selection) ends here — a sign-in is always a fresh session. The
    // identity in secure storage is untouched.
    endIdentitySession();
    session.setAuthStatus("authenticating");
    try {
      let info = await getLocalIdentity();
      if (!info.pubkey) {
        if (action === "continue") {
          throw new AppError(
            "auth_required",
            "No identity was found on this device — create one first.",
          );
        }
        info = await createLocalIdentity();
      }
      if (!info.pubkey) {
        throw new AppError("auth_failed", "Couldn't create your identity. Please try again.");
      }
      const lifecycle = useIdentitySessionStore();
      lifecycle.setPhase("IDENTITY_LOADED");
      setActiveSigningService(tauriSigningService);
      lifecycle.setPhase("SIGNER_READY");
      const pubkey = info.pubkey;
      // resolveAccess signs NIP-98 probes with the fresh signer: platform role
      // and memberships. "Resolving permissions…" on the screen.
      lifecycle.setPhase("ROLE_RESOLVED");
      const decision = await resolveAccess(pubkey);
      if (decision.kind === "unreachable") {
        lifecycle.fail("ROLE_RESOLVED");
        error.value = UNREACHABLE_MESSAGE;
        session.setAuthError(UNREACHABLE_MESSAGE);
        return; // stays on the sign-in screen, not signed in
      }
      if (decision.kind === "mismatch") {
        // The signer is not this identity: stop. Nothing is routed on someone
        // else's answers; the signer is cleared so nothing can sign as it either.
        lifecycle.fail("SIGNER_READY");
        clearActiveSigningService();
        const message = IDENTITY_MISMATCH_MESSAGE(decision.expected, decision.signer);
        error.value = message;
        session.setAuthError(message);
        return;
      }
      // An invite/connect link that arrived meanwhile is the user's next step.
      if (pendingLink.value) {
        lifecycle.setPhase("READY");
        await router.push({ name: "join" });
        return;
      }
      // Operator dashboard / community choice / welcome: authenticated by
      // NIP-98 for HTTP; no community socket is opened until one is chosen.
      lifecycle.setPhase("READY");
      await router.push({ name: decision.destination });
    } catch (err) {
      logError("useAuth.loginWithLocalIdentity", err);
      clearActiveSigningService();
      const message = userMessageFor(err);
      error.value = message;
      session.setAuthError(message);
    } finally {
      isLoading.value = false;
    }
  }

  const continueWithLocalIdentity = () => loginWithLocalIdentity("continue");
  const createNewIdentity = () => loginWithLocalIdentity("create");

  /**
   * Import an identity (nsec / hex / ncryptsec+password) — Rust decodes and
   * stores it and refuses to replace a working identity — then sign in with it.
   * Returns whether the import itself succeeded.
   */
  async function importAndLogin(
    input: string,
    password?: string,
    allowRawHex = false,
  ): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      await importIdentity(input, password, allowRawHex);
    } catch (err) {
      logError("useAuth.importAndLogin", err);
      error.value = userMessageFor(err);
      isLoading.value = false;
      return false;
    }
    isLoading.value = false;
    await loginWithLocalIdentity("continue");
    return true;
  }

  /**
   * "Switch / Import another identity" on a device that already has one.
   *
   * Order matters and is unconditional: FIRST the current session ends
   * (socket closed, signer cleared, roles/selection/caches gone — regardless
   * of whether anyone was signed in, so a lingering reconnect timer or a
   * half-established session from an earlier attempt can't survive), THEN Rust
   * archives the current key and stores the imported one, making it the
   * identity `get_identity`/`sign_event` answer for. Returns whether the
   * replacement happened; it does not sign the new identity in — the caller
   * decides what comes next (LoginView continues, which establishes a fresh
   * session as the IMPORTED identity).
   */
  async function replaceIdentityLocal(
    input: string,
    password?: string,
    allowRawHex = false,
  ): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      endIdentitySession();
      await replaceIdentity(input, password, allowRawHex);
      return true;
    } catch (err) {
      logError("useAuth.replaceIdentityLocal", err);
      error.value = userMessageFor(err);
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Retry removing a stored identity after a sign-out whose Rust removal failed
   * (`session.identityRemovalError`). Nobody is signed in at this point; this
   * only asks Rust again and reports whether the device is now clean.
   */
  async function removeStoredIdentity(): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const result = await endIdentitySessionAndRemoveIdentity();
      if (!result.removed) error.value = result.error;
      return result.removed;
    } finally {
      isLoading.value = false;
    }
  }

  /** Make `relayUrl` the active community and sign in to it (NIP-42 + `relay_members`). */
  async function switchCommunity(relayUrl: string) {
    isLoading.value = true;
    error.value = null;
    try {
      const info = await getLocalIdentity();
      if (!info.pubkey) {
        throw new AppError(
          "auth_required",
          "No identity was found on this device — create one first.",
        );
      }
      setActiveSigningService(tauriSigningService);
      session.setIdentity({
        authMode: "local",
        employeeEmail: null,
        applicationUserId: null,
        pubkey: info.pubkey,
      });
      // Teardown clears the selection; remember it so the new community can
      // reopen the same channel IF it has one with that id (switchNavigation.ts).
      const previousChannelId = useUiStore().selectedChannelId;
      // A failure is recorded on the session/connection (with the relay's reason).
      if (await openRelay(info.pubkey, relayUrl)) {
        await router.push(await localLandingRoute(info.pubkey));
        // After the landing navigation, so the channel it opens (and its
        // `?channelId=`) is not overwritten by that navigation.
        useUiStore().requestChannelRestore(previousChannelId);
      }
    } catch (err) {
      logError("useAuth.switchCommunity", err);
      const message = userMessageFor(err);
      error.value = message;
      session.setAuthError(message);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * LOCAL-TESTING DECOUPLING (see docs/DECISIONS.md D3 update): a real NIP-46
   * bunker connection is no longer required to complete Okta login. When no
   * bunker is already paired for this identity, a deterministic local
   * keypair is derived from the Okta `subject` instead — real signed Nostr
   * events, real server-side `relay_members` authorization, just no remote
   * signer round trip. This is deliberately gated the same way
   * `DevSigningService`'s shared default key already is (dev-only, never
   * reachable in a production build) — see docs/SECURITY.md. The NIP-46
   * bunker code path (`Nip46SigningService`, `completeBunkerPairing` below)
   * is untouched and still fully usable; it's simply no longer on the
   * default path, not deleted.
   */
  async function resolveLocalIdentitySigningService(applicationUserId: string) {
    const service = await DevSigningService.forLocalIdentity(applicationUserId);
    setActiveSigningService(service);
    return service.getPublicKey();
  }

  /**
   * Native Tauri: full round trip (system-browser deep link, then back)
   * resolves right here, exactly as before. Browser: `beginLogin()` just
   * navigates the tab to Okta and never returns — the round trip finishes
   * later in `completeOktaBrowserLogin()`, called from `/callback` (see
   * `OktaCallbackView.vue`). Both paths set the same `authenticating`
   * status first so the UI can't tell which one is running.
   */
  async function loginWithOkta() {
    isLoading.value = true;
    error.value = null;
    session.setAuthStatus("authenticating");
    if (!isTauri()) {
      try {
        await oktaAuthServiceBrowser.beginLogin();
      } catch (err) {
        logError("useAuth.loginWithOkta.browser", err);
        const message = userMessageFor(err);
        error.value = message;
        session.setAuthError(message);
        isLoading.value = false;
      }
      return;
    }
    try {
      const result = await oktaAuthService.login();
      if (result.pubkey) {
        // A real bunker was already paired in a previous session — keep using it.
        setActiveSigningService(nip46SigningService);
        await resolveIdentityAndRole(result);
      } else if (result.applicationUserId) {
        const pubkey = await resolveLocalIdentitySigningService(result.applicationUserId);
        await resolveIdentityAndRole({ ...result, pubkey });
      } else {
        throw new Error("Okta didn't return a stable subject identifier for this login.");
      }
    } catch (err) {
      logError("useAuth.loginWithOkta", err);
      const message = userMessageFor(err);
      error.value = message;
      session.setAuthError(message);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Browser-only: called from `/callback` (`OktaCallbackView.vue`) once
   * Okta redirects back with `code`/`state`. Mirrors `loginWithOkta()`'s
   * native branch above — same status transitions, same bunker-pairing
   * fallback — just entered from a fresh page load instead of a resolved
   * promise.
   */
  async function completeOktaBrowserLogin() {
    isLoading.value = true;
    error.value = null;
    session.setAuthStatus("authenticating");
    try {
      const result = await oktaAuthServiceBrowser.completeLogin();
      if (result.pubkey) {
        setActiveSigningService(nip46SigningService);
        await resolveIdentityAndRole(result);
      } else if (result.applicationUserId) {
        const pubkey = await resolveLocalIdentitySigningService(result.applicationUserId);
        await resolveIdentityAndRole({ ...result, pubkey });
      } else {
        throw new Error("Okta didn't return a stable subject identifier for this login.");
      }
    } catch (err) {
      logError("useAuth.completeOktaBrowserLogin", err);
      const message = userMessageFor(err);
      error.value = message;
      session.setAuthError(message);
    } finally {
      isLoading.value = false;
    }
  }

  async function completeBunkerPairing(bunkerUri: string) {
    if (!pendingBunkerPairing.value) return;
    isLoading.value = true;
    error.value = null;
    session.setAuthStatus("authenticating");
    try {
      await nip46SigningService.connectFromBunkerUri(bunkerUri);
      const pubkey = await nip46SigningService.getPublicKey();
      setActiveSigningService(nip46SigningService);
      await resolveIdentityAndRole({
        authMode: "production",
        employeeEmail: pendingBunkerPairing.value.employeeEmail,
        applicationUserId: null, // the Okta sub from the original login isn't threaded through this
        // second step today — see docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md §3/D3 for the
        // open question of linking a bunker pairing back to the Okta identity that initiated it.
        pubkey,
      });
      pendingBunkerPairing.value = null;
    } catch (err) {
      logError("useAuth.completeBunkerPairing", err);
      const message = userMessageFor(err);
      error.value = message;
      session.setAuthError(message);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * The browser production case is the odd one out: `oktaAuthServiceBrowser
   * .logout()` navigates the tab away to Okta's end-session endpoint, so
   * local state has to be torn down BEFORE calling it, not after — there is
   * no "after" on that path. The native and dev-mode paths are unaffected
   * and keep the original tear-down-then-await-logout order.
   */
  async function logout() {
    // Local identity — SWF shared-device sign-out (NOT OLD BUZZ parity): end
    // the session (socket, signer, roles, routing decision, selection, read
    // state, every cache) AND remove the identity from this device, verified in
    // Rust. The login screen then shows "No identity is stored on this device."
    // If removal fails the session is still gone but the identity is not: the
    // login screen says so (`session.identityRemovalError`) and offers a retry
    // — sign-out is never claimed complete in that case.
    if (session.authMode === "local") {
      isLoading.value = true;
      try {
        const result = await endIdentitySessionAndRemoveIdentity();
        pendingBunkerPairing.value = null;
        if (!result.removed) error.value = result.error;
      } finally {
        isLoading.value = false;
      }
      await router.push({ name: "login" });
      return;
    }

    // Best-effort revoke server-side + drop the OS-keychain copy (DECISIONS.md
    // D10) — never blocks the rest of teardown; a network failure here must
    // not trap the user signed in locally.
    await logoutSession().catch((err) => logError("useAuth.logout.backendSession", err));
    await clearStoredSessionToken();

    if (!isTauri() && session.authMode === "production") {
      endIdentitySession();
      pendingBunkerPairing.value = null;
      await oktaAuthServiceBrowser.logout().catch((err) => logError("useAuth.logout.browser", err));
      return;
    }

    // Only the Okta (production) mode has a remote session to tear down. The
    // local Nostr identity has nothing to sign out of remotely — its teardown
    // is `endIdentitySession()` below. This used to fall through to
    // `DevAuthService.logout()`, which was a documented no-op, so a local
    // sign-out was calling the development auth service for no effect.
    if (session.authMode === "production") {
      await oktaAuthService.logout().catch((err) => logError("useAuth.logout", err));
    }
    endIdentitySession();
    pendingBunkerPairing.value = null;
    // The router guard only re-evaluates on a navigation attempt — clearing
    // session state alone leaves the user stranded on the now-disconnected
    // view until something else happens to navigate.
    await router.push({ name: "login" });
  }

  return {
    isLoading,
    error,
    pendingBunkerPairing,
    continueWithLocalIdentity,
    createNewIdentity,
    importAndLogin,
    replaceIdentityLocal,
    removeStoredIdentity,
    switchCommunity,
    // TODO(identity-migration): legacy Okta/bunker entry points — no longer
    // used by LoginView; kept until the Okta code is removed (plan §26).
    loginWithOkta,
    completeOktaBrowserLogin,
    completeBunkerPairing,
    logout,
  };
}
