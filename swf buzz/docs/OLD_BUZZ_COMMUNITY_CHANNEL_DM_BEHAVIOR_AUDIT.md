# OLD BUZZ — Community, Channels, DM & User Behavior Audit

**Method**: every claim is labeled `[CODE]` (opened and read directly this pass, `file:line` cited), `[DOCS-EXISTING]` (consolidated from six prior source-verified audits already in this repo — cited by document name, not duplicated verbatim), `[INFERRED]` (a reasonable but not directly confirmed conclusion), or **`UNABLE TO VERIFY FROM SOURCE`** / **`NOT FOUND IN OLD BUZZ SOURCE`** (an explicit open question — never filled with generic chat-app assumptions). Old-Buzz repo root throughout: `C:\Users\Pranshul\Downloads\buzz2.0\buzz`, read-only. This document performs no implementation in either codebase.

---

## 1. Scope

Old Buzz's complete business logic for: communities, community roles, community member management, community invitations and invite-acceptance onboarding, channels, channel roles, channel member management, channel messaging, message threads/replies, direct messages, user profiles, the profile→DM flow, channel header/member UI, community UI (members/invites/moderation), the database/state model, the Nostr/HTTP protocol mechanics behind every one of these, and the authorization architecture — with UI visibility, frontend gating, backend/HTTP authorization, and relay/protocol authorization kept explicitly distinct throughout. Section 27 is the only section that discusses the current SWF Buzz repository; sections 1–26 are old Buzz alone.

## 2. Source of Truth

Primary: direct reading of `../buzz` source this pass (see §31 for the full file index). Consolidated without duplication from six prior source-verified audits already in this repository:

- `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` (394 lines) — sections A–K: roles, community/channel creation, invites, add-to-channel, membership, DMs, channel conversations, UI map, responsive behavior, API/DB. This document's own §4–§7, §10–§13, §18, §21 lean heavily on its sections A/C/D/E/F/K, which this pass spot-checked and extended rather than re-deriving.
- `docs/ROLE_PERMISSION_AUDIT.md` (529 lines) — the 56-row master capability table this document's §4 matrix is built from.
- `docs/ROLE_PERMISSION_MATRIX.md`, `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md`, `docs/ADMIN_PANEL_REVERSE_ENGINEERING_REPORT.md` — role hierarchy, 12-stage lifecycle, admin/moderation state machine.
- `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` — SWF Buzz's own verified Nostr kind registry, used in §27 to cross-check protocol-parity claims rather than re-deriving kind numbers.

**New research this pass** (not covered, or not covered in this depth, by the six existing documents): the exact NIP-10 nested-thread mechanism and its depth/descendant-count model (§14), the exact `POST /api/invites` / `/api/invites/claim` request/response contracts (§8), the precise reconciliation of why kind:9009 is dead code in the current relay source (§8, §22), and the real user-profile/DM-navigation component chain (§16–§17).

## 3. Old Buzz Architecture

`[DOCS-EXISTING + CODE]`. Desktop client: React/TypeScript (Tauri-hosted; `desktop/src/`). Backend: `buzz-relay` (Rust/Axum, `crates/buzz-relay/`), a Nostr relay extended with a private HTTP API plane (`/api/*`, `/moderation/*`, `/operator/*`) for operations that don't fit the event-publish model (invites, moderation reads, provisioning). Database: Postgres via `sqlx` (`crates/buzz-db/`). A separate `admin-web` browser console and a separate `mobile/` client directory exist outside the scope of this audit (per `docs/ADMIN_PANEL_REVERSE_ENGINEERING_REPORT.md` and `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §J respectively) — not opened this pass.

Identity is a raw secp256k1 keypair (Nostr), never Okta or any external IdP — old Buzz has no OIDC integration anywhere; this is a SWF Buzz-only addition (§27 note). Every mutating community/channel action is a signed Nostr event over a relay WebSocket, authorized by `crates/buzz-relay/src/handlers/ingest.rs`'s scope-resolution gate (§22/§23) before any handler ever runs. Invites are the one deliberate exception: real HTTP endpoints, NIP-98-signed (a signed kind:27235 event carried as a header, proving key control for a single HTTP request without publishing anything) rather than a data-plane event.

## 4. Roles & Permission Matrix

`[DOCS-EXISTING]`, full detail in `docs/ROLE_PERMISSION_AUDIT.md` §2–§10/§20 and `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §A. Old Buzz has **no single "Super Admin."** Three independent role planes exist:

| Role | Plane | Storage | Assigned by |
|---|---|---|---|
| Operator | Platform-wide | `RELAY_OPERATOR_PUBKEYS` config, or `relay_operators` row | Config edit, or an existing Operator |
| Moderator | Platform-wide | `relay_operators` row only | An Operator |
| owner (community) | Per-community | `relay_members.role`, PK `(community_id, pubkey)` | Provisioning bootstrap, or ownership transfer |
| admin (community) | Per-community | `relay_members.role` | Owner only, kind:9032 |
| member (community) | Per-community | `relay_members.role` | Owner/admin (kind:9030), or invite claim (role hard-pinned `member`) |
| Owner/Admin/Member/Guest (channel) | Per-channel, separate lattice | `channel_members.role` enum | Channel creation (owner), or an elevated channel member's grant |
| Bot (channel) | Per-channel, non-hierarchical | `channel_members.role='bot'` | Any member, subject to `channel_add_policy` |

**Community permission matrix** `[DOCS-EXISTING, cross-checked against `moderation_authz.rs:146-181`/`relay_admin.rs:313-441` this pass]`:

| Permission | Member | Admin | Owner |
|---|---|---|---|
| View channels/messages, send message, submit report | YES | YES | YES |
| View moderation queue | NO | YES | YES |
| Add community member | NO | member-role only | YES |
| Remove community member | NO | member-role targets only | admin/member, never another owner |
| Change community member role | NO | NO | YES (never to `owner`) |
| Ban/timeout | NO | not against owner/admin | YES |
| **Create channel** | **YES — not role-gated** | YES | YES |
| Create community invite | NO | YES | YES |
| Transfer community ownership | NO | NO | via operator endpoint |

**Channel permission matrix** — `[CODE]`, from `crates/buzz-relay/src/handlers/channel_authz.rs` (pure, exhaustively unit-tested; every rule below is directly reflected in that file's own test tables):

| Permission | Non-member (open ch.) | Non-member (private ch.) | Member/Guest/Bot | Admin/Owner |
|---|---|---|---|---|
| Self-add (kind:9021/self kind:9000) | YES | **NO** — `ActorNotAuthorized`, even for self | YES (idempotent) | YES |
| Add another user at plain role | YES (`decide_put_user`, `channel_authz.rs:119-133`) | NO | YES | YES |
| Grant an elevated role (admin/owner) to someone | NO — `ElevatedRoleGrantDenied` | NO | NO — `ElevatedRoleGrantDenied` | **YES — owner or admin, not owner-only** (`channel_authz.rs:128-132`) |
| Change an existing active member's role | NO — `RoleChangeDenied` | NO | NO — `RoleChangeDenied` | YES |
| Remove another member | — | — | only an agent they own (`CheckAgentOwner`) | YES, any target (`classify_remove_other`, `channel_authz.rs:210-215`) |
| Remove self (leave) | NO if not a member (`NotActiveMember`) | — | YES, unless sole owner | YES, unless sole owner |
| Demote/remove the channel's only owner | — | — | — | Blocked — `LastOwnerDemotion`/`LastOwnerRemoval*` |

Notable finding, unchanged from `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md`'s §A "new finding" but reconfirmed by direct read this pass: **channel creation itself carries no role gate at all** — `KIND_NIP29_CREATE_GROUP` (kind:9007) requires only `Scope::ChannelsWrite` (`ingest.rs:518`), which every NIP-42-authenticated connection holds regardless of community role. Only channel *management* (edit/archive/delete) and *membership* (§ above) are role-gated, and by the *channel's own* role, not the community's.

**What each role cannot do**: Member cannot manage anyone or moderate. Admin cannot touch the community owner or a fellow admin (ban/timeout/remove/demote), cannot change any role. Owner cannot act outside their own community and cannot be removed except via transfer. A channel admin (community-role notwithstanding) *can* grant channel-owner to someone else in that specific channel — the channel-role plane is, in this one respect, **more permissive** than the community-role plane, where only the owner may grant admin.

## 5. Community Lifecycle

`[CODE, cross-checked against docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md §B]`. **Old Buzz has no end-user "Create Community" UI.** The only community-creation-shaped control, `"+ Add community"` in `CommunityRail.tsx:418-428` → `EditCommunityDialog.tsx:20-92`, is a purely local client-side "connect to an existing relay by URL" action — its submit handler builds a local config object and calls `onSave`; no server round-trip of any kind. Real provisioning happens exclusively via `POST /operator/communities` (`operator.rs:153`), gated by `RELAY_OPERATOR_PUBKEYS` config checked directly (**not** a `relay_members` lookup — `community_provisioning.rs:5-11` states this is deliberate). No frontend in the repository calls this endpoint (confirmed by `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §6's grep). In practice this is an out-of-band operations action.

What happens on provisioning: one `communities` row (`id, host, created_at, deletion_state='active'`), one `relay_members` row for the specified owner pubkey with `role='owner'`. **No default channels, no default permissions beyond that single row** — no seed-channel logic was found in `operator.rs` or `community_provisioning.rs`. `UNABLE TO VERIFY FROM SOURCE` beyond this — the exact provisioning SQL wasn't traced statement-by-statement.

Owner-community cap: `MAX_COMMUNITIES_PER_OWNER = 5` — `[CODE]` `crates/buzz-db/src/store/relay_members.rs:456`, overridable via `BUZZ_MAX_COMMUNITIES_PER_OWNER`.

## 6. Community Roles

`[DOCS-EXISTING]`, `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §F, `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §3–§4. Owner is bootstrapped at provisioning or via transfer — never through the normal add-member path: kind:9030 explicitly refuses `role="owner"`, and kind:9032 refuses it too (`relay_admin.rs:436-441`, exact message *"cannot set role to owner"*). Promotion/demotion (member↔admin) is owner-only, kind:9032. `transfer_ownership()` demotes the outgoing owner to `member`, **not** `admin` — *"the former owner retains no management capabilities"* (`relay_members.rs:509-511`). Owner deletion protection is structural: the DB delete path is `DELETE ... WHERE role <> 'owner'`, so an owner row can never be reached by the remove path at all — a stronger guarantee than a runtime "last owner" counter check. **Leaving a community** (as opposed to leaving a *channel*, well-documented via kind:9022) — **`NOT FOUND IN OLD BUZZ SOURCE`** in any of the six existing audits or this pass; flagged as a genuinely open question, not assumed absent.

## 7. Community Member Management

`[DOCS-EXISTING]`, `docs/ROLE_PERMISSION_AUDIT.md` §4/§13, `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §2 Stage 4–5. UI: `AddMemberDialog.tsx` (add existing user directly via kind:9030, or mint an invite, depending on active tab); the role selector filters "admin" out unless the actor is the owner (`AddMemberDialog.tsx:129-132`). Server-side authorization: `relay_admin.rs:313-441` — admin may only grant/remove `member`-role targets; owner may grant/remove admin or member but never touch another owner; role changes are owner-only and can never target or produce `role="owner"`. These are the **actual enforcement point** — the dialog's role-selector filtering is a frontend convenience mirroring, not substituting for, this server-side check.

## 8. Invitation Lifecycle

**This is the single most consequential section in this document for SWF Buzz.** `[CODE]`, freshly traced this pass at the exact request/response level — not re-derived from the existing docs' summary.

### Mint — `POST /api/invites`
Source: `crates/buzz-relay/src/api/invites.rs:284-353`, function `mint_invite`.
- **Auth**: NIP-98 signed (`authenticate()`, line 289 — verifies a kind:27235 event covering the URL+method+body as an HTTP header, per `crates/buzz-core`'s NIP-98 implementation), *not* a WebSocket/relay-membership check.
- **Authorization**: `role != "owner" && role != "admin"` → `403 Forbidden`, *"only relay owners and admins can create invites"* (lines 292-304) — looked up fresh from `relay_members` on every request, not cached.
- **Request body** (`MintInviteRequest`, lines 49-61): `{ ttl_secs?: number, max_uses?: number }`. `ttl_secs` defaults to `DEFAULT_INVITE_TTL_SECS = 72*60*60` (72h) and must fall within `[MIN_INVITE_TTL_SECS=60, MAX_INVITE_TTL_SECS=30*24*60*60]` (1 minute to 30 days) or `400 Bad Request`. `max_uses`, if present, must be `1..=MAX_INVITE_USES` (10,000) or `400`; omitted/`null` means unlimited uses.
- **Response** (line 346-352): `{ code, expires_at: <unix seconds>, max_uses, uses_remaining, url: "<scheme>://<tenant-host>/invite/<code>" }`. Scheme is `https` for a `wss://` relay deployment, `http` otherwise (line 328-332).
- **Storage**: a v2 opaque, database-backed invite — `state.db.mint_relay_invite(...)` (line 320-324); only the invite's hash is stored server-side (per `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §D, unchanged), the plaintext code is returned exactly once.

### Claim — `POST /api/invites/claim`
Source: `crates/buzz-relay/src/api/invites.rs:361-469+`, function `claim_invite`.
- **Auth**: NIP-98 signed by the *joining* pubkey. **Deliberately exempt from the relay-membership gate** (doc comment, lines 7-10) — the whole point is the caller isn't a member yet.
- **Rate limit**: 10 attempts / 60s per pubkey (`CLAIM_RATE_LIMIT`/`CLAIM_RATE_WINDOW`, lines 39-42), capped to 10,000 distinct tracked pubkeys (`CLAIM_RATE_CACHE_CAPACITY`) — bounds brute-force probing, not normal use (claims are idempotent; a real user performs exactly one).
- **Request body** (`ClaimInviteRequest`, lines 90-97): `{ code: string, policy_receipt?: string }`. `policy_receipt` is required and separately verified (`invite_token::verify_policy_acceptance`) only when the deployment has a configured join policy (`state.config.join_policy`) — otherwise unused.
- **Two code formats, routed by prefix** (`V2_PREFIX = "v2."`, `buzz-core/src/invite.rs:24`): a `v2.`-prefixed code uses the durable DB-backed path (`claim_relay_invite`); anything else falls to a stateless v1 HMAC-verified token (`invite_token::verify_invite`) — **no fallback from v2 to v1** for a malformed v2 code (`validate_v2_code` failure → `403 invite_invalid` directly, line 385-387).
- **v2 outcomes** (`ClaimOutcome`, lines 416-456), each a distinct JSON shape:
  - `Joined` → `{ status: "joined", community_id, host, role: "member" }`, plus two side effects: `publish_nip43_member_added` and `publish_nip43_membership_list` (so every connected client's membership-list subscription sees the new member without polling).
  - `AlreadyMember` → `{ status: "already_member", community_id, host, role: "member" }` — **idempotent no-op**, no error, no duplicate.
  - `Expired` → `403 invite_expired`.
  - `Exhausted` → `403 invite_exhausted` (max-uses reached).
  - `Invalid` → `403 invite_invalid`.
- **Role on acceptance**: hard-pinned to `member` at both the API-response level (above) and, per `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §D, at the schema CHECK-constraint level (`migrations/0025_relay_invites.sql:20`) — **an invite can never grant `admin` or `owner`, regardless of who minted it.**
- **Revocation**: `[DOCS-EXISTING, marked UNVERIFIED there, unchanged this pass]` — an owner/admin-only revoke endpoint plausibly exists given the invite-management UI pattern, but was not located in `invites.rs` (only mint/claim/accept-policy handlers are defined there) or independently confirmed this pass. **`UNABLE TO VERIFY FROM SOURCE`.**

### Reconciling against SWF Buzz's kind:9009 (see §22 for the full trace)
Old Buzz's real invite mechanism is **entirely HTTP**, never a Nostr event. `KIND_NIP29_CREATE_INVITE = 9009` exists as a named constant (`buzz-core/src/kind.rs:347`) and a literal `9009 =>` match arm still exists in `side_effects.rs:211-214` logging *"NIP-29 kind 9009 handler deferred to future phase"* — but this handler is **unreachable dead code** in the current relay source: the earlier ingest-time authorization gate, `required_scope_for_kind` (`ingest.rs:437-545`), has no match arm for kind 9009 anywhere, so any kind:9009 event falls through to the wildcard `_ => Err("restricted: unknown event kind")` at line 545 and is rejected *before* it could ever reach the side-effect dispatcher where the no-op stub lives. This is not a version-mismatch or stale-relay-binary artifact — both pieces of evidence live in the same source tree and are mutually consistent: a leftover no-op stub, made permanently unreachable by an authorization gate that was never extended to recognize this kind.

## 9. Invite Acceptance & Onboarding

`[CODE + INFERRED synthesis]`. The full traced sequence:

```
Owner/Admin (already a community member)
  │  POST /api/invites  (NIP-98 signed)
  ▼
Relay mints a v2 code, returns { code, url, expires_at, max_uses, uses_remaining }
  │  owner/admin shares the returned `url` (or bare code) out-of-band —
  │  NO email/SMTP integration exists anywhere in old Buzz (confirmed,
  │  `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §D)
  ▼
New user obtains the code/URL somehow (mechanism outside the product —
  Slack/email/chat, whatever the sharer used)
  │
  ▼
New user authenticates to the relay AS THEMSELVES — a raw Nostr keypair,
  no OIDC — UNABLE TO VERIFY FROM SOURCE exactly which UI screen in the
  desktop app accepts a pasted invite code/URL and triggers the claim;
  not opened this pass (candidate: the same onboarding flow referenced by
  `desktop/src/features/onboarding/ui/ProfileStep.tsx`, seen during file
  search but not independently read)
  │
  ▼
POST /api/invites/claim (NIP-98 signed by the NEW user's own pubkey)
  │
  ├─ already a member? → { status: "already_member" } — no-op, no error
  ├─ expired? → 403 invite_expired
  ├─ exhausted? → 403 invite_exhausted
  ├─ invalid? → 403 invite_invalid
  └─ success → relay_members row inserted (role='member', hard-pinned)
       │
       ├─ publish_nip43_member_added (delta)
       └─ publish_nip43_membership_list (full snapshot)
              │
              ▼
       Every connected client's membership-list subscription (including
       the new member's own) observes the updated roster — this is how
       the client learns of its own new membership; there is no
       dedicated "GET my membership" REST endpoint
              │
              ▼
       New member sees community-scoped channels: OPEN channels are
       joinable via kind:9021 self-service; PRIVATE channels still
       require a separate channel-level add (kind:9000) by a channel
       owner/admin — community membership alone does not grant private-
       channel access (§4's channel-vs-community role distinction)
```

**Approval requirement**: none beyond the owner/admin having minted the invite in the first place — claiming is unconditional (subject to expiry/exhaustion/validity) once a valid code is presented; there is no separate "pending approval" state. **First screen shown after successful claim**: `UNABLE TO VERIFY FROM SOURCE` — not traced to a specific route/component this pass.

## 10. Channel Lifecycle

`[DOCS-EXISTING, reconfirmed]`, `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §C.

```
AppSidebar.tsx "+" (handleOpenCreateChannel, line 490-496)
  ↓
CreateChannelDialog.tsx → CreateChannelFormFields.tsx
  fields: name, description (optional), visibility (open/private),
  ttlSeconds (optional), templateId (optional)
  ↓
kind:9007 (KIND_NIP29_CREATE_GROUP) signed & published
  tags: name, visibility, channel_type (defaults "stream" server-side if
  omitted, side_effects.rs:1776-1778), about, optional client-generated
  h-tag UUID (relay prefers this over auto-generating, keeping optimistic
  UI and server state on the same id, side_effects.rs:1792-1809)
  ↓
Relay: handle_create_group (side_effects.rs:1769-1830)
  → channels row: community_id, name, channel_type, visibility,
    description, created_by, ttl
  ↓
[INFERRED, not re-traced to the exact line this pass] creator very likely
  auto-added to channel_members as Owner — every other codebase
  "create X" pattern does this, and channel_authz's own sole-owner-immune
  invariant only makes sense if creation always yields exactly one owner
  ↓
Realtime fan-out; optimistic client UI reconciles via the shared h-tag id
  ↓
New channel appears in AppSidebar's channel list, selectable immediately
```

No community-role gate (§4). Open channels: self-join via kind:9021, unconditional `add_member(role=Member)` (`side_effects.rs:1950-2027`). Private channels: no self-service — an existing channel owner/admin must add you (kind:9000, gated by `channel_authz.rs`). Editing/archiving/deleting is **channel-role**-gated, not community-role-gated: owner can delete/archive/edit everything, admin can edit/archive but not delete (`ChannelManagementModerationActions.tsx:52-95`, `docs/ROLE_PERMISSION_AUDIT.md` §20 rows 36-38).

## 11. Channel Roles

See §4's channel permission matrix, sourced directly from `channel_authz.rs`. The five roles are `owner | admin | member | guest | bot` (`buzz_db::channel::MemberRole`, confirmed by the roster literals in `channel_authz.rs`'s own test module). Guest and bot are non-hierarchical — neither can manage other members; a bot's removal-by-a-plain-member path is gated by a separate `channel_add_policy` (`anyone | owner_only | nobody`, evaluated in `decide_channel_add_policy`, `channel_authz.rs:178-193`) tied to that specific agent's configured owner, not the channel's own role lattice.

## 12. Channel Member Management

`[CODE]`, `channel_authz.rs` + `side_effects.rs::handle_put_user`/`handle_remove_user` (lines 1292-1367+, per this session's earlier direct read — file/function confirmed, exact current line numbers for the two handler bodies not re-verified against a fresh checkout this pass, treat as approximate).

- **Add / change role** (kind:9000, `KIND_NIP29_PUT_USER`): open channel — any authenticated user, even non-members, may add someone at a plain role; private channel — actor must already be an active member, **even to add themselves** (`ActorNotAuthorized` otherwise — a non-member cannot self-bootstrap into a private channel this way). Granting an elevated role (admin/owner) requires the actor already be elevated (owner **or** admin — channel admins can grant channel-ownership, a real asymmetry vs. the community-role plane, §4). Changing an *already-active* member's role is privileged in both directions on every visibility. Last-owner demotion is blocked.
- **Remove** (kind:9001, `KIND_NIP29_REMOVE_USER`): owner/admin may remove any target; a plain member/guest/bot may only remove an agent (bot) they personally own — checked via a separate DB read (`CheckAgentOwner`); a non-member is denied outright, without even that check. Self-removal (leave) is always allowed unless the actor is the channel's sole owner.
- **Duplicate handling**: re-adding an existing member at the *same* role is explicitly idempotent (`Ok(Allow)` short-circuit in `decide_put_user` for the equal-role case — confirmed in `channel_authz.rs`'s own test table, e.g. `("open", [(1,"owner"),(2,"bot")], 9, None, 2, Some(Bot), Ok(CheckAddPolicy))` and the owner-to-owner idempotent case).
- **Realtime/UI update**: `[DOCS-EXISTING, marked UNVERIFIED]` — a membership-list snapshot republish analogous to the community-level `KIND_NIP43_MEMBERSHIP_LIST` was not independently confirmed for the channel-level path.

## 13. Channel Messaging

`[DOCS-EXISTING]`, `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` Stage 7 — the 11-step ingest gate order: write-fence → kind allowlist (§22) → signature → timestamp drift ≤15min → content size ≤256KiB → pubkey match → scope check → ban/timeout write-block → h-tag required → token channel-scope check → channel membership check. Not independently re-verified line-by-line this pass; this document's new contribution is §14 (threads) which sits directly on top of this same ingest path.

## 14. Message Threads / Replies

**New research this pass** — none of the six existing documents cover this; old Buzz supports genuine nested threading, materially richer than a flat reply model. `[CODE]`, `crates/buzz-db/src/store/thread.rs` + `crates/buzz-relay/src/handlers/ingest.rs:815-1100` + `crates/buzz-core/src/nip10.rs`.

### Wire format — standard NIP-10 e-tag markers
`parse_thread_markers` (`nip10.rs:57-80`) reads `["e", <64-hex-event-id>, <relay-hint>, "root"|"reply"]` tags. `ThreadMarkers::resolve()` (`nip10.rs:38-44`) collapses them to a `(root_id, parent_id)` pair: `root`+`reply` present → `(root, reply)` (a nested reply naming both); `reply` only → `(reply, reply)` (a direct reply to the root, using the shared shorthand); neither, or `root` only (malformed) → `None` (not a reply at all — this is exactly how the relay distinguishes a top-level message from a reply). **This tag format is identical to SWF Buzz's own** (see §27) — the wire-level reply-tagging convention is genuine, confirmed protocol parity.

### Server-side ancestry resolution and real nesting
`resolve_nip10_thread_meta` (`ingest.rs:816-921`) is called on every incoming message that carries reply markers:
1. Looks up the parent event and its own `thread_metadata` row (if any) concurrently (`tokio::join!`, line 832-839).
2. **Same-channel invariant**: rejects with `"parent event belongs to a different channel"` if the parent's channel doesn't match the reply's (lines 845-851).
3. If the parent already has thread metadata, the reply's depth is `parent.depth + 1`, capped at a **hard depth limit of 100** (`"thread depth limit exceeded"`, lines 879-882) — this is real, server-enforced nested threading, not a flat one-level model.
4. If the parent has *no* existing thread metadata (first reply to a previously-unreplied message, or a legacy/not-yet-indexed parent), `derive_ancestry_from_parent_tags` (`ingest.rs:936+`) recovers the correct root by recursively resolving the *parent's own* markers.
5. The client-supplied `root` tag is cross-checked against the server-computed root and rejected (`"root tag does not match thread ancestry"`) if they disagree — the server is authoritative, not the client.

### Persistence & aggregation (`thread.rs`)
Each reply gets a `thread_metadata` row: `event_id, parent_event_id, root_event_id, channel_id, depth, reply_count, descendant_count, last_reply_at, broadcast`. `insert_thread_metadata` (lines 138-261) atomically increments the *parent's* `reply_count` (direct children only) and the *root's* `descendant_count` (all descendants at every depth) in one transaction — these are genuinely different numbers or a two-level-deep reply would double-count. A `broadcast` flag (set via a literal `["broadcast","1"]` tag, `ingest.rs:902-905`) marks a reply that should *also* appear in the main channel timeline, not just the thread panel — `get_channel_window` (lines 622-835) includes depth-0 rows plus depth-1 rows where `broadcast=true`, everything else is thread-only.

### Reading a thread
`get_thread_replies` (lines 369-538) — cursor-paginated (`(event_created_at, event_id)` composite keyset, tie-broken by event id since bursty threads routinely share a `created_at` second — a real bug this exact keyset was built to fix, per the module's own doc comment), optionally depth-limited. `get_thread_summary` (lines 541-608) returns `{reply_count, descendant_count, last_reply_at, participants (up to 10 pubkeys)}` for a single root — this is the aggregate SWF Buzz's own kind:39005 already mirrors (§27).

### UI
`[INFERRED from file names found this pass, not independently opened]`: `desktop/src/features/channels/ui/ThreadPanelSurface.tsx` and `FocusThreadDrawer.tsx` are the rendering surfaces; `threadBadgeCounts.ts`, `threadReplyUnreadCounts.ts`, `threadViewModePreference.ts` (all with accompanying `.test.mjs` files, suggesting real, tested logic, not scaffolding) imply a genuine reply-count badge and a persisted view-mode preference exist. **Whether the UI actually renders visual nesting by depth (a real indent-per-level tree) or flattens all replies under a root regardless of depth is `UNABLE TO VERIFY FROM SOURCE`** — these files' *rendering* logic was not opened this pass, only their existence and naming confirmed. This is the one open question that most directly matters for §27's comparison against SWF Buzz's own deliberately-flat thread UI.

## 15. Direct Messages

`[DOCS-EXISTING]`, `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §G, reconfirmed. A DM is `ChannelType::Dm` (`buzz-core/src/channel.rs:59-95`) — one of four channel types (`Stream`, `Forum`, `Dm`, `Workflow`), not a separate table or protocol family. Creation flow: `NewMessageScreen.tsx` → `useNewMessageRecipients()` (searches the current community's own user directory, supports multi-select → group DMs are supported, not just 1:1; `hasReachedRecipientLimit` implies a cap, exact number `UNABLE TO VERIFY FROM SOURCE`) → `usePrepareDmSendChannel()` resolves an existing DM with the exact participant set, or calls `useOpenDmMutation()` → `invoke("open_dm", {pubkeys})` (Tauri command; signing happens Rust-side, the raw key never reaches the JS webview, per the codebase's universal signing pattern) → idempotent (same participant set twice returns the same channel). Message storage/ordering: `[INFERRED]` same `KIND_STREAM_MESSAGE` substrate as channel messages, scoped by the DM channel's own `h`-tag — no separate DM message kind found anywhere. A DM can be explicitly hidden (`hiddenDmResurfaceAction.ts`/`hiddenDmInboxAction.ts`) and later resurfaced — a DM-specific affordance with no channel equivalent, exact trigger `UNABLE TO VERIFY FROM SOURCE`. Old Buzz exposes DMs through **two** surfaces — an inline `AppSidebar` section and a separate `HomeView`/`Inbox` master-detail screen (`features/home/`) — their exact relationship (duplicate view of the same list vs. genuinely different scope) is `UNABLE TO VERIFY FROM SOURCE`.

## 16. User Profiles

**New research this pass.** `[CODE]`, `desktop/src/features/profile/ui/`. The profile is a rich panel (`UserProfilePanel.tsx` + `UserProfilePanelSections.tsx`/`Fields.tsx`/`Tabs.tsx`/`Frame.tsx`), not a minimal card. Primary actions (`UserProfilePrimaryActions.tsx:25-157`): **Message**, **Huddle**, **Wave**, plus an agent-specific primary action (start/restart) and a feature-flagged **Follow/Unfollow** (gated behind a `"pulse"` feature flag, `useFeatureEnabled("pulse")` — not universally available). Each action button shows its own loading state (`messagePending`, `huddlePending`, `wavePending`) independently.

**Gating logic** (`useProfileInteractionActions.ts:101-106`) — **this is frontend UX gating, not the security boundary** (consistent with this document's discipline of never conflating the two):
```
canInteract = enabled && !isSelf && effectivePubkey !== null
canWave     = canInteract && (availability?.wave ?? !isBot)
canMessage  = canInteract && (availability?.message ?? (!isBot || viewerIsOwner === true))
canHuddle   = canInteract && (availability?.huddle ?? canMessage)
```
An `availability` object can override each default per-target (`[INFERRED]` likely reflects that target's own configured preferences); absent that, a bot can only be messaged by its owner unless the viewer holds ownership of the community/channel. **The actual DM-open authorization enforcement point was not independently re-verified this pass** — `open_dm`'s own server-side check (if any beyond "any authenticated pubkey may open a DM with any other known pubkey") is `UNABLE TO VERIFY FROM SOURCE`.

Profile data itself: `[INFERRED from component/file names, not independently opened]` avatar (`ProfileAvatar.tsx`, editable via `ProfileAvatarEditor.tsx`), display name, and metadata come from the standard Nostr `kind:0` profile-metadata convention (per this codebase's universal pattern elsewhere) — not independently re-traced to a specific parse function this pass.

## 17. Profile → DM Flow

`[CODE]`, `useProfileInteractionActions.ts:150-162`, function `handleMessage`:
```js
handleMessage = () => {
  if (!canMessage) return;
  runAction("message", async (targetPubkey) => {
    const dm = await openDm({ pubkeys: [targetPubkey] });   // useOpenDmMutation → invoke("open_dm", ...)
    await goChannel(dm.id);                                  // useAppNavigation — navigates into the DM channel
    onClose();                                                // closes the profile panel/popover
  });
};
```
This is the exact, complete navigation chain: click **Message** → (if `canMessage`) → open-or-reuse the DM channel for that one pubkey → navigate to it → close the profile UI. Errors surface as a toast (*"Couldn't open the direct message."*, `runAction`'s catch block, lines 116-148) rather than a silent failure or a thrown exception reaching the UI tree.

## 18. Channel Header & UI Behavior

`[DOCS-EXISTING]`, `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §I. `ChannelPane.tsx` (`features/channels/ui/`) renders the header + message list + composer for a selected channel — `[INFERRED from file name, not independently opened this pass]` exact header element composition (title, member count, three-dot menu placement) was not re-traced to specific JSX this pass; the existing audit's UI map is the authority here and was not contradicted by anything found this pass. `MembersSidebar.tsx:438-493` is the channel-scoped member-management surface (role change/removal); `ChannelManagementModerationActions.tsx:52-95` is the edit/archive/delete surface, gated by channel role (§11).

## 19. Channel Settings

Covered by §10 (lifecycle)/§11 (roles)/§18 (UI location) above — old Buzz does not appear to have a dedicated "Channel Settings modal" distinct from `ChannelManagementModerationActions.tsx`'s edit/archive/delete controls, per the existing audit's file inventory. `UNABLE TO VERIFY FROM SOURCE` whether a richer settings surface (visibility toggle, TTL change, template) exists beyond channel creation and the moderation-actions component — not independently opened this pass.

## 20. Community UI Behavior

`[DOCS-EXISTING]`, `docs/OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` §I, `docs/ROLE_PERMISSION_AUDIT.md` §12. `CommunityMembersSettingsCard.tsx` (member list + management) and `ModerationQueueCard.tsx` (reports + audit tabs) are both gated `owner|admin` — **who can see them**: only owner/admin, enforced client-side by a role check at the component level; **who can use the actions inside them**: server-side, the same `relay_admin.rs`/`moderation_authz.rs` checks as §7/§4. `AddMemberDialog.tsx` is the invite/add surface (§7/§8). No dedicated "Invites" tab distinct from `AddMemberDialog`'s own mode toggle was found — inviting and directly-adding share one dialog, not two separate UI surfaces.

## 21. Database / State Model

`[DOCS-EXISTING]`, `docs/ROLE_PERMISSION_AUDIT.md` §13-§14, `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §10. Extended this pass with the thread model (§14):

```
communities (root tenant)
 ├─ FK → channels
 │        └─ FK → channel_members       [role: owner/admin/member/guest/bot — SEPARATE lattice]
 │        └─ FK → thread_metadata       [event_id, parent_event_id, root_event_id, depth,
 │                                       reply_count, descendant_count, last_reply_at, broadcast]
 ├─ FK → relay_members                  [role: owner/admin/member]
 ├─ FK → relay_invites                  [role hard-pinned to 'member'; v2 opaque, hash-only storage]
 ├─ FK → users                          [profile only — NOT an authz hub]
 └─ FK → moderation_reports, community_bans, moderation_actions

relay_operators                         [platform-wide — NO community_id column, deliberately]
 └─ (no FK to anything — deployment-global roster)
```

**Critical, load-bearing finding, preserved from the existing audit**: there is **no unified `users` foreign-key hub** — `users.pubkey` (BYTEA), `relay_members.pubkey` (TEXT/hex), and `relay_operators.pubkey` (BYTEA, deployment-global) are three disjoint identity surfaces with zero referential integrity between them; every join happens at the query level. Relevant to SWF Buzz's own Okta↔Nostr identity question — old Buzz's own architecture already tolerates loosely-coupled identity, precedent for treating `users.okta_user_id` (confirmed present in the shared live schema) as a similarly loose link, never an authorization input.

## 22. Nostr / HTTP Protocol Flow

| Feature | Mechanism | Kind/Endpoint | Signer | Authorization | Storage |
|---|---|---|---|---|---|
| Community provisioning | HTTP | `POST /operator/communities` | Operator | `RELAY_OPERATOR_PUBKEYS` config, direct | `communities` + `relay_members` (owner) |
| Community add/remove/role-change | Nostr event | kind:9030/9031/9032 | member/admin/owner pubkey | `relay_admin.rs:313-441` | `relay_members` |
| **Community invite mint** | **HTTP** (NIP-98 signed) | **`POST /api/invites`** | owner/admin pubkey | role lookup, fresh per request | `relay_invites` |
| **Community invite claim** | **HTTP** (NIP-98 signed) | **`POST /api/invites/claim`** | joining pubkey | code validity/expiry/exhaustion, exempt from membership gate | `relay_members` (insert) |
| Channel creation | Nostr event | kind:9007 | any authenticated pubkey | `Scope::ChannelsWrite`, ungated by role | `channels` |
| Channel add/change-role | Nostr event | kind:9000 | varies (§4/§12) | `channel_authz::decide_put_user` | `channel_members` |
| Channel remove | Nostr event | kind:9001 | varies (§4/§12) | `channel_authz::classify_remove_other` | `channel_members` |
| Channel self-join/leave | Nostr event | kind:9021/9022 | self | open-visibility only (join); always (leave, unless sole owner) | `channel_members` |
| Message | Nostr event | kind:9 (`KIND_STREAM_MESSAGE`) | channel member | 11-step ingest gate (§13) | `events`, partitioned |
| Reply/thread | Nostr event | kind:9, with NIP-10 `e`-tag markers | channel member | same as message + ancestry validation (§14) | `events` + `thread_metadata` |
| DM open | Tauri command → Nostr event | `invoke("open_dm")`, exact kind `[INFERRED]` reuses kind:9007 with `channel_type=dm` | either participant | `[UNABLE TO VERIFY FROM SOURCE]` | `channels` (type=dm) |
| DM message | Nostr event | `[INFERRED]` kind:9, same as channel messages | DM participant | channel membership check (implicit: DM participant list) | `events` |
| Report | Nostr event | kind:1984 (NIP-56) | any member | none (ungated) | `moderation_reports` |
| Ban/unban/timeout/untimeout/resolve | Nostr event | kind:9040-9044 | owner/admin | `moderation_authz.rs:146-181` | `community_bans`, `moderation_actions` |
| **Invite (Nostr event, DEAD CODE)** | Nostr event | **kind:9009 (`KIND_NIP29_CREATE_INVITE`)** | n/a | **rejected at `ingest.rs:545` before any handler runs — see §8** | never reached |

## 23. Authorization Architecture

```
User action (click a button)
       ↓
Frontend UI visibility check           e.g. AddMemberDialog hides "admin" from
       ↓                                the role picker unless actor is owner —
       │                                COSMETIC, not enforcement
Frontend action-gating                 e.g. canMessage/canWave/canHuddle in
       ↓                                useProfileInteractionActions — decides
       │                                whether the button is even clickable
Signed request                         Nostr event (WebSocket) OR NIP-98-signed
       ↓                                HTTP request — proves KEY CONTROL only,
       │                                not permission
Authentication                         Signature verification (event) or NIP-98
       ↓                                header verification (HTTP) — "is this
       │                                really pubkey X"
REAL AUTHORIZATION                     For events: ingest.rs's scope-resolution
       ↓                                gate (§22) then, for admin/channel-admin
       │                                kinds, the pure decision modules
       │                                (relay_admin.rs, channel_authz.rs,
       │                                moderation_authz.rs) — "is X allowed to
       │                                do this, to this target, right now"
       │                                For invites: the role lookup inside
       │                                mint_invite/claim_invite itself (§8)
Database / protocol validation         relay_members / channel_members row
       ↓                                lookups feeding the decision above;
       │                                CHECK constraints (e.g. role enum,
       │                                invite-role hard-pin) as a final backstop
Success / rejection
```

**The frontend is never the enforcement boundary anywhere in this trace.** Every gate that actually matters (§4, §8, §12) is server-side, keyed off a fresh `relay_members`/`channel_members` lookup at request time, not a cached or client-asserted role. This matches `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §9's own framing (*"is client-side authorization ever real, or purely cosmetic?"*) — confirmed cosmetic-only on the frontend, real only on the relay/API, consistently across every feature this document covers.

## 24. Error & Edge Cases

`[CODE where cited, DOCS-EXISTING otherwise]`.

| Case | Behavior |
|---|---|
| Invalid invite code | `403 invite_invalid` (both v1 and v2 paths) |
| Expired invite | `403 invite_expired` |
| Revoked invite | `UNABLE TO VERIFY FROM SOURCE` — no revoke endpoint located |
| Exhausted invite (max uses) | `403 invite_exhausted` |
| Duplicate membership (claim while already a member) | `200`, `{status: "already_member"}` — idempotent, not an error |
| Unauthorized channel creation | N/A — channel creation is ungated (§4/§10) |
| Unauthorized member addition (community) | Server rejects per `relay_admin.rs` role check; exact wire error text not re-traced this pass |
| Unauthorized channel member addition | `ActorNotAuthorized` / `ElevatedRoleGrantDenied` (§12), exact client-visible strings per `channel_authz.rs`'s own doc comment: *"Every `ChannelAuthzError` message is returned to clients verbatim in the NIP-29 `OK` frame."* |
| Unauthorized role change | `RoleChangeDenied` (channel) / owner-only enforcement (community, exact string not re-traced) |
| Unauthorized removal | `Deny` classification (channel, §12) / owner/admin-only (community) |
| Private channel access by non-member | `ActorNotAuthorized` on any 9000 self/other add attempt; messages themselves separately gated by the ingest path's channel-membership check (§13) |
| Leaving a channel as sole owner | Blocked — `LastOwnerRemoval`/`LastOwnerRemovalTransferFirst` (two distinct wordings for the pre-storage validator vs. the side-effect applier, per `channel_authz.rs`'s own doc comment) |
| Leaving a community | `NOT FOUND IN OLD BUZZ SOURCE` (§6) |
| Missing user/community/channel | `UNABLE TO VERIFY FROM SOURCE` — generic 404/error handling not traced this pass |
| Relay/API failure | `UNABLE TO VERIFY FROM SOURCE` for the general case; invite mint's DB-access-denied path specifically maps to `503 Service Unavailable`, *"community writes are temporarily unavailable"* (`invites.rs:272-275`) |
| Kind:9009 invite event published anyway | `403`-equivalent WebSocket rejection, `"restricted: unknown event kind"` (§8/§22) — not silently accepted |

## 25. UI Flow Diagrams

**A. New user onboarding** (composited from §9; steps not independently confirmed at the exact UI-screen level are marked):
```
Owner/Admin: POST /api/invites → { code, url }
   ↓
Share url/code (mechanism outside the product)
   ↓
New user opens it — UNABLE TO VERIFY FROM SOURCE which exact screen/route
   ↓
New user's own Nostr keypair (already exists or freshly generated —
   UNABLE TO VERIFY FROM SOURCE which)
   ↓
POST /api/invites/claim (NIP-98 signed)
   ↓
relay_members row created, role=member
   ↓
NIP-43 membership snapshot republished
   ↓
New user's client observes its own new membership via that snapshot
   ↓
Open channels visible/joinable immediately; private channels still
   require a separate channel-level add
```

**B. Community creation**: N/A — no such user-facing flow exists (§5).

**C. Community invite creation**:
```
Owner or Admin
   ↓ POST /api/invites (NIP-98 signed)
mint_invite() — role check → mint_relay_invite() → { code, url, expires_at }
   ↓
Returned to the UI (AddMemberDialog's invite mode) for the actor to share
```

**D. Invite acceptance**: identical to diagram A from the `POST /api/invites/claim` step onward.

**E. Channel creation**: see §10's diagram verbatim.

**F. Add channel member**:
```
Channel owner/admin (or any user, if channel is open and target role is
  plain) → kind:9000 signed → channel_authz::decide_put_user()
   ↓ Allow / CheckAddPolicy
handle_put_user() → channel_members upsert
   ↓
[UNVERIFIED: realtime snapshot republish — see §12]
```

**G. Remove channel member**:
```
Channel owner/admin (any target) OR a member removing an agent they own
  → kind:9001 → channel_authz::classify_remove_other()
   ↓ Allow / CheckAgentOwner / Deny
handle_remove_user() → channel_members row removed
```

**H. Channel message**: standard kind:9 publish → 11-step ingest gate (§13) → `events` insert → realtime fan-out to channel subscribers.

**I. Message reply/thread**:
```
User composes a reply with NIP-10 e-tags (root + reply markers)
   ↓
resolve_nip10_thread_meta() — ancestry validated & computed server-side
   ↓
events insert + thread_metadata insert (atomic, §14)
   ↓
parent.reply_count++, root.descendant_count++
   ↓
Realtime fan-out; UI increments a reply-count badge on the parent message
  — UNABLE TO VERIFY FROM SOURCE whether the UI also shows visual nesting
```

**J. User profile → DM**: see §17's exact code trace, reproduced as a diagram:
```
User list / mention / avatar click
   ↓
UserProfilePanel opens for target pubkey
   ↓
canMessage gate evaluated (client-side UX only)
   ↓ (if true) click "Message"
openDm({pubkeys:[target]}) — invoke("open_dm") — idempotent
   ↓
goChannel(dm.id) — navigate into the (new-or-existing) DM channel
   ↓
Profile panel closes
```

**K. Existing user → DM**: identical to J — old Buzz does not distinguish "new" vs "existing" conversation at the UI-trigger level; `usePrepareDmSendChannel()`/`openDm()` both resolve idempotently to the same channel either way (§15).

**L. Leave channel**: kind:9022 (self) or self-targeted kind:9001 → `decide_self_departure()` (`channel_authz.rs:77-88`) → `NotActiveMember` if not a member, `LastOwnerRemoval` if sole owner, else removed.

**M. Community member management**: see §7 — `AddMemberDialog` (add/invite) and `CommunityMembersSettingsCard` (list/role-change/remove) are the two UI surfaces; both round-trip through `relay_admin.rs`'s server-side checks (§4).

## 26. Business Flow Diagrams

**Owner's full capability tree** (derived strictly from §4's matrices, not assumed):
```
Owner
 ├── Community: add/remove any member, promote/demote (never to/from owner
 │              via the normal path), view moderation queue, ban/timeout
 │              anyone, create invites, transfer ownership (via operator
 │              endpoint)
 ├── Channel (any channel where they hold channel-owner role — NOT
 │            automatic from community ownership alone): create, edit,
 │            archive, delete, add/remove any member, grant elevated
 │            channel roles
 └── Ordinary member capabilities: send messages, reply, DM, react
```
**Admin's full capability tree**:
```
Admin
 ├── Community: add/remove member-role targets only, cannot touch owner
 │              or fellow admin, view moderation queue, ban/timeout
 │              (not owner/admin targets), create invites, cannot change
 │              any role, cannot transfer ownership
 ├── Channel (where they hold channel-admin role): edit/archive but not
 │            delete; add/remove members; grant elevated channel roles
 │            (same as channel-owner in this one respect, §4)
 └── Ordinary member capabilities
```
**Member's full capability tree**:
```
Member
 ├── Community: view, send message, submit report, CREATE A CHANNEL
 │              (not gated!) — nothing else
 ├── Channel (where they hold no elevated channel role): send messages,
 │            reply, self-join open channels, add OTHER plain members to
 │            an OPEN channel (yes — decide_put_user's open-channel path
 │            has no membership requirement for the actor at all), leave
 └── DM: open/participate freely
```

## 27. Old Buzz → SWF Buzz Comparison

Read fresh this pass against the current SWF Buzz file tree (`src/`, `src-tauri/src/`) as it exists right now — including work from this same session (the channel-membership UI and the channel-conversation UI redesign built earlier today), not just the prior `docs/NEW_SWF_BUZZ_GAP_ANALYSIS.md` snapshot.

| Area | Old Buzz | SWF Buzz (current) | Status |
|---|---|---|---|
| Community creation | No UI (§5) | No UI | **N/A** — parity by absence |
| Community roles | `relay_members`, 3-tier | Same table, same 3-tier, read via `RelayMembersService`/`resolveMyRole` | **IMPLEMENTED** |
| Community member add/remove/role-change | kind:9030/9031/9032, `relay_admin.rs` gated | Same kinds, `CommunityMembersPanel.vue`/`useCommunityMembers.ts`, permission mirror in `permissions.ts` | **IMPLEMENTED** — live-verified against a real relay in a prior session (owner/admin tiers both) |
| **Community invites** | **Real HTTP, NIP-98-signed, `/api/invites`+`/api/invites/claim`** | **kind:9009 event — confirmed this session to be rejected outright by the relay (`restricted: unknown event kind`, §8/§22), not merely a no-op** | **BROKEN** — this is the single largest, most consequential gap in this entire audit. `src/services/nip98.ts` (NIP-98 signing) already exists and already works today for `/moderation/*` — the missing piece is exactly two new HTTP-calling service methods against the exact contracts in §8, not a new signing primitive |
| Channel creation | Ungated, kind:9007 | Ungated, kind:9007 via `ChannelService.createChannel` — **UI now exists**: `CreateChannelDialog.vue`/`useCreateChannel.ts`, wired into `ChannelsView.vue`'s sidebar this session | **IMPLEMENTED** (was `PARTIALLY IMPLEMENTED`/dead-code as of the prior gap-analysis doc; closed this session) |
| Channel roles | 5-tier (`owner/admin/member/guest/bot`), `channel_authz.rs` | 3-tier (`owner/admin/member` — `src/protocol/membership.ts`'s `MemberRole`); no `guest`/`bot` concept | **PARTIALLY IMPLEMENTED** — the 3 roles that exist are correctly modeled against §4/§11's real rules (`src/features/channels/channelPermissions.ts`, built this session directly against `channel_authz.rs`); `guest`/`bot` and the bot-specific `channel_add_policy` have no SWF Buzz equivalent, deliberately out of scope for human-to-human testing |
| Channel member add/remove | kind:9000/9001, `channel_authz.rs` | Same kinds (`buildPutUserEvent`/`buildRemoveUserEvent`, pre-existing), now with real UI this session: `ChannelMembersPanel.vue`/`ChannelMemberRow.vue`/`useChannelMemberActions.ts`, gating logic matching §4/§12 exactly | **IMPLEMENTED** (was `MISSING` as of the prior gap-analysis doc; closed this session) |
| Channel messaging | kind:9, 11-step ingest gate | kind:9, same relay | **IMPLEMENTED** |
| **Message threads/replies** | **Real nested threading**: NIP-10 e-tag markers, server-computed depth up to 100, separate `reply_count`/`descendant_count`, cursor-paginated | Same NIP-10 e-tag wire format (`src/protocol/nip10.ts`/`threads.ts` — confirmed matching resolution rule); reads the **same relay's** kind:39005 aggregate (`reply_count`, `descendant_count`, `participants` — identical shape to `ThreadSummary` in §14); UI (`ThreadPanel.vue`) renders all replies **flat**, one level, by deliberate design choice made this session | **DIFFERENT BEHAVIOR, not a protocol gap** — because both apps share the exact same `buzz-relay` backend, the depth/nesting *data* is equally available to both; the difference is purely in each client's own rendering choice. Whether old Buzz's UI actually *visualizes* the nesting is itself `UNABLE TO VERIFY FROM SOURCE` (§14) — so this may not even be a real behavioral difference, just an unverified one. New this session: `useThreadSummaries.ts` (batched kind:39005 fetch) + a persistent "💬 N replies" indicator on every message with replies, matching §14/§26's "reply-count badge" description |
| Direct messages | `ChannelType::Dm`, `open_dm` command, idempotent | kind:41010 (`KIND_DM_OPEN`), confirmed against the real relay handler (`command_executor.rs:66`) in a prior session | **IMPLEMENTED** |
| **User profile → DM** | **Exact chain**: `UserProfilePanel` → Message button (`canMessage` gate) → `openDm` → `goChannel` → close panel (§17) | **Built this session**, matching the same chain almost line-for-line: `UserProfilePanel.vue` → Message button → `useOpenDm().open([pubkey])` → `router.push({name:"dm", query:{conversationId}})` | **IMPLEMENTED** — a genuinely close architectural match, confirmed independently rather than copied (this session's SWF Buzz implementation predates this audit read of old Buzz's actual code) |
| User profiles (general) | Rich: avatar, name, Message/Huddle/Wave/Follow, agent actions | `UserProfilePanel.vue`: avatar, name, presence dot, Message button, raw pubkey display | **PARTIALLY IMPLEMENTED** — Message (the one old Buzz itself calls "most important" per no explicit statement, but structurally primary) is done; Huddle/Wave/Follow have no SWF Buzz equivalent, consistent with those being explicitly out of scope (no huddle/voice feature in SWF Buzz's product brief per project memory) |
| Channel header/member UI | `ChannelPane.tsx` header, `MembersSidebar.tsx` | Built this session: `ChannelHeader.vue` (name, visibility icon, member count, people-icon, ⋮ menu), `MembersModal.vue`, `ChannelMenu.vue` | **IMPLEMENTED** — not a line-by-line port (old Buzz's exact header JSX wasn't opened, §18), but matches the *behavior* description in the existing UI-map audit |
| Channel details/settings | `ChannelManagementModerationActions.tsx` | Built this session: `ChannelDetailsPanel.vue` (real channel type/visibility/member-count/id, Leave-channel with confirm dialog) | **IMPLEMENTED** for leave/view; edit/archive/delete (channel-role-gated in old Buzz, §10) have no SWF Buzz UI yet |
| Community UI (members/invites/moderation) | Three separate-purpose surfaces, all owner/admin-gated | Consolidated this session into `CommunityManagementModal.vue` (tabs: Members/Moderation/Invites), deliberately separated from per-channel UI (mirrors §20's "community vs. channel" UI separation) | **IMPLEMENTED**, structurally matching old Buzz's own community-vs-channel UI separation better than the pre-this-session layout did (which conflated the two) |
| Moderation | kind:9040-9044, `moderation_authz.rs` | Same kinds, `ModerationService.ts`/`moderation/` feature | **IMPLEMENTED** (code-complete; per `docs/KNOWN_LIMITATIONS.md` not fully click-tested against seeded data) |
| Okta authentication | **`NOT FOUND IN OLD BUZZ SOURCE`** — no OIDC anywhere | Full Okta OIDC+PKCE, verified end-to-end this session | **N/A for comparison** — a SWF Buzz-only addition per its own product brief, not a parity question |
| Onboarding (second test user) | Real invite flow (§8-§9) | **Still blocked** — the invite mechanism is broken (see above); this session used a direct `relay_members` DB seed as the documented, real-server-enforced workaround, not a fix | **BLOCKED**, downstream of the invitations gap — unchanged in kind from the prior gap-analysis doc, though the exact failure mode is now precisely characterized (§8/§22) rather than just "no-op" |

## 28. Missing SWF Buzz Behaviors

In priority order, cross-referencing §27:

1. **Real community invitations** (HTTP + NIP-98, §8) — the highest-value, best-understood gap in this document; the signing primitive already exists in SWF Buzz (`nip98.ts`), only two service methods against the exact contracts documented in §8 are missing.
2. **Channel role richness** — `guest`/`bot` roles and `channel_add_policy` have no SWF Buzz equivalent (deliberately, for now — human-only testing doesn't need it).
3. **Channel edit/archive/delete** — old Buzz's channel-role-gated management actions beyond "leave" have no SWF Buzz UI.
4. **A second DM surface** (old Buzz's Home/Inbox) — a scope decision, not confirmed as required (§15).
5. **Huddle/Wave/Follow profile actions** — out of SWF Buzz's stated product scope, not a gap to close.
6. **Notifications** — neither app was confirmed to have a push/toast system for unfocused-window new messages (§ existing gap-analysis doc); unchanged.

## 29. Behavior That Must NOT Be Assumed

Explicitly, because a future session might otherwise reach for "how Slack/Discord does it":

- Old Buzz does **not** email invites — there is no SMTP integration anywhere; sharing the invite URL/code is entirely out-of-band.
- Old Buzz does **not** require owner/admin approval to *accept* an invite — claiming is unconditional once a valid code is presented (no "pending request" state).
- A community owner is **not** automatically a channel owner in every channel — the two role planes are independent; an owner who didn't create or get added to a specific channel has no special authority there.
- Channel creation is **not** owner/admin-restricted — any member can create a channel; this is real old-Buzz behavior, not an oversight.
- A channel admin **can** grant channel-*ownership* to someone else — this is not a typo or a bug pattern to "fix" if SWF Buzz reproduces it; `channel_authz.rs`'s own test table confirms it's intentional.
- There is **no** confirmed "leave community" action distinct from "leave channel" (§6) — do not build one assuming it must exist just because "leave channel" does.
- Thread depth is **not** capped at one level server-side (up to 100) — a client choosing to render replies flat is a UI decision, not evidence the protocol itself is flat.

## 30. Open Questions / Unable to Verify

Consolidated from every section above, for visibility in one place:

1. Whether old Buzz's thread UI visually renders nesting by depth, or flattens all replies under a root (§14/§27) — the single question most relevant to whether SWF Buzz's flat-by-design thread UI is actually a behavioral difference or not.
2. The exact DM-participant recipient limit (`hasReachedRecipientLimit`, §15).
3. Whether an invite-revocation endpoint exists (§8).
4. The exact relationship between old Buzz's inline sidebar DM section and its separate Home/Inbox screen (§15).
5. Whether `open_dm` has any server-side authorization beyond "any authenticated pubkey may message any other" (§16).
6. The first screen/route shown immediately after a successful invite claim (§9).
7. Whether default channels/permissions are seeded at community provisioning beyond the single owner row (§5).
8. General 404/error handling for a missing user/community/channel (§24).
9. Whether old Buzz has a "Channel Settings" surface richer than edit/archive/delete (§19).
10. Exact profile-metadata parsing (`kind:0` field mapping) — assumed by convention, not independently re-traced (§16).

## 31. Exact Source File Index

Files opened and cited directly this pass (new research beyond the six existing documents):

- `crates/buzz-relay/src/api/invites.rs` (full mint/claim contract, §8)
- `crates/buzz-core/src/invite.rs` (TTL/use-count constants, v2 code format, §8)
- `crates/buzz-relay/src/handlers/ingest.rs` (`required_scope_for_kind` lines 437-545; `resolve_nip10_thread_meta`/`derive_ancestry_from_parent_tags`/`resolve_relay_reply_thread_meta` lines 789-1100, §14/§22)
- `crates/buzz-relay/src/handlers/side_effects.rs` (kind:9009 dead stub, line 211-214; `handle_put_user`/`handle_remove_user`, lines ~1292-1420, confirmed earlier this session)
- `crates/buzz-relay/src/handlers/channel_authz.rs` (full channel authorization logic + its own test tables, §4/§12 — confirmed earlier this session, re-cited here)
- `crates/buzz-db/src/store/thread.rs` (thread_metadata schema, insert/read/summary functions, §14)
- `crates/buzz-core/src/nip10.rs` (`ThreadMarkers`, `parse_thread_markers`, `resolve()`, §14)
- `desktop/src/features/profile/ui/UserProfilePrimaryActions.tsx` (Message/Huddle/Wave/Follow buttons, §16)
- `desktop/src/features/profile/ui/useProfileInteractionActions.ts` (`canMessage`/`canWave`/`canHuddle` gates, `handleMessage`, §16/§17)

Files cited by reference from the six pre-existing audit documents (not re-opened this pass; see those documents for their own original citations): `CommunityRail.tsx`, `EditCommunityDialog.tsx`, `operator.rs`, `community_provisioning.rs`, `relay_members.rs`, `AppSidebar.tsx`, `CreateChannelDialog.tsx`/`CreateChannelFormFields.tsx`, `AddMemberDialog.tsx`, `relay_admin.rs`, `moderation_authz.rs`, `relay_invite.rs` (DB layer), `invite_token.rs`, `NewMessageScreen.tsx`, `useNewMessageRecipients`, `usePrepareDmSendChannel`/`useOpenDmMutation`, `ChannelPane.tsx`, `MembersSidebar.tsx`, `ChannelManagementModerationActions.tsx`, `CommunityMembersSettingsCard.tsx`, `ModerationQueueCard.tsx`, `HomeView.tsx`/`InboxListPane.tsx`/`InboxDetailPane.tsx`, `buzz-core/src/channel.rs`, `buzz-auth/src/lib.rs`.

Current SWF Buzz files cited in §27 (this session's own work, already known from direct authorship, not re-read as part of this audit pass): `src/services/nip98.ts`, `src/features/channels/ChannelService.ts`, `src/features/channels/channelPermissions.ts`, `src/features/channels/ui/{ChannelHeader,ChannelMenu,MembersModal,UserProfilePanel,ChannelDetailsPanel,CreateChannelDialog,ChannelMembersPanel,ChannelMemberRow}.vue`, `src/features/community-members/ui/CommunityManagementModal.vue`, `src/features/threads/useThreadSummaries.ts`, `src/protocol/{nip10,threads,membership}.ts`.

---

*Compiled this pass: read-only throughout both `../buzz` and this SWF Buzz repository. No code was modified in either. Every `UNABLE TO VERIFY FROM SOURCE` / `NOT FOUND IN OLD BUZZ SOURCE` marker above is a genuine gap in what this pass (plus the six prior audits it builds on) could confirm from source — treat each as a real open question, not an implicit "assume it works like X."*
