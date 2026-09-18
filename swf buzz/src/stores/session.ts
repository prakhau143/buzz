import { defineStore } from "pinia";
import type { RelayMemberRole } from "@/protocol/relayMembers";

/**
 * Client-only session state. This store never holds a private key, an ID
 * token, an access token, or a PKCE verifier — see docs/SECURITY.md. Never
 * persisted to disk/localStorage — a fresh process always starts at
 * `"unauthenticated"`. `pubkey` is public information; signing capability
 * lives entirely behind the signing service.
 */

export type AuthMode = "production" | "development";

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
   * ever set for `authMode === "production"`; `null` for Development Mode
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
}

export const useSessionStore = defineStore("session", {
  state: (): SessionState => ({
    authStatus: "unauthenticated",
    authMode: null,
    employeeEmail: null,
    applicationUserId: null,
    pubkey: null,
    communityRole: null,
    applicationUser: null,
    authError: null,
  }),
  getters: {
    isAuthenticated: (state) => state.authStatus !== "unauthenticated" && state.authStatus !== "authError",
    /** True only once role resolution has completed — the dashboard's real "ready" gate. */
    isReady: (state) => state.authStatus === "ready",
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
      this.pubkey = input.pubkey;
      this.communityRole = null;
      this.authStatus = "resolvingIdentity";
    },
    setCommunityRole(role: RelayMemberRole | null) {
      this.communityRole = role;
      this.authStatus = "ready";
    },
    /** Best-effort — see `ApplicationUser`'s doc comment. Never throws, never blocks `authStatus`. */
    setApplicationUser(user: ApplicationUser | null) {
      this.applicationUser = user;
    },
    setAuthError(message: string) {
      this.authError = message;
      this.authStatus = "authError";
    },
    clearSession() {
      this.authStatus = "unauthenticated";
      this.authMode = null;
      this.employeeEmail = null;
      this.applicationUserId = null;
      this.pubkey = null;
      this.communityRole = null;
      this.applicationUser = null;
      this.authError = null;
    },
  },
});
