# New SWF Buzz — Gap Analysis vs. Old Buzz

Compares old Buzz's actual behavior (`docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md`) against SWF Buzz's **current** code, read fresh this session (`src/features/**`, `src/protocol/**`, `src/views/**`, `src-tauri/src/**`) — not from memory, and not from the earlier `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §11 gap table alone, which is now **partially stale**: it predates a later session that built real `community-members`, `moderation`, and `platform-admin` features. Every verdict below was re-checked against the file tree as it exists right now.

**Labels**: `IMPLEMENTED` (matches old Buzz behavior, working) · `PARTIALLY IMPLEMENTED` (real code exists but is incomplete, unwired, or narrower than old Buzz) · `MISSING` (no code at all) · `BROKEN` (code exists but cannot work as built — a real bug, not just an incomplete feature) · `DIFFERENT BEHAVIOR` (a deliberate, documented divergence from old Buzz, not a bug) · `N/A` (old Buzz itself doesn't have this either — not a gap).

---

## Summary table

| Area | Status | Notes |
|---|---|---|
| Authentication (Okta OIDC + PKCE) | **IMPLEMENTED** | Verified end-to-end this session against the real trial tenant — see below |
| Nostr/NIP-46 Bunker connection | **PARTIALLY IMPLEMENTED** | Code correct (verified against library source, timeout bug fixed this session); no live external bunker successfully paired yet |
| User identity (Okta ↔ Nostr linkage) | **PARTIALLY IMPLEMENTED** | `users.okta_user_id` column exists in the shared schema; nothing in SWF Buzz code writes to it yet |
| Communities (creation) | **N/A** | Old Buzz has no create-community UI either (§B of the audit) — not a gap |
| Communities (connect to existing relay) | **MISSING** | Old Buzz's `EditCommunityDialog` equivalent doesn't exist in SWF Buzz — see below |
| Community roles (owner/admin/member) | **IMPLEMENTED** | Real server-side enforcement via `relay_members`, consumed correctly |
| Channels (messaging) | **IMPLEMENTED** | Working, protocol-verified |
| Channel creation | **PARTIALLY IMPLEMENTED** | `ChannelService.createChannel` exists, zero UI call sites — dead code, unchanged from the prior audit |
| Channel membership (add/remove) | **MISSING** | No UI, no protocol builder for kind:9000/9001 |
| Invitations | **BROKEN** | Built against a Nostr event kind (9009) the real relay explicitly does not implement — see below, this is the most important finding in this document |
| Direct messages | **IMPLEMENTED** | Protocol-verified match with old Buzz's real `KIND_DM_OPEN` handler |
| Conversations UI (DM inbox) | **DIFFERENT BEHAVIOR** | SWF Buzz has one DM surface (sidebar); old Buzz has two (sidebar + separate Home/Inbox) — not necessarily wrong, a scope decision |
| Community member management | **IMPLEMENTED** (code-complete, partially live-verified) | `community-members/` feature exists and was E2E-tested against a real relay for both admin/owner tiers |
| Moderation | **IMPLEMENTED** (code-complete, not fully live-verified) | `moderation/` feature exists; reports/queue/actions built, per `docs/KNOWN_LIMITATIONS.md` not independently click-tested against seeded data |
| Platform admin console | **PARTIALLY IMPLEMENTED** | `platform-admin/` feature exists; blocked from live verification because this local relay has no `BUZZ_ADMIN_HOST` configured (environment gap, not code) |
| Realtime | **IMPLEMENTED** | `RelayConnectionService`, integration-tested against a real socket |
| Notifications | **MISSING** | No push/toast notification system found in either app for new messages while unfocused |
| Sidebar | **PARTIALLY IMPLEMENTED** | Channels + DMs list exists; no community-switcher rail (old Buzz's `CommunityRail`) since SWF Buzz is single-relay-per-build |
| Onboarding (second-user / friend invite) | **BROKEN** (downstream of the invitations bug above) | Cannot complete without fixing invitations first |

---

## Detail, area by area

### Authentication — Okta OIDC + PKCE — IMPLEMENTED

Verified this session, live, against the real `trial-7050986.okta.com` tenant: authorize request (client_id, redirect_uri `com.okta.trial-7050986:/callback`, S256 PKCE, state, nonce) → deep-link callback → state validation → token exchange (200 OK) → JWKS-verified ID token (signature, iss, aud, exp, nonce all checked) → `prakhar.mittal@lmdconsulting.com` resolved. Files: `src-tauri/src/auth/oidc.rs`, `src-tauri/src/commands/auth.rs`. One real bug found and fixed this session (see `docs/OKTA_PKCE_SETUP.md`'s history): `start_okta_login`/`okta_logout` were synchronous Tauri commands blocking the app's main/event-loop thread for the whole up-to-5-minute wait, which froze the UI and caused a real deep-link callback to be silently dropped once. Fixed by making both `async fn` + `tauri::async_runtime::spawn_blocking`. No further action needed here — old Buzz doesn't use Okta at all (N/A for comparison), this is purely SWF Buzz's own addition per the product brief.

### Nostr/NIP-46 Bunker — PARTIALLY IMPLEMENTED

`src/features/signing/signingService.nip46.ts` correctly implements bunker-URI parsing (delegates to `nostr-tools`' own `parseBunkerInput`, which correctly supports multiple `relay=` params), PKCE-equivalent transport-key generation, and all the same security checks the Okta flow uses (state/nonce equivalent via NIP-46's own request/response correlation). **Real bug found and fixed this session**: `BunkerSigner.sendRequest()` (library internals, confirmed by reading `node_modules/nostr-tools/lib/esm/nip46.js` directly) has no timeout waiting for the remote signer's response — only relay-connect (~3s) and publish-ack (~4.4s) are bounded. If the signer never answers, the call hung forever, exactly matching the "Connect your Nostr signer to finish" freeze reported this session. Fixed with an explicit 25s/15s timeout wrapper plus safe per-relay connect/fail diagnostic logging (`onRelayConnectionSuccess`/`onRelayConnectionFailure`, a supported library extension point). **What's still open**: no live external bunker has been successfully paired against yet this session — the fix makes failure fast and clear instead of infinite, but doesn't create a bunker to connect to. This is a real product/infra dependency (`docs/DECISIONS.md` D2), not a remaining code bug.

### User identity — Okta ↔ Nostr linkage — PARTIALLY IMPLEMENTED

**New finding this session**: the shared relay's live schema already has `users.okta_user_id` (confirmed via `\d users` against the running local Postgres) — a real, if loosely-typed (no FK, per the old-Buzz audit's finding that no pubkey identity surface in this schema has enforced FKs to any other), place to record which Okta identity a given Nostr pubkey belongs to. **Nothing in SWF Buzz's current code writes to this column** — `resolveIdentityAndRole()` in `useAuth.ts` resolves community role from `relay_members` by pubkey alone; the Okta `employeeEmail`/`applicationUserId` from the login step is discarded after that point (see `useAuth.ts:184`'s own comment: *"the Okta sub from the original login isn't threaded through this second step today"*). This is `docs/DECISIONS.md` D3, previously "unresolved," now with a concrete, low-risk path forward: write `okta_user_id` (the Okta `sub`) onto the `users` row for the paired pubkey after `resolveIdentityAndRole` succeeds, purely as a display/audit convenience — **this must never become part of the authorization decision** (role still comes from `relay_members` alone), only an identity-linkage record.

### Communities — creation — N/A, not a gap

Corrected finding, see `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §B: **old Buzz has no create-community UI either.** Its "Add Community" button connects an existing client to an already-provisioned relay by URL; true provisioning is an Operator-only backend API with zero frontend anywhere. SWF Buzz not having a "Create Community" button is **not a gap relative to old Buzz** — building one would be new product scope, not parity work, and would contradict the master prompt's own "don't invent business logic old Buzz doesn't have" rule.

### Communities — connect to an existing relay by URL — MISSING

What old Buzz *does* have (a client-local "point this app at relay X" flow, `EditCommunityDialog`) has no SWF Buzz equivalent — `.env.local`'s `VITE_OKTA_ISSUER`/`VITE_RELAY_URL` model is single-relay-per-build, not a runtime-switchable UI. Whether this matters depends on SWF Buzz's actual deployment model (one build per customer/community vs. one build that can switch) — a product decision, not purely a code gap.

### Community roles — IMPLEMENTED

`relay_members.role` (owner/admin/member) is read correctly via `relayMembersService.fetchMembershipList()` + `resolveMyRole()` (`src/features/community-members/permissions.ts`), and — critically — this is **real server-side authorization**, not a cosmetic frontend badge: every mutating action (`RelayMembersService.ts`, `ModerationService.ts`) signs and publishes the same kind:9030-9044 events the relay itself enforces, exactly matching old Buzz's own architecture where "client-side authorization is purely cosmetic; the relay is the sole enforcement boundary" (`docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §9 pattern, preserved correctly here). This directly answers the concern in the original request ("UI shows Create Channel but API returns 403") — for the role actions that ARE wired up (member add/remove/promote/demote, moderation), the backend enforcement already exists and already matches old Buzz's own guard rails (admin cannot touch owner/admin, etc.) per `docs/ROLE_PERMISSION_AUDIT.md`.

### Channel creation — PARTIALLY IMPLEMENTED (dead code, unchanged finding)

`ChannelService.createChannel`/`editChannel` (`src/features/channels/ChannelService.ts:82,86`) exist and are almost certainly protocol-correct (built during the same session that verified the rest of `src/protocol/channels.ts` against source), but **have zero call sites anywhere in the UI** — confirmed by a repo-wide grep this session, unchanged from the earlier `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §11 finding. There is no `CreateChannelDialog`-equivalent Vue component, no "+" button in `ChannelsView.vue`. This is the most concrete, smallest, highest-value fix available for "Phase 7 — make channel creation work": the plumbing exists, only the dialog + button need to be built and wired.

**Important correction to the master prompt's assumption**: channel creation in old Buzz is **not owner/admin-gated** — any community member can create a channel (§A/§C of the audit, confirmed via `Scope::ChannelsWrite` being granted to every authenticated connection regardless of role). SWF Buzz's UI should show the "Create Channel" affordance to every member, not just owner/admin, to match old Buzz's actual behavior — gating it to owner/admin would be a *different* behavior than old Buzz, not parity.

### Channel membership (add/remove a user to/from a specific channel) — MISSING

No protocol builder for kind:9000/9001 (channel-level put/remove-user) exists in `src/protocol/`, and no UI surface for it. This is separate from *community* member management (which is `IMPLEMENTED`, see above) — old Buzz's channel-role plane (owner/admin/member/guest/bot per channel, independent of community role) has no SWF Buzz equivalent at all yet.

### Invitations — BROKEN — the most important finding in this document

SWF Buzz's `src/features/invites/` and `src/protocol/invites.ts` build and sign **kind:9009** (`KIND_NIP29_CREATE_INVITE`). This session confirmed directly against the real relay source (`crates/buzz-relay/src/handlers/side_effects.rs:211-214`) that this kind's handler is a literal stub: `"NIP-29 kind 9009 handler deferred to future phase"` — **the relay accepts the event but does nothing with it.** This was already flagged as a known limitation (`docs/KNOWN_LIMITATIONS.md`: *"kind:9009's relay-side handler is a confirmed no-op"*), but this session's audit of old Buzz clarifies **why**, and what the actual fix is:

**Old Buzz doesn't use a Nostr event for invites at all.** Its real invite mechanism is a pair of HTTP endpoints, NIP-98-signed: `POST /api/invites` (owner/admin, mints a token, returns the plaintext code once) and `POST /api/invites/claim` (any identity, redeems the code, adds the claimant to `relay_members` with role hard-pinned to `member`). **No amount of UI work on top of kind:9009 will ever make invites work** — the fix is protocol-level: replace the kind:9009 event builder with real HTTP calls to `/api/invites`/`/api/invites/claim`, which requires SWF Buzz to implement **NIP-98 HTTP request signing** (a different signing surface than the Nostr-event signing `src/features/signing/` already does — old Buzz's own admin-web does this via `signNip98()`, a useful reference pattern, though admin-web's version signs with a NIP-07 browser key rather than a NIP-46 bunker).

This single finding is why **Phase 8 (friend onboarding) cannot currently work through any invite flow** — it needs this fixed first, or the alternative bootstrap path below.

### Direct messages — IMPLEMENTED

`src/features/dm/Kind41010Transport.ts` builds kind:41010 (`KIND_DM_OPEN`), confirmed this session against `crates/buzz-relay/src/handlers/command_executor.rs:66` (`KIND_DM_OPEN => handle_dm_open(...)`) to be a real, implemented relay handler — unlike invites, this is genuine protocol parity, not a mismatch. `useOpenDm`/`useSendDm`/`useDmList`/`useDmMessages`/`useHideDm` cover open/send/list/receive/hide; only "unhide" UI is missing (a documented, minor known limitation, not a functional blocker).

### Conversations UI (DM inbox) — DIFFERENT BEHAVIOR, not necessarily a bug

Old Buzz has **two** DM-access surfaces: an inline sidebar section, and a separate `HomeView`/`Inbox` master-detail screen (`docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §G/§I — the exact relationship between the two is itself `UNVERIFIED` in old Buzz's own code). SWF Buzz's `DmView.vue` provides one DM surface. Whether a second, dedicated inbox view is needed is a scope decision, not a confirmed gap — flagging for a product call rather than asserting it must be built.

### Community member management — IMPLEMENTED (code-complete, partially live-verified)

`src/features/community-members/` (`RelayMembersService.ts`, `permissions.ts`, `CommunityMembersPanel.vue`, `CommunityMemberRow.vue`) exists and, per `docs/E2E_TEST_RESULTS.md`'s "Update" section, was verified against a **real running relay** this project cycle: a seeded owner added a second member, a seeded admin added a third, and the rendered UI correctly hid role-change/remove controls on the owner's and admin's own rows, restricted the add-member role picker to `member` only — matching `docs/ROLE_PERMISSION_AUDIT.md`'s guard rails exactly. This is real, not cosmetic — worth stating plainly since the master prompt was specifically worried about a frontend-only bypass.

### Moderation — IMPLEMENTED (code-complete, not fully live-verified)

`src/features/moderation/` (ban/timeout/report/queue/audit) exists, unit-tested, reachable in the UI. Per `docs/KNOWN_LIMITATIONS.md`, not yet independently click-tested against seeded report/feedback data (time-boxed in a prior session, not a code defect).

### Platform admin console — PARTIALLY IMPLEMENTED

`src/features/platform-admin/` exists and is unit-tested, but this local relay deployment has no `BUZZ_ADMIN_HOST` configured (`GET /api/admin/v1/probe` 404s) — an **environment gap**, not a code gap, per `docs/KNOWN_LIMITATIONS.md`. Not reachable for live testing in this environment without that relay-side configuration.

### Realtime — IMPLEMENTED

`RelayConnectionService` has a real, non-mocked integration test (`tests/integration/relayConnectionService.spec.ts`) proving connect/publish/subscribe/reconnect-with-backoff against a real WebSocket. Solid foundation; no gap found.

### Notifications — MISSING

No OS-level push notification or in-app toast-for-unfocused-window system was found in SWF Buzz's code. Old Buzz's own notification behavior wasn't deeply audited this pass either (out of this session's scope) — flag as an open item on both sides rather than assert old Buzz definitely has one SWF Buzz should copy.

### Sidebar — PARTIALLY IMPLEMENTED

`ChannelsView.vue` covers the channel list + DM list. Old Buzz's `CommunityRail` (a left rail for switching between multiple connected communities) has no SWF Buzz equivalent — consistent with SWF Buzz's current single-relay-per-build architecture (see "Communities — connect to an existing relay" above); only relevant if that architecture changes.

### Onboarding (second test user) — BROKEN, downstream of the invitations bug

Per the master prompt's Phase 8 (friend onboarding test): **this cannot be completed today** through the app's own invite flow, because that flow calls a relay handler that's a no-op (see "Invitations" above). Two ways to unblock this locally, without the full NIP-98 HTTP-invite implementation:

1. **Fix invitations properly** (the durable fix, but real engineering work: NIP-98 signing + two new HTTP-calling service methods).
2. **Bypass with a direct DB seed**, exactly as this project's own `docs/ROLE_PERMISSION_MATRIX.md` §2 already documents doing for the dev-mode owner: once User B has completed *some* login (Development Mode is sufficient — it doesn't require Okta or a bunker) and their pubkey is known, `INSERT INTO relay_members (community_id, pubkey, role, added_by) VALUES (..., 'member', 'local-test-seed')` gives them real, server-enforced community membership without touching the broken invite path at all. This is not a frontend bypass — it's the same table the relay's own authorization reads, and it's the documented, already-validated way this project tests multi-user scenarios locally. **This is the recommended path for Phase 8** given the invite fix is out of scope for "make it work today."

---

## What's most urgent, in priority order, for making community/channel/invite/DM actually work end-to-end

1. **Seed `prakhar.mittal@lmdconsulting.com`'s real pubkey as `owner`** in `relay_members` for the `dc4b45d3...` (`localhost:3000`) community, once he completes NIP-46 bunker pairing — zero code changes, same mechanism already validated for the dev-mode pubkey.
2. **Build the Create Channel dialog + button**, wiring the already-correct `ChannelService.createChannel` — smallest, highest-value UI gap; no backend/protocol work needed.
3. **For the second test user (Phase 8)**: use the direct DB-seed bypass above (not the broken invite flow) to get them real `member` community access quickly; treat fixing the real HTTP-based invite flow as separate, larger follow-up work, not a blocker for today's testing goal.
4. **Do not attempt to fix invites by changing the kind:9009 UI or client-side logic** — the fix is protocol-level (HTTP + NIP-98), and building more UI on top of the current broken event won't change the outcome.

---

*Compiled this session, cross-checked against SWF Buzz's actual current `src/**`/`src-tauri/src/**` file tree and against `../buzz`'s real relay handler source (not assumed from either app's own documentation). `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §11's gap table is now superseded by this document for SWF Buzz's current state — keep this one current going forward, that one as historical record of an earlier point in the project.*
