# Old Buzz — Business Logic Audit

**Purpose**: a complete reverse-engineering of the old Buzz application (`C:\Users\Pranshul\Downloads\buzz2.0\buzz`, a React/Tauri desktop client + `buzz-relay` Rust backend + Postgres — read-only reference, never modified) covering roles, community/channel lifecycle, invitations, membership, direct messages, moderation, UI layout, responsive behavior, and the API/database contract, structured into the exact sections requested for SWF Buzz parity planning.

**Method note**: every claim is labeled `[CODE]` (read directly from source this pass, file:line cited), `[DOCS-EXISTING]` (consolidated from the six audit documents already in this repo — see below, each independently source-verified), `[INFERRED]` (reasonable conclusion, not directly confirmed), or `UNVERIFIED` (a real open question in old Buzz's own code — do not implement against it, flag it instead). Nothing here is invented; where old Buzz's own behavior is ambiguous, this document says so rather than guessing.

**This document consolidates, rather than duplicates, prior work.** Five documents already exist in this repo from an earlier, thorough, source-verified audit pass and are the primary source for sections A, D, F, and K:

- `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` — role hierarchy, 12-stage user lifecycle, owner/admin/moderator/operator workflow traces, report lifecycle, ban/kick/timeout flow, DB relationships, gap analysis, implementation plan
- `docs/ROLE_PERMISSION_MATRIX.md` — compact permission matrix + local test-identity seeding procedure (directly reused for the SWF Buzz super-admin bootstrap — see the companion gap-analysis doc)
- `docs/ROLE_PERMISSION_AUDIT.md` — exhaustive role/permission/API/DB catalog, 56-row master capability table
- `docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md` — SWF Buzz's own auth architecture (referenced for contrast, not old-Buzz behavior)
- `docs/AUTHORIZATION_RUNTIME_FLOW.md` — SWF Buzz's own enforcement-layer state machine (referenced for contrast)
- `docs/ADMIN_PANEL_REVERSE_ENGINEERING_REPORT.md` — old Buzz's admin-web console, moderation state machine, reports/bans/feedback data models

Spot-checked this pass against current source (5 of 5 confirmed byte-accurate, see companion report to the requester): `relay_admin.rs:424-441` (owner-only role-change gate, exact error strings), `moderation_authz.rs:146-181` (the ban/timeout admin guard rail, exact error strings), `kind.rs:479` (`KIND_STREAM_MESSAGE = 9`), `relay_members.rs:456` (`MAX_COMMUNITIES_PER_OWNER = 5`). No stale citations found in the existing five documents' claims that were checked.

Sections **B, C (UI-flow detail), E (UI-flow detail), G, I, and J** below are new research from this pass — old Buzz's own docs did not cover DMs, channel/community-creation UI specifics, the on-screen layout map, or responsive/mobile behavior in detail.

---

## A. User Roles

**Full detail**: see `docs/ROLE_PERMISSION_AUDIT.md` §2–§10, §20 (master capability table) and `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §1. Reproduced here as the reference matrix this document's own numbering points back to.

Old Buzz has **no single "Super Admin."** Three independent role planes exist, plus one cross-cutting capability system — confirmed absent by direct source search and by explicit design-doc statement: *"Two roles, not three… deliberately"* (`VISION_MODERATION.md:57`) `[DOCS-EXISTING]`.

| Role | Plane | Storage | Assigned by | Removed by |
|---|---|---|---|---|
| **Operator** | Platform-wide | Config `RELAY_OPERATOR_PUBKEYS`, or `relay_operators` DB row | Deployment config edit, or an existing Operator | Config edit, or an Operator (blocked if it would leave zero operators) |
| **Moderator** | Platform-wide | `relay_operators` DB row only | An Operator | An Operator |
| **owner** (community) | Per-community | `relay_members.role`, PK `(community_id, pubkey)` | `RELAY_OWNER_PUBKEY` config bootstrap, or ownership transfer | Never directly — only *replaced* via transfer (demotes prior owner to `member`) |
| **admin** (community) | Per-community | `relay_members.role` | Owner only, kind:9032 | Owner only |
| **member** (community) | Per-community | `relay_members.role` | Owner/admin (kind:9030), or invite claim (role hard-pinned `member`) | Owner/admin (kind:9031), or self-leave |
| **Owner/Admin/Member/Guest** (channel) | Per-channel, separate lattice | `channel_members.role` enum | Channel creation (owner), grant by elevated channel member | Owner/admin, or self-leave; sole owner is immune |
| **Bot** (channel) | Per-channel, non-hierarchical | `channel_members.role='bot'` | Added by any member (subject to `channel_add_policy`) | Owner/admin, or the human `agent_owner_pubkey` |

**Community role permission matrix** (`[DOCS-EXISTING]`, `docs/ROLE_PERMISSION_AUDIT.md` §4, cross-checked this pass against `moderation_authz.rs:146-181` and `relay_admin.rs:313-441` — exact match):

| Permission | Member | Admin | Owner |
|---|---|---|---|
| View channels/messages, send message | YES | YES | YES |
| Submit report | YES | YES | YES |
| View community moderation queue | NO | YES | YES |
| Add member | NO | COND¹ | YES |
| Remove member | NO | COND² | COND³ |
| Change member role | NO | NO | YES |
| Ban / timeout | NO | COND⁴ | YES |
| Unban / lift timeout | NO | YES | YES |
| Resolve/dismiss/escalate report | — | YES | YES |
| Create channel | **YES — not role-gated** (see §C below) | YES | YES |
| Edit/archive/delete channel | NO (unless also a *channel* owner/admin) | COND (channel role) | COND (channel role) |
| Create invite | NO | COND (member role only) | YES |
| Transfer ownership | NO | NO | COND (via operator endpoint) |

¹ Admin may only grant role `member`, never `admin`. ² Admin may only remove a target whose current role is exactly `member`. ³ Owner may remove admin/member but never another owner. ⁴ Admin cannot ban/timeout a target whose role is `owner` or `admin` — the one hard guard rail in the community moderation model, quoted verbatim from `moderation_authz.rs:163-169`: *"an admin cannot ban or time out a community owner or fellow admin."*

**New finding this pass** `[CODE]`: channel **creation** is not community-role-gated at all. `KIND_NIP29_CREATE_GROUP` (kind:9007) requires only `Scope::ChannelsWrite` (`ingest.rs:518`), and every NIP-42-authenticated WebSocket connection receives `Scope::all_known()` regardless of community role (`buzz-auth/src/lib.rs:147-155`). `handle_create_group` (`side_effects.rs:1769-1830`) performs no role check — any community member, including a plain `member`, can create a channel. Only channel *management* (edit/archive/delete/permissions) is gated by the separate per-channel role lattice. This refines `docs/ROLE_PERMISSION_AUDIT.md`'s framing (which documents channel management thoroughly but doesn't explicitly call out that creation itself is open to any member) — see §C for the full flow.

**Platform-plane roles (Operator/Moderator)** — full detail unchanged from existing docs, reproduced compactly: Operator is deployment-root (staffs the roster, provisions/archives/transfers communities, acts on every report/feedback item cross-tenant). Moderator has identical report/feedback authority but is walled off from staffing and provisioning. Neither has any automatic authority inside a specific community's own moderation plane — see `ROLE_PERMISSION_AUDIT.md` §6-§7.

**What each role cannot do** (the boundaries, stated explicitly): Member cannot manage anyone, cannot moderate, cannot view the queue. Admin cannot touch the owner or a fellow admin (ban/timeout/remove/demote), cannot change any role, cannot promote anyone. Owner cannot act outside their own community (no platform-wide reach) and cannot be removed except via transfer. Operator/Moderator cannot moderate inside a community without *also* separately holding owner/admin there — platform role grants no community-role inheritance.

---

## B. Community Creation Flow

**Headline finding, confirmed from source this pass, that changes the shape of this whole section**: **old Buzz has no end-user "Create Community" UI at all.** This was already stated in `docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md:414,474` and `docs/ROLE_PERMISSION_AUDIT.md` §12/§16 (*"no route exists for... community management"*, *"platform-wide 'communities' list/console... presumably driven by direct API calls or a CLI today"*) — this pass independently confirmed it by reading the actual desktop "Add Community" UI rather than trusting the prior claim at face value.

### What "Add Community" actually does (client-side connection config, not server-side provisioning)

The only community-related creation-shaped UI in the whole desktop app is the **"+ Add community"** button at the bottom of `CommunityRail.tsx:418-428` (the left-most vertical rail that lists communities you're already connected to — see §I for the full screen map), which opens `EditCommunityDialog.tsx`. Reading that dialog's fields and submit handler directly (`EditCommunityDialog.tsx:20-92`):

```
Fields: name (local display label only), relayUrl (required), token (optional API token
        for a private/self-hosted relay), reposDir (local git directory, unrelated to Nostr)

Submit → onSave(id, { name?, relayUrl?, token?, reposDir? })
        → purely a LOCAL client-side config update (saved to the app's own community storage)
        → no relay-side "create community" event or API call of any kind
```

This is **"point this desktop client at an existing relay/community by URL,"** not "provision a brand-new community." It's the same UI used for *editing* an already-added community's connection details (`EditCommunityDialog` is reused for both add and edit — the component's own name gives this away). Confirmed no server round-trip creates anything: the dialog's `handleSubmit` only builds a local `updates` object and calls the passed-in `onSave` callback — no `invoke()`/fetch call to any Tauri command or HTTP endpoint appears in the file.

### Where real community provisioning actually happens

A genuinely new community (a new tenant, new `communities` row, a bootstrapped owner) is created **exclusively** via the Operator-only backend control plane:

```
POST /operator/communities   (operator.rs:153)
  → gated by authorize_operator_request, which checks RELAY_OPERATOR_PUBKEYS config
    DIRECTLY — "deliberately NOT a relay_members lookup" (community_provisioning.rs:5-11)
  → creates the communities row + bootstraps the owner pubkey
```

**No frontend anywhere in the old Buzz repository calls this endpoint** — confirmed independently by two separate research passes (`docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §6: *"grep for `/operator` across `admin-web/src` returns zero hits"*). In practice, old Buzz's own community-provisioning step is an out-of-band operations action (a direct API call, e.g. via `curl`/Postman, or a CLI script), not a product feature reachable by any role inside either the desktop app or `admin-web`.

### Answering the original 15 questions directly, against this finding

1. **Who can create a community?** Nobody, through any UI. Only an Operator, via a raw API call outside the product.
2. **What happens when a community is created?** A `communities` row is inserted (`id, host, created_at, deletion_state='active'`) and the specified owner pubkey is bootstrapped directly into `relay_members` with `role='owner'` — `[INFERRED]` from `operator.rs:153`'s stated purpose ("provision community, bootstrap owner") combined with the schema in §K; the exact bootstrap SQL wasn't traced line-by-line this pass, but the `communities`+`relay_members` row pair is the only structural requirement `channel_authz`/`moderation_authz` depend on.
3. **Who automatically becomes owner?** Whichever pubkey the Operator's API call specifies.
4-5. **Is owner automatically admin/member?** Not applicable — `owner` is a separate, higher role than `admin` in the same `relay_members.role` CHECK constraint (`owner|admin|member`), not a composite of the two. An owner is not separately a `member` row.
6. **What DB records are created?** One `communities` row, one `relay_members` row (the owner). **No default channels, no default permissions, no default roles beyond the single owner row** — `UNVERIFIED` whether the provisioning endpoint seeds anything else; not traced beyond the two tables both `channel_authz.rs` and `moderation_authz.rs` require to exist.
7-9. **Default channels/permissions/roles?** None found — no seed-channel logic was located in `operator.rs` or `community_provisioning.rs` during this pass. `UNVERIFIED` — flagged rather than assumed.
10-14. **UI opened, fields required, what happens after, where it appears, navigation change?** **Not applicable — there is no UI.** The closest analogous end-user action is "Add community" (connect to an already-provisioned relay by URL), which appears as a new entry in the `CommunityRail` and switches the active community context immediately on save.
15. **API/DB calls?** `POST /operator/communities` (provisioning, Operator-only, no frontend) vs. a purely local `EditCommunityDialog` save (no server call at all, for connecting to an existing one).

### Implication for SWF Buzz

Per the master prompt's own instruction ("do not invent business logic when the old implementation contains the answer"): **SWF Buzz should not build a "Create Community" feature that provisions a brand-new tenant from inside the app**, because old Buzz itself never had one — building it would be net-new product design, not parity work. What SWF Buzz *should* build, to match old Buzz's actual "Add Community" behavior, is a client-side "connect to a relay by URL" flow (equivalent to `EditCommunityDialog`) — this is already effectively how SWF Buzz's own `VITE_RELAY_URL` single-relay-per-build model works, just not exposed as a runtime-switchable UI. See the companion gap-analysis document for whether building a multi-relay switcher is in scope.

---

## C. Channel Creation Flow

### Who can create — confirmed open to any member (§A above)

No community-role gate exists on channel creation. Any authenticated member of the community (including plain `member`) can create a channel — the relay only requires `Scope::ChannelsWrite`, which every authenticated WebSocket connection holds regardless of role (`ingest.rs:518`, `buzz-auth/src/lib.rs:147-155`). `[CODE]`

### UI flow, traced end-to-end

```
AppSidebar.tsx — "+" control near a channel section (handleOpenCreateChannel, line 490-496)
  ↓
CreateChannelDialog.tsx opens (channelKind: "stream" | "forum" — no other kind is user-selectable
  from this entry point; "dm" and "workflow" channel types are created through other flows, see §G)
  ↓
CreateChannelFormFields.tsx — form fields: name, description (optional), visibility
  (ChannelVisibility — open/private per the type import), ttlSeconds (optional, ephemeral-channel
  TTL), templateId (optional)
  ↓
useCreateChannelForm hook validates + calls onCreate(input) → the parent's create-channel mutation
  ↓
Client builds & signs kind:9007 (KIND_NIP29_CREATE_GROUP) with tags: name, visibility,
  channel_type (defaults to "stream" server-side if omitted — side_effects.rs:1776-1778), about,
  optional h-tag (client-generated UUID for the channel id — side_effects.rs:1792-1809 shows the
  relay prefers this over auto-generating one, to keep client-side optimistic UI and server state
  in sync on the same id)
  ↓
Relay: handle_create_group (side_effects.rs:1769-1830) — creates the channels row
  (community_id, name, channel_type, visibility, description, created_by=actor_bytes, ttl)
  ↓
Side effect: metrics counter increment; [INFERRED, not traced this pass] the creator is very likely
  auto-added to channel_members as Owner (matching every other "X creates a group/resource" pattern
  in this codebase, and matching channel_authz.rs's own note that a sole channel owner is immune to
  removal — that invariant only means something if channel creation always produces exactly one
  initial owner) — UNVERIFIED at the exact code line; flagged rather than assumed as certain.
  ↓
Realtime: the created channel event fans out to subscribers; the creating client's own optimistic
  UI (h-tag id match) reconciles with the confirmed server row.
  ↓
Sidebar: new channel appears in AppSidebar's channel list (sectioned/sorted per user preference —
  see §I), selectable immediately.
```

### Public/private (visibility) behavior

`ChannelVisibility` (open/private, per `EditCommunityDialog`'s type import and `channel_authz.rs`'s open-channel self-join logic referenced in the existing docs): **open channels** allow self-join via kind:9021 (`side_effects.rs:1950-2027`, unconditional `add_member(role=Member)`); **private channels** require an existing elevated (owner/admin) channel member to add you via kind:9000 — no self-service (`channel_authz.rs:111-167`). `[DOCS-EXISTING]`, unchanged this pass.

### Editing / archiving / deleting

Channel-role-gated, not community-role-gated (§A) — `ChannelManagementModerationActions.tsx:52-95`: Owner can delete/archive/edit everything; Admin can edit/archive but not delete. `[DOCS-EXISTING]`, `docs/ROLE_PERMISSION_AUDIT.md` §20 rows 36-38.

### Membership on creation

The creator is added as the initial channel member (very likely `Owner` — see the `UNVERIFIED` note above). Other community members do not automatically gain access to a *private* channel just by virtue of community membership — they must be separately added (kind:9000) or self-join if the channel is *open*.

---

## D. Add Member / Invite User Flow

Fully covered, unchanged from the existing audit — `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §2 Stage 4, `docs/ROLE_PERMISSION_AUDIT.md` §13 (Nostr kinds table) and §4 (permission matrix). Reproduced compactly:

- **Who can invite?** Owner and admin only — `"only relay owners and admins can create invites"` (`invites.rs:299-304`). A plain member has no invite capability at all.
- **UI location**: `AddMemberDialog.tsx` — the same dialog handles both "add an existing user directly" (kind:9030) and "mint an invite link" depending on which tab/mode is active; the role selector in that dialog filters out "admin" unless the inviter is the owner (`AddMemberDialog.tsx:129-132`).
- **Mechanism**: `POST /api/invites` (NIP-98 signed) → server generates 32 random bytes, stores only the SHA-256 hash, returns the plaintext code once (`invites.rs:284-353`). This is a **token-based link**, not email-based — old Buzz has no email/SMTP integration found anywhere in this audit.
- **Community vs. channel scoped**: community-scoped only. There is no separate "invite to this specific channel" mechanism — an invite grants community membership; channel access is then either open (self-join) or requires a separate add.
- **Role on acceptance**: hard-pinned to `'member'` at the schema/CHECK-constraint level (`migrations/0025_relay_invites.sql:20`) — **an invite link can never grant `admin`, regardless of who minted it or what role was requested at creation time.**
- **Acceptance**: `POST /api/invites/claim`, rate-limited 10/60s, one transaction: row-lock → expiry check → idempotent no-op if already a member → capacity check → `INSERT ... ON CONFLICT DO NOTHING` → increment `use_count` (`relay_invite.rs:222-397`).
- **If already a member**: idempotent no-op — claiming an invite you're already covered by does not error or duplicate.
- **Expiry**: enforced in the same claim transaction; an expired invite's claim fails cleanly (exact user-facing message not re-traced this pass — see `relay_invite.rs:222-397` for the precise error path if needed).
- **Revocation**: `[INFERRED]` an owner/admin-only revoke endpoint very likely exists given the invite-management UI pattern, but was not directly re-traced this pass; not found explicitly cited in any of the five existing docs either — flag as `UNVERIFIED` rather than assume a specific endpoint shape.
- **How the client learns of new membership**: no dedicated "GET my membership" REST endpoint — the client parses the relay-published `KIND_NIP43_MEMBERSHIP_LIST` snapshot event for its own pubkey (`relayMembers.ts:106-146`).

---

## E. Add User To Channel

Distinct from community invitation (§D) — this is an existing community member being added to a *specific* channel by an owner/admin of that channel.

- **Mechanism**: kind:9000 (NIP-29 put-user), gated by `channel_authz.rs:111-167` — requires the actor to hold an elevated (owner/admin) role in that specific channel, not just community-wide owner/admin (this is the "channel-role vs. community-role" distinction that runs through this whole audit — a community owner who isn't also a channel owner/admin in a *particular* channel cannot add members to it through this path).
- **UI location** `[INFERRED from the existing docs' file citations, not independently re-opened this pass]`: `MembersSidebar.tsx` (member role change/removal at `:438-493`) is the channel-scoped member-management surface per `docs/ROLE_PERMISSION_AUDIT.md` §12; the "add" counterpart very likely lives in the same file or a sibling dialog, following the same UI pattern as `AddMemberDialog.tsx` for the community-level equivalent.
- **Search/selection**: `[INFERRED]` — old Buzz's community-level add-member flow (`AddMemberDialog.tsx`) and DM-recipient flow (`useNewMessageRecipients`, §G) both search a per-community user directory; the channel-add flow almost certainly reuses the same directory-search pattern rather than inventing a second one, but this specific component wasn't opened this pass.
- **Authorization**: server-side, `channel_authz.rs::decide_put_user` (existing docs, `docs/ROLE_PERMISSION_AUDIT.md` §20 row 39).
- **Duplicate handling**: `[INFERRED]` idempotent, matching every other membership-add path in this codebase's consistent `ON CONFLICT DO NOTHING` convention (confirmed for the community-level and invite-claim paths in §D; not independently re-verified for the channel-level path this pass).
- **Remove member (kick)**: kind:9001, gated purely by the target channel's own roster via `channel_authz::classify_remove_other` — **does not consult community role at all**, confirmed both in the existing docs and structurally consistent with the channel/community role-plane separation established throughout this audit (`side_effects.rs:401-429`).
- **Realtime/sidebar update**: `[INFERRED]` a membership-list snapshot republish, following the same pattern as every other membership mutation traced in this document (community add/remove republishes `KIND_NIP43_MEMBERSHIP_LIST`; no channel-level equivalent snapshot mechanism was independently confirmed this pass — flag as an open verification item before SWF Buzz implements the realtime side of channel member management).

---

## F. Community Membership

Fully covered, unchanged from the existing audit — `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §2 Stage 5, §3 (owner workflow table), §4 (admin workflow table). Reproduced compactly:

- **Becoming a member**: invite claim (§D), or direct add by owner/admin (kind:9030).
- **Owner membership**: exactly one pubkey per community, bootstrapped at provisioning (§B) or via transfer — never "added" through the normal kind:9030 path (kind:9030 explicitly refuses `role="owner"`, `relay_admin.rs:436-441` and, per this pass's spot-check of `relay_admin.rs:424-441`, kind:9032 refuses it too with the exact message *"cannot set role to owner"*).
- **Promotion (member → admin)**: owner only, kind:9032. Admin cannot self-promote or promote anyone.
- **Demotion (admin → member)**: owner only, kind:9032.
- **Transferring ownership**: `transfer_ownership()`, owner-initiated or Operator-initiated via `/operator/communities/transfer` — demotes the outgoing owner to `member` (**not** `admin`) — *"the former owner retains no management capabilities"* (`relay_members.rs:509-511`).
- **Owner deletion protection**: cannot be removed by CLI (*"role 'owner' cannot be set via CLI"*, `buzz-admin/main.rs:302-313`), cannot be deleted at the DB layer (`DELETE ... WHERE role <> 'owner'`).
- **Last-owner protection**: `[INFERRED]` the DB-level `DELETE ... WHERE role <> 'owner'` constraint structurally guarantees a community can never reach zero owners through the remove path (there is exactly one owner row at all times, and it's excluded from every delete), which is a stronger guarantee than an explicit "last owner" counter check — `[CODE]`-adjacent but the invariant is structural rather than a runtime check, worth noting the distinction for SWF Buzz's own implementation.
- **Leaving a community**: `[UNVERIFIED]` — no explicit "leave community" (as opposed to "leave channel," which is well-documented via kind:9022) was found cited in any of the five existing audits or during this pass. Flag as an open question rather than assume it doesn't exist.
- **Owner capped at 5 communities**: `MAX_COMMUNITIES_PER_OWNER = 5` (confirmed this pass at `crates/buzz-db/src/store/relay_members.rs:456`, overridable via `BUZZ_MAX_COMMUNITIES_PER_OWNER`).

---

## G. Direct Messages / Conversations

**New research this pass** — none of the five existing documents mention DMs; this section is sourced fresh from `../buzz` this session.

### DMs are a channel type, not a separate entity

Old Buzz models a DM as `ChannelType::Dm` (`crates/buzz-core/src/channel.rs:59-95`) — one of four channel types (`Stream`, `Forum`, `Dm`, `Workflow`). There is no separate "conversations" table or protocol family — a DM is a `channels` row like any other, just with `channel_type='dm'` and a fixed participant list. This is architecturally identical to SWF Buzz's own already-documented `kind:41010` DM-channel model (see `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md`) — old Buzz and SWF Buzz agree on this shape already, which is a useful confirmation rather than a gap.

### Creating a 1:1 (or group) DM

```
NewMessageScreen.tsx (features/messages/ui/) — a dedicated "compose" screen, not a modal:
  the normal chat header is replaced by an inline "To:" field; recipient discovery happens in
  an attached popover (Popover/PopoverAnchor/PopoverContent), not a full-screen takeover.
  ↓
useNewMessageRecipients() — searches a per-community user directory as you type
  (deferredSearchQuery for debounce, isDirectoryLoading, hasReachedRecipientLimit — implying a
  cap on how many recipients a single DM/group-DM can have, exact number UNVERIFIED this pass),
  renders results via NewMessageResultRow, supports multi-select (selectedUsers/removeUser) —
  confirming GROUP DMs (more than 2 participants) are supported, not just 1:1.
  ↓
User selects one or more recipients → composes a message → send
  ↓
usePrepareDmSendChannel() (features/channels/ui/) — before the first real send, resolves which
  DM channel this should land in:
    - if there's already an active DM channel with EXACTLY this participant set → reuse its id
    - if additional participants were added beyond an existing DM's current set → calls
      openDmMutation (see below) to get/create the EXPANDED-participant DM, since a DM's
      participant list is otherwise fixed once created (this is the "add a participant to a DM"
      case — it produces a distinct/expanded channel via openDm rather than mutating one in place)
  ↓
useOpenDmMutation() → openDm({ pubkeys }) → Tauri command invoke("open_dm", { pubkeys, ... })
  (tauriChannels.ts:193) — signing and the actual relay event happen in the Rust backend, exactly
  like every other signed action in this codebase (§9 of the workflow blueprint: "the raw key
  never reaches the JS webview"). This returns the Channel record (new or pre-existing,
  idempotently — opening a DM with the same participant set twice returns the same channel).
  ↓
Client caches the returned channel (upsertCachedChannel), removes it from the "hidden DM"
  visibility set if it had been hidden, and navigates to it (goChannel).
```

### User discovery

Recipient search in `NewMessageScreen` is scoped to the **current community's own member/user directory** (`useNewMessageRecipients`) — there is no cross-community or global user search found. This matches the general pattern in this codebase (no cross-community anything except the platform admin console) and matches SWF Buzz's own existing DM implementation, which likewise discovers DM recipients from the current relay's known users.

### Message storage, ordering, read/unread

- **Storage**: `[INFERRED, not independently re-traced this pass]` DM messages are very likely the same `KIND_STREAM_MESSAGE` (kind:9) as channel messages, scoped by the DM channel's own id via the `h`-tag, exactly like every other channel — no separate DM message kind was found referenced anywhere in the five existing audits or this pass's kind-registry spot-check.
- **Ordering**: `[INFERRED]` same as channel messages — `created_at`-ordered, same ingest pipeline (§ Stage 7 of the workflow blueprint) applies uniformly to any channel type including `dm`.
- **Read/unread state**: `useChannelUnreadState.ts` (in `features/channels/ui/`) is shared across channel types per its location — `[INFERRED]` DMs use the same unread-tracking mechanism as regular channels, not a separate one. `hiddenDmResurfaceAction.ts` / `hiddenDmInboxAction.ts` suggest a DM can be explicitly "hidden" (removed from the visible sidebar without leaving/deleting it) and later "resurfaced" — this is a DM-specific affordance with no channel equivalent found, `UNVERIFIED` exact trigger mechanism (likely a context-menu action, not independently opened this pass).

### The "Home"/"Inbox" surface — a DM-specific aggregate view

`features/home/` (`HomeView.tsx`, `InboxListPane.tsx`, `InboxDetailPane.tsx`, `InboxMessageRow.tsx`, `lib/inbox.ts`, `lib/inboxListRows.ts`, `lib/inboxSelection.ts`) is a **separate top-level view from the channel sidebar**, distinct from `AppSidebar`'s inline DM section — `[INFERRED]` this is likely a dedicated "all your DMs, sorted by recency, like an email inbox" screen, given the naming convention (`InboxListPane`/`InboxDetailPane` mirroring a classic master-detail inbox layout). This is a genuinely new finding for the UI map (§I) — old Buzz appears to offer DM access through **two** distinct surfaces (an inline sidebar section, and a dedicated Home/Inbox screen), not one. Exact relationship between the two (is Home the default landing view? does the sidebar DM section duplicate or subset the inbox list?) is `UNVERIFIED` — worth a follow-up screen-by-screen pass before SWF Buzz commits to replicating both surfaces or consolidating to one.

### Notifications, blocking

`[UNVERIFIED]` — no DM-specific notification or user-blocking mechanism was found cited in the existing docs or located during this pass's targeted search. Not confirmed to exist; not confirmed to be absent either — flag as an open item rather than assert either way.

---

## H. Channel Conversations

Messaging mechanics (posting, the ingest pipeline, ordering) are the same as DMs (§G) since both ride the same `channels`/kind:9 substrate — fully covered already in `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` Stage 7 (the exact 11-step ingest gate order: write-fence → kind allowlist → signature → timestamp drift ≤15min → content size ≤256KiB → pubkey match → scope check → ban/timeout write-block → h-tag required → token channel-scope check → channel membership check).

Not independently re-verified this pass (existing docs don't cite these specifically, and this pass's time budget prioritized the previously-uncovered sections B/C/G/I/J): mentions/threading/reactions UI-level behavior inside a channel (as opposed to the protocol-level kind existence, which SWF Buzz's own `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` already documents independently for its own implementation). `MessageComposer` and `ChannelPane.tsx` are the relevant old-Buzz files (seen during this pass's directory search for DM-related code, §G) but their exact UI behavior for mentions/threads/reactions was not opened. `UNVERIFIED` — recommend a targeted follow-up read of `ChannelPane.tsx`/`MessageComposer.tsx` before SWF Buzz's own threading/mention/reaction UI is declared at parity, though SWF Buzz's protocol-level implementation of these features has already been independently verified against relay behavior per its own `PROTOCOL_IMPLEMENTATION_REFERENCE.md`.

---

## I. UI / UX Audit

**New research this pass.** A real screen map, built from actually reading the component tree (`AppShell.tsx` → its children), not from feature descriptions alone.

```
AppShell.tsx (top-level layout, desktop/src/app/)
│
├─ LEFT: CommunityRail.tsx — vertical icon rail, one row per connected community
│    - click a community icon → switches active community context
│    - right-click → context menu: Mark all read, [Invite], Edit community settings
│    - bottom of the rail: "+" → "Add community" → EditCommunityDialog (§B — connects to an
│      existing relay by URL; does NOT provision a new one)
│
├─ LEFT-CENTER: AppSidebar.tsx (features/sidebar/ui/) — within the active community:
│    - SidebarProfileCard.tsx — current user's own identity card, likely top of the sidebar
│    - Channel list, sectioned (CustomChannelSection.tsx, SidebarSection.tsx) — supports
│      user-defined sections/folders (createSection, assignChannel — drag-to-organize via
│      SidebarDnd.tsx), starred channels, per-section sort mode
│    - "+" control per section → CreateChannelDialog.tsx (§C)
│    - Direct Messages section — sortDmChannelsForSidebar, useProtectedVisibleDirectMessages
│      (a "protected feature component" — [INFERRED] likely a feature-flag/entitlement gate,
│      not independently traced this pass)
│    - SidebarRelayConnectionCard.tsx — connection status indicator (mirrors SWF Buzz's own
│      ConnectionBadge.vue concept)
│    - MoreUnreadButton.tsx — likely a "jump to next unread" affordance
│
├─ CENTER: the active channel/DM's own pane — [INFERRED from file names seen this pass, not
│    independently opened] ChannelPane.tsx (features/channels/ui/) renders header + message
│    list + composer for a selected channel; NewMessageScreen.tsx (§G) replaces this pane's
│    header with an inline "To:" field specifically for the DM-compose case.
│
├─ SEPARATE TOP-LEVEL VIEW: HomeView.tsx (features/home/ui/) — InboxListPane.tsx +
│    InboxDetailPane.tsx, a master-detail DM inbox (§G) — [UNVERIFIED] exact relationship to
│    the sidebar's own inline DM section; flagged as an open question, not assumed to be
│    either "the same list twice" or "two genuinely different scopes."
│
└─ Community-scoped settings/management surfaces (existing docs, not re-opened this pass):
     - CommunityMembersSettingsCard.tsx — member list + management, gated `owner|admin`
     - ModerationQueueCard.tsx — reports + audit tabs, gated `owner|admin`
     - AddMemberDialog.tsx — add member / mint invite, role selector gated to admin's ceiling
     - ChannelManagementModerationActions.tsx / MembersSidebar.tsx — per-channel management
```

**Modals/dialogs inventory** (every one found cited across this pass and the existing docs): `EditCommunityDialog` (add/edit community connection), `CreateChannelDialog` (+ `CreateChannelFormFields`), `AddMemberDialog`, `ChannelSectionDialogs` (sidebar section management), `WelcomeAgentCreateDialog` (excluded feature, Local Agents), `PersonaShareDialog` (excluded feature, Local Agents), `AgentCardViewerDialog` (excluded feature).

**Context menus found**: `ChannelContextMenu.tsx` (per-channel right-click in the sidebar), the `CommunityRail` community right-click menu (Mark all read / Invite / Edit settings — inline in `CommunityRail.tsx:262-281`), `MessageModerationMenuItems.tsx` (per-message moderator actions, existing docs).

---

## J. Responsive Behavior

**New research this pass — thin by necessity, not by omission.** Old Buzz's repository structure (per `docs/RECONNAISSANCE.md:16`) includes a **separate `mobile/` client directory** — this strongly suggests old Buzz's answer to "mobile" is a distinct native/hybrid mobile app, not a responsive breakpoint of the same desktop React codebase. This pass did not open the `mobile/` client's source (out of scope for a desktop-parity audit unless SWF Buzz's own roadmap includes a mobile target — flag this as a scoping question rather than assume it's needed).

Within the desktop app itself: no responsive/breakpoint/media-query logic was found cited in any of the five existing audits, and this pass's own targeted search (`grep -i "responsive|mobile|tablet|viewport"` across all `docs/*.md`) returned exactly one relevant hit — `docs/ADMIN_PANEL_REVERSE_ENGINEERING_REPORT.md:410`, about the **separate `admin-web` browser console** (not the desktop app): *"single fixed header... No sidebar. No responsive hamburger/collapse logic found in the read component code."* That finding is about `admin-web`, a different product surface entirely, and should not be assumed to describe the main desktop app's behavior.

**Conclusion, stated plainly rather than papered over**: responsive/tablet/mobile behavior for old Buzz's *main product* (the one this whole audit otherwise concerns) is **UNVERIFIED** — this pass found no evidence either that the desktop app has deliberate responsive breakpoints, or that it doesn't. A dedicated follow-up pass reading the desktop app's own CSS/layout code (not just component logic) would be needed to answer this properly, and/or a decision on whether `mobile/`'s separate client is in scope for SWF Buzz at all (the original master prompt's stack choices — Vue 3 + Tauri 2 desktop client — suggest SWF Buzz's own scope is desktop-only, in which case old Buzz's separate mobile client is likely out of scope by the same logic that excluded Local Agents/Git bridge, but this is a product decision, not something this audit should decide unilaterally).

---

## K. API / Database Audit

Fully covered, unchanged from the existing audit — `docs/ROLE_PERMISSION_AUDIT.md` §13-§14, `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §10 (including the Mermaid ER diagram). Reproduced compactly; see those documents for the complete endpoint list and every table's full column set.

### Data relationship (verified structure, headline finding preserved from existing docs)

```
communities (root tenant)
 ├─ FK → channels
 ├─ FK → relay_members         [role: owner/admin/member]
 ├─ FK → relay_invites         [role hard-pinned to 'member']
 ├─ FK → users                 [profile only — NOT an authz hub]
 ├─ FK → moderation_reports, community_bans, moderation_actions

channels
 └─ FK → channel_members       [role: owner/admin/member/guest/bot — SEPARATE lattice]

relay_operators                [platform-wide — NO community_id column, deliberately]
 └─ (no FK to anything — deployment-global roster)
```

**Critical, load-bearing finding preserved from the existing audit**: there is **no unified `users` foreign-key hub**. `users.pubkey` (BYTEA), `relay_members.pubkey` (TEXT/hex — a structural type mismatch that makes an FK to `users` impossible even by convention), and `relay_operators.pubkey` (BYTEA, deployment-global) are three disjoint identity surfaces with zero referential integrity between them. Every join between them (e.g. showing a display name next to a role) happens at the SQL-query level, not via a schema constraint. This is directly relevant to SWF Buzz's own Okta↔Nostr identity question (see the companion gap-analysis document) — old Buzz's own architecture already tolerates loosely-coupled identity surfaces, which is precedent for SWF Buzz's `users.okta_user_id` column (confirmed present in the live local schema this session) being a similarly loose, non-FK-enforced link rather than a blocker.

### Privileged endpoints (table, unchanged from existing audit)

| Method | Path | Role |
|---|---|---|
| POST | `/api/invites` | community owner/admin |
| POST | `/api/invites/claim` | any authenticated identity |
| GET/POST | `/moderation/*` (reports, audit, restricted) | community owner/admin |
| GET/PUT/DELETE | `/api/admin/v1/operators*` | Operator only |
| GET/POST | `/api/admin/v1/reports*`, `/feedback*` | Operator or Moderator |
| POST | `/operator/communities*` (provision/archive/unarchive/transfer/list/availability) | `RELAY_OPERATOR_PUBKEYS` allowlist directly |

### Nostr event kinds relevant to this audit (community/channel/DM plane — moderation kinds unchanged from existing docs)

| Kind | Name | Notes |
|---|---|---|
| 9007 | Create group/channel | `Scope::ChannelsWrite` only — **any member**, confirmed this pass |
| 9000/9001/9002 | Put/remove/edit channel member | channel-role gated |
| 9021/9022 | Join/leave (open channels self-service) | — |
| 9030/9031/9032 | Add/remove/change-role (community) | owner/admin per §A |
| 9040-9044 | Ban/unban/timeout/untimeout/resolve | owner/admin per §A |
| 1984 | Report (NIP-56) | any member, no gate |
| (DM open) | via Tauri `open_dm` command → relay event, exact kind not independently re-confirmed this pass | `[INFERRED]` almost certainly reuses `KIND_STREAM_MESSAGE`'s channel-creation path (kind:9007 with `channel_type=dm`) rather than a bespoke DM-open kind, since `ChannelType::Dm` is just one variant of the same `channels` row shape (§G) — not verified at the exact wire-tag level this pass. |

---

*Compiled this pass from: (1) direct reading of the five existing source-verified audit documents in this repo, (2) five spot-checks against current `../buzz` source (all confirmed accurate, see the report accompanying this document), (3) fresh source research this session into direct messages, community/channel creation UI, and the on-screen layout map — the three areas the existing documents did not cover. Old-Buzz repo root: `C:\Users\Pranshul\Downloads\buzz2.0\buzz`, read-only throughout. Treat `UNVERIFIED`-flagged items as genuinely open questions, not gaps to silently fill with invented behavior.*
