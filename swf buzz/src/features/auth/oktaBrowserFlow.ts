/**
 * Browser-only Okta OIDC Authorization Code + PKCE — used when SWF Buzz runs
 * as a plain Chrome tab via `npm run dev` (no Tauri IPC available, so the
 * native custom-URL-scheme callback in `src-tauri/src/auth/oidc.rs` can't be
 * used at all — there's no OS-level scheme registration or process to
 * receive it). See docs/WEB_LOCAL_DEVELOPMENT.md for why this is a
 * genuinely different flow, not a shortcut version of the native one, and
 * exactly what to configure in Okta for it to work.
 *
 * Mirrors the native flow's security properties exactly: S256 PKCE, random
 * state + nonce, RS256 signature verification against Okta's JWKS (via
 * `jose`, not hand-rolled), iss/aud/exp checks, manual nonce comparison. The
 * one real difference: the PKCE transaction (verifier/state/nonce) must
 * survive a full page navigation to Okta and back (a browser tab has no
 * other way to preserve state across that), so it's held in
 * `sessionStorage` — cleared immediately after use (success or failure),
 * never written to `localStorage`, never sent anywhere but back to this
 * same code on return.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { AppError } from "@/services/errors";

const PENDING_KEY = "swf-buzz:okta-pkce-pending";

/** Held only in this module's JS memory for the tab's lifetime — mirrors
 *  the native flow's Rust-memory-only `OktaSession`. Never written to
 *  localStorage/sessionStorage, never exposed outside this module; only
 *  `redirectToBrowserLogout()`'s own internal read-and-clear touches it. */
let lastIdToken: string | null = null;

interface OktaConfig {
  issuer: string;
  clientId: string;
}

interface PendingTransaction {
  verifier: string;
  state: string;
  nonce: string;
}

export interface BrowserOktaLoginResult {
  subject: string;
  employeeEmail: string | null;
}

function loadConfig(): OktaConfig {
  const issuer = import.meta.env.VITE_OKTA_ISSUER as string | undefined;
  const clientId = import.meta.env.VITE_OKTA_CLIENT_ID as string | undefined;
  if (!issuer || !clientId) {
    throw new AppError(
      "auth_failed",
      "Okta isn't configured for this build yet. Ask an admin, or use Development Mode.",
      "okta_not_configured",
    );
  }
  return { issuer: issuer.replace(/\/+$/, ""), clientId };
}

/** The redirect URI this browser build uses — must exactly match what's
 *  registered in Okta as a Sign-in redirect URI. Derived from the current
 *  origin rather than hardcoded so it's always correct for wherever this
 *  page is actually being served from — see docs/WEB_LOCAL_DEVELOPMENT.md
 *  for why `http://127.0.0.1:1420` specifically (not `localhost`) is the
 *  one canonical value to register and always navigate to. */
function redirectUri(): string {
  return `${window.location.origin}/callback`;
}

function postLogoutRedirectUri(): string {
  return `${window.location.origin}/`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafe(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Generates fresh PKCE/state/nonce, stores them for the pending transaction, and
 *  navigates the current tab to Okta's hosted login. Never resolves — the page
 *  unloads. Callers must not `await` this expecting a return value. */
export async function beginBrowserLogin(): Promise<void> {
  const config = loadConfig();
  const verifier = randomUrlSafe(32);
  const challenge = await pkceChallenge(verifier);
  const state = randomUrlSafe(16);
  const nonce = randomUrlSafe(16);

  const pending: PendingTransaction = { verifier, state, nonce };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri(),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${config.issuer}/v1/authorize?${params.toString()}`;
}

/** True when the current URL looks like an Okta authorize-endpoint redirect
 *  (has `code`/`error` + `state` query params) — used by the `/callback`
 *  route to decide whether there's anything to do. */
export function isPendingCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has("state") && (params.has("code") || params.has("error"));
}

/** Completes the flow from the `/callback` route: validates `state`,
 *  exchanges the code, and verifies the ID token — exactly the same checks
 *  as the native flow (`src-tauri/src/auth/oidc.rs`), just running in the
 *  browser. Always clears the pending transaction from sessionStorage
 *  before returning, success or failure, so a stale entry can never be
 *  reused across attempts. */
export async function completeBrowserLogin(): Promise<BrowserOktaLoginResult> {
  const config = loadConfig();
  const pendingRaw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);

  if (!pendingRaw) {
    throw new AppError("auth_failed", "Sign-in could not be verified — please try again.");
  }
  const pending = JSON.parse(pendingRaw) as PendingTransaction;

  const params = new URLSearchParams(window.location.search);
  const returnedState = params.get("state");
  if (!returnedState || returnedState !== pending.state) {
    throw new AppError("auth_failed", "Sign-in could not be verified — please try again.");
  }

  const code = params.get("code");
  if (!code) {
    const description = params.get("error_description") ?? "Sign-in was cancelled or failed.";
    throw new AppError("auth_failed", description);
  }

  const tokenResponse = await fetch(`${config.issuer}/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: config.clientId,
      code_verifier: pending.verifier,
    }),
  }).catch((err) => {
    throw new AppError(
      "network",
      "Couldn't reach Okta to finish signing in. If this keeps happening, this origin may need to be added as a Trusted Origin in the Okta admin console — see docs/WEB_LOCAL_DEVELOPMENT.md.",
      err,
    );
  });

  if (!tokenResponse.ok) {
    throw new AppError("auth_failed", "Sign-in with Okta failed.", await tokenResponse.text().catch(() => ""));
  }

  const { id_token: idToken } = (await tokenResponse.json()) as { id_token: string };

  const jwks = createRemoteJWKSet(new URL(`${config.issuer}/v1/keys`));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: config.issuer,
    audience: config.clientId,
    algorithms: ["RS256"],
  }).catch((err) => {
    throw new AppError("auth_failed", "Could not verify the identity token.", err);
  });

  if (payload.nonce !== pending.nonce) {
    throw new AppError("auth_failed", "Sign-in could not be verified — please try again.");
  }

  lastIdToken = idToken;

  return {
    subject: String(payload.sub),
    employeeEmail: typeof payload.email === "string" ? payload.email : null,
  };
}

/** Best-effort RP-initiated logout redirect. Unlike the native flow, this
 *  navigates the tab away entirely (there's no way to "wait for the
 *  redirect" in-page the way a native deep-link callback can) — so callers
 *  must clear local application state BEFORE calling this, not after. A
 *  no-op (does not navigate) if no Okta session's ID token is held — e.g.
 *  Development Mode, or Okta login never completed. */
export function redirectToBrowserLogout(): void {
  const idToken = lastIdToken;
  lastIdToken = null;
  if (!idToken) return;

  const config = loadConfig();
  const params = new URLSearchParams({
    id_token_hint: idToken,
    post_logout_redirect_uri: postLogoutRedirectUri(),
  });
  window.location.href = `${config.issuer}/v1/logout?${params.toString()}`;
}
