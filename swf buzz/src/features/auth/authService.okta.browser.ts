/**
 * Browser-only counterpart to `authService.okta.ts` — used when
 * `isTauri()` is false (a plain Chrome tab via `npm run dev`). Does not
 * implement the shared `AuthService` interface directly: unlike the native
 * flow, `login()` cannot resolve to an `AuthResult` in one call — it
 * navigates the tab away to Okta and only completes after the browser
 * comes back on `/callback`, a full page load later. See
 * `views/OktaCallbackView.vue` and `useAuth.ts` for how the two halves are
 * wired together, and docs/WEB_LOCAL_DEVELOPMENT.md for the full flow.
 */
import {
  beginBrowserLogin,
  completeBrowserLogin,
  redirectToBrowserLogout,
} from "./oktaBrowserFlow";
import type { Nip46SigningService } from "@/features/signing/signingService.nip46";
import type { AuthResult } from "./types";

export class OktaAuthServiceBrowser {
  readonly mode = "production" as const;

  constructor(private readonly signingService: Nip46SigningService) {}

  /** Triggers the redirect to Okta. Never resolves (the page unloads) —
   *  callers must not await this expecting an `AuthResult`. */
  async beginLogin(): Promise<void> {
    await beginBrowserLogin();
  }

  /** Called from `/callback` once Okta redirects back. */
  async completeLogin(): Promise<AuthResult> {
    const result = await completeBrowserLogin();

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

  /** Ends the local signer connection and redirects to Okta's end-session
   *  endpoint (a no-op redirect if no Okta session is held — see
   *  `redirectToBrowserLogout`). NAVIGATES AWAY, so callers must finish
   *  clearing local application state before calling this, not after. */
  async logout(): Promise<void> {
    await this.signingService.disconnect().catch(() => undefined);
    redirectToBrowserLogout();
  }
}
