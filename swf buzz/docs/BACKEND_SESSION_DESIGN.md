# Backend session design (Phase 2, DECISIONS.md D10)

**Decision record, not an essay.** Covers: where the new backend lives, how the existing Rust OIDC
flow hands off to it, and how the Vue frontend authenticates HTTP calls to it. See D10 for why this
backend exists at all and `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` for the full endpoint/schema spec this
phase is a slice of.

## 1. No cookies — bearer token via existing secure-storage infra

The master prompt's `swf_session` httpOnly-cookie model assumes a browser. This is a Tauri desktop
app: the OIDC token exchange happens in the **Rust process** (`src-tauri/src/auth/oidc.rs`), not in
the webview, via `reqwest::blocking` — a cookie `Set-Cookie` response to that Rust-side HTTP call
would land in `reqwest`'s own cookie jar, not the webview's, and would not be sent automatically by
the Vue frontend's own `fetch()` calls (separate network stack; Tauri does not bridge the two
cookie jars). Forcing a cookie model here would mean re-deriving the token in the webview or
proxying every request through Rust — unnecessary complexity for a native client that already has a
secure, working secret store.

**Decision**: the new backend issues an **opaque bearer session token**, not a cookie:

1. `oidc::login()` runs exactly as today (PKCE, deep-link callback, token exchange, **local** JWKS
   verification — unchanged, see §3 below for why this stays).
2. Immediately after, Rust calls `POST /api/session/bootstrap` on the new backend with the raw
   `id_token`. The backend independently re-verifies it (never trusts the Rust process's own
   verification — the backend is a separate trust boundary; a compromised or modified client binary
   must not be able to assert an unverified identity to it) and returns
   `{ session_token, expires_at, user: { id, okta_sub, email, display_name } }`.
3. Rust stores `session_token` via a **new whitelisted `StorageKey` variant**
   (`SwfSessionToken`) in the existing narrow `secure_storage_*` commands
   (`commands/secure_storage.rs`) — same OS-keychain-backed store already used for the NIP-46
   transport key, so this required no new storage mechanism, just one new enum variant.
4. `start_okta_login` returns `session_token`/`expires_at`/`user` to the frontend directly (this
   token is minted specifically for frontend use, unlike the Okta `id_token`, which stays
   Rust-only per the existing "no ID token in the frontend" rule — that rule is about the
   Okta-specific artifact needed for RP-initiated logout, not about session tokens in general).
5. On app start, before prompting login, the frontend calls
   `secure_storage_get(SwfSessionToken)`; if present and `GET /api/session` (sent with
   `Authorization: Bearer <token>`) succeeds, the stored session is reused — no re-login needed
   every launch.
6. Every subsequent frontend→backend call sends `Authorization: Bearer <session_token>`.
7. Logout: frontend calls `POST /api/session/logout` (bearer-authenticated) to revoke the token
   server-side, then `secure_storage_delete(SwfSessionToken)`, then the existing `okta_logout`
   Tauri command runs unchanged (Okta RP-initiated logout via `id_token_hint`).

## 2. Token storage: hash at rest, same convention as invites

`sessions(id, user_id, token_hash UNIQUE, created_at, expires_at, revoked_at)`. The raw token is
generated with a CSPRNG, returned once in the bootstrap response, and never stored — only its
SHA-256 hash. `GET /api/session` and every authenticated endpoint hash the presented bearer token
and look up by `token_hash`. This mirrors the invite-token hashing convention the master prompt
specifies for `community_invites` (D10) — one consistent "never store bearer secrets in plaintext"
rule across the whole new backend, not a one-off.

Session lifetime: 12 hours from issuance, no sliding renewal in this phase (re-login extends it —
simplest correct thing for Phase 2; revisit if product wants silent refresh later). Logout sets
`revoked_at`; `GET /api/session` and all authenticated routes reject a token whose row is expired
or revoked.

## 3. The Tauri-side JWKS verification in `oidc.rs` is *not* being removed

`oidc.rs` already fetches Okta's JWKS and verifies the ID token's signature/`iss`/`aud`/`exp`/nonce
before returning `OktaLoginResult` to the caller (this closed D9 already, in a prior edit not yet
reflected in `DECISIONS.md`'s D9 text — corrected in this pass). That verification stays: it is
what lets the Tauri app immediately show/reject a login attempt without a network round-trip to the
new backend's response, and it validates the OIDC **nonce**, which is a Rust-process-local secret
(generated in `login()`) that the new backend never sees and has no way to check. The new backend's
own JWKS verification (§1 step 2) is a second, independent check at a different trust boundary —
intentional defense in depth, not redundant duplication to be "optimized away."

## 4. New crate location and stack

`swf buzz/backend/` — a new standalone Cargo binary crate (`swf-buzz-backend`), **not** a workspace
member of `../buzz` and **not** a modification to `../buzz` in any way. Stack chosen to match
`buzz-relay`'s own dependency versions for consistency (not copied code, matching versions only):
`axum = "0.8"`, `tokio = "1"`, `sqlx = "0.9"` (postgres, uuid, chrono, json, runtime-tokio,
tls-rustls features), `jsonwebtoken = "9"` (already used in `src-tauri`), `reqwest` for the JWKS
fetch, `thiserror`/`anyhow` for errors, `serde`/`serde_json`.

**`sqlx::query`/`query_as` (runtime-checked), not `query!`/`query_as!` (compile-time-checked)** —
deliberate: this dev machine has no live Postgres instance running in this session (Docker Desktop
is down), and the compile-time macros require either a live `DATABASE_URL` or a committed
`.sqlx` query-metadata cache at every `cargo check`. Runtime-checked queries let this crate compile
and unit-test cleanly without either. Switching to the compile-time macros later (once a real
Postgres is available to run `cargo sqlx prepare` against) is a mechanical, low-risk follow-up, not
a redesign — noted here so it isn't forgotten, not silently left as the permanent choice.

## 5. What's deliberately out of scope for this phase

Community membership, invites, channels, messages, threads, DMs — Phase 3+ per
`OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §3. This phase only stands up `users`, `sessions`, and the three
auth endpoints (`bootstrap`, `GET /api/session`, `logout`).
