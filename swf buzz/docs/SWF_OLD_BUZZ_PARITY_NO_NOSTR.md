# SWF Buzz — No-Nostr Architecture: Configuration, Design & Verification Reference

**Purpose**: the single reference for how SWF Buzz's human-identity/community/channel/message/
thread/DM stack actually works right now, as of 2026-09-17, after the DECISIONS.md D10 migration.
Every claim below is either `file:line`-cited against source read this pass, or explicitly marked
as a documented design decision (with its own decision-record doc) or an open gap. This is a
verification/reference document, not a plan — for the plan and the feature-by-feature gap analysis
that produced this system, see `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md`. For the decision that started
all of this, see `DECISIONS.md` D10.

**The one thing to know before anything else**: this system currently has **two identity/data
paths coexisting on purpose**. A new HTTP(+WebSocket)-backed path (`swf-buzz-backend`, `Application
User`, bearer sessions) now handles auth, community membership, invites, channels, messages,
threads, and DMs. The old Nostr/pubkey-based path (Okta → deterministic/bunker Nostr keypair →
`buzz-relay`) is still fully present and still what reactions, presence, moderation,
platform-admin, and agent-activity features use — untouched, not broken, not yet migrated. This is
a deliberate "build alongside, verify, delete old code only after everything migrates" sequencing
(D10, `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §2's closing note), not an oversight or an unfinished
merge. Nothing has been deleted yet.

---

## 1. Final architecture

```
Okta (OIDC, Authorization Code + PKCE)
  │  custom URL scheme redirect: com.okta.trial-7050986:/callback
  │  (NOT a loopback listener — this Okta app's registered redirect URI is
  │  a custom scheme; see docs/OKTA_PKCE_SETUP.md §2)
  ▼
src-tauri/src/auth/oidc.rs :: login()          [Rust process, system browser]
  │  PKCE code exchange → ID token
  │  JWKS-verified in Rust (signature, iss, aud, exp, nonce) — closes the
  │  historical DECISIONS.md D9 gap, confirmed live this session
  ▼
POST {SWF_BUZZ_BACKEND_URL}/api/session/bootstrap   [best-effort, non-fatal]
  │  backend independently re-verifies the ID token via its OWN JWKS fetch
  │  (defense in depth — never trusts the Rust client's own verification)
  ▼
swf-buzz-backend (new Rust/Axum/Postgres service, `swf buzz/backend/`,
                  NOT part of ../buzz, NOT a cookie-based session)
  │
  ├─ users (upsert by okta_sub)
  ├─ sessions (opaque bearer token, SHA-256-hashed at rest)
  │
  └─ HTTP + WebSocket API:
       communities, community_members, community_invites,
       channels, channel_members,
       messages (+ threads), dm_conversations/dm_participants/dm_messages,
       /ws realtime fan-out
  ▲
  │  Authorization: Bearer <session_token>  (stored in OS keychain via
  │  secure_storage_* Tauri commands, NOT a cookie, NOT localStorage)
  │
Vue frontend (src/services/ApiClient.ts + src/features/{communities,
  channels,messages,threads,dm}/*Http.ts, *ServiceHttp.ts)
```

Coexisting, untouched, still fully Nostr/pubkey-based (see §17):

```
Okta identity → deterministic/NIP-46 Nostr keypair (src/features/signing/)
  → buzz-relay (WebSocket, ../buzz) → reactions, presence, moderation,
    platform-admin, agent-activity, and the original ChannelsView.vue/
    DmView.vue routes
```

**Why a bearer token, not a cookie** (`docs/BACKEND_SESSION_DESIGN.md` §1): the OIDC token exchange
happens in the Tauri **Rust process**, not the webview. A `Set-Cookie` response to that Rust-side
`reqwest` call would land in `reqwest`'s own cookie jar, never the webview's — the frontend's
`fetch()` calls have no way to receive it. The new backend instead returns an opaque bearer token,
which Rust persists to the OS keychain (`StorageKey::SwfSessionToken`,
`src-tauri/src/commands/secure_storage.rs`) and the frontend reads via the same
`secure_storage_get`/`secure_storage_delete` Tauri commands (`src/services/ApiClient.ts:39-56`).

**Why a brand-new backend, not an extension in-place of anything existing** (D10, confirmed by the
Phase 1 audit): SWF Buzz had no HTTP backend, session, or database of its own before this
migration — it was documented as "client only." Old Buzz's own `buzz-relay` has a working invite
API, but it's NIP-98/pubkey-authenticated, not session-based, and its entire data model is
Nostr-native. `swf-buzz-backend` is architected *like* `buzz-relay` (Rust/Axum/Postgres, same
general dependency versions) with its already-correct authorization *logic* ported and re-keyed
from `pubkey` to `user_id` — never copy-pasted, and never touching `../buzz` itself.

---

## 2. Authentication flow

Full sequence diagram, exact env vars, troubleshooting table: `docs/OKTA_PKCE_SETUP.md`. Summary
of what's real vs. configured-by-convention:

| Step | Mechanism | Source |
|---|---|---|
| Redirect | Custom URL scheme (`com.okta.trial-7050986:/callback`), via `tauri-plugin-deep-link` + `tauri-plugin-single-instance` | `src-tauri/src/auth/oidc.rs` |
| PKCE | `code_challenge_method=S256`, verifier sent only to `/v1/token`, never `/v1/authorize` | `oidc.rs::login` |
| State/nonce | Random per attempt, checked on callback (`state`) and in the ID token (`nonce`) — a mismatch is a hard failure, not silently ignored | `oidc.rs::login`, `verify_id_token` |
| ID token verification (Rust side) | JWKS fetch (`{issuer}/v1/keys`), RS256 signature, `iss`, `aud`, `exp`, `nonce` — all checked before the token is trusted | `oidc.rs::verify_id_token` |
| ID token verification (backend side, independent) | Same checks, fetched via the backend's own JWKS client — never trusts the Rust process's verification, a separate trust boundary | `backend/src/jwks.rs`, called from `routes/session.rs::bootstrap` |
| Backend session bootstrap | `POST {SWF_BUZZ_BACKEND_URL}/api/session/bootstrap {id_token}` — best-effort, **non-fatal**: if this fails, Okta login still succeeds locally, but every community/channel/message/DM feature on the new backend is unavailable until it does succeed | `oidc.rs:444-464` |
| ID token retention | Rust process memory only, for logout's `id_token_hint` — **never sent to the frontend** | `oidc.rs`, `docs/OKTA_PKCE_SETUP.md` §4 |

**Env vars actually read** (confirmed by grepping `std::env::var(` in `oidc.rs` and
`backend/src/config.rs` this pass — do not assume a name, verify it, a real session earlier this
day hit a real bug from assuming `SWF_BACKEND_URL` instead of the correct `SWF_BUZZ_BACKEND_URL`):

| Var | Read by | Required | Default |
|---|---|---|---|
| `SWF_BUZZ_OKTA_ISSUER` | `oidc.rs:178`, `backend/config.rs` | Yes (both) | none — login fails with `okta_not_configured` if unset |
| `SWF_BUZZ_OKTA_CLIENT_ID` | `oidc.rs:180`, `backend/config.rs` | Yes (both) | none |
| `SWF_BUZZ_BACKEND_URL` | `oidc.rs:129` | No, but the bootstrap step silently no-ops without it | none — if unset, `backend_base_url()` returns `None` and login succeeds Okta-only, no backend session |
| `VITE_OKTA_ISSUER` / `VITE_OKTA_CLIENT_ID` | Vite/frontend build (`.env.local`) | No — cosmetic only, gates the "Sign in with Okta" button's visibility check in `LoginView.vue`, **not** the actual source of truth | none |
| `VITE_SWF_BACKEND_URL` | Frontend `ApiClient`/`app/config.ts` | No | `http://127.0.0.1:8787` |
| `DATABASE_URL` | `backend/config.rs` | Yes | none |
| `SWF_BACKEND_BIND_ADDR` | `backend/config.rs` | No | `127.0.0.1:8787` |
| `SWF_BACKEND_SESSION_TTL_HOURS` | `backend/config.rs` | No | `12` |
| `SWF_BACKEND_INVITE_BASE_URL` | `backend/config.rs` | No | `http://localhost:5173` |

**Known documentation gap found while writing this doc**: `.env.example` documents
`VITE_SWF_BACKEND_URL` but **not** `SWF_BUZZ_BACKEND_URL` (the Rust-side var that actually gates
whether the backend session bootstrap runs at all) — anyone following `.env.example` alone would
reproduce the exact "Okta login succeeds, but nothing backend-related works" bug hit live this
session. Fix `.env.example` to document `SWF_BUZZ_BACKEND_URL` alongside `SWF_BUZZ_OKTA_*`; not yet
done as of this doc.

**Verified live, this session, for real** (first time in this project's history — see project
memory `project-swf-buzz-okta-verification` for the prior session's Okta-side "user not assigned"
blocker, which is evidently now resolved): the full PKCE flow, deep-link callback, token exchange
(HTTP 200), and JWKS verification (signature/iss/aud/exp/nonce all pass) against the real
`trial-7050986.okta.com` tenant, from a running `npm run tauri dev` instance. The backend session
bootstrap step was **not** exercised in that first run (env var gap above); a second run with
`SWF_BUZZ_BACKEND_URL` correctly set was in progress as of this document being written — see
project memory for the outcome once confirmed.

---

## 3. Application User / session model

`users` (`backend/migrations/0001_init.sql`): `id` (UUID, PK), `okta_sub` (unique, the stable
identity key — **never key by email**, D10), `email`, `display_name`, timestamps. Upserted by
`okta_sub` on every successful bootstrap (`repo::UserRepo::upsert_by_okta_sub`) — same `okta_sub`
logging in twice always reuses the same row.

`sessions`: `id`, `user_id` (FK, cascade delete), `token_hash` (unique, SHA-256 hex,
`backend/src/token.rs::hash`), `expires_at`, `revoked_at`. The raw token is a 32-byte CSPRNG value,
base64url-encoded (`token::generate`), returned **exactly once** in the bootstrap response, never
stored. Default TTL 12 hours, no sliding renewal (`SWF_BACKEND_SESSION_TTL_HOURS`). Logout
(`POST /api/session/logout`) sets `revoked_at`; idempotent — revoking an already-revoked/unknown
token still returns 200 (`routes/session.rs:106-117`).

Every authenticated route uses the same `AuthUser` extractor (`backend/src/auth.rs:26-50`): reads
`Authorization: Bearer <token>`, hashes it, looks up `sessions.token_hash`, rejects with 401 if
missing/expired/revoked. No route ever trusts a client-supplied user id for "who am I" — only this
extractor's result.

---

## 4. Community membership & roles

`communities` (`id`, `name`) + `community_members` (`community_id`, `user_id`, `role` ∈
{owner, admin, member}, `joined_at`, `status`), PK `(community_id, user_id)`
(`0002_community_members.sql`). `POST /api/communities` (any authenticated user; creator becomes
`owner` in the same transaction as the community row) — not part of the master prompt's original
Phase 3 scope, added because membership is untestable without a community to belong to
(`COMMUNITY_MEMBERSHIP_DESIGN.md` §1).

Rules, ported **verbatim in behavior** (not "improved") from `src/features/community-members/
permissions.ts:39-71` into `backend/src/community_authz.rs` — this file is the real security
boundary, `permissions.ts` is UX-only fast-fail:

| Function | Rule |
|---|---|
| `can_add_member` | Owner may add admin/member (never owner). Admin may add member only. |
| `can_remove_member` | Owner may remove admin/member. Admin may remove member only. **An owner can never be removed via this endpoint, period — not just "unless last owner."** Nobody may remove themselves, regardless of role. |
| `can_change_role` | **Owner-only** (admins cannot change roles at all). Cannot touch an owner's role, cannot grant owner, cannot change your own role. |
| `can_manage_invites` | Owner or admin. |

Viewing the roster (`GET .../members`) requires the caller to already be a member of that
community (any role) — a non-member gets `403`, and a request against a genuinely non-existent
community gets `404` (existence check happens before the membership check).

---

## 5. Invite architecture

`community_invites` (`0003_community_invites.sql`): `id`, `community_id`, `token_hash` (unique,
SHA-256, raw code never stored), `created_by_user_id`, `expires_at`, `max_uses` (nullable =
unlimited), `used_count`, `created_at`, `revoked_at`.

| Endpoint | Auth | Behavior |
|---|---|---|
| `POST /api/communities/:id/invites` | owner/admin (`can_manage_invites`) | `{ttl_secs?, max_uses?}` → `{id, code, url, expires_at, max_uses, uses_remaining}`. `ttl_secs` must be 3600–2,592,000 (1h–30d), default 259,200 (72h); `max_uses` ≥ 1 if given. `code`/`url` shown exactly once. |
| `POST /api/invites/claim` | any authenticated user | `{code}` → `claiming_user_id` from session only. `joined`/`already_member` (idempotent, no double-increment) on success; 404 unknown, 410 expired/revoked, 409 exhausted. |
| `POST /api/invites/:id/revoke` | owner/admin | Idempotent. **Genuine SWF addition — old Buzz's source never confirmed a revoke endpoint exists**, not parity. |
| `GET /api/invites/:token/preview` | **public, unauthenticated** | Returns only `{community_name}`. Uses real 404/410/409 status codes, not a `200 {valid:false}` wrapper — judged acceptable specifically because invite tokens are 256-bit CSPRNG values with no enumeration risk (`INVITE_DESIGN.md` §1). |

**Atomicity — what's proven vs. reasoned about** (`INVITE_DESIGN.md` §4, still true as of this
doc): `PostgresRepo::claim` does `SELECT ... FOR UPDATE` on the invite row inside a transaction
before validating/inserting/incrementing. This has **not** been isolated-tested against a live
Postgres lock conflict in this environment. What *is* proven, via a real concurrent-HTTP-request
test against the live Axum router (`InMemoryRepo`'s single-mutex critical section, re-run 8× with
no flakes): the **outcome contract** — exactly one of two simultaneous claims against a
`max_uses=1` invite succeeds, the other gets `409`. The specific claim "Postgres's row lock is
what prevents this in production" remains unverified in isolation, though the same backend process
was proven to correctly execute ordinary create/claim/revoke/preview flows against real Postgres
in this session's manual smoke test (§16).

---

## 6. Channel architecture

`channels` (`id`, `community_id`, `name`, `visibility` ∈ {open, private}, `channel_type`,
`description`, `created_by_user_id`) + `channel_members` (`channel_id`, `user_id`, `role`,
`joined_at`), PK `(channel_id, user_id)` (`0004_channels.sql`).

**Three role tiers (owner/admin/member), not old Buzz's five** (owner/admin/member/guest/bot) —
confirmed by reading `src/features/channels/channelPermissions.ts` directly before choosing the
schema; `guest`/`bot` don't exist anywhere in current SWF Buzz (`CHANNEL_MEMBERSHIP_DESIGN.md` §1).
`channel_members.role` reuses the same TEXT-CHECK vocabulary as `community_members.role` but is
**not the same role plane** — `channel_authz.rs` never reads `community_members` and vice versa.

**The single most important invariant** (D10, master prompt §17): a community owner is **not**
automatically a channel owner, admin, or even member of any given channel. Every channel handler
resolves the caller's role from an actual `channel_members` row; community membership is used only
as the outer "are you even in this community" gate, never as channel authority. Proven both by a
unit/integration test (`community_owner_is_not_automatically_a_member_of_a_channel_they_did_not_create`)
and by this session's own live smoke test (owner correctly got 403 posting to a channel until they
explicitly joined it).

Rules ported from `channelPermissions.ts` into `backend/src/channel_authz.rs`:

| Function | Rule | Source line |
|---|---|---|
| `can_open_add_flow` | Open channel: anyone (even non-members) may self-add. Private: actor must already be a channel member. | `channelPermissions.ts:28-34` |
| `can_grant_channel_role` | Granting admin/owner requires the actor already be elevated (owner OR admin). **A channel admin may grant channel-owner** — confirmed intentional asymmetry vs. the community plane (there, only an owner may ever grant admin, nobody may grant owner). Do not "fix." | `channelPermissions.ts:36-47` |
| `can_manage_channel_member` | Elevated actors only (owner/admin). **No self-removal/self-role-change immunity**, unlike the community plane. | `channelPermissions.ts:58-60` |
| `would_orphan_channel` | Blocks removing/demoting a channel's sole owner — the one guard that exists here in place of self-immunity. | `channelPermissions.ts:62-74` |

Channels are community-scoped, not globally visible: every channel endpoint requires community
membership first (`require_community_and_caller_role`, reused verbatim from §4). Listing
(`GET /api/communities/:id/channels`) returns every `open` channel plus any `private` one the
caller already belongs to.

---

## 7. Message architecture

`messages` (`0005_messages.sql`, extended by `0006_threads.sql`): `id`, `seq` (`BIGSERIAL`, the
pagination key — **not `id` or `created_at`**, since UUIDs don't sort chronologically and
timestamps aren't guaranteed unique under concurrent writes), `channel_id`, `sender_user_id`,
`content`, `parent_message_id`, `root_message_id`, `depth`, `reply_count`, `descendant_count`,
`last_reply_at`, timestamps, `deleted_at`.

| Endpoint | Contract |
|---|---|
| `POST /api/channels/:id/messages` | `{content, parent_message_id?}`. Requires actual **channel** membership (not just community). `sender_user_id` always from session — the field isn't even deserialized from a client-supplied value. Content: trimmed, non-empty, ≤8,000 chars (422 otherwise). |
| `GET /api/channels/:id/messages?before_seq=&limit=` | Newest-first. `limit` default 50, max 200. Pass the last-seen `seq` as `before_seq` for the next (older) page. |
| `GET /ws?token=<session_token>` | WebSocket upgrade. Realtime fan-out — see below. |

**Realtime mechanism** (`MESSAGING_DESIGN.md`): a single process-wide `tokio::sync::broadcast`
channel (`backend/src/realtime.rs`). Every send publishes an event; every connected socket filters
against a **membership snapshot taken at connect time** — joining a new channel after connecting
does not retroactively subscribe you; the client must reconnect. This is a real, tested limitation,
not an oversight (`tests/messages_flow.rs::websocket_does_not_receive_events_for_a_channel_joined_after_connecting`).

**Auth over `/ws`**: session token as a `?token=` query parameter, not a header — the browser
`WebSocket` constructor cannot set arbitrary headers on the handshake. Validated with the exact
same hash-lookup every other endpoint uses. Stated tradeoff: the token appears in one additional
place (URL/access logs) beyond the `Authorization` header. Mitigation path documented, not yet
built: a short-lived single-use realtime ticket, or excluding `/ws` query strings from
proxy/access logs.

**Proven by a real test, not reasoned about**: `tests/messages_flow.rs` connects a real
`tokio_tungstenite` WebSocket client to a real TCP-bound Axum router, posts a message over plain
HTTP from a different user, and asserts the socket actually receives `{"type":"message.created",
"channel_id":..., "message":{...}}`.

---

## 8. Thread architecture

Extends the `messages` table (`0006_threads.sql`) rather than a separate `thread_metadata` table
(unlike old Buzz) — the plan doc explicitly allows either shape; folding avoids a second table with
a 1:1 relationship to maintain.

**`root_message_id` always flattens to the top-level ancestor** — never chains through an
intermediate reply. If the parent is top-level, the new message's root is the parent; if the
parent already has a root, the new message's root is *that* value. This matches old Buzz's own
`derive_ancestry_from_parent_tags` (`OLD_BUZZ_COMMUNITY_CHANNEL_DM_BEHAVIOR_AUDIT.md` §14) and is
tested explicitly — flagged as the single most likely place for a flattening regression if this
code is touched again.

`depth` is stored (`= parent.depth + 1`), not recomputed by walking ancestors, so the cap check is
O(1). Cap: **100**, matching old Buzz's own hard limit (`ingest.rs:879-882`).

`reply_count` (incremented on the **immediate parent** only) and `descendant_count` (incremented on
the **root** only, every depth) are genuinely separate counters, matching old Buzz's
`thread.rs:138-261` — a depth-2 reply increments its parent's `reply_count` and the root's
`descendant_count`, two different rows unless the parent is the root itself. Both updates happen
inside the same transaction as the insert.

Same-channel invariant: a reply's parent must be in the same `channel_id`, enforced inside the same
locked transaction as the write, not pre-checked and trusted (422 `CrossChannelParent` otherwise;
404 if the parent doesn't exist at all).

| Endpoint | Contract |
|---|---|
| `GET /api/messages/:rootId/thread?after_seq=&limit=` | Root + replies, **oldest-first** (`seq ASC`) — the opposite direction from the channel timeline, matching natural top-to-bottom thread reading. |
| `GET /api/messages/thread-summaries?ids=id1,id2,...` | Batched `{reply_count, descendant_count, last_reply_at}` per id. **Best-effort**: an inaccessible or nonexistent id is silently omitted, not a request failure — lets a caller pass every rendered message id without pre-filtering. |

---

## 9. DM architecture

Separate tables — `dm_conversations`, `dm_participants`, `dm_messages` (`0007_dms.sql`) — not a
reuse of `messages` with a nullable `channel_id`, since DMs have no channel/community authorization
model and (this phase) no threading; two small tables are simpler than one table with two
authorization models bolted on (`DM_DESIGN.md` §1).

**Race-safe idempotent open, via `ON CONFLICT`, not a transaction/row lock**: `participant_key` is
a deterministic sorted comma-joined list of participant `user_id`s, with a unique index. `open()`
does `INSERT ... ON CONFLICT (participant_key) DO NOTHING`; if nothing came back, a plain `SELECT`
by the same key fetches the winner. Different from the invite-claim mechanism deliberately — there's
no multi-step validation to serialize here, "does this exact key already exist" is a single fact
Postgres's own unique index already enforces atomically. Verified independently this session via a
real live-Postgres HTTP smoke test: opening the same DM from both participants, in reversed
participant order, returned the exact same conversation id both times.

`POST /api/dm/open {user_ids}`: caller must be included in `user_ids` (confirmed live — omitting
yourself returns 422 `"you must be one of the conversation's participants"`), at least 2 distinct
participants required, every id validated as a real user first (fail fast on a typo'd id rather
than creating a conversation with a dangling participant).

Conversation ordering (`GET /api/dm`): newest-created, not most-recently-active — a deliberate
simplification; upgrading to activity-ordering is an additive migration (a denormalized
`last_message_at` column), not a redesign.

Realtime: the same `Broadcaster`/`RealtimeEvent` enum from §7, extended with a `NewDmMessage`
variant, not a second WebSocket route. Same connect-time-snapshot limitation as channels, proven by
a real WebSocket test for both "receives" and "does not retroactively receive" cases.

**Known limitation, not yet fixed**: no HTTP endpoint anywhere in this backend returns another
user's display name (`GET /api/channels/:id/members` only returns `{user_id, role, joined_at}`) —
so the frontend's "start a DM" flow is currently a raw user-id text input, not a name-based picker.
`useOpenDmHttp()` (frontend) is built and ready for a real profile-panel "Message" button once a
`userId`-keyed profile-lookup endpoint exists.

---

## 10. Permission matrix

| Action | Member | Admin | Owner | Enforced |
|---|---|---|---|---|
| View community roster | ✅ (any role) | ✅ | ✅ | Server (403 for non-members) |
| Add community member (member role) | ❌ | ✅ | ✅ | Server |
| Add community member (admin role) | ❌ | ❌ | ✅ | Server |
| Remove community member | ❌ | ✅ (member-role targets only) | ✅ (admin/member, never another owner) | Server |
| Change community role | ❌ | ❌ | ✅ (never self, never touching another owner, never granting owner) | Server |
| Create/revoke community invite | ❌ | ✅ | ✅ | Server |
| Claim an invite | ✅ (any authenticated user) | — | — | Server |
| Create a channel | ✅ (any community member, ungated) | ✅ | ✅ | Server |
| Self-add to an **open** channel | ✅ | ✅ | ✅ | Server |
| Self-add to a **private** channel | ❌ (unless already a member) | — | — | Server |
| Grant channel-admin/owner role | — (need channel owner/admin) | ✅ (channel role, incl. granting owner) | ✅ | Server |
| Remove/role-change a channel member | — (need channel owner/admin) | ✅ (channel role) | ✅ | Server, blocked if it would orphan the channel |
| Post/read channel messages | ✅ (requires actual **channel** membership, community role insufficient) | ✅ | ✅ | Server |
| Open/send/read a DM | ✅ (must be a participant) | — | — | Server |

**Every row above is server-enforced** (`*_authz.rs`, checked fresh per request from the database,
never from a client-supplied role/user id — master prompt §25). Frontend `permissions.ts`/
`channelPermissionsHttp.ts` re-exports of the same rule functions exist **only** to hide UI the
caller can't use (fast-fail UX) — they are not a security boundary and a client could bypass them
entirely by calling the API directly; the server would still reject the action.

---

## 11. API contracts (complete)

All endpoints require `Authorization: Bearer <session_token>` unless marked public. All error
responses: `{"error": "<message>"}` with the status code shown.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/session/bootstrap` | none (Okta `id_token` is the credential) | `{id_token}` | `{session_token, expires_at, user}` | 401 token verification failure |
| GET | `/api/session` | bearer | — | `{expires_at, user}` | 401 |
| POST | `/api/session/logout` | bearer | — | `{status:"logged_out"}` | idempotent, no real failure case |
| POST | `/api/communities` | bearer | `{name}` | `{id, name}` | — |
| GET | `/api/communities/:id/members` | bearer, member | — | `[{user_id, role, joined_at}]` | 403 non-member, 404 no such community |
| POST | `/api/communities/:id/members` | bearer, owner/admin | `{user_id, role}` | `{user_id, role, joined_at}` | 403, 404 (target not a user), 409 (already a member) |
| PATCH | `/api/communities/:id/members/:userId` | bearer, owner | `{role}` | member view | 403, 404 |
| DELETE | `/api/communities/:id/members/:userId` | bearer, owner/admin | — | `{status:"removed"}` | 403, 404 |
| POST | `/api/communities/:id/invites` | bearer, owner/admin | `{ttl_secs?, max_uses?}` | `{id, code, url, expires_at, max_uses, uses_remaining}` | 403, 422 (bad ttl/max_uses) |
| POST | `/api/invites/:id/revoke` | bearer, owner/admin | — | `{status:"revoked"}` | 403, 404 |
| POST | `/api/invites/claim` | bearer | `{code}` | `{status:"joined"|"already_member", ...}` | 404, 410 (expired/revoked), 409 (exhausted) |
| GET | `/api/invites/:token/preview` | **public** | — | `{community_name}` | 404, 410, 409 |
| POST | `/api/communities/:id/channels` | bearer, any community member | `{name, visibility, description?}` | channel view | 403 |
| GET | `/api/communities/:id/channels` | bearer, community member | — | `[channel view]` | 403 |
| GET | `/api/channels/:id/members` | bearer, channel member | — | `[{user_id, role, joined_at}]` | 403 |
| POST | `/api/channels/:id/members` | bearer, gated by `can_open_add_flow`+`can_grant_channel_role` | `{user_id, role}` | member view | 403, 404, 409 |
| PATCH | `/api/channels/:id/members/:userId` | bearer, channel owner/admin | `{role}` | member view | 403 (incl. would-orphan), 404 |
| DELETE | `/api/channels/:id/members/:userId` | bearer, channel owner/admin | — | `{status:"removed"}` | 403 (incl. would-orphan), 404 |
| POST | `/api/channels/:id/messages` | bearer, channel member | `{content, parent_message_id?}` | message view | 403, 404 (bad parent), 422 (empty/too long/cross-channel/depth) |
| GET | `/api/channels/:id/messages?before_seq=&limit=` | bearer, channel member | — | `[message view]` | 403 |
| GET | `/api/messages/:rootId/thread?after_seq=&limit=` | bearer, channel member (of root's channel) | — | `{root, replies}` | 403, 404 |
| GET | `/api/messages/thread-summaries?ids=` | bearer | — | `[{root_message_id, reply_count, descendant_count, last_reply_at}]` (best-effort filtered) | — |
| GET | `/ws?token=<session_token>` | token in query | WebSocket upgrade | `message.created` / `dm_message.created` frames | non-101 on invalid token |
| POST | `/api/dm/open` | bearer | `{user_ids}` (must include caller, ≥2 distinct) | conversation view | 422 |
| GET | `/api/dm` | bearer | — | `[conversation view]` | — |
| POST | `/api/dm/:id/messages` | bearer, participant | `{content}` | dm message view | 403, 404, 422 |
| GET | `/api/dm/:id/messages?before_seq=&limit=` | bearer, participant | — | `[dm message view]` | 403, 404 |

---

## 12. Database schema (migrations, in order)

1. `0001_init.sql` — `users`, `sessions`
2. `0002_community_members.sql` — `communities`, `community_members`
3. `0003_community_invites.sql` — `community_invites`
4. `0004_channels.sql` — `channels`, `channel_members`
5. `0005_messages.sql` — `messages` (with unused `parent_message_id`/`root_message_id` columns)
6. `0006_threads.sql` — adds `depth`, `reply_count`, `descendant_count`, `last_reply_at` to `messages`
7. `0007_dms.sql` — `dm_conversations`, `dm_participants`, `dm_messages`

Applied for real, confirmed against a live Postgres instance this session (`SELECT version FROM
_sqlx_migrations` returned `1` through `7`). Auto-applied on backend startup via `sqlx::migrate!`
(`backend/src/lib.rs`) — no separate migration-run step needed.

---

## 13. Frontend architecture — old path vs. new path, per feature

| Feature | Old (Nostr/pubkey) path — still present, unused by new UI | New (HTTP/backend) path | Which UI route uses the new path |
|---|---|---|---|
| Auth/session | `authService.okta.ts`, `signingService.{dev,nip46}.ts`, pubkey resolution in `useAuth.ts` | `ApiClient.ts`, additive `session.ts::applicationUser`, `attemptSilentResume()` | All routes (session bootstrap happens on every login regardless) |
| Community membership | `features/community-members/{RelayMembersService,permissions}.ts` | `features/communities/{CommunityService,permissions,useCommunity}.ts` | `/community` (`CommunityChannelsView.vue`'s member panel), `CommunityManagementModal.vue`'s Members tab |
| Invites | `features/invites/{InviteService,useChannelInvites}.ts` (kind:9009, confirmed dead code server-side even before this migration) | `features/communities/{InviteService,useInvites,pendingInvite}.ts` | `/invite/:token` (`InviteLandingView.vue`), `CommunityManagementModal.vue`'s Invites tab |
| Channels | `features/channels/{ChannelService,channelPermissions}.ts`, `useChannels.ts` | `ChannelServiceHttp.ts`, `channelPermissionsHttp.ts`, `useChannelsHttp.ts` | `/community` (`CommunityChannelsView.vue`) |
| Messages | `MessageService.ts`, `useChannelMessages.ts`, `useSendMessage.ts` | `MessageServiceHttp.ts`, `useChannelMessagesHttp.ts` | `/community` |
| Threads | `ThreadService.ts`, `useThread.ts`, `useThreadSummaries.ts` | `ThreadServiceHttp.ts`, `useThreadHttp.ts` | `/community`'s thread panel |
| DMs | `DmService.ts`, `DmTransport.ts`, `Kind41010Transport.ts`, `useDmList.ts`/`useDmMessages.ts`/`useOpenDm.ts`/`useSendDm.ts`/`useHideDm.ts` | `DmServiceHttp.ts`, `useDmHttp.ts` | `/community-dm` (`CommunityDmView.vue`) |
| Realtime transport | `RelayConnectionService.ts` (raw Nostr WebSocket to `buzz-relay`) | `RealtimeService.ts` (WebSocket to `/ws`) | Every new-path feature above |
| **Still fully old-path, not touched by this migration at all** | `features/{reactions,presence,moderation,platform-admin,agents}/*`, the original `ChannelsView.vue`/`DmView.vue` routes | — | `/` (original `ChannelsView.vue`), `/dm` (original `DmView.vue`), `/platform-admin` |

**Why two parallel views exist for channels/messages/DMs** (`CommunityChannelsView.vue` /
`CommunityDmView.vue` vs. the original `ChannelsView.vue` / `DmView.vue`): the original views are
deeply wired into still-Nostr-only features (reactions, presence, agent-activity, moderation).
Retrofitting them in place would either break those features or require migrating them too, out of
scope for F1-F4. The new views are separate, fully-functional routes built additively. A real
unified view is follow-up work once reactions/presence/moderation are migrated.

---

## 14. Configuration reference

### Backend (`swf buzz/backend/`)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | none | Postgres connection string, e.g. `postgres://buzz:buzz_dev@localhost:5432/swf_buzz` |
| `SWF_BUZZ_OKTA_ISSUER` | Yes | none | Same Okta app as the Tauri side — must match |
| `SWF_BUZZ_OKTA_CLIENT_ID` | Yes | none | Same Okta app as the Tauri side — must match |
| `SWF_BACKEND_BIND_ADDR` | No | `127.0.0.1:8787` | |
| `SWF_BACKEND_SESSION_TTL_HOURS` | No | `12` | |
| `SWF_BACKEND_INVITE_BASE_URL` | No | `http://localhost:5173` | Used to build `{base}/invite/{code}` URLs |

### Frontend/Tauri (`swf buzz/`)

| Var | Layer | Required | Default | Purpose |
|---|---|---|---|---|
| `SWF_BUZZ_OKTA_ISSUER` / `SWF_BUZZ_OKTA_CLIENT_ID` | Rust, real shell env vars (Cargo/Tauri doesn't read `.env.local`) | Yes | none | Source of truth for the OIDC flow |
| `SWF_BUZZ_BACKEND_URL` | Rust, real shell env var | **Not required, but the backend session bootstrap silently no-ops without it** — see §2's gap note | none | Where to POST `/api/session/bootstrap` |
| `VITE_OKTA_ISSUER` / `VITE_OKTA_CLIENT_ID` | Vite, `.env.local` | No | none | Cosmetic only — gates the login button's visibility |
| `VITE_SWF_BACKEND_URL` | Vite, `.env.local` | No | `http://127.0.0.1:8787` | Frontend `ApiClient` base URL |
| `VITE_SWF_COMMUNITY_ID` | Vite, `.env.local` | No | none | Stopgap until a real community-switcher UI exists |
| `VITE_RELAY_URL` | Vite, `.env.local` | No | `ws://localhost:3000` | Old Nostr path only |

### Local dev stack — exact commands that worked this session

```sh
# 1. Docker Desktop must be running (doesn't auto-start on this machine) —
#    launch AppData\Local\Programs\DockerDesktop\Docker Desktop.exe if `docker ps` fails.

# 2. Bring up Postgres (shared with Old Buzz's own stack, but a SEPARATE database):
docker exec buzz-postgres psql -U buzz -d postgres -c "CREATE DATABASE swf_buzz;"  # one-time

# 3. Run the backend (auto-applies migrations on startup):
cd "swf buzz/backend"
export DATABASE_URL="postgres://buzz:buzz_dev@localhost:5432/swf_buzz"
export SWF_BUZZ_OKTA_ISSUER="https://trial-7050986.okta.com/oauth2/default"
export SWF_BUZZ_OKTA_CLIENT_ID="0oa17llt8buRrHSrX698"
cargo run

# 4. Run the full app (separate shell, same Okta vars PLUS the backend URL):
cd "swf buzz"
export SWF_BUZZ_OKTA_ISSUER="https://trial-7050986.okta.com/oauth2/default"
export SWF_BUZZ_OKTA_CLIENT_ID="0oa17llt8buRrHSrX698"
export SWF_BUZZ_BACKEND_URL="http://127.0.0.1:8787"
export VITE_OKTA_ISSUER="https://trial-7050986.okta.com/oauth2/default"
export VITE_OKTA_CLIENT_ID="0oa17llt8buRrHSrX698"
npm run tauri dev
```

Disk space note: this dev machine's `C:` drive has run to 0 bytes free from Rust build-artifact
growth alone during this project. `swf buzz/backend/target` and `swf buzz/src-tauri/target` are
both safe to `cargo clean` at any time (regenerable, not `../buzz`) if a build fails with `ENOSPC`
or a Windows `LNK1318 Unexpected PDB error`.

---

## 15. Security considerations

- **Bearer token storage**: OS keychain only (`keyring` crate via `secure_storage_*` Tauri
  commands), never localStorage/sessionStorage/a file. `ApiClient.ts` never logs the token.
- **Hashing at rest**: session tokens and invite tokens both use the identical convention —
  256-bit CSPRNG raw value, SHA-256 hashed for storage, raw value shown/returned exactly once.
- **Server-side-only authorization**: every `*_authz.rs` decision re-derives the caller's role from
  the database on every request; nothing trusts a client-supplied role, user id, or community/
  channel membership claim. Frontend permission checks (`permissions.ts`/`channelPermissionsHttp.ts`)
  are UX-only — hiding buttons, not a security boundary.
- **JWKS verification, twice, independently**: Rust verifies the Okta ID token before ever calling
  the backend; the backend independently re-verifies the same token via its own JWKS fetch before
  trusting it — a compromised or modified client binary cannot assert an unverified identity to the
  backend.
- **`sender_user_id`/`claiming_user_id` never trusted from a request body** — always derived from
  the authenticated session, enforced by the type system in several cases (the field simply isn't
  deserialized).
- **`/ws` token-in-query-string tradeoff**: documented, not hidden (§7). Same bearer secret as
  every other endpoint, one additional exposure surface (URL/access logs), not a new privilege.
- **Error responses never leak internals**: `ApiError::Database`/`Internal` are logged server-side
  (`tracing::error!`) and returned to the client as a generic `"internal error"` — matches this
  project's pre-existing error-sanitization discipline (see project memory).
- **Invite public-preview info-leak tradeoff**: accepted deliberately because tokens are
  high-entropy and unguessable — see §5.

---

## 16. Test matrix / verification status

| Layer | Automated tests | Real-Postgres verification | Real-Okta verification | Real-browser/webview verification |
|---|---|---|---|---|
| Backend (all 8 phases combined) | **86/86 pass** (`cargo test`), clippy/fmt clean | **Yes** — live smoke test this session: session, community, channel, message, invite, and DM flows all confirmed via raw HTTP against a real `swf_buzz` Postgres database | N/A (backend independently verifies Okta's ID token, doesn't perform the OIDC dance itself) | N/A |
| Realtime WebSocket fan-out | Proven by real `tokio_tungstenite` client tests against a real TCP-bound router (channel + DM variants) | Not Postgres-dependent — same code path as production | N/A | **No** — two-real-browser-session delivery never run |
| Postgres row-lock (invite claim, thread counters) | Concurrency *outcome* proven via `InMemoryRepo` + real concurrent HTTP requests | **No** — the specific `SELECT...FOR UPDATE` mechanism not isolated-tested against live Postgres locking | N/A | N/A |
| Frontend (F1-F4 combined) | **226/226 pass**, typecheck/lint/build clean | N/A (mocked at `ApiClient` boundary) | N/A | **No** — every new HTTP-backed view (`/community`, `/community-dm`, `/invite/:token`) has never rendered in a real webview |
| Okta OIDC flow (`src-tauri`) | 7 Rust unit tests (prior sessions) | N/A | **Yes — confirmed live this session**, first fully successful real Okta login in this project's history (PKCE, deep-link callback, HTTP 200 token exchange, JWKS verification all passed against `trial-7050986.okta.com`) | Partial — the login itself ran in the real native window; the post-login backend-session-bootstrap step's outcome with the corrected env var was still being confirmed as of this document |
| `src-tauri` (Rust/Tauri shell) | `cargo check`/`clippy --all-targets`/`fmt --check` clean | N/A | see above | Real native window launches and is interactive (confirmed) |

**Cumulative counts**: 86 backend + 226 frontend = **312 automated tests passing**, zero known
failing tests, zero known compile/lint/typecheck warnings as of this document.

---

## 17. Remaining gaps

Ranked roughly by what would surprise a new session most:

1. **The old Nostr/pubkey path has not been removed.** Not an oversight — deliberately deferred
   per D10's "build alongside, verify, delete old code only after everything migrates" sequencing.
   `features/{reactions,presence,moderation,platform-admin,agents}/*` and the original
   `ChannelsView.vue`/`DmView.vue` routes still depend on it entirely. Do not delete
   `signingService.*`/`authService.okta.ts`'s pubkey-resolution path, `RelayConnectionService.ts`,
   or any Nostr `protocol/*.ts` file without first migrating or explicitly descoping those five
   feature areas — see `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §2's file-by-file classification for
   what's safe to remove once that happens.
2. **`.env.example` is missing `SWF_BUZZ_BACKEND_URL`** — documented in §2/§14 above; without it,
   the backend session bootstrap silently no-ops and every new-backend feature is unavailable even
   though Okta login itself appears to succeed. Real bug hit live this session.
3. **No DM display-name lookup endpoint** — `GET /api/channels/:id/members` only returns
   `{user_id, role, joined_at}`; "start a DM" is currently a raw user-id input, not a picker (§9).
4. **No community-switcher UI** — `currentCommunity.ts`'s localStorage-cached resolver + first-run
   "create a community" fallback is a stopgap; the backend is multi-community-capable, the frontend
   isn't yet.
5. **Postgres row-lock claims not isolated-tested** — the concurrency *outcome* is proven, the
   specific `SELECT...FOR UPDATE` mechanism under real Postgres lock contention is not (§5, §16).
6. **Real two-browser-session realtime delivery has never run** — only single-process
   `tokio_tungstenite` client tests and mocked frontend tests.
7. **No real webview/UI click-through of any new-backend view** — `/community`, `/community-dm`,
   `/invite/:token` have never been visually confirmed rendering correctly in the actual Tauri
   window; only unit/build-level verification exists.
8. **The backend session bootstrap's outcome with the correct `SWF_BUZZ_BACKEND_URL` env var**
   was still being confirmed live as this document was being written — check project memory or
   re-run the app to confirm before assuming it's settled.
9. **Sibling gaps outside this migration's community/invite/channel/message/DM scope, flagged not
   silently carried forward**: platform-admin (Operator/Moderator plane, pubkey-based by old Buzz's
   own design) and moderation's NIP-98 HTTP-signing dependency are real "no NIP-98" violations
   under the same D10 rule, but were explicitly out of scope for Phases 2-8/F1-F4.

---

*Written 2026-09-17. If any claim in this document conflicts with what you find by reading current
source, trust the source and update this document — it is a snapshot, not a spec.*
