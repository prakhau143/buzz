# Web (Browser) Local Development

How to run and test SWF Buzz as a **plain Chrome tab via `npm run dev`**, without Tauri at all —
temporarily the primary verification target while Windows Smart App Control blocks native Rust
compilation on this machine (see `docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md`'s changelog banner and
the "Native Tauri" line in every status report). Nothing in this document changes, weakens, or
replaces the native build — see §7/§9 for exactly what's shared and what's genuinely different.

## 1. Exact URL

```
http://127.0.0.1:1420/
```

**Not** `http://localhost:1420/` — `vite.config.ts` explicitly binds to `host: host || "127.0.0.1"`
with a comment noting IPv6 resolution issues with `localhost` on this machine (`::1` has nothing
listening on it). `127.0.0.1:1420` is confirmed listening and returning HTTP 200 with
`<title>SWF Buzz</title>`. Always use this exact origin — it's also the one value registered as this
build's Okta redirect URI (§4); a different origin (a different port, or `localhost` instead of
`127.0.0.1`) will not match and Okta will reject the redirect.

## 2. Current verified state (this session)

| Check | Result |
|---|---|
| Docker (`buzz-relay`, `buzz-postgres`, `buzz-redis`, `buzz-minio`, `buzz-adminer`) | All up; postgres/redis/minio report `healthy` |
| Relay NIP-11 (`curl -H "Accept: application/nostr+json" http://localhost:3000`) | HTTP 200, valid relay info doc |
| Vite dev server | Running, HTTP 200 at `http://127.0.0.1:1420/`, correct `<title>` |
| `npm run typecheck` | Pass, 0 errors |
| `npm run lint` (`--max-warnings 0`) | Pass, 0 warnings |
| `npm run test` | Pass, 139/139 across 20 files |
| `npm run build` | Pass, production bundle emitted to `dist/` |
| Deterministic dev owner seeded + verified end-to-end | Done — see §6 |
| Interactive click-through in a real Chrome window | **Not performed by the agent** — see §10 |

## 3. Two Okta implementations, one shared everything-else

A browser tab **cannot** register a custom OS URL scheme (`com.okta.trial-7050986:/callback`) — only
an installed native app can do that, which is why the native Tauri build uses one at all (see
`docs/OKTA_PKCE_SETUP.md` §2). There is no way to "reuse" that redirect URI in a browser; it isn't
that the browser flow is a lesser version of the native one, it's a different OS-level mechanism for
receiving the redirect, and Okta requires each mechanism's redirect URI to be registered separately.
So this project now has two Okta client implementations, selected at runtime via `isTauri()`
(`@tauri-apps/api/core`) — never both active in the same session:

| | Native (Tauri) | Browser (`npm run dev`) |
|---|---|---|
| Redirect target | Custom URL scheme, OS-level deep link | `http://127.0.0.1:1420/callback`, an in-app route |
| Redirect receipt | `tauri-plugin-deep-link` + `tauri-plugin-single-instance` | A full page load of `/callback` (`OktaCallbackView.vue`) |
| PKCE verifier/state/nonce storage (transient, this attempt only) | Rust process memory (`Mutex`) | `sessionStorage` (cleared immediately on success or failure) |
| Token exchange (`POST /v1/token`) | Rust `reqwest` | Browser `fetch()` — **requires an Okta Trusted Origin entry, see §4** |
| ID token verification | Rust `jsonwebtoken` crate, JWKS fetched via `reqwest` | `jose`'s `createRemoteJWKSet` + `jwtVerify` |
| ID token storage (for logout's `id_token_hint`) | Rust process memory only, cleared on logout | A private, non-exported module variable in `oktaBrowserFlow.ts`, cleared on logout |
| Checks performed | S256 PKCE · random `state` + `nonce` · RS256 signature · `iss` · `aud` · `exp` · `nonce` match | **Identical** — same list, same order, just executed in TS instead of Rust |
| Files | `src-tauri/src/auth/oidc.rs`, `src/features/auth/authService.okta.ts` | `src/features/auth/oktaBrowserFlow.ts`, `src/features/auth/authService.okta.browser.ts` |

Everything *after* "we now know who the Okta identity is" — signing-service selection, relay
connection, community-role resolution, routing, every Vue component, every Pinia store, the entire
rest of the app — is one shared code path (`useAuth.ts`'s `resolveIdentityAndRole()`), used
identically by Development Mode, native Okta, and browser Okta. `useAuth.ts` is the one place that
branches on `isTauri()`, and only for the two functions that must (`loginWithOkta()`, `logout()`);
everything else in that file, and every other file in `src/`, is unconditional and runs the same in
both environments.

## 4. Okta admin console changes required for the browser flow

Not yet applied as of this writing — the browser Okta round trip cannot be fully tested until these
exist. Development Mode and the app's core functionality do **not** depend on this.

Go to **Okta Admin Console → Applications → [SWF Buzz application] → General → Sign-in redirect
URIs → Add:**
```
http://127.0.0.1:1420/callback
```
(Keep the existing `com.okta.trial-7050986:/callback` entry — this is additive, for the native build,
not a replacement.)

Go to **Okta Admin Console → Applications → [SWF Buzz application] → General → Sign-out redirect
URIs → Add:**
```
http://127.0.0.1:1420/
```

Go to **Okta Admin Console → Security → API → Trusted Origins → Add Origin:**
```
Name: SWF Buzz local dev (browser)
Origin URL: http://127.0.0.1:1420
Type: CORS
```
This one is easy to miss and has a different failure mode than a redirect-URI mismatch: without it,
`/v1/authorize` and the redirect back both work fine (a full-page navigation, not a fetch, so CORS
doesn't apply there), but the `fetch()` call to `/v1/token` in `completeBrowserLogin()` will fail with
a CORS error in the browser console — surfaced in-app as "Couldn't reach Okta to finish signing in.
If this keeps happening, this origin may need to be added as a Trusted Origin" (see
`oktaBrowserFlow.ts`'s `completeBrowserLogin`).

`.env.local` already has the matching `VITE_OKTA_ISSUER` / `VITE_OKTA_CLIENT_ID` pair — no frontend
env change needed, only the three Okta-side additions above.

## 5. Browser login flow, state by state

```
LoginView.vue: "Sign in with Okta" clicked
  │
  ├─ useAuth.loginWithOkta() — isTauri() is false
  ├─ session.authStatus → "authenticating"
  ├─ oktaBrowserFlow.beginBrowserLogin():
  │    ├─ generate verifier/challenge(S256)/state/nonce
  │    ├─ sessionStorage["swf-buzz:okta-pkce-pending"] = {verifier, state, nonce}
  │    └─ window.location.href = {issuer}/v1/authorize?... (FULL PAGE NAVIGATION — tab leaves the app)
  ▼
Okta Hosted Login (real browser tab, not an embedded frame)
  │ user authenticates
  ▼
Browser is redirected to: http://127.0.0.1:1420/callback?code=...&state=...
  ▼
Vue Router matches /callback → OktaCallbackView.vue mounts (a fresh page load — a fresh JS
  module graph, fresh Pinia store, fresh everything; nothing survives from before beginBrowserLogin()
  except sessionStorage, which is exactly what carries the PKCE transaction across this gap)
  │
  ├─ onMounted → useAuth().completeOktaBrowserLogin()
  ├─ session.authStatus → "authenticating" (again — this IS a fresh store instance)
  ├─ oktaBrowserFlow.completeBrowserLogin():
  │    ├─ read + immediately clear sessionStorage pending transaction
  │    ├─ validate state === pending.state (else: hard failure, same as native)
  │    ├─ POST {issuer}/v1/token (code, code_verifier, redirect_uri, client_id) — needs §4's Trusted Origin
  │    ├─ verify id_token: JWKS (jose), RS256, iss, aud, exp
  │    ├─ validate nonce === pending.nonce (else: hard failure)
  │    └─ return { subject, employeeEmail }
  ├─ if a NIP-46 bunker was already paired in a previous session for this identity → resolveIdentityAndRole()
  │    (connect relay → resolve community role → router.push("channels"))
  └─ else → session.authStatus "unauthenticated", pendingBunkerPairing set (same "needs a bunker" UI
       as the native flow — see docs/DECISIONS.md D3; this is NOT an error state)
```

Logout is the same shape, reversed: `useAuth.logout()` clears all local state (session, signing
service, relay connection) **before** calling `oktaAuthServiceBrowser.logout()`, because that call
navigates the tab away to Okta's `/v1/logout` — there is no "after" on that path the way there is for
the native flow's awaited, in-process browser round trip. If there's no Okta session held (e.g. the
user only ever used Development Mode), `redirectToBrowserLogout()` is a no-op and `router.push`
never even needs to fire because local state is already cleared synchronously.

## 6. Development Mode: deterministic identity, verified

Development Mode's signer (`DevSigningService`) now defaults to a **fixed** test keypair instead of a
fresh random one per session:

```
secret key: 0000000000000000000000000000000000000000000000000000000000000001
pubkey:     79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
```

This is the smallest valid secp256k1 scalar (its pubkey is the well-known generator point) —
deliberately public, never a secret, never treated as one. The only property that matters is that
it's the *same* value every time `new DevSigningService()` is constructed with no argument, which is
what makes a role seeded once in `relay_members` survive a dev-server restart (a restart tears down
and rebuilds the whole `useAuth.ts` module graph, including its module-scope `devSigningService`
instance — without this, that would silently mint a new random identity every restart and any
previously-seeded role would point at a pubkey nobody uses anymore). An explicit
`new DevSigningService("ephemeral")` opts back into a fresh random key, for the rarer case of needing
several distinct dev identities live at once (e.g. testing owner and member simultaneously in two
tabs) — see `docs/ROLE_PERMISSION_MATRIX.md` §2.

This directly satisfies the requirement that Development Mode must not silently act as
Owner/Admin-for-everyone: the deterministic pubkey has **no role at all** until someone explicitly
runs the seeding procedure below, and it goes through the exact same `relay_members` /
`fetchMembershipList()` / `resolveMyRole()` path as every other identity — no special-cased "dev mode
= owner" branch exists anywhere in this codebase (verified: `grep` for `authMode.*development` outside
`signingService.dev.ts`/`authService.dev.ts` themselves turns up nothing that branches permissions on
it).

**Verified this session, end-to-end, not just asserted:**

1. Computed the pubkey above directly from the fixed secret key using this project's own
   `nostr-tools` dependency (not by inspection/guessing).
2. `INSERT INTO relay_members (community_id, pubkey, role, added_by) VALUES
   ('dc4b45d3-7f95-4e60-9bbf-52a8f34c9b46', '79be667e...798', 'owner', 'local-test-seed')` — this
   community's `host` is `localhost:3000`, matching `VITE_RELAY_URL=ws://localhost:3000`.
3. Confirmed the relay's 60-second background maintenance reconciler (`main.rs`) does **not** pick up
   a community's very first snapshot on its own within a reasonable wait — this matches
   `docs/ROLE_PERMISSION_MATRIX.md` §2 step 4's existing guidance to trigger one via a real admin
   action, not assume it happens automatically.
4. Signed and published a real `kind:9030` (add member) event as the seeded owner, using this
   project's own event shapes (`src/protocol/relayMembers.ts`) — the relay logged
   `"relay member add attempted", role: "member", was_inserted: true` followed by
   `"NIP-43 membership list published", member_count: 2` (`buzz-relay`'s own log, not inferred).
   Then published a real `kind:9031` (remove member) for the same throwaway pubkey to clean up,
   which logged `member_count: 1` — leaving exactly the seeded owner, and only the seeded owner, in
   the live, relay-authored kind:13534 snapshot.
5. This means `relayMembersService.fetchMembershipList()` — the exact function `useAuth.ts` calls
   after every login — will now return `[{ pubkey: "79be667e...798", role: "owner" }]` for this
   community, today, without any further setup. Signing in via Development Mode against
   `ws://localhost:3000` resolves to **Owner**.

To reset to a no-role identity (e.g. to test the Member-role UI instead):
```sh
docker exec buzz-postgres psql -U buzz -d buzz -c "DELETE FROM relay_members WHERE pubkey = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';"
```
then repeat the add/remove-event trick above (or use the in-app "Add member" form once any other
owner exists) to force a fresh snapshot reflecting the deletion.

## 7. Role-based access — testing matrix

| Role | How to get there locally | What should be visible |
|---|---|---|
| Member | Seed `role='member'` for the dev pubkey (or leave unseeded — no snapshot row also resolves as no elevated role) | Channels, DM, submit a report; no moderation queue, no member management |
| Admin | Seed `role='admin'` | + moderation queue, add member (member role only), ban/timeout (not against owner/admin), resolve reports |
| Owner | Seed `role='owner'` (current live state — see §6) | Everything Admin has, + change any member's role, remove admin/member, ban/timeout anyone |
| Moderator / Operator (platform) | **Not achievable locally** — resolved via a separate `GET /api/admin/v1/probe` call against real platform admin infra that does not exist in this local stack; see `docs/ROLE_PERMISSION_MATRIX.md` §2 "Platform Operator/Moderator test identities" | — |

Full permission-by-permission detail: `docs/ROLE_PERMISSION_MATRIX.md` §1.

## 8. Known limitation: NIP-46 bunker pairing in a browser

`completeBunkerPairing()` in `useAuth.ts` is shared, unconditional code (not gated by `isTauri()`),
and it calls into `Nip46SigningService`, which calls Tauri's `invoke("secure_storage_set"/...)` to
persist the bunker connection. Those commands don't exist outside a Tauri webview — in a plain Chrome
tab, this call throws.

This is a **pre-existing gap in an already-incomplete feature**, not something introduced or newly
broken by the browser work: per `docs/DECISIONS.md` D3 and `authService.okta.ts`'s own doc comment, a
real NIP-46 bunker to pair with does not exist anywhere in the Buzz stack yet regardless of platform —
so there is nothing to actually pair with today, natively or in-browser. Reaching this code path in
the browser requires first completing a real Okta login (blocked on §4's Okta-side changes not being
live yet) and then having no previously-restored bunker connection. Left undone deliberately, scoped
out: giving bunker pairing a browser-safe storage fallback is a separate, larger piece of work
(designing what "secure enough for a bunker's transport key" means with no OS keychain available) that
this task's goal — verifying Okta identity login, Development Mode, and role-based UI in a browser —
does not require. Tracked here so it isn't silently forgotten.

## 9. What is explicitly unchanged

- Nothing was removed from the native Tauri path. `src-tauri/`, `authService.okta.ts`, and every
  Rust file are untouched by this phase — `loginWithOkta()`/`logout()` still call them, unchanged,
  whenever `isTauri()` is true.
- Development Mode's behavior for the native build is identical — same deterministic key, same
  shared `resolveIdentityAndRole()`.
- No PKCE, state, nonce, signature, issuer, audience, or expiration check was skipped, weakened, or
  made "best-effort" in the browser implementation — see the checklist in §3's table; every check
  the native flow performs, the browser flow performs too, verified line-by-line against
  `src-tauri/src/auth/oidc.rs::verify_id_token`.
- No token, secret, or PKCE verifier is logged anywhere in either flow (`oktaBrowserFlow.ts` never
  calls `console.*` with any of these values; grepped for `console.log` in the file — zero results).
- No client secret exists in any browser-reachable file, `.env.local`, or anywhere else — the browser
  flow is a public client exactly like the native one, using the same Client ID, no secret, ever.

## 10. What was NOT verified this session, and why

The one gap in this pass: **no interactive click-through of the running app in an actual Chrome
window.** The available browser-automation tooling (`claude-in-chrome`) runs against a browser
instance that does not have network access to this machine's `127.0.0.1` — confirmed directly:
navigating that tool's browser to `https://example.com` succeeded, but to `http://127.0.0.1:1420/` and
`http://localhost:1420/` both failed with `ERR_CONNECTION_REFUSED`, while `curl` from this same
machine's own shell succeeds against the identical URL at the identical moment. That tool's browser is
evidently not on this machine's network — nothing in this project can fix that, and exposing this
local dev server (with a real Okta client configured) to a wider network just to make an external
automation tool reach it would be a real security posture change, not a safe workaround, so it was not
attempted.

Everything gate-checkable without a live browser session was checked instead (§2), and the identity/
role-resolution claims in §6 were verified against real relay logs and real Postgres state, not
guessed. The one remaining step is genuinely manual: **open `http://127.0.0.1:1420/` in your own
Chrome**, click "Continue in Development Mode," and confirm you land on Channels as Owner (per §6),
with the relay connection badge showing connected. If anything there doesn't match this document,
that's the next thing to fix.
