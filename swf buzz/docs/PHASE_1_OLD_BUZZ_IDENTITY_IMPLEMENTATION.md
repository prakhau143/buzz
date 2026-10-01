# Phase 1 — OLD BUZZ Identity Login (no Okta): Implementation Report

| | |
|---|---|
| **Date** | 2026-09-21 |
| **Scope** | Rust identity module, OS-keyring storage, Rust-side signing, `TauriSigningService`, auth orchestration rewrite, minimal login screen, relay role → `ready` |
| **Status** | **Implemented and verified** on Windows against the real Buzz relay. Nothing committed or pushed. |
| **Reference** | `docs/SWF_BUZZ_OLD_BUZZ_IDENTITY_MIGRATION_PLAN.md` (§7-§10, §31 phases 1-2) |

**Read this first — three things that differ from what you might assume**

1. **A relay-verdict bug was found and fixed.** On a *closed* relay, a non-member reached `authStatus = ready` with no role, because `RelayConnectionService` never read the relay's NIP-42 verdict. It needed a small additive change to `RelayConnectionService` (a file you asked me not to rewrite; I added to it, I did not rewrite it). Details in §7.
2. **The test suite cannot start on this machine's Node.** `jsdom 30` requires Node ≥ 22.22; this machine has Node 20.19.4, so even untouched specs failed before my changes. I ran the suite with a **test-run-only shim kept outside the repo**. Results below are "with shim". Details in §9.
3. **I made one mistake during testing and corrected it.** My first "restart" test did not actually restart the app (an old process survived and answered), so I redid it properly. Details in §8.

---

## 1. Files

### Added
| File | Purpose |
|---|---|
| `src-tauri/src/identity/mod.rs` | Module root; `init()` loads the persisted identity at startup (never generates) |
| `src-tauri/src/identity/state.rs` | In-memory identity state; `IdentityInfo` (public data only); hand-written `Debug` that cannot print the secret |
| `src-tauri/src/identity/storage.rs` | Resolution order, keyring/file persistence, recovery rules, `create_identity` |
| `src-tauri/src/identity/signing.rs` | Rust-side NIP-01 event signing |
| `src-tauri/src/identity/commands.rs` | Tauri commands `get_identity`, `create_identity`, `sign_event` |
| `src/features/signing/signingService.tauri.ts` | `SigningService` implementation that calls those commands |
| `tests/unit/signing/signingService.tauri.spec.ts` | Signer tests + a guard that no frontend file references the keyring entry or a secret-export command |
| `tests/unit/services/RelayConnectionService.auth.spec.ts` | Tests for the relay AUTH verdict (§7) |
| `docs/PHASE_1_OLD_BUZZ_IDENTITY_IMPLEMENTATION.md` | This report |

### Modified
| File | Change | Why |
|---|---|---|
| `src-tauri/Cargo.toml` (+3), `Cargo.lock` (+305 lines) | add `nostr = "0.44"` | Key generation and BIP-340 signing. Same crate/version as the reference desktop; already in the local cargo cache. The lock growth is that crate's transitive dependencies (`secp256k1`, `bitcoin_hashes`, `bech32`, …). |
| `src-tauri/src/lib.rs` (+12) | manage `IdentityState`, call `identity::init` in `setup()`, register 3 commands | Wiring only. Okta commands and handlers untouched. |
| `src/features/auth/useAuth.ts` (+124) | new `attemptSilentResume` (local identity), `continueWithLocalIdentity`, `createNewIdentity`, local logout branch; old resume renamed `attemptLegacyOktaSilentResume` | The auth orchestration rewrite you asked for. All Okta functions remain. |
| `src/views/LoginView.vue` | minimal identity screen | Requested. Okta button and unreachable bunker step removed **from the view only**. |
| `src/stores/session.ts` (+12) | `AuthMode` gains `"local"`; `setIdentity` clears a stale `authError` | Type; and a stale-error bug seen in live testing (§7). |
| `src/app/router/index.ts` (+8) | local-identity sessions landing on `home` go to `channels` | Home is HTTP-backend based and needs a backend session the local identity does not have. |
| `src/services/RelayConnectionService.ts` (+50) | check the relay's AUTH verdict before reporting "connected" | The bug in §7. Additive; existing behaviour is unchanged when there is no verdict. |
| `tests/unit/auth/useAuth.spec.ts` | 3 old-resume tests repointed at the renamed legacy function; `channels` route added to the test router; new local-identity tests | The old tests cover behaviour I deliberately moved. |
| `tests/unit/stores/session.spec.ts` (+19) | two tests | `"local"` mode; stale-error regression |

Not changed: `RelayMembersService`, `resolveMyRole`, all message/channel/thread/reaction/DM/profile/presence/typing services, all `protocol/*`, the `SigningService` interface, the backend, database migrations, `package.json`, and everything under `buzz/buzz` (OLD BUZZ source).

## 2. Identity architecture

```
Tauri Rust process                                       Vue webview (no key, ever)
┌──────────────────────────────────────────────┐         ┌─────────────────────────────────┐
│ identity::init()  (setup)                    │         │ TauriSigningService             │
│   env(debug only) → OS keyring → identity.key│  IPC    │   getPublicKey() → get_identity │
│   → nothing.  NEVER generates on startup     │◄───────►│   signEvent()   → sign_event    │
│ IdentityState { Keys }  ◄─ only place the key│         │ useAuth: create/continue/resume │
│ commands: get_identity · create_identity ·   │         │ RelayConnectionService (NIP-42) │
│           sign_event                         │         │ RelayMembersService → role      │
└──────────────┬───────────────────────────────┘         └───────────────┬─────────────────┘
               │ OS keyring: service "swf-buzz", entry "identity_nsec"    │ WebSocket + NIP-42
               ▼                                                          ▼
       Windows Credential Manager                                 Buzz relay (unchanged)
                                                                  relay_members → role
```

## 3. Authentication flow

```
App start ─► router first guard ─► attemptSilentResume()            (Tauri only)
   get_identity ─► pubkey?  no → /login ("Create new identity")
                            yes → activate TauriSigningService
                                  → RelayConnectionService.connect()  ── NIP-42 AUTH signed in Rust
                                  → relay accepts? no → authError + /login (message, "Continue" to retry)
                                  → fetch relay_members (kind 13534) → resolveMyRole(pubkey)
                                  → setCommunityRole() ⇒ authStatus = "ready" → /channels
/login buttons:  "Create new identity" → create_identity → same flow
                 "Continue with existing identity" → same flow
```
No Okta, OAuth, PKCE, Application User, `okta_sub`, email identity, backend session, bearer token, NIP-46, bunker, or derived key is used on this path. Logging in as `local` deliberately skips the legacy backend-session bootstrap.

## 4. Key storage flow

- **First launch:** nothing exists. Startup only *resolves*; it never generates.
- **"Create new identity":** `create_identity` generates a secp256k1 key in Rust, stores the `nsec` in the OS keyring (service `swf-buzz`, entry `identity_nsec`), reads it back to verify, then writes a marker file `identity.keyring`. Falls back to `identity.key` (created with `create_new`, so it can never overwrite) only if the keyring write or its round trip fails.
- **Later launches:** the same key is loaded from the keyring.
- **Safety rules (ported from OLD BUZZ):** a marker + unreachable keyring = *keyring-locked*; a marker + empty keyring = *lost*; an unparseable stored value = *corrupt*. In *keyring-locked* and *corrupt*, `create_identity` **refuses** rather than mint a second identity or overwrite the entry. *Lost* allows an explicit new identity.
- **Debug builds only:** `SWF_BUZZ_PRIVATE_KEY` overrides everything; release builds ignore it.
- The keyring entry name is not a variant of `StorageKey`, so the existing JS-callable `secure_storage_*` commands cannot read it.

## 5. Tauri command flow

| Command | Returns | Never |
|---|---|---|
| `get_identity()` | `{ pubkey \| null, storage, recovery }` | generates; returns a secret |
| `create_identity()` | same shape | replaces an existing key; runs in a locked/corrupt state |
| `sign_event(kind, content, createdAt, tags)` | signed NIP-01 event | returns key material |

`create_identity` is a **third command beyond the two you listed**. Your login screen needs a "Create new identity" action while `get_identity` must not generate keys, so the create step had to exist. It is idempotent and holds the state lock across check → generate → persist.

## 6. Signer flow

`TauriSigningService` implements the unchanged `SigningService` interface (`mode` is `"production"`). `getPublicKey` → `get_identity`; `signEvent` → `sign_event`; the rest of the Nostr stack keeps calling `getActiveSigningService()` and cannot tell which signer it has. `nip44Encrypt/Decrypt` throw a clear "not supported yet" error because NIP-44 would need another secret-using command; the only consumer (agent observer decryption) already treats a decrypt failure as "no frame" (`protocol/agents.ts`).

## 7. NIP-42 flow, and the bug found

Flow: relay sends a challenge → `relay.onauth` → `signAuthEvent` → `TauriSigningService.signEvent` → Rust signs kind 22242 (`relay`, `challenge` tags) → relay verifies and applies its ban check and `relay_members` gate.

**Bug (found live):** on a closed relay the relay answers a non-member with `OK false "restricted: not a relay member"`. `nostr-tools` exposes that only through the auth promise, which nothing read. The app therefore reported "connected", the roster fetch returned nothing, and login finished `ready` with role `null` — violating "ready = identity + relay + membership valid". The relay log showed it rejecting the same pubkey every ~6 s.

**Fix (`RelayConnectionService.ts`, additive):** after the AUTH window, read the verdict through the public `relay.auth()` (which returns the cached in-flight promise). A refusal → status `error` with a user-safe message, socket closed, **no reconnect loop**. No challenge, or no verdict within 2.5 s → unchanged behaviour. Two pure helpers (`authDenialFrom`, `authDenialMessage`) are exported for testing.

Live result after the fix: exactly **one** denial logged and still one 26 s later (previously a retry every ~6 s); the app stayed on `/login` with "This identity isn't a member of this community yet. Ask an admin to add you or send you an invite."

Also fixed: `session.authError` lingered after a later successful login (`setIdentity` now clears it).

## 8. Tests executed and results

### Automated
| Suite | Result |
|---|---|
| `npm run typecheck` (vue-tsc) | pass |
| `npm run lint` (`--max-warnings 0`) | pass |
| `npm run build` | pass |
| `vitest` — full suite | **39 files, 266 tests, all pass** (with the shim, §9). Includes the 10-test real-WebSocket integration spec. |
| `cargo check` | pass |
| `cargo clippy --all-targets -- -D warnings` | pass |
| `rustfmt --check` on the new `identity/*` files | pass |
| `cargo test --lib` | **27 pass** (20 new identity tests + 7 pre-existing) |

### Live, in the real Tauri app against the real Buzz relay
| # | Requested check | Result | Evidence |
|---|---|---|---|
| 1 | Fresh launch | **PASS** | No credential, no app-data dir, no `SWF_*`/`VITE_*` env vars beforehand. Log: `identity resolved — storage=none`. Screen offered "Create new identity". |
| 2 | Identity generated | **PASS** | After the click: Windows Credential Manager entry `identity_nsec.swf-buzz`, marker file created, `storage=system-keyring`. |
| 3 | Public key returned | **PASS** | `get_identity` → `0f61e5e4…320029`. |
| 4 | Private key not in Vue/webview | **PASS** | The real secret was read from the credential store into a process env var (never printed or written to disk) and searched for in a **12.9 MB full V8 heap snapshot**, the Pinia state, localStorage, sessionStorage, DOM and IndexedDB names, in both `nsec1…` and hex form. **Not found.** Positive control (the public key) *was* found in both, so the scan is not blind. Plus a repo-wide test that no frontend file references the keyring entry or a secret-export command. |
| 5 | Restart application | **PASS** (second attempt) | See the mistake below. Real restart: new PID 18368, fresh process, its own `identity resolved` log line. |
| 6 | Same public key | **PASS** | Identical pubkey, `storage=system-keyring`; the app logged in **by itself** (silent resume) to `/channels`. |
| 7 | TauriSigningService signs | **PASS** | `sign_event` returned an event that **independently verified in Node with `nostr-tools`** (signature, id, pubkey match). The TS wrapper is unit-tested; in the app it also signed the real AUTH event. |
| 8 | NIP-42 | **PASS** | Relay log: `NIP-42 auth successful` for this pubkey; only the Rust-backed signer was active. |
| 9 | `relay_members` fetched | **PASS** | Roster (kind:13534) read for each role below. |
| 10 | owner/admin/member resolved | **PASS** | Relay run closed with a separate owner "X" (env vars only): member → `member`; X promotes → `admin`; relay restarted with the app's pubkey as `RELAY_OWNER_PUBKEY` → `owner`. |
| 11 | `authStatus` ready | **PASS** | `ready`, `authMode: local`, `applicationUser: null`, `employeeEmail: null`, no `okta`. And **not** ready for a non-member (§7). |
| 12 | Starts without Okta config | **PASS** | No Okta/backend variables set anywhere; `.env.local` Okta values are blank; no Okta button rendered. |
| 13 | Nostr stack still compiles | **PASS** | typecheck, lint, build, 266 tests, cargo check/clippy/test. |

**My mistake, corrected:** stopping the first test task killed only the npm wrapper. The old Vite server kept port 1420 and the old `swf-buzz.exe` kept running, so my first "restart" failed with `Port 1420 is already in use` while the CDP port answered from the *old* instance. I caught the contradiction (exit code 1 vs "app up"), identified the leftover processes by command line, killed exactly those, and redid the restart with a check that requires a new PID and the new instance's own log line. The restart results above are from that second, genuine restart.

### Not tested live (unit-tested only, or not tested)
- **Recovery states** (`keyring-locked`, `lost`, `corrupt`) and the `identity.key` file fallback: covered by 12 Rust tests against a fake key store; not provoked in the real keyring.
- **Live logout** in the real app: unit-tested (does not call any Tauri command, does not touch the key).
- **A release/`tauri build` run**, other operating systems, and Windows file-permission behaviour of `identity.key` (Windows has no `0o600`).
- **Live role updates** without a reload (role was re-resolved on each fresh load/login).

## 9. Environment issues

- **Node 20.19.4 vs `jsdom 30` (needs Node ≥ 22.22 / ≥ 24.15).** Vitest could not start on *any* spec, including untouched ones. Two gaps, both polyfilled by a shim **in the scratchpad, not in the repo**: `worker_threads.markAsUncloneable` (jsdom's `undici`), and a global `WebSocket` (absent before Node 22; the integration spec failed with `WebSocket is not defined` until supplied). With them: 266/266. **Recommended:** run the suite on Node ≥ 22 (no shim needed) and pin it with `.nvmrc`/`engines`. I did not change `package.json` or install Node.
- **Old BUZZ infrastructure state (runtime data, not source).** For the role tests the relay was restarted three times with environment variables only, and two test rows were added to `relay_members` plus eight test events (one kind:8000, seven kind:13534 roster snapshots). **All were deleted afterwards**: `relay_members` = 0 rows, `events` = 0 rows (it was empty before my tests), and the relay is back in its original open configuration. No OLD BUZZ source or `.env` file was edited.
- **Left in place on purpose:** the generated SWF identity in the Windows keyring (`identity_nsec.swf-buzz`) and its marker file, since a persisting identity is the feature. Delete it with `cmdkey /delete:identity_nsec.swf-buzz` and remove `%APPDATA%\com.swfbuzz.desktop\identity.keyring` to test a fresh first launch again.

## 10. Remaining Okta and legacy code (all untouched, by instruction)

`src-tauri/src/auth/{mod,oidc}.rs`, `commands/auth.rs`, `commands/secure_storage.rs` (Okta/bunker keys), Okta deep-link scheme in `tauri.conf.json`; frontend `OktaCallbackView.vue`, `authService.okta*.ts`, `oktaBrowserFlow.ts`, `authService.dev.ts`, `signingService.dev.ts`, `signingService.nip46.ts`, and the exported-but-unused `loginWithOkta`, `completeOktaBrowserLogin`, `completeBunkerPairing`, `attemptLegacyOktaSilentResume` in `useAuth.ts`; `services/ApiClient.ts`; the whole `backend/` crate and its migrations; the HTTP screens (`/community`, `/community-dm`, Home). The "Continue in Development Mode" button is still shown in dev builds. New `TODO(identity-migration)` comments mark the touch points. The Okta commands are still registered in the Tauri handler.

## 11. Known limitations and risks

- **A non-member has no next step yet.** The relay's refusal is now reported clearly, but there is no way to enter an invite until Phase 2.
- **HTTP screens are unauthenticated for local-identity users** (no backend session by design); the router sends local sessions to `/channels` instead of Home.
- **`VITE_SWF_BACKEND_URL` is still required in production builds** (`app/config.ts` throws without it; dev builds have a default). Not addressed in this phase.
- **`sign_event` will sign any kind for any webview code** (same as OLD BUZZ). Keep the CSP tight (currently permissive: `connect-src https: wss: ws:`) and consider a kind allowlist later.
- **No `zeroize`** on the in-memory `nsec` string; Windows file fallback is not permission-restricted.
- **The relay's AUTH verdict is read for the first connection.** A later revocation on an already-open connection is not re-checked here.
- **Dev tooling:** stopping a `tauri dev` task can leave the Vite server and app running; kill the process tree explicitly.

## 12. Remaining work for Phase 2

1. Onboarding: profile (kind:0), backup (NIP-49), import, recovery screens for `keyring-locked` / `lost` / `corrupt`.
2. NIP-98 with a `payload` tag (SWF's `nip98.ts` lacks it) and relay invite create/claim; the SWF-owned `swfbuzz://` deep link.
3. Decide D-1 (how communities and the first owner are created) — the relay only supports `RELAY_OWNER_PUBKEY` or operator provisioning.
4. Non-member entry point ("join with invite") and revisit sign-out semantics (D-5).
5. Retire the HTTP screens, then remove Okta, the backend crate and the legacy signers; drop `VITE_SWF_BACKEND_URL`.
6. Hardening: CSP, kind allowlist, `zeroize`, Windows file permissions, NIP-44 command if agent observer frames are in scope.

## 13. Final `git status --short`

Exact output at the end of this phase (nothing committed or pushed):

```
 M .claude/scheduled_tasks.lock
 M "swf buzz/package-lock.json"
 M "swf buzz/src-tauri/Cargo.lock"
 M "swf buzz/src-tauri/Cargo.toml"
 M "swf buzz/src-tauri/src/lib.rs"
 M "swf buzz/src/app/router/index.ts"
 M "swf buzz/src/features/auth/useAuth.ts"
 M "swf buzz/src/services/RelayConnectionService.ts"
 M "swf buzz/src/stores/session.ts"
 M "swf buzz/src/views/LoginView.vue"
 M "swf buzz/tests/unit/auth/useAuth.spec.ts"
 M "swf buzz/tests/unit/stores/session.spec.ts"
?? SWF_STARTUP_PROMPT.md
?? "swf buzz/docs/OLD_BUZZ_AUTH_AND_COMMUNITY_FLOW_AUDIT.md"
?? "swf buzz/docs/OLD_BUZZ_AUTH_AND_COMMUNITY_FLOW_AUDIT.pdf"
?? "swf buzz/docs/PHASE_1_OLD_BUZZ_IDENTITY_IMPLEMENTATION.md"
?? "swf buzz/docs/SWF_BUZZ_CURRENT_RUNTIME_AUDIT.md"
?? "swf buzz/docs/SWF_BUZZ_OLD_BUZZ_IDENTITY_MIGRATION_PLAN.md"
?? "swf buzz/docs/SWF_BUZZ_OLD_BUZZ_IDENTITY_MIGRATION_PLAN.pdf"
?? "swf buzz/src-tauri/src/identity/"
?? "swf buzz/src/features/signing/signingService.tauri.ts"
?? "swf buzz/tests/unit/services/RelayConnectionService.auth.spec.ts"
?? "swf buzz/tests/unit/signing/signingService.tauri.spec.ts"
```

Pre-existing before this phase and not from it: `.claude/scheduled_tasks.lock`, `package-lock.json` (npm flags), `SWF_STARTUP_PROMPT.md`, and the three earlier audit/plan documents.
