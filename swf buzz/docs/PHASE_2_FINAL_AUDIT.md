# Phase 2 — Final Audit (identity-first architecture)

> **Terminology update (Phase 2.1).** This document originally used "Super Admin". OLD BUZZ has no such role; the deployment-level role is **Operator** (see `SWF_ROLE_MODEL.md`). The wording, route (`/operator`) and view (`OperatorDashboardView`) below reflect the final naming.

## CURRENT STATUS

| Phase | Status |
|---|---|
| Phase 1 — local identity, secure storage, NIP-42, role resolution | **COMPLETE** |
| Phase 2 — onboarding, communities, invites, deep links, automatic routing | **COMPLETE, within one relay limitation** (§16, item L1) |
| Phase 3 — chat UI | **NOT STARTED** |

The one thing Phase 2 cannot do, because the OLD BUZZ relay does not support it and no fake frontend solution was built: **discover a person's memberships from their identity alone on a device that has never seen any of their communities.** Everything else in the brief is implemented and was verified live. Details, the exact reason, and the smallest relay change that would remove it are in §16.

Nothing was committed or pushed. OLD BUZZ (`buzz/buzz`) source and `.env` were not modified.

---

## 1. Current architecture

**SWF Buzz is identity-first.** The login screen deals only with the local Nostr identity. Which community (or dashboard, or picker) a person lands on is decided *after* sign-in from what the relay says about that identity.

```
Launch
  │
  ├─ no identity ─► LOGIN  [Create your identity] [Import existing identity]
  └─ identity ────► LOGIN  <short key> [Continue with existing identity] [Import existing identity]
                              │
                              ▼   (also runs silently at app start)
                   resolveAccess(pubkey)                         ← ONE central decision, useAuth.ts
                   ├─ ask the relay, NIP-98 signed:  "am I an operator?"
                   └─ ask each candidate community, NIP-98 signed:  "am I a member?"
                              │
        ┌─────────────────────┼──────────────────────┬───────────────────────┐
   operator              0 memberships          1 membership           2+ memberships
        │                     │                     │                       │
  OPERATOR             WELCOME               open it               COMMUNITY PICKER
 DASHBOARD          [Join with invite]     automatically           (names + roles, not URLs)
 [Create Community]                                                
                     nothing could be asked (relay down) → stay on LOGIN, clear error
```

**The login screen contains no community URL, no community dropdown, no "Create community", and does not ask the relay anything.**

## 2. Identity lifecycle

| Step | Where | Notes |
|---|---|---|
| Create | Rust `create_identity` | secp256k1 keypair generated in Rust; only `{pubkey, npub, storage, recovery}` returned to Vue |
| Import | Rust `import_identity` | `nsec1…`, 64-char hex, or `ncryptsec1…` + password |
| Replace ("Import another identity") | Rust `replace_identity` | old key **archived, never deleted**; refuses if it cannot be kept safe |
| Back up | Rust `create_ncryptsec_backup` | NIP-49; saved to a local file; never sent anywhere |
| Resume | `attemptSilentResume` | runs the same `resolveAccess` decision |
| Sign out | `logout` | drops session, relay connection, signer and the access cache; the key stays in the keyring |
| Recovery | keyring-locked / lost / corrupt | explained on the identity screen; nothing overwritten |

## 3. Key storage

OS keyring (Windows Credential Manager), service `swf-buzz`, entry `identity_nsec`; fallback file `identity.key` only when the keyring is unusable (flagged in the UI). A marker file distinguishes "first launch" from "keyring locked/wiped". The private key is never in Vue, Pinia, `localStorage`, logs or any request. A Rust egress guard refuses to sign any event whose content/tags contain this identity's secret or any `nsec1…`/`ncryptsec1…`-shaped value.

## 4. Authentication flow — NIP-42 (WebSocket)

Local signer (Rust) signs the relay's challenge (kind 22242). The relay decides membership/role from `relay_members`; a non-member is refused and a banned identity is distinguished. NIP-42 is what the app uses once a community is chosen.

## 5. NIP-98 flow (HTTP)

Every HTTP call the app makes to a relay is `Authorization: Nostr <base64 kind-27235 event>` signed by the local key (`u` = URL, `method`, `payload` = sha256(body) for POST, `nonce`). Used for: invite mint/claim, the operator probe / list / create, and the per-community membership probe (`POST /query`). The app never sends an `X-Pubkey` header (asserted in `communityDiscovery.spec.ts`).

## 6. Operator flow

"Operator" = a public key in the relay's `RELAY_OPERATOR_PUBKEYS`. The **relay** answers, per signed request: `GET /operator/communities/availability` → `200` operator / `403` not. Not a frontend flag, not localStorage, not a hostname.

After sign-in, an operator lands on **Operator Dashboard** (`/operator`), which re-asks the relay on arrival and sends anyone it refuses back to sign-in. It shows the communities they own (`GET /operator/communities?owner_pubkey=<me>`, an operator-only relay endpoint) merged with communities they are a member of, with **Open** on each, plus **Create Community** ("Create your first community" when there are none) and **Join with invite**. A non-operator calling the create API directly gets `403` (verified).

## 7. Community creation flow

Dashboard → Create Community: name (label) + address (suggested from the name, editable) + first owner (default: me). `POST /operator/communities {host, initial_owner_pubkey, create_only:true}`. The relay creates the tenant and an **owner row**; the dialog shows the owner and an **Invite members** button.

## 8. Owner flow

The owner is a real `relay_members` row (role `owner`). They enter their community by signing in with their own key; they can manage members (kind 9030/9031/9032), create invites, and open the community from the dashboard. Naming an owner by public key authenticates nobody.

## 9. Member flow

A member's app asks each candidate community (§14) whether they are a member; 1 → auto-open, several → picker. Removal by an owner takes effect on the next launch (memberships are re-asked, never remembered as authority).

## 10. Invite / add-by-public-key — what OLD BUZZ actually supports

Inspected in `buzz/buzz/crates/buzz-relay` (read-only):

| Question | Finding |
|---|---|
| Are invites bound to a public key? | **No.** `POST /api/invites` accepts only `ttl_secs` and `max_uses`. An invite is a bearer token. `max_uses=1` limits it to one person but does not choose *which* person. A pubkey-targeted invite would need a relay change → **not implemented, not faked.** |
| Can an owner add a member directly by public key? | **Yes** — NIP-43 kind **9030** (`RELAY_ADMIN_ADD_MEMBER`), signed by an owner/admin, `p` tag = the person's key, optional `role` (`member`; `admin` only by an owner). Idempotent. The SWF app already had this in `RelayMembersService`. |

So the requested UX is delivered with existing relay mechanisms:

1. Person copies their **public key** (My identity → *Copy Public Key*) and sends it to the owner.
2. Owner opens **Community → Add member**, pastes the `npub1…` or hex key → the app publishes kind 9030 (a **real relay membership**, recorded with the owner as `added_by`).
3. The app then shows a link `swfbuzz://connect?relay=…&name=…` to send to the person. It carries **only the community address and a label** — no secret, no code.
4. Person opens the link → their app loads their local identity → NIP-42 → the relay recognises them → the community opens.

For people whose key the owner does not know, the token flow remains: `swfbuzz://join/<token>?relay=…&name=…&by=…` (mint with expiry / max uses; claim over NIP-98; role `member`).

## 11. Invite claim flow

Link or paste → **invite preview** (name, server, inviter — the name/inviter come from the link and are labelled *not verified*; the server address is the verified part) → identity step if needed (Create / Import, or "Identity found" + Import another) → *Join Community* → NIP-98 claim → membership `member` → the community opens. Invalid / expired / exhausted / already-member / malformed link each have a clear message; a newer link clears the previous attempt's messages.

## 12. `swfbuzz://` deep-link flow

Rust (`deeplink.rs`) parses and validates; the UI confirms before anything is signed. Formats: `swfbuzz://join/<code>?relay=…[&name=…][&by=…]` (generated), `swfbuzz://join?relay=…&code=…` (accepted), `swfbuzz://connect?relay=…[&name=…]`. Cold start: launch argument queued until the webview drains it. Warm start: the single-instance plugin forwards the URL and Rust emits `swf-deep-link`. Only `swfbuzz://` is registered (plus the legacy Okta scheme); `buzz://` belongs to the installed OLD Buzz and is not touched.

## 13. Automatic community routing

`resolveAccess` (single source of truth; used by Continue, silent resume and post-create). Its inputs are the relay's answers, kept only in the in-memory `access` store:

| Relay says | Destination |
|---|---|
| operator | `/operator` |
| member of exactly 1 | opened automatically |
| member of 2+ | `/communities` (picker) |
| member of 0 | `/welcome` (Join with invite) |
| nothing could be asked | stay on `/login` with "Can't reach your community server right now…" |
| an invite/connect link is waiting | `/join` first |

A partly-unreachable answer is not an outage: reachable memberships are used.

## 14. Where community addresses come from (no URL is ever typed)

The relay picks a community from the request `Host` and deliberately answers an unknown host with a generic 404 so callers cannot enumerate communities. So membership can only be asked of a community whose address is already known. The app's candidate list is:

1. the deployment's home relay (`config.relayUrl`, build configuration — never shown or chosen by the user);
2. communities this device already joined or created (the address arrived in an invite/connect link or from creating it, and is remembered — an **address book**, `swf_relay_communities.v1`, addresses and labels only).

The address book grants nothing and is not a membership database: every entry is re-verified by the relay on every launch (`POST /query`, NIP-98, `403` for a non-member). This is the smallest compatible implementation; see §16 L1 for what it cannot do.

## 15. Role model

`relay_members.role` ∈ `owner | admin | member`, decided only by the relay. Owner: created with the community (operator API) or transferred. Admin: promoted by an owner. Member: added by kind 9030, or by claiming an invite (always `member` — DB constraint). Operator: a deployment-level allowlist that spans tenants; separate from roles.

## 16. Known limitations (ranked)

**L1 — BLOCKER for full "identity-only" discovery (relay cannot support it).** There is no relay endpoint that lists the communities a public key belongs to. The only cross-tenant listing (`GET /operator/communities?owner_pubkey=`) is operator-only and returns *owned* communities. Consequence, **reproduced live**: an identity that is a member of 4 communities, imported on a brand-new device, finds **0** until it opens one link per community (a connect or invite link, which carries the address). On the same device, once addresses are known, everything is automatic. *Smallest relay change to remove it:* an identity-scoped directory endpoint (e.g. NIP-98-signed `GET /api/my-communities` on the deployment root that returns hosts of communities where the signer is a member) — which would also need a decision about the enumeration privacy the relay currently enforces. Not done: it is outside the frontend and would be a fake if simulated client-side.

**L2 — the relay's dev mode accepts a bare public key on the REST bridge.** With `BUZZ_REQUIRE_AUTH_TOKEN=false` (the local default; the relay logs a warning at startup), `POST /query`, `/events` etc. honour an `X-Pubkey` header as the caller (`bridge.rs: verify_bridge_auth`). Observed live: `POST /query` with only `X-Pubkey` → `200`. The invite and operator endpoints and the WebSocket still refused it (`401`). The app never sends that header, but a production relay **must** set `BUZZ_REQUIRE_AUTH_TOKEN=true` (source: the header path is skipped and the request falls through to `401 missing Nostr auth`). This was not re-verified live because the local relay's launch environment was not recorded; it is a documented deployment requirement, not a verified result.

**L3 — pubkey-targeted invites are not supported by the relay** (§10); the supported equivalent is add-by-public-key (kind 9030) + connect link.

**L4 — community names/descriptions.** The relay stores host and icon only. The name is a label kept on devices that created or joined the community and carried in links; it is unverified. A description is not implemented.

**L5 — an owner added by public key must be told the address** (the connect link). The relay cannot notify them.

**L6 — profile prompt** appears on the sign-in path, not after a silent resume, and a non-member cannot publish a profile until joined.

**L7 — `join_policy_required`** invites are not supported (error shown). **L8 —** the relay's own `/invite/<code>` page hard-codes `buzz://`; SWF never uses it. **L9 —** typed secrets (import/backup password) pass through the webview for one `invoke` and are cleared immediately. **L10 —** on an *open* relay (no membership requirement) every identity passes the membership probe, so the home relay counts as a membership for everyone.

## 17. Security boundaries

| Boundary | Rule |
|---|---|
| Frontend ↔ Rust | Vue never holds a private key. Only `get_identity`, `create_identity`, `import_identity`, `replace_identity`, `create_ncryptsec_backup`, `save_ncryptsec_backup`, `verify_ncryptsec_backup`, `sign_event`, `take_pending_deep_links`. No command returns a secret. |
| Frontend ↔ Relay | Only signed requests (NIP-42 / NIP-98). No pubkey header, no pubkey query parameter as an identity claim. |
| Public key | An identifier: shown, copyable, shareable, enterable by an owner to add someone. It never authenticates. |
| Links | Intent only. Nothing is signed until a button is pressed. Name/inviter hints are unverified and labelled so. |
| Static enforcement | `identitySecurity.spec.ts`: no key generation/signing in non-legacy frontend code; no browser storage in identity code; no secret-shaped Pinia fields; only import/replace/backup carry user secrets; no sign-in action takes a public key. |
| Debug-only | `SWF_BUZZ_PRIVATE_KEY` and `SWF_BUZZ_PROFILE` are ignored in release builds. |

## 18. Files changed

**This round — Rust:** `src-tauri/src/deeplink.rs` (`connect` carries an optional name hint).
**This round — Frontend, new:** `features/access/communityDiscovery.ts`, `stores/access.ts`, `views/OperatorDashboardView.vue`, `views/CommunityPickerView.vue`.
**This round — Frontend, changed:** `features/auth/useAuth.ts` (central `resolveAccess`, `openRelay`, new `switchCommunity`, resume, logout), `app/router/index.ts` (`/operator`, `/communities`, guard destination), `views/LoginView.vue` (community line/dropdown removed), `views/WelcomeView.vue` (join only), `views/JoinCommunityView.vue` (connect name), `features/onboarding/ui/JoinInvitePanel.vue`, `features/communities/{OperatorService,RelayInviteService}.ts` (`listOwnedCommunities`, connect-link name), `features/deeplink/pendingLink.ts`, `layouts/AppSidebar.vue` (Switch community / Operator Dashboard), `features/identity/ui/IdentityModal.vue` (*Copy Public Key*), `features/community-members/ui/CommunityMembersPanel.vue` (add by npub/hex + connect link).
**Tests, new/rewritten:** `tests/unit/access/communityDiscovery.spec.ts`, `tests/unit/onboarding/{operatorDashboardAndPicker,addMemberByPublicKey,welcomeView}.spec.ts`; updated `useAuth`, `loginView`, `communityFlows` specs.
**Earlier Phase 2 files** (identity module, NIP-49 backup, egress guard, deep links, operator/invite services, profile, onboarding UI) are described in `PHASE_2_ONBOARDING_COMMUNITY_INVITE_IMPLEMENTATION.md` (its "login screen → Welcome" flow is superseded by this document).

**Git (nothing committed):** 23 modified tracked files (+1915 / −184) and 40 untracked paths. Incidental, not feature work: `package-lock.json` (`"dev": true` flags) and `.claude/scheduled_tasks.lock`. Pre-existing untracked: `SWF_STARTUP_PROMPT.md`.

## 19. Existing features completed (Phase 1 + 2)

Local identity (create/import/replace/backup/recovery), NIP-42, NIP-98, NIP-49 backup in Rust, profile kind:0, operator detection, Operator dashboard, community creation with a real owner, owner add-by-public-key, invite mint/claim, `swfbuzz://` cold/warm deep links, invite preview, automatic routing (0 / 1 / many / operator / unreachable), community picker, public-key copy.

## 20. Tests executed

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings 0`) | pass |
| `npm run build` | pass |
| Vitest, full run | **54 files, 517 tests, all pass** |
| `cargo check` | pass |
| `cargo clippy --all-targets -- -D warnings` | pass |
| `cargo test --lib` | **57 passed** |
| `rustfmt --check` (identity/*, deeplink.rs, lib.rs) | clean |

**Node environment (reported; repository not modified).** This machine has Node 20.19.4; the repo's jsdom 30 needs Node ≥ 22.22, so Vitest does not start unmodified. It was run through a shim kept outside the repo (`NODE_OPTIONS="--require …/node20-jsdom-shim.cjs"`). No shim is needed on Node ≥ 22.22.

## 21. Live test results (real app on Windows, real relay in closed-membership mode)

Each identity ran as an isolated debug profile (`SWF_BUZZ_PROFILE`, own keyring entry, data folder and WebView2 storage) so the real credential was never touched.

| # | Scenario | Result |
|---|---|---|
| 1 | **Operator**: import operator key → Continue → routed to **Operator Dashboard**; lists owned communities (relay list) with Open + Create Community; resume at app start also lands on the dashboard | pass |
| 2 | **New user**: login shows no community text; Create identity → NIP-42 finds no membership → **Welcome**, only "Join with invite", no Create button | pass |
| 3 | **Owner adds by public key**: in the UI, owner pastes the new user's `npub1…` → relay `relay_members` row `member`, `added_by` = owner, no invite token; connect link produced | pass |
| 4 | **Existing member / connect link**: cold start from the link → "Open the community SWF Developers" → opens | pass |
| 5 | **One community → automatic routing**: relaunch, no clicks, no typing → lands in the community | pass |
| 6 | **Multiple communities → picker**: two remembered communities → "Acme Five · member / SWF Developers · member" (names, no URLs, nothing auto-opened); choosing one opens it | pass |
| 7 | **Token invite claim**: fresh identity, cold-start link → preview (Acme Six, unverified label) → Create identity → Join Community → member via invite → opens | pass |
| 8 | **Invalid invite** → "This invite isn't valid."; **expired** → "This invite has expired." | pass |
| 9 | **Non-member**: refused by the relay's `403` on the probe; user lands on Welcome | pass |
| 10 | **Public-key-only authentication**: invite endpoint with `X-Pubkey` only → `401`; unauthenticated WebSocket read → `auth-required`; operator create by a non-operator → `403` | pass |
| 10b | …but `POST /query` with `X-Pubkey` only → **`200`** on this dev-mode relay | **finding, see L2** |
| 11 | New-device discovery: identity that belongs to 4 communities, empty address book → finds 0 | **limitation, see L1** |
| — | Relay unreachable → stay on login with a clear error | unit-tested only (not live: the relay was not stopped) |
| — | Warm-start link occasionally did not navigate on the very first attempt after a profile relaunch; not reproducible on retry (worked in ~2 s) | unexplained, noted |

**Interference note.** The app window was being used by the developer during testing; two "unexpected landings" (a dashboard "Open" clicked, an early sign-out) were traced to real input via input-idle measurement and are not app behaviour. Test keyring entries and profile folders were deleted afterwards; the real `identity_nsec` entry and app data are untouched.

## 22. Remaining technical debt

Okta/legacy code still present (see §23). No UI to switch to an archived identity. Community name/description live only on devices and in links. `resolveIdentityAndRole` (legacy) and the new `resolveAccess` coexist until the legacy paths are removed. A relay "my communities" endpoint (L1) would let the address book shrink to a cache.

## 23. Remaining Okta / legacy code

Kept intentionally and untouched: Okta Rust commands, `oktaAuthService*`, `loginWithOkta`, `completeBunkerPairing`, `OktaCallbackView`, the NIP-46 signer, the dev shared-key signer, the backend crate, the HTTP-backend screens and `useAuth` legacy entry points. Nothing in the local-identity flow calls them (asserted by the Tauri mock rejecting unknown commands).

## 24. Phase 3 prerequisites

None blocking. Recommended before/alongside: (a) decide on the relay "my communities" endpoint (L1); (b) set `BUZZ_REQUIRE_AUTH_TOKEN=true` in any non-dev relay (L2); (c) Phase 3 (chat) starts from `/channels` inside an opened community, which this phase produces for members, owners and admins.
