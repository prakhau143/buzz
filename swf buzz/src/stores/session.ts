import { defineStore } from "pinia";
import type { RelayMemberRole } from "@/protocol/relayMembers";

/**
 * Client-only session state. This store never holds a private key, an ID
 * token, an access token, or a PKCE verifier — see docs/SECURITY.md. Never
 * persisted to disk/localStorage — a fresh process always starts at
 * `"unauthenticated"`. `pubkey` is public information; signing capability
 * lives entirely behind the signing service.
 */

/**
 * `"local"` — the OLD-BUZZ-style identity: a Nostr keypair generated and held
 * in Rust (OS keyring), no Okta. This is the primary login path.
 * `"production"` — legacy Okta login (kept until the local path is verified and
 * the Okta code is removed, see docs/SWF_BUZZ_OLD_BUZZ_IDENTITY_MIGRATION_PLAN.md).
 *
 * `"development"` (a dev-build-only shared fixed key) was REMOVED on 2026-09-24
 * along with "Continue in Development Mode". A throwaway in-memory key is in no
 * community's `relay_members`, so it resolved to no role at all — now that
 * owner/admin/member actually work, that session was misleading rather than
 * convenient. The real Nostr identity + NIP-42 path is the only human sign-in.
 */
export type AuthMode = "local" | "production";

/**
 * Platform (deployment-level) roles the relay can grant a pubkey via
 * `RELAY_OPERATOR_PUBKEYS` / its `relay_operators` roster. Only `"operator"` is
 * probed by this app today (`GET /operator/communities/availability`); the
 * relay's Moderator role has no client probe yet and is deliberately not
 * guessed at.
 */
export type PlatformRole = "operator";
const OPERATOR: PlatformRole = "operator";

/**
 * The one authoritative authentication/authorization state machine — see
 * docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md §7/§14 and
 * docs/AUTHORIZATION_RUNTIME_FLOW.md. The dashboard must not render
 * role-gated navigation before this reaches `"ready"`.
 *
 *   unauthenticated → authenticating → resolvingIdentity → resolvingRole → ready
 *                                    ↘ authError                        ↗
 *
 * `resolvingIdentity` covers "which Nostr pubkey am I" (already resolved by
 * the time `AuthService.login()` returns for both Dev Mode and Okta — see
 * useAuth.ts); `resolvingRole` covers the community-membership/role lookup
 * that runs identically for both auth modes.
 */
export type AuthStatus =
  | "unauthenticated"
  | "authenticating"
  | "resolvingIdentity"
  | "resolvingRole"
  | "ready"
  | "authError";

/**
 * The no-Nostr-human-identity `swf-buzz-backend` Application User
 * (DECISIONS.md D10) — `id`/`oktaSub` are the durable identifiers,
 * `email`/`displayName` are display-only and can be null before a user
 * completes their Okta profile. Populated from `GET /api/session` /
 * `POST /api/session/bootstrap` (`ApplicationUserDto` in
 * `src/services/ApiClient.ts`). Deliberately additive alongside `pubkey`
 * below, not a replacement — see useAuth.ts's module doc comment for why.
 */
export interface ApplicationUser {
  id: string;
  oktaSub: string;
  email: string | null;
  displayName: string | null;
}

export interface SessionState {
  authStatus: AuthStatus;
  authMode: AuthMode | null;
  employeeEmail: string | null;
  /**
   * Okta's stable subject identifier — the application-level user ID. Only
   * ever set for `authMode === "production"`; `null` for a local identity
   * (there is no Okta identity to have one). See
   * docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md §3.
   */
  applicationUserId: string | null;
  pubkey: string | null;
  /**
   * The signed-in pubkey's community role, resolved once after login (see
   * useAuth.ts's identity-resolution step) — `null` while unresolved/loading,
   * `undefined` role value is never used; a relay with no membership
   * requirement (no kind:13534 snapshot) resolves to `null` here too, same
   * as "not a recognized member," per docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2a.
   */
  communityRole: RelayMemberRole | null;
  /**
   * PLATFORM role — deployment-level authority, resolved SEPARATELY from
   * `communityRole` and never derived from it (docs/SWF_ROLE_MODEL.md,
   * docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §10): `"operator"` only
   * when the relay answered this pubkey's NIP-98 probe on `/operator/*` with
   * 200 this session. An operator is not thereby a member of any community,
   * and a community owner is not thereby an operator. `null` = not an
   * operator, or not asked yet.
   */
  platformRole: PlatformRole | null;
  /**
   * The `swf-buzz-backend` session's Application User (DECISIONS.md D10) —
   * `null` until a bearer session was successfully bootstrapped/resumed.
   * Best-effort: a `null` value here does not block the rest of sign-in
   * (see useAuth.ts) — the pubkey/relay path above remains the real
   * authorization boundary for community/channel/message features until
   * those are migrated to the new backend in a later phase.
   */
  applicationUser: ApplicationUser | null;
  /** Set only when authStatus === "authError" — a user-facing message. */
  authError: string | null;
  /**
   * SWF sign-out removes the identity from the device
   * (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §3). When Rust could not
   * remove it, the SESSION is still ended (socket/signer/caches gone) but the
   * identity is still stored, and this carries the reason so the login screen
   * says so instead of pretending the device is clean. Cleared by the next
   * successful removal or sign-in; deliberately survives `clearSession()`.
   */
  identityRemovalError: string | null;
}

export const useSessionStore = defineStore("session", {
  state: (): SessionState => ({
    authStatus: "unauthenticated",
    authMode: null,
    employeeEmail: null,
    applicationUserId: null,
    pubkey: null,
    communityRole: null,
    platformRole: null,
    applicationUser: null,
    authError: null,
    identityRemovalError: null,
  }),
  getters: {
    isAuthenticated: (state) => state.authStatus !== "unauthenticated" && state.authStatus !== "authError",
    /** True only once role resolution has completed — the dashboard's real "ready" gate. */
    isReady: (state) => state.authStatus === "ready",
    /**
     * The relay said "operator" to THIS pubkey's NIP-98 probe this session
     * (`setPlatformRole`, written only from `operatorService.isOperator(…)`
     * answers). A platform-plane fact — says nothing about community roles.
     */
    isPlatformOperator: (state) => state.platformRole === OPERATOR,
  },
  actions: {
    setAuthStatus(status: AuthStatus) {
      this.authStatus = status;
    },
    /** Called once AuthService.login() resolves — identity is known, role is not yet. */
    setIdentity(input: { authMode: AuthMode; employeeEmail: string | null; applicationUserId: string | null; pubkey: string }) {
      this.authMode = input.authMode;
      this.employeeEmail = input.employeeEmail;
      this.applicationUserId = input.applicationUserId;
      // A different pubkey than before means a different person: nothing the
      // previous identity resolved (community role, platform role) may carry
      // over, even for one render.
      if (this.pubkey !== input.pubkey) {
        this.platformRole = null;
      }
      this.pubkey = input.pubkey;
      this.communityRole = null;
      // A new attempt starts clean: a previous attempt's error must not linger
      // on a session that then succeeds.
      this.authError = null;
      this.authStatus = "resolvingIdentity";
    },
    setCommunityRole(role: RelayMemberRole | null) {
      this.communityRole = role;
      this.authStatus = "ready";
    },
    /** The relay's answer to the operator probe for the CURRENT pubkey — independent of any community. */
    setPlatformRole(role: PlatformRole | null) {
      this.platformRole = role;
    },
    /** Best-effort — see `ApplicationUser`'s doc comment. Never throws, never blocks `authStatus`. */
    setApplicationUser(user: ApplicationUser | null) {
      this.applicationUser = user;
    },
    setAuthError(message: string) {
      this.authError = message;
      this.authStatus = "authError";
    },
    setIdentityRemovalError(message: string | null) {
      this.identityRemovalError = message;
    },
    /** Ends the session. Does NOT clear `identityRemovalError` — that is a fact about the device, not the session. */
    clearSession() {
      this.authStatus = "unauthenticated";
      this.authMode = null;
      this.employeeEmail = null;
      this.applicationUserId = null;
      this.pubkey = null;
      this.communityRole = null;
      this.platformRole = null;
      this.applicationUser = null;
      this.authError = null;
    },
  },
});
