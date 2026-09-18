import type { AuthMode } from "@/stores/session";

export interface AuthResult {
  authMode: AuthMode;
  employeeEmail: string | null;
  /**
   * Okta's stable subject identifier — the application-level user ID.
   * `null` for Development Mode (no Okta identity exists). Never fall back
   * to `employeeEmail` as a primary key when this is present: email can
   * change, `sub` does not. See docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md §3.
   */
  applicationUserId: string | null;
  /** Absent when Okta succeeded but no NIP-46 bunker is paired yet (see docs/DECISIONS.md D3). */
  pubkey?: string;
}

/**
 * AuthService authenticates the employee (Okta OIDC + PKCE in production).
 * It never produces or handles a Nostr private key — see docs/ARCHITECTURE.md §6
 * and docs/SECURITY.md. The `pubkey` in AuthResult comes from the signing
 * service (see features/signing), not from Okta.
 */
export interface AuthService {
  readonly mode: AuthMode;
  login(): Promise<AuthResult>;
  logout(): Promise<void>;
}
