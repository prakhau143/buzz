/**
 * Preserves an invite token across the Okta login redirect. `loginWithOkta()`
 * (`useAuth.ts`) unconditionally navigates to `{ name: "channels" }` once
 * login succeeds — it has no notion of "return to where I was," and
 * teaching it one is out of this phase's scope (auth/session foundation is
 * F1's). Instead: `InviteLandingView` stashes the token here before
 * triggering login; the router's global guard (`app/router/index.ts`)
 * redirects a fresh post-login landing on `channels` back to `/invite/:token`
 * if one is pending, then clears it.
 *
 * `sessionStorage`, not `localStorage`: this is genuinely transient
 * navigation state for one login round trip, not a durable preference.
 */
const KEY = "swf_pending_invite_token";

export function setPendingInviteToken(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // Best-effort — worst case, the user lands on the dashboard instead of
    // back on the invite page after login and has to click the link again.
  }
}

export function getPendingInviteToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingInviteToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up if storage isn't available in the first place.
  }
}
