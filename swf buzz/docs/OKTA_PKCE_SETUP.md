# Okta OIDC + PKCE Setup

How SWF Buzz's production login works, exactly what's configured, and how to reproduce/troubleshoot
it locally. No client secret is ever used or stored anywhere in this app — this is a public native
client using Authorization Code + PKCE, which is designed specifically so a public client never
needs one.

## 1. Okta configuration (this environment)

| Setting | Value |
|---|---|
| Okta domain | `trial-7050986.okta.com` |
| Application type | Native application |
| Client ID | `0oa17llt8buRrHSrX698` (a public identifier, not a secret — safe to appear in client code/config, same as any OAuth public-client ID) |
| Sign-in redirect URI | `com.okta.trial-7050986:/callback` |
| Sign-out redirect URI | `com.okta.trial-7050986:/` |
| Grant type | Authorization Code |
| PKCE | **Required** (`code_challenge_method=S256`) |
| Client secret | **None** — this app never sends one, and Okta's "Native application" type for a public client should not issue/require one |

Verified live against this tenant's own discovery document
(`https://trial-7050986.okta.com/oauth2/default/.well-known/openid-configuration`) during
development of this feature — not assumed:

| Endpoint | URL |
|---|---|
| Issuer | `https://trial-7050986.okta.com/oauth2/default` |
| Authorization | `https://trial-7050986.okta.com/oauth2/default/v1/authorize` |
| Token | `https://trial-7050986.okta.com/oauth2/default/v1/token` |
| UserInfo | `https://trial-7050986.okta.com/oauth2/default/v1/userinfo` (not currently called — the ID token already carries `sub`/`email`) |
| End session (logout) | `https://trial-7050986.okta.com/oauth2/default/v1/logout` |
| JWKS | `https://trial-7050986.okta.com/oauth2/default/v1/keys` |
| `code_challenge_methods_supported` | `["S256"]` |

These are hardcoded as the default issuer in `SWF_BUZZ_OKTA_ISSUER` (see §3) rather than fetched via
discovery at runtime — `src-tauri/src/auth/oidc.rs` builds `/v1/authorize`, `/v1/token`, `/v1/logout`,
`/v1/keys` directly from the configured issuer, matching Okta's fixed, documented path convention
for an Okta authorization server, rather than adding a discovery-document HTTP round-trip on every
login purely to re-derive URLs that don't change for a given tenant. If this app is ever pointed at
a non-Okta OIDC provider whose paths don't follow this convention, switch to real discovery-document
fetching at that point — don't hardcode a second provider's path convention alongside this one.

## 2. Why a custom URL scheme, not `localhost`

Okta native apps can use either a loopback redirect (`http://127.0.0.1:{port}/callback`) or a custom
URL scheme (`com.example.app:/callback`) as the registered redirect URI. **This Okta application is
configured with a custom scheme, not a loopback address** — so this app's redirect handling uses a
custom-URL-scheme deep link, not an HTTP listener. (An earlier version of this code used a loopback
listener; that could never have worked against this Okta app's actual registered redirect URI, and
was replaced — see `docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md` for the audit that found this.)

## 3. Environment variables

Two separate pairs, read by two separate layers (Cargo/Tauri does not read `.env.local`):

```sh
# .env.local — read by Vite (frontend build). Used only for the
# "Sign in with Okta" button's best-effort visibility check
# (LoginView.vue) — NOT the actual source of truth for the login flow.
VITE_OKTA_ISSUER=https://trial-7050986.okta.com/oauth2/default
VITE_OKTA_CLIENT_ID=0oa17llt8buRrHSrX698

# Real exported shell environment variables — read by Rust directly via
# std::env::var (src-tauri/src/auth/oidc.rs). This IS the source of truth;
# if these are unset, Okta login fails with "okta_not_configured" even if
# the VITE_* pair above is set and the button renders.
export SWF_BUZZ_OKTA_ISSUER=https://trial-7050986.okta.com/oauth2/default
export SWF_BUZZ_OKTA_CLIENT_ID=0oa17llt8buRrHSrX698
```

Set the `SWF_BUZZ_OKTA_*` pair in the same shell before running `npm run tauri dev` — they do not
persist across shell sessions unless added to your own shell profile.

## 4. The full PKCE flow, as implemented

```
SWF Buzz (src-tauri/src/auth/oidc.rs::login)
  │
  ├─ generate: code_verifier (32 random bytes, base64url)
  ├─ generate: code_challenge = base64url(SHA-256(code_verifier))
  ├─ generate: state (16 random bytes, base64url)
  ├─ generate: nonce (16 random bytes, base64url)
  │
  ├─ register a one-shot channel as the "pending callback" (managed Tauri state)
  ├─ open system browser → {issuer}/v1/authorize?
  │     client_id&response_type=code&scope=openid+email+profile
  │     &redirect_uri=com.okta.trial-7050986:/callback
  │     &state&nonce&code_challenge&code_challenge_method=S256
  │
  ▼
Okta Hosted Login (system browser, NOT an embedded webview)
  │ user authenticates
  ▼
Okta redirects to: com.okta.trial-7050986:/callback?code=...&state=...
  │
  ▼
OS invokes SWF Buzz via the registered custom URL scheme
  │ (tauri-plugin-deep-link registers the scheme; tauri-plugin-single-instance
  │  ensures this reaches the ALREADY-RUNNING window, not a second one — the
  │  OS always launches a fresh process for a custom-scheme invocation, and
  │  single-instance detects that, forwards its argv to the primary instance,
  │  and the second process exits)
  ▼
Rust: pending-callback channel receives the URL
  │
  ├─ validate: state matches the one generated for this attempt (else: hard
  │            failure, "sign-in could not be verified" — not silently ignored)
  ├─ extract: authorization code
  │
  ▼
POST {issuer}/v1/token
  grant_type=authorization_code&code&redirect_uri&client_id&code_verifier
  (code_verifier sent ONLY here — never to /authorize)
  │
  ▼
{ id_token }
  │
  ├─ fetch {issuer}/v1/keys (JWKS)
  ├─ find the key matching id_token's `kid` header
  ├─ verify RS256 signature
  ├─ verify iss === configured issuer
  ├─ verify aud === client_id
  ├─ verify exp (not expired) — jsonwebtoken's default behavior
  ├─ verify nonce === the one generated for this attempt
  │
  ▼
{ sub, email } — trusted, verified claims
  │
  ├─ id_token itself is retained ONLY in Rust memory (never sent to the
  │  frontend/webview) — needed later for logout's id_token_hint
  │
  ▼
Returned to frontend: { subject: sub, employeeEmail: email }
  │
  ▼
SWF Buzz identity-resolution (useAuth.ts) → community role → dashboard
```

## 5. Logout flow

```
useAuth.ts logout()
  │
  ├─ OktaAuthService.logout():
  │    ├─ disconnect the NIP-46 bunker (if one was connected)
  │    └─ invoke("okta_logout") — Rust:
  │         ├─ takes the Rust-held id_token (cleared either way — a second
  │         │  call with nothing stored is a safe no-op, not an error)
  │         ├─ generates a fresh `state`
  │         ├─ opens system browser →
  │         │    {issuer}/v1/logout?id_token_hint&post_logout_redirect_uri=
  │         │    com.okta.trial-7050986:/&state
  │         └─ waits (best-effort) for the sign-out redirect back to
  │              com.okta.trial-7050986:/ — a failure/timeout here does NOT
  │              fail the command; local teardown proceeds regardless
  │
  ├─ clearActiveSigningService()
  ├─ relayConnectionService.disconnect()
  ├─ session.clearSession() — authStatus → "unauthenticated"
  └─ router.push({name: "login"})
```

The local application session is **always** fully cleared regardless of whether the Okta end-session
round trip succeeds — see docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md §9 gap 5's concern about a
local-only logout leaving a remote SSO session alive: this flow does perform the real remote
end-session step (not just local teardown), but never lets a failure in that step trap the user in a
signed-in local state.

## 6. Local testing procedure

1. Ensure the local relay stack is up (`docker ps` shows `buzz-relay`/`buzz-postgres`/`buzz-redis`/
   `buzz-minio` healthy — see `docs/LOCAL_DEVELOPMENT.md`).
2. Export the `SWF_BUZZ_OKTA_*` pair (§3) in the shell you'll run `npm run tauri dev` from.
3. Confirm `.env.local` has the matching `VITE_OKTA_*` pair (already set for this tenant).
4. `npm run tauri dev` — the native window should show **both** "Sign in with Okta" and "Continue in
   Development Mode" (dev builds only) on the login screen.
5. Click "Sign in with Okta" — the system browser opens to Okta's hosted login. **This step requires
   a real interactive human login** — an automated agent cannot complete it without a real Okta
   account's credentials.
6. After successful Okta authentication, the browser should redirect and the native SWF Buzz window
   should receive the callback automatically (you may see the OS briefly flash/focus-steal — this is
   the second, forwarded process instance exiting immediately, expected behavior).
7. The app should show a brief resolving state, then land on the dashboard.
8. Click "Sign out" — the browser should briefly open Okta's logout endpoint (may be invisible if it
   completes very fast), and the app should return to the login screen.

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Okta isn't configured for this build yet" | `SWF_BUZZ_OKTA_ISSUER`/`SWF_BUZZ_OKTA_CLIENT_ID` not set as real shell env vars in the process that launched `tauri dev` |
| Browser opens, but nothing happens in the app after login | The custom URL scheme isn't registered with the OS for this exact executable path — confirm `app.deep_link().register_all()` ran (check for any setup errors in the terminal); on Windows, the registry key it wrote may point at a stale `target\debug\swf-buzz.exe` path if the binary was rebuilt to a different location |
| "sign-in could not be verified — please try again" | `state` mismatch — most likely two login attempts were started close together (e.g. double-clicked "Sign in with Okta"), or the callback arrived after `CALLBACK_TIMEOUT` (5 minutes) and a fresh attempt's `state` no longer matches |
| Token exchange fails with a 400 from Okta | `redirect_uri` sent to `/v1/token` doesn't byte-for-byte match what was sent to `/v1/authorize` and what's registered in Okta — all three must be identical |
| "could not verify the identity token" | JWKS fetch failed, no matching `kid`, or a genuine signature/claim mismatch — check the error detail; a `kid` mismatch usually means Okta rotated signing keys and something cached a stale JWKS response (this app doesn't cache JWKS across logins, so a fresh login should self-heal) |
| User completes Okta login but the app shows "no SWF Buzz membership" / no role | Expected, not a bug — see `docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md` §11: Okta only authenticates identity, it does not grant a SWF Buzz community role. The signed-in pubkey (from the paired NIP-46 bunker) must exist in the relay's own membership roster — see `docs/ROLE_PERMISSION_MATRIX.md` for how test identities are set up locally |
| "user not assigned to the Okta application" (shown by Okta itself, before redirecting back) | The Okta admin must assign this user to the application in the Okta admin console — this is entirely on the Okta side, not something SWF Buzz can work around |

## 8. What this app does NOT do (by design)

- Does not use the implicit flow.
- Does not use `client_credentials`.
- Does not embed a client secret anywhere (frontend, Rust binary, `.env.local`, or any
  desktop-distributed artifact).
- Does not log the ID token, access token, authorization code, or PKCE verifier anywhere (see
  `docs/SECURITY.md`'s logging rules, which this flow follows).
- Does not persist the ID token to disk — it lives only in Rust process memory for the duration of
  one signed-in session, cleared on logout.
- Does not use an embedded webview for the login UI — always the system browser.
