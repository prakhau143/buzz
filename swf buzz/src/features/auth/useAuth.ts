import { ref } from "vue";
import { useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import { useSessionStore } from "@/stores/session";
import type { ApplicationUser } from "@/stores/session";
import { useConnectionStore } from "@/stores/connection";
import { logError, userMessageFor } from "@/services/errors";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { relayMembersService } from "@/features/community-members/RelayMembersService";
import { resolveMyRole } from "@/features/community-members/permissions";
import { config } from "@/app/config";
import { DevSigningService } from "@/features/signing/signingService.dev";
import { Nip46SigningService } from "@/features/signing/signingService.nip46";
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
import { DevAuthService } from "./authService.dev";
import { OktaAuthService } from "./authService.okta";
import { OktaAuthServiceBrowser } from "./authService.okta.browser";
import type { AuthResult } from "./types";

// One signing-service instance per kind, reused across login attempts within a session.
const devSigningService = new DevSigningService();
const nip46SigningService = new Nip46SigningService();

const devAuthService = new DevAuthService(() => devSigningService.getPublicKey());
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
async function bootstrapApplicationUserFromStoredToken(session: ReturnType<typeof useSessionStore>) {
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

  await relayConnectionService.connect(config.relayUrl);
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

/**
 * Silent session resume at app start (DECISIONS.md D10) — new
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
export async function attemptSilentResume(): Promise<void> {
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
    await bootstrapApplicationUserFromStoredToken(session);
    if (!ok) return;
    // Home ("/") is the default landing page post-login — see
    // `app/router/index.ts`'s `home` route and its pending-invite check.
    await router.push({ name: "home" });
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

  async function loginWithDevelopmentMode() {
    isLoading.value = true;
    error.value = null;
    session.setAuthStatus("authenticating");
    try {
      const result = await devAuthService.login();
      setActiveSigningService(devSigningService);
      await resolveIdentityAndRole(result);
    } catch (err) {
      logError("useAuth.loginWithDevelopmentMode", err);
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
    // Best-effort revoke server-side + drop the OS-keychain copy (DECISIONS.md
    // D10) — never blocks the rest of teardown; a network failure here must
    // not trap the user signed in locally.
    await logoutSession().catch((err) => logError("useAuth.logout.backendSession", err));
    await clearStoredSessionToken();

    if (!isTauri() && session.authMode === "production") {
      clearActiveSigningService();
      relayConnectionService.disconnect();
      session.clearSession();
      pendingBunkerPairing.value = null;
      await oktaAuthServiceBrowser.logout().catch((err) => logError("useAuth.logout.browser", err));
      return;
    }

    const service = session.authMode === "production" ? oktaAuthService : devAuthService;
    await service.logout().catch((err) => logError("useAuth.logout", err));
    clearActiveSigningService();
    relayConnectionService.disconnect();
    session.clearSession();
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
    loginWithOkta,
    completeOktaBrowserLogin,
    completeBunkerPairing,
    loginWithDevelopmentMode,
    logout,
  };
}
