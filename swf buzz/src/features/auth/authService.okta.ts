import { invoke } from "@tauri-apps/api/core";
import { AppError, logError } from "@/services/errors";
import type { Nip46SigningService } from "@/features/signing/signingService.nip46";
import type { AuthResult, AuthService } from "./types";

interface OktaLoginResult {
  subject: string;
  employeeEmail: string | null;
}

/**
 * Rust's `OidcError` (`src-tauri/src/auth/oidc.rs`) reaches here as the
 * exact `thiserror` Display string, via `commands/auth.rs`'s
 * `.map_err(|e| e.to_string())` — every one of those strings is
 * deliberately safe to show a user as-is (no token/secret/PKCE verifier
 * ever appears in one; see docs/SECURITY.md). Mapped to a specific,
 * actionable message per variant here rather than one generic string, so a
 * real, distinguishable cause isn't flattened away before the user sees
 * it — see docs/OKTA_PKCE_SETUP.md §7's troubleshooting table, which this
 * mirrors. The raw string is still passed through as `cause` on the
 * `AppError` either way, for `logError`'s console output.
 */
export function oktaLoginErrorMessage(err: unknown): string {
  if (err === "okta_not_configured") {
    return "Okta isn't configured for this build yet. Ask an admin, or use Development Mode.";
  }
  if (typeof err === "string") {
    if (err === "timed out waiting for sign-in to complete") {
      return "Okta sign-in didn't complete in time. If Okta showed a redirect URI error in the browser, this app's configured redirect URI doesn't match what's registered in the Okta application — ask your admin to check it. Otherwise, please try again.";
    }
    if (err === "sign-in could not be verified — please try again") {
      return err;
    }
    if (err.startsWith("could not open the system browser:")) {
      return "Couldn't open your browser to sign in with Okta. Please try again.";
    }
    if (err.startsWith("token exchange failed:")) {
      return "Okta sign-in failed while completing the exchange. Please try again.";
    }
    if (err.startsWith("could not verify the identity token:")) {
      return "Your Okta sign-in couldn't be verified. Please try again or contact your admin.";
    }
  }
  return "Sign-in with Okta failed.";
}

/**
 * Production auth: Okta OIDC Authorization Code + PKCE, run via the system
 * browser and a native custom-URL-scheme callback
 * (`src-tauri/src/auth/oidc.rs`) — never an embedded webview login, per
 * platform best practice for native apps. This class only establishes *who
 * the employee is*; it deliberately does not produce a Nostr key. See
 * docs/ARCHITECTURE.md §6 and docs/DECISIONS.md D3 for the still-unresolved
 * question of how an Okta identity selects a bunker, and
 * docs/OKTA_PKCE_SETUP.md for the full flow.
 */
export class OktaAuthService implements AuthService {
  readonly mode = "production" as const;

  constructor(private readonly signingService: Nip46SigningService) {}

  async login(): Promise<AuthResult> {
    let result: OktaLoginResult;
    try {
      result = await invoke<OktaLoginResult>("start_okta_login");
    } catch (err) {
      throw new AppError("auth_failed", oktaLoginErrorMessage(err), err);
    }

    // A bunker connection may already be paired from a previous session.
    const hasSigningConnection = await this.signingService.restore().catch(() => false);
    const pubkey = hasSigningConnection
      ? await this.signingService.getPublicKey().catch(() => undefined)
      : undefined;

    return {
      authMode: "production",
      employeeEmail: result.employeeEmail,
      applicationUserId: result.subject,
      pubkey,
    };
  }

  async logout(): Promise<void> {
    await this.signingService.disconnect().catch(() => undefined);
    // Ends the Okta session server-side (RP-initiated logout) — best-effort;
    // local session teardown in useAuth.ts always proceeds regardless of
    // whether this succeeds, so a failure here never traps the user signed in.
    await invoke("okta_logout").catch((err) => {
      logError("OktaAuthService.logout", err);
    });
  }
}
