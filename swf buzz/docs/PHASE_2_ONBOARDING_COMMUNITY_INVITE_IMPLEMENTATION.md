# Phase 2 — Onboarding, Community Model D-1, Invites and `swfbuzz://` Deep Links

> **Superseded in part by `PHASE_2_FINAL_AUDIT.md`.** The final architecture is identity-first: the login screen shows no community, and where a person lands (Operator dashboard, automatic open, community picker, or Welcome) is decided after sign-in by `resolveAccess`. Read that document for the current routing, the add-by-public-key flow, and the known relay limitations. Sections below that describe "Welcome shows Create your first community" are out of date.

**Status: COMPLETE.** Nothing was committed or pushed. OLD BUZZ (`buzz/buzz`) source and `.env` were not modified.

This document replaces the first Phase 2 report. That version put "Create community" on the login screen and used a `?code=` link; this one is the corrected, final architecture (login = identity only; community actions after sign-in; `swfbuzz://join/<token>` invite preview).

Builds on Phase 1 (`PHASE_1_OLD_BUZZ_IDENTITY_IMPLEMENTATION.md`). Okta, the Okta Rust commands, the legacy auth services, the backend crate, the old screens and the old signers are all still in the tree; only the login screen no longer offers them.

---

## 1. Final human-identity model

- Every human has their **own local Nostr identity**. The **public key is an identifier**; the **private key is proof of ownership** and never leaves the device.
- A public key alone **never authenticates** anyone. NIP-42 (the relay's challenge, answered by a signature from the private key in Rust) is the only proof.
- No Okta, no OAuth, no browser login, no Application User login anywhere in this flow.

## 2. Screens and who sees what

```
Launch
 ├─ no identity ──► LOGIN: "Welcome to SWF Buzz · No identity found on this device."
 │                    [Create your identity]  [Import existing identity]
 ├─ identity ─────► LOGIN: "An identity was found on this device." <short key>
 │                    [Continue with existing identity]  [Import existing identity]
 │                                   │  NIP-42 to the community
 │                    member ────────┴──► app (channels)   (profile prompt on first sign-in)
 │                    not a member ─────► WELCOME (below)
 └─ swfbuzz:// link ► JOIN (invite preview), before or after an identity exists

WELCOME  "You don't have any communities yet."
   everyone:           [Join with invite]
   relay operator only: [Create your first community]  [Join with invite]
```

The **login screen has no "Create community"**, no invite box and no field for a public key. It does not even ask the relay whether you are an operator. Development Mode is shown only in development builds, clearly separated ("Development only").

### Who decides "operator"
The **relay**, not the app. After sign-in the Welcome screen sends a NIP-98-signed `GET /operator/communities/availability` with the local key: `200` means operator, `403` means not. A refusal, an unreachable relay or a failure just hides the button. The create request itself is signed and re-checked by the relay, so calling the API directly as a non-operator also fails (`403 actor not authorized: not a relay operator`, verified live).

## 3. Implemented flows

**Create identity.** Rust generates the secp256k1 key and stores it in the OS keyring (service `swf-buzz`); Vue only receives `{pubkey, npub, storage, recovery}`. Then an optional NIP-49 backup step, then NIP-42 sign-in.

**Import identity** (first launch): `nsec1…`, 64-char hex, or `ncryptsec1…` + password. Decoding/decryption is in Rust.

**Import another identity** (an identity already exists — login screen and invite screen): a spelled-out warning plus an explicit tick, then `replace_identity`. Rust **archives the old private key first and refuses to continue if it can't**: as keyring entry `identity_previous_<pubkey8>` (or by renaming `identity.key` to `identity.previous-<pubkey8>.key`). It never deletes a key. The session, relay connection and signer of the old identity are torn down first. There is no UI yet to switch back to an archived identity — restoring one means importing its backup.

**Recovery states** (`keyring-locked`, `identity_lost`, `identity_corrupt`): explained on the identity screen; nothing is overwritten (corrupt files are moved aside, never deleted).

**Profile (kind:0).** Offered after the first sign-in as a member, skippable per identity, never blocks joining.

**Create community (operator, after sign-in).** Community name + address (the address follows the name, e.g. `swf-developers.localhost:3000`, until edited) + first owner (defaults to your own public key). The relay creates the tenant and the owner row. The dialog then shows *Owner: your identity `0d360395…`*, an **Invite members** button (mints an invite for the new community immediately — the owner does not need to be signed in to it yet) and **Open this community**. If the owner is someone else, a `swfbuzz://connect` link is produced for them; nothing signs anyone in as them.

**Owner.** The owner opens the community with their own key; the relay's NIP-42 handshake plus `relay_members(role=owner)` decides. Typing an owner's public key anywhere authenticates nobody.

**Create invite (owner/admin).** NIP-98 `POST /api/invites` signed by the local key, with expiry (1 h – 30 d) and optional max uses. Result: `swfbuzz://join/<token>?relay=<ws url>&name=<label>&by=<inviter pubkey>`. Shared out of band; no email.

**Invite claim.** Link (cold or warm start) or pasted link/code → **invite preview** → identity step if needed → *Join Community* → NIP-98 claim → membership role `member` → NIP-42 sign-in → community opens.

```
You've been invited to join:
SWF Developers
Server: swf-developers.localhost:3000 · the name comes from the link and isn't verified
Invited by npub1p5mq8…eccf47 (from the link, not verified)
[Create your identity] [Import existing identity]      (no identity)
Identity found: 391fd1e6…6e20b6d1   [Join Community] [Import existing identity] [Not now]
```

Handled: invalid, expired, exhausted, already member (idempotent — proceeds into the community), successful join, malformed link (`http://` relay, missing code, unknown action → clear message, no action offered), and rate limiting. A newer link clears the previous attempt's messages.

**Non-member.** Signing in to a community that doesn't recognise the identity ends on WELCOME ("*localhost:3000 doesn't recognise this identity as a member. Join with an invite to get in.*"), not a login dead end. A banned identity gets the error text only.

## 4. What the invite preview can and cannot promise

The relay has **no preview endpoint** (only `POST /api/invites` and `POST /api/invites/claim`) and its `communities` table has only `host` and `icon` — no name, no description. Adding either would need a backend change, which is out of scope. Therefore:

- The **server address is the only fact** the relay stands behind, and it is always shown.
- The **community name** and **inviter** in the preview come from the link's `name` and `by` parameters. They are written by whoever made the link and are **not verified**; the screen says so. A malformed hint is dropped, never trusted.
- **Community description is not implemented** (nowhere to store it).
- The community *name* is a display label kept on the devices that created or joined it (`swf_relay_communities.v1` in localStorage — a list of relay addresses and labels only). It is not a community database and grants no access.

## 5. Architecture and protocol

```
Vue (never holds a private key)               Rust (src-tauri)                 Relay (unchanged)
LoginView / WelcomeView / JoinCommunityView   identity::{storage,backup,       tenant by Host
CreateCommunityDialog / CreateRelayInvitePanel  signing,commands,state}        relay_members roles
useAuth · RelayInviteService · OperatorService deeplink.rs (parse + queue)      /api/invites[/claim]
TauriSigningService ── invoke sign_event ───► signs with the keyring key ────►  /operator/communities
deepLinks.ts ◄── event swf-deep-link ─────── take_pending_deep_links           NIP-42 AUTH / NIP-98
```

| Purpose | Transport | Auth |
|---|---|---|
| Sign in | WebSocket, NIP-42 (kind 22242) | local signer |
| Profile | kind 0 over WebSocket | local signer |
| Operator probe | `GET /operator/communities/availability` | NIP-98 |
| Create community | `POST /operator/communities` `{host, initial_owner_pubkey, create_only:true}` | NIP-98 (operator) |
| Create invite | `POST /api/invites` `{ttl_secs, max_uses}` | NIP-98, body-bound `payload` |
| Claim invite | `POST /api/invites/claim` `{code}` | NIP-98 by the joiner |
| Backup | none — `ncryptsec` is saved locally (Downloads) | — |

Link formats parsed by Rust (`deeplink.rs`): `swfbuzz://join/<code>?relay=…[&name=…][&by=…]` (generated form), `swfbuzz://join?relay=…&code=…` (also accepted), `swfbuzz://connect?relay=…`. The relay address must be in the link — the relay picks the community from its host, so a code alone cannot be claimed. Only `swfbuzz://` is registered (plus the legacy Okta scheme); **`buzz://` is not**, it belongs to the installed OLD Buzz. A link is intent only: nothing is signed until the user presses a button.

The private key and the `ncryptsec` are never sent to the relay.

## 6. Security

- Private key: OS keyring (fallback file when the keyring is unusable, flagged in the UI). Never in Vue, Pinia, localStorage, logs or any request.
- `tests/unit/security/identitySecurity.spec.ts` enforces: no key generation/signing/NIP-49 in non-legacy frontend files; no browser storage in identity code; no secret-shaped Pinia fields; the only `invoke` calls carrying user secrets are import/replace/backup; no frontend reference to the keyring entry; no sign-in action takes a public key.
- Egress guard in Rust: `sign_event` refuses any event containing this identity's secret or `nsec1…`/`ncryptsec1…`-shaped values.
- The one unavoidable exception: what a user *types* into the import form (nsec / hex / backup password) passes through the webview for a single `invoke` and is cleared immediately.
- Debug-only switches (`SWF_BUZZ_PRIVATE_KEY`, `SWF_BUZZ_PROFILE`) are compiled out of behaviour in release builds. `SWF_BUZZ_PROFILE=<name>` gives a run its own keyring entry and data folder so several identities can be tested on one machine without touching the real one.

## 7. Files changed (this correction)

**Rust:** `src/identity/{mod,storage,commands}.rs` (profile isolation, `replace_identity` with archive-first, `KeyStore::archive`), `src/deeplink.rs` (`name`/`by` hints), `src/lib.rs` (registers `replace_identity`).
**Frontend:** new `views/WelcomeView.vue`, `features/identity/format.ts`, `features/onboarding/ui/ImportAnotherIdentity.vue`; rewritten `views/LoginView.vue` (identity only), `views/JoinCommunityView.vue` (invite preview), `features/onboarding/ui/IdentitySetup.vue` (Create / Import buttons); changed `features/communities/ui/{CreateCommunityDialog,CreateRelayInvitePanel}.vue`, `features/communities/RelayInviteService.ts` (path-form link + hints), `features/deeplink/pendingLink.ts`, `features/identity/identityApi.ts` (`replaceIdentity`), `features/auth/useAuth.ts` (route to `welcome` on "not a member", `replaceIdentityLocal`), `app/router/index.ts` (`/welcome`, guard).
**Tests:** new `tests/unit/onboarding/welcomeView.spec.ts`; updated `loginView`, `communityFlows`, `onboardingUi`, `useAuth`, `RelayInviteService` specs.
Earlier Phase 2 files (operator service, invites, deep links, profile, NIP-49 backup, egress guard) are unchanged in design; see git status below.

## 8. Tests

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings 0`) | pass |
| `npm run build` | pass |
| Vitest, full run | **51 files, 477 tests, all pass** |
| `cargo check` | pass |
| `cargo clippy --all-targets -- -D warnings` | pass |
| `cargo test --lib` | **57 passed** |
| `rustfmt --check` (identity/*, deeplink.rs, lib.rs) | clean |

**Node environment (reported, repository not modified).** This machine has Node 20.19.4; the repo's jsdom 30 needs Node ≥ 22.22, so `vitest` does not start unmodified. The suite was run through a shim kept outside the repo (`NODE_OPTIONS="--require …/node20-jsdom-shim.cjs"`). On Node ≥ 22.22 no shim is needed.

**Live tests on Windows, real relay (closed-membership mode), real app.** Each identity ran as an isolated profile (`SWF_BUZZ_PROFILE`) so the real credential was never touched.

| Scenario | Result |
|---|---|
| First launch, no identity: "Welcome to SWF Buzz / No identity found", Create + Import only, no Create community | pass |
| Create identity → backup step → NIP-42 → not a member → **Welcome**, only "Join with invite" | pass |
| Import a hex key through the UI as an operator → Welcome shows **Create your first community** | pass |
| Create community "SWF Developers": address suggested, owner defaults to me, relay creates tenant + **owner row** | pass |
| Invite members from the same dialog → `swfbuzz://join/<token>?relay=…&name=…&by=…` | pass |
| Owner opens the community over NIP-42 (Connected); profile step publishes kind:0 | pass |
| **Cold start** from the link, no identity → invite preview → Create identity → Join Community → member added via invite → community opens | pass |
| **Warm start** from a link, existing identity → preview "Identity found" → Join → member | pass |
| Import another identity from the invite screen → old key archived in keyring → claim signed by the new identity | pass |
| Expired / invalid invite → clear message; `http://` relay link → "must start with ws://" | pass |
| Login screen with an existing identity: Continue + Import existing identity, no Create community | pass |
| Relaunch → existing identity resumes into the app | pass |
| Import an `ncryptsec1…` backup + password through the UI (real backup of the developer's identity) → restores `0f61e5e4…`, no secret exposed | pass |
| Non-operator calls `POST /operator/communities` directly → `403` | pass |
| Exhausted invite | pass at protocol level (`403 invite_exhausted`); covered in the UI by unit tests |
| Public-key-only sign-in | not possible: no field exists; relay refuses unauthenticated / `X-Pubkey`-only requests (verified in the earlier Phase 2 run) |

Test keyring entries and profile folders created for these runs were deleted; the real `identity_nsec` entry and app data are untouched.

## 9. Phase 2 completion checklist

- [x] First launch with no identity
- [x] Create identity
- [x] Existing identity resume
- [x] Import identity (hex live; `ncryptsec` + password live; `nsec` unit/Rust-tested)
- [x] Profile setup
- [x] Identity backup (NIP-49 in Rust)
- [x] Operator detection (relay-decided)
- [x] Operator can create a community **after** authentication
- [x] Normal users cannot create a community (no button; relay `403` if forced)
- [x] Community has a real owner (relay `relay_members` row, verified in the DB)
- [x] Owner/admin can create invite
- [x] `swfbuzz://join/<token>` link generated
- [x] Cold-start deep link
- [x] Warm-start deep link
- [x] User without identity can create/import an identity from the invite
- [x] Existing identity can accept an invite (and swap identity first)
- [x] NIP-42 authentication
- [x] NIP-98 invite claim
- [x] Membership created (role `member`, inviter recorded)
- [x] Correct role resolved
- [x] Successful join opens the correct community
- [x] Invalid / expired / exhausted / already-member handling
- [x] No public-key-only authentication
- [x] No private key in Vue/webview
- [x] No Okta / browser login in this flow

## 10. Known limitations (none block Phase 3)

1. **Community description is not implemented** and the community **name is only a label**: the relay stores host and icon only. A shared, verified name/description needs a relay change.
2. **Invite preview name/inviter are unverified** (they come from the link); the server address is the verified part.
3. **Invited members are always `member`** (relay DB constraint). An owner is named at community creation; an admin is promoted afterwards. To make "Rahul" an owner, the operator creates the community (or a future one) with Rahul's public key as first owner.
4. **Closed-mode relay needs deployment settings**: `RELAY_OWNER_PUBKEY`, and for operator creation `RELAY_OPERATOR_PUBKEYS` and `RELAY_OPERATOR_API_ORIGIN` (the origin the NIP-98 `u` tag must equal). The operator origin the app uses is `config.relayUrl` (or `VITE_OPERATOR_API_ORIGIN`).
5. **Profile prompt appears on the sign-in path**, not after a silent resume (skip is remembered per identity). A non-member cannot publish a profile until joined.
6. **No UI to switch back to an archived identity**; its key is kept in the OS keyring (`identity_previous_<pubkey8>`) and recoverable by importing its backup.
7. **`join_policy_required`** invites are not supported (the error is shown).
8. The relay's own `/invite/<code>` page hard-codes `buzz://`; SWF never uses it — share the app-generated `swfbuzz://` link.
9. Import of a typed secret necessarily passes through the webview for one call (see §6). There is no passphrase generator (min 12 characters, user-chosen).
10. Local relay database still holds test communities (`acme`, `acme3`–`acme6`, `swf-developers`) and their members; nothing was deleted.
11. The relay is currently running in closed mode with owner/operator settings added for testing.

## 11. Git state (nothing committed)

```
Modified (tracked): 22 files, +1570 / −180
  swf buzz/src-tauri/{Cargo.toml, Cargo.lock, tauri.conf.json, src/lib.rs}
  swf buzz/src/{App.vue, app/router/index.ts, features/auth/useAuth.ts,
    features/community-members/ui/CommunityManagementModal.vue,
    features/moderation/ModerationService.ts, layouts/AppSidebar.vue,
    protocol/profile.ts, services/{ProfileService,RelayConnectionService,nip98}.ts,
    stores/{connection,session}.ts, types/domain.ts, views/LoginView.vue}
  swf buzz/tests/unit/{auth/useAuth.spec.ts, stores/session.spec.ts}
Incidental (not feature work):
  swf buzz/package-lock.json   — "dev": true flags from the earlier npm install
  .claude/scheduled_tasks.lock — Claude Code session lock
Untracked (new): src-tauri/src/{deeplink.rs, identity/}; src/features/{communities (operator, invite,
  relayCommunities, useJoinInvite, ui/CreateCommunityDialog, ui/CreateRelayInvitePanel), deeplink/,
  identity/, onboarding/, signing/signingService.tauri.ts}; src/views/{JoinCommunityView,
  ProfileSetupView, WelcomeView}.vue; tests (communities, deeplink, identity, onboarding, security,
  signing, helpers, nip98, profile); docs/ (audits, migration plan, Phase 1 + Phase 2 reports)
Pre-existing untracked: SWF_STARTUP_PROMPT.md
```

## 12. Phase 3 readiness

Nothing in Phase 2 blocks Phase 3 (chat UI, channels, messaging). Chat work should start from the signed-in, community-open state (`/channels`) that this phase produces.
