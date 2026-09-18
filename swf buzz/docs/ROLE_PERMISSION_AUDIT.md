# Buzz Role & Permission Audit

**Source-verified inventory of every role, permission, and privileged surface in the Buzz codebase (`buzz2.0/buzz`), compiled to scope SWF Buzz's feature parity.**

Audited: 2026-09-15 · Method: 6 parallel, independently-sourced research passes over the Buzz monorepo (read-only), cross-verified against each other · Every claim below is backed by an exact `file:line` citation. Treat this document as a snapshot — re-verify citations against current source before relying on them for implementation. This complements, and is broader in scope than, `ADMIN_PANEL_REVERSE_ENGINEERING_REPORT.md` (which focuses specifically on the admin-panel implementation path); this document is the full role/permission/RBAC audit across the entire codebase (backend, database, and all client frontends).

**Scope instruction this audit was run against:** "Return all Buzz app functionality except (1) Local Agents, (2) Git access / Git app-level checks. Everything else should be included."

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [All discovered roles](#2-all-discovered-roles)
3. [Role hierarchy](#3-role-hierarchy)
4. [Role → permission matrix](#4-role--permission-matrix)
5. [Role → feature matrix](#5-role--feature-matrix)
6. ["Super Admin" / platform admin capabilities](#6-super-admin--platform-admin-capabilities--there-is-none-operator-is-the-ceiling)
7. [Moderator capabilities](#7-moderator-capabilities)
8. [Community owner capabilities](#8-community-owner-capabilities)
9. [Community admin capabilities](#9-community-admin-capabilities)
10. [Member / normal user capabilities](#10-member--normal-user-capabilities)
11. [All admin / privileged features found](#11-all-admin--privileged-features-found)
12. [Admin UI surfaces](#12-admin-ui-surfaces)
13. [Privileged API endpoints](#13-privileged-api-endpoints)
14. [Database role/permission models](#14-database-rolepermission-models)
15. [Hidden / backend-only features](#15-hidden--backend-only-features)
16. [Features currently missing from the frontend](#16-features-currently-missing-from-the-frontend)
17. [Features that must be implemented in SWF Buzz](#17-features-that-must-be-implemented-in-swf-buzz)
18. [Features to exclude](#18-features-to-exclude)
19. [Recommended SWF Buzz role architecture](#19-recommended-swf-buzz-role-architecture)
20. [Master capability table](#20-master-capability-table)

---

## 1. Executive summary

> **VERDICT: No Super Admin exists.** Verified against source, docs, and tests — see §6.

Buzz has **no single top-of-hierarchy "Super Admin" or "Platform Admin" role**. Instead it runs **three independent role planes** that do not inherit from one another, plus one cross-cutting capability system:

- **Platform** — deployment-wide `Operator` / `Moderator`, resolved from config (`RELAY_OPERATOR_PUBKEYS`) or a `relay_operators` DB roster. `auth.rs:48-55`
- **Community** — per-tenant `owner` / `admin` / `member`, stored in `relay_members`. `migrations/0001:577`
- **Channel** — per-channel `Owner` / `Admin` / `Member` / `Guest`, plus a non-hierarchical `Bot` designation. `channel.rs:102-158`
- **Cross-cutting** — API-token `Scope` bits (16 variants, e.g. `AdminChannels`, `AdminUsers`) and agent-owner delegation. `scope.rs:16-86`

**Operator is the highest-privilege role that exists** — it is deployment-root: it staffs the Operator/Moderator roster, provisions/archives/transfers communities, and can act on every report and feedback item across every tenant. There is no role above it. The design doc is explicit that a third community tier and any future platform-wide super-admin surface are *deliberately deferred, not built*:

> "Two roles, not three… There is no volunteer-moderator tier yet — deliberately." — `VISION_MODERATION.md:57`
> "Decide any future operator-global super-admin surface separately." — `multi-tenant-conformance.md:45`

The single biggest gap discovered: **the backend fully supports staffing and report-resolution APIs that the standalone admin frontend (`admin-web`) never surfaces.** There is no UI to list/add/remove Operators or Moderators, and the Reports page is read-only despite `resolve`/`reopen`/`cancel` endpoints existing server-side. See §15–§16.

Everything catalogued below is in scope for SWF Buzz except two self-contained subsystems confirmed to have no authorization dependency on anything else in this report: **Local Agents** (kinds 10100, 30174–30179, 24200, 44200, 43001–43006, the `buzz-agent` crate, managed-agent lifecycle) and **Git bridge / git-app checks** (`git-credential-nostr`, `git-sign-nostr`, `git_perms.rs`, the `api/git/*` Smart-HTTP subsystem). See §18.

---

## 2. All discovered roles

Every role name that actually appears in code, verbatim, with its defining source and scope. No role below was inferred or assumed — each has a direct citation.

| Role | Scope | Defined in | Storage | Assigned by | Removed by |
|---|---|---|---|---|---|
| **Operator** | Platform-wide | `AdminRole::Operator` `auth.rs:48-55` | Config `RELAY_OPERATOR_PUBKEYS`, or DB `relay_operators` row | Deployment config edit, or an existing Operator via `PUT /operators/:pubkey` | Config edit, or an Operator via `DELETE /operators/:pubkey` (blocked if it would leave zero operators) |
| **Moderator** | Platform-wide | `AdminRole::Moderator` `auth.rs:48-55` | DB `relay_operators` row only (no config path) | An Operator via `PUT /operators/:pubkey` | An Operator via `DELETE /operators/:pubkey` |
| **owner** | Per-community | `relay_members.role` `migrations/0001:577` | `relay_members` table, PK `(community_id, pubkey)` | `RELAY_OWNER_PUBKEY` config bootstrap, or the current owner via ownership transfer | Never directly removable — only *replaced* via transfer (demotes prior owner to `member`) |
| **admin** | Per-community | `relay_members.role` `migrations/0001:577` | `relay_members` table | Owner only, via kind:9032 `relay_admin.rs:424-426` | Owner (removes admin/member freely) or self |
| **member** | Per-community | `relay_members.role` `migrations/0001:577` | `relay_members` table | Owner/admin via kind:9030, or invite claim (role pinned to `member`) | Owner/admin via kind:9031, or self-leave |
| **Owner** (channel) | Per-channel | `MemberRole::Owner` `channel.rs:102-158` | `channel_members.role` (Postgres enum `member_role`) | Channel creation, or grant by an existing elevated (owner/admin) member | Cannot be removed/demoted while sole owner (`is_sole_owner`) |
| **Admin** (channel) | Per-channel | `MemberRole::Admin` `channel.rs:102-158` | `channel_members.role` | Grant by owner/admin (kind:9000) | Owner/admin (kind:9001), or self |
| **Member** (channel) | Per-channel | `MemberRole::Member` `channel.rs:102-158` | `channel_members.role` | Open-channel self-join, or invite/add | Owner/admin, or self-leave |
| **Guest** (channel) | Per-channel | `MemberRole::Guest` `channel.rs:102-158` | `channel_members.role` | Grant by owner/admin | Owner/admin |
| **Bot** (channel) | Per-channel, non-hierarchical | `MemberRole::Bot`, `permission_level()=0` `channel.rs:142-150` | `channel_members.role` | Added by any member (subject to `channel_add_policy`), owned by an `agent_owner_pubkey` | Owner/admin, or the human who owns the bot |
| **agent-owner** (delegation, not a role) | Cross-cutting | `users.agent_owner_pubkey` `migrations/0001:154-175` | `users` table, self-referencing FK | First-mint-wins at agent creation | N/A — fixed provenance link, not reassignable |

A resolved-authority label appears in the moderation code — `ModerationAuthority::{CommunityOwner, CommunityAdmin, ChannelRole}` (`moderation_authz.rs:61-69`) — but this is a decision *output*, not a role name; it records which of the two role planes granted authority for a given moderation action.

**Confirmed absent** — searched directly, zero matches: `SuperAdmin`, `super_admin`, `PlatformAdmin`, `platform_admin`, and any third role string in the community CHECK constraint beyond `owner/admin/member`. A git-scope test even asserts `push:superadmin` fails to parse as a role (`git_perms.rs:775-780`) — confirming the shared role vocabulary stops at `owner|admin|member|guest|bot` everywhere in the codebase.

---

## 3. Role hierarchy

Three separate lattices. A pubkey's position in one plane says nothing about its position in another — a community owner is not automatically a channel owner, and a channel owner is not automatically a platform Moderator.

```
PLATFORM PLANE                  COMMUNITY PLANE              CHANNEL PLANE
───────────────                 ────────────────              ─────────────
Operator                        owner                         Owner   (level 4)
  staffs roster                   unrestricted; can ban/         full control, delete channel,
  provisions/archives/            timeout admins; changes         immune to demotion if sole owner
  transfers communities           any role; transfers owner
  acts on all reports/feedback                                Admin   (level 3)
                                 admin                           manage members/settings,
Moderator                         ban/timeout members only,       cannot delete channel
  acts on reports/feedback        not owner/fellow admins;
  cannot staff/provision          cannot change roles           Member  (level 2)
                                                                   standard participant
                                 member
                                   report content, join/leave;  Guest   (level 1)
                                   no management authority         read-only external participant

                                                                Bot     (level 0, non-hierarchical)
                                                                  automated participant
```

**The one documented bridge between planes:** when a moderation action has no community-level authority (actor isn't community owner/admin), the authorizer falls back to the actor's *channel* role for exactly two actions — `DeleteMessage` and `Kick` — via `ModerationAuthority::ChannelRole`. Every other moderation action (ban/timeout/unban/untimeout/resolve-report) requires community owner/admin; channel role alone is insufficient. `moderation_authz.rs:146-181`

**Second bridge:** agent-owner delegation — a human who owns an agent inherits that agent's channel authority (e.g. can delete a channel the agent "owns"). `ChannelManagementModerationActions.tsx:52-95`

---

## 4. Role → permission matrix

`YES` = code-confirmed allowed · `COND` = allowed with a restriction (see cell) · `NO` = code-confirmed blocked · `—` = not applicable to this role.

| Permission | Member | Ch. Admin | Ch. Owner | Comm. Admin | Comm. Owner | Moderator | Operator |
|---|---|---|---|---|---|---|---|
| Submit report (kind:1984) | YES | — | — | YES | YES | — | — |
| View moderation queue | NO | — | — | YES | YES | YES | YES |
| Delete a message (other author) | NO | YES | YES | YES | YES | — | — |
| Kick from channel | NO | YES | YES | YES | YES | — | — |
| Ban / unban (community-wide) | NO | NO | NO | COND (not vs. owner/admin) | YES | — | — |
| Timeout / untimeout | NO | NO | NO | COND (not vs. owner/admin) | YES | — | — |
| Resolve / dismiss / escalate report | — | — | — | YES | YES | — | — |
| Add community member | — | — | — | YES | YES | — | — |
| Remove community member | — | — | — | COND (member-role targets only) | COND (not other owner) | — | — |
| Change community member role | — | — | — | NO | YES | — | — |
| Transfer community ownership | — | — | — | NO | COND (via operator endpoint) | — | YES |
| Create invite | NO | — | — | COND (member-role only) | YES | — | — |
| Grant elevated channel role | NO | YES | YES | — | — | — | — |
| Edit channel name/visibility/TTL | NO | YES | YES | — | — | — | — |
| Archive / unarchive channel | NO | YES | YES | — | — | — | — |
| Delete channel | NO | NO | YES | — | — | — | — |
| Provision new community | — | — | — | — | — | NO | YES |
| Archive / transfer any community | — | — | — | — | — | NO | YES |
| Staff Operator/Moderator roster | — | — | — | — | — | NO | YES |
| Manage product feedback status | — | — | — | — | — | YES | YES |

The "not vs. owner/admin" guard rail is enforced in code, not just convention: `anyhow::bail!("an admin cannot ban or time out a community owner or fellow admin")` (`moderation_authz.rs:163-169`), unit-tested at `moderation_authz.rs:239-273`.

---

## 5. Role → feature matrix

| Feature area | Member | Community Admin | Community Owner | Moderator | Operator |
|---|---|---|---|---|---|
| User-facing chat (channels, DMs, reactions, threads) | YES | YES | YES | COND (as a user, not a capability) | COND (as a user, not a capability) |
| Community management (members, roles, invites) | NO | COND (partial) | YES | NO | COND (provisioning only, not roster) |
| Channel management | NO | COND (via channel role, not community role) | COND (via channel role) | NO | NO |
| Moderation (ban/kick/timeout/delete-content) | NO | COND (restricted vs. owner/admin) | YES | NO | NO |
| Reports queue (community-scoped) | NO | YES | YES | NO | NO |
| Reports/feedback console (deployment-wide) | NO | NO | NO | YES | YES |
| Staff management (Operators/Moderators) | NO | NO | NO | NO | YES |
| Platform provisioning (create/archive/transfer communities) | NO | NO | NO | NO | YES |
| Audit log access | NO | YES (community) | YES (community) | UNKNOWN (not surfaced in admin-web) | UNKNOWN (not surfaced in admin-web) |
| Platform settings / deployment config | NO | NO | NO | NO | NO — env-var only, no UI/API found |
| Local Agents *(excluded)* | — | — | — | — | — |
| Git bridge *(excluded)* | — | — | — | — | — |

Note the asymmetry in row 3: even an Operator has **no route into per-community moderation or channel management** — those authorities live entirely on the community/channel planes. Operator's power is staffing + provisioning + the deployment-wide report/feedback console; it does not grant community-owner rights inside any specific tenant.

---

## 6. "Super Admin" / platform admin capabilities — there is none; Operator is the ceiling

Operator is the highest-privilege role Buzz has. It is not called "Super Admin" anywhere, and it does not have community- or channel-scoped powers by virtue of being Operator.

**What Operator can do:**
- Read and act on every report and feedback item, deployment-wide — `GET/POST /api/admin/v1/reports*`, `/feedback*` (`admin/mod.rs:46-62`)
- List, add, and remove Operators and Moderators — `GET/PUT/DELETE /api/admin/v1/operators*`, gated by `require_operator` (`auth.rs:325-334`, `admin/mod.rs:903-1088`)
- Provision a brand-new community (creates host + bootstraps owner) — `POST /operator/communities` (`operator.rs:153`)
- Archive / unarchive any community, disconnecting all live cluster connections — `POST /operator/communities/archive|unarchive` (`operator.rs:207,269`)
- Transfer ownership of any community (demotes the prior owner to `member`) — `POST /operator/communities/transfer` (`operator.rs:358`)

**What Operator cannot do:**
- Cannot moderate inside a community it doesn't own (no ban/kick/timeout authority — that's community owner/admin only)
- Cannot manage channels (channel role, not platform role, governs that)
- Has no deployment-configuration UI/API of any kind — deployment settings (admin host, auth mode, operator pubkeys) are environment variables, edited outside any admin surface

> **Two things both called "operator," scoped differently.** `AdminRole::Operator` (admin console — reports, feedback, staffing) resolves from config *or* the `relay_operators` DB table. The separate `/operator/communities*` provisioning control plane checks `RELAY_OPERATOR_PUBKEYS` config **directly** (`operator.rs:60-106`) — a DB-only Operator (added via the roster API, not present in the config list) can staff and resolve reports, but **cannot** provision/archive/transfer communities. SWF Buzz must decide deliberately whether to preserve this split or unify it — don't assume the two "operator" checks are the same gate.

Break-glass path: if `RELAY_OPERATOR_PUBKEYS` is empty, the pubkey in `RELAY_OWNER_PUBKEY` is automatically treated as Operator (`AdminSource::OwnerFallback`) — a self-hoster's own identity always has a way in. `auth.rs:59-68,271-281`

---

## 7. Moderator capabilities

Moderator is the second, and only other, platform-plane role. It shares the read/act-on-reports-and-feedback surface with Operator but is explicitly walled off from staffing and provisioning.

- **YES** — read reports and feedback, deployment-wide (`admin/mod.rs:191,281`)
- **YES** — resolve / reopen / cancel reports, update feedback status (`admin/mod.rs:468,679,765,841`)
- **NO** — staffing endpoints: `require_operator` returns 403 with message *"staffing endpoints require operator role"* (`auth.rs:326-334`)
- **NO** — community provisioning/archive/transfer (Moderator pubkeys are never in the separate `RELAY_OPERATOR_PUBKEYS` allowlist by definition) (`operator.rs:93-103`)

> **Under-tested rule, worth re-verifying when building SWF Buzz:** the test `moderator_cannot_access_staffing_endpoints` is an empty stub that only comments *"Covered by negative-matrix integration test suite"* — no such suite exists anywhere in the repo (confirmed by grep). The 403 gate is real code (`require_operator`), but has no direct automated test exercising a genuine Moderator principal. `admin/mod.rs:2849-2854`

Moderator can only be granted via the DB roster (`PUT /operators/:pubkey` with `role: "moderator"`) — there is no config-file path to Moderator, unlike Operator's `RELAY_OPERATOR_PUBKEYS`/owner-fallback routes.

---

## 8. Community owner capabilities

The unrestricted authority inside one tenant. `decide_authority` grants owner every moderation action with **no guard rail** (`moderation_authz.rs:154`) — the only role for which that's true.

- Ban / unban / timeout / untimeout *any* member, including fellow admins — kinds 9040-9043 (`kind.rs:342-351`)
- Resolve, dismiss, or escalate any report, with cascading delete/kick/ban/timeout — kind 9044 (`kind.rs:356`)
- Add member (kind:9030), remove member or admin but never another owner (kind:9031) (`relay_admin.rs:315-397`)
- **Sole authority** to promote/demote roles — kind:9032, owner-only, cannot self-target, and cannot promote anyone to owner through this path (ownership change requires the config-driven transfer flow instead) (`relay_admin.rs:424-441`)
- Set workspace profile/icon — kind:9033 (`relay_admin.rs`)
- Create invites at any allowed role (invite links are still pinned to `member` at the DB layer regardless of who mints them) (`migrations/0025:18-31`)
- View the community moderation queue and audit log — `GET /moderation/reports`, `/audit` (`bridge.rs:2422-2463`)

Structural protections: an owner cannot be removed by the CLI (`"role 'owner' cannot be set via CLI"`, `buzz-admin/main.rs:302-313`), cannot be deleted at the DB layer (`DELETE ... WHERE role <> 'owner'`, `relay_members.rs:251-284`), and is capped at **5 owned communities** by default (`MAX_COMMUNITIES_PER_OWNER`, overridable via `BUZZ_MAX_COMMUNITIES_PER_OWNER`) (`relay_members.rs:456,464-473`). Ownership can only change via transfer, which demotes the outgoing owner to plain `member` — not `admin` — "the former owner retains no management capabilities" (`relay_members.rs:509-511`).

---

## 9. Community admin capabilities

Everything an owner can do, minus role changes, minus authority over the owner and fellow admins.

- Ban / timeout members — **except** a target whose role is `owner` or `admin`; that call fails with *"an admin cannot ban or time out a community owner or fellow admin"* (`moderation_authz.rs:163-169`)
- Add members (kind:9030) — but cannot grant the `admin` role to anyone (owner-only per kind:9030's own check) (`relay_admin.rs:326-328`)
- Remove members — only targets whose role is plain `member`, enforced via an atomic conditional delete (`remove_relay_member_if_role`) (`relay_admin.rs:379-384`)
- Cannot change any role (kind:9032 is owner-only) (`relay_admin.rs:424-426`)
- Resolve/dismiss/escalate reports, same as owner (`kind.rs:356`)
- Set workspace profile/icon, same as owner (`relay_admin.rs`)
- Create invites — but only at role `member`; the invite dialog filters out the "admin" option unless the inviter is the owner (`AddMemberDialog.tsx:129-132`)
- View moderation queue/audit log, same as owner

---

## 10. Member / normal user capabilities

Base community role and base channel role. No management or moderation authority in either plane.

- Submit a report against a message, user, or blob — kind:1984, no role gate on submission at all (`report.rs:44-94`)
- Join (self-service, open channels or via invite) and leave (kind:9021/9022) — protected so the sole owner cannot self-remove (`channel_authz.rs:77-88`)
- Post messages; edit/delete *own* messages only (self-authorship check, not a role check) (`canManageMessage.ts:17-30`)
- Remove an agent it personally owns from a channel, even without elevated role (`CheckAgentOwner` path) (`channel_authz.rs:210-216`)
- Cannot ban/kick/timeout anyone, cannot view the moderation queue, cannot add/remove other members, cannot change any role, cannot delete/archive/edit a channel it doesn't own or administer

The `Guest` channel tier sits below Member (`permission_level 1` vs `2`) and is explicitly documented as "read-only external participant" (`channel.rs:102-158`) — confirmed in code as the lowest human-facing tier; no separate behavior beyond the permission-level comparison was found gating it further.

---

## 11. All admin / privileged features found

**User management**
- Community-scoped ban/unban, timeout/untimeout (kinds 9040-9043, `community_bans` table) — no *global* cross-community ban exists; every restriction is per-`community_id`, proven by test `moderation.rs — restrictions_are_confined_to_their_community, line 895-941`
- No standalone "search users" admin page exists anywhere audited — user lookup happens contextually (community member list, report detail)

**Community management**
- Create (provision), archive, unarchive, transfer — all via the Operator-only control plane (`operator.rs`)
- Manage members, promote/demote, settings — via owner/admin roster commands (`relay_admin.rs`)

**Channel management**
- Create, edit, delete, archive, permissions, membership — all channel-role-gated (`channel_authz.rs`, `side_effects.rs:313+`)

**Moderation**
- Reports (submit/resolve/dismiss/escalate/reopen/cancel), content deletion, kick, ban, timeout, unban, untimeout, audit trail — see §4, §13

**Platform management**
- Community provisioning/archive/transfer (Operator) — no separate "global users" or "global channels" console was found; Operator's reach is reports/feedback/staffing/provisioning only
- No system-health/metrics/service-status admin surface was found in `admin-web` or the admin API router

**Staff management**
- List/add/remove Operators and Moderators, with a last-operator invariant and an append-only grant/revoke audit trail (`relay_operator_audit`) (`relay_operators.rs`)

**Feedback**
- List, filter (community/time/status), detail view, status update (new/reviewed/archived), attachment viewing with server-verified MIME sniffing (`admin/mod.rs:281-379,841`, `App.tsx:715-751`)

**Security**
- NIP-98 request signing for every admin/operator call, replay-guarded, with Host/Origin binding (`auth.rs:188-237`)
- API tokens with scoped capabilities and channel restriction, max 10 active per (community, owner) (`api_token.rs:62-70`)

---

## 12. Admin UI surfaces

### admin-web (standalone SPA) — the only dedicated admin frontend

| Route | Component | Role required (client-side) | Actions available | Backend calls |
|---|---|---|---|---|
| `/reports` (default) | `Reports` (`App.tsx:96-144`) | none — server 403s | Browse open reports only; no resolve/dismiss UI | `GET /reports?status=open&limit=100` |
| `/reports/:id` | `ReportDetail` (`App.tsx:146-219`) | none | Read-only detail — **no action buttons at all**, despite the backend supporting resolve/reopen/cancel | `GET /reports/{id}` |
| `/feedback` | `FeedbackList` (`App.tsx:221-379`) | write requires `authMode==="nip98"` | Search, filter by community/time/status, change status inline | `GET /feedback`, `PATCH /feedback/{id}` |
| `/feedback/:id` | `FeedbackDetailView` (`App.tsx:516-597`) | none | View body + attachments | `GET /feedback/{id}`, attachment fetch |

**No route exists for:** user management, community management, channel management, staff/role management (`/operators` has zero UI), platform settings. There is also no login page — "authentication" is holding a NIP-07 browser-extension key the relay's roster recognizes; the frontend never distinguishes Operator from Moderator (it never calls the purpose-built `GET /probe` endpoint that exists specifically to let a UI discover its own role and capabilities) (`admin/mod.rs:125-142`).

### Desktop/web/mobile clients — role-gated features inside the main product

| Surface | Gate | File |
|---|---|---|
| Community Members settings card | `currentRole === "owner" \|\| "admin"` | `CommunityMembersSettingsCard.tsx:255` |
| Moderation queue panel | `role === "owner" \|\| "admin"` (hidden otherwise, with explanatory text) | `ModerationQueueCard.tsx:564-586` |
| Per-message moderator menu (ban/timeout/kick author) | `relayRole === "owner" \|\| "admin"` | `MessageModerationMenuItems.tsx:49-63` |
| Members-sidebar ban/timeout actions | same relay-role check, reused hook | `useMembersSidebarModeration.ts:24-28` |
| Channel edit/archive/delete | per-channel `selfRole`, delete restricted to `owner` | `ChannelManagementModerationActions.tsx:52-95` |
| Channel member role change / removal | per-channel `selfMember.role` | `MembersSidebar.tsx:438-493` |
| Invite creation — role selectable | `isOwner` unlocks "admin" option, else "member" only | `AddMemberDialog.tsx:129-132` |

Every one of these gates is computed *inline*, independently, in each component — there is no shared `hasPermission()`/`useCan()` abstraction in the client. SWF Buzz should centralize this (see §19) rather than reproduce the duplication.

---

## 13. Privileged API endpoints

### Deployment-admin console — `/api/admin/v1/*`

| Method | Path | Role | Handler |
|---|---|---|---|
| GET | `/probe` | any | `probe` (`mod.rs:145`) |
| GET | `/reports`, `/reports/:id` | Operator or Moderator | `mod.rs:191,242` |
| POST | `/reports/:id/resolve` | Operator or Moderator | `mod.rs:468` |
| POST | `/reports/:id/reopen` | Operator or Moderator | `mod.rs:679` |
| POST | `/reports/:id/cancel` | Operator or Moderator | `mod.rs:765` |
| GET | `/feedback`, `/feedback/:id`, attachments | Operator or Moderator | `mod.rs:281,317,340` |
| PATCH | `/feedback/:id` | any authenticated principal | `mod.rs:841` |
| GET | `/operators` | **Operator only** | `mod.rs:903`, `auth.rs:325-334` |
| PUT | `/operators/:pubkey` | **Operator only** | `mod.rs:986` |
| DELETE | `/operators/:pubkey` | **Operator only**, blocked if it removes the last operator | `mod.rs:1058` |

### Deployment-operator control plane — `/operator/communities*`

| Method | Path | Role | What it does |
|---|---|---|---|
| POST | `/operator/communities` | `RELAY_OPERATOR_PUBKEYS` allowlist | Provision community, bootstrap owner (`operator.rs:153`) |
| GET | `/operator/communities` | same allowlist | List communities by owner (`operator.rs:306`) |
| POST | `/operator/communities/archive` | same allowlist | Archive + cluster-wide disconnect (`operator.rs:207`) |
| POST | `/operator/communities/unarchive` | same allowlist | Restore admission (`operator.rs:269`) |
| POST | `/operator/communities/transfer` | same allowlist | Atomic ownership swap, demotes prior owner to member (`operator.rs:358`) |
| GET | `/operator/communities/availability` | same allowlist | Host availability check (`operator.rs:472`) |

### Tenant-scoped moderation reads — `/moderation/*`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/moderation/reports` | community owner/admin | Shares the exact same `authorize_moderation_action(..., ViewQueue)` check as the Nostr command path (`bridge.rs:2385-2399`) |
| GET | `/moderation/audit` | community owner/admin | `bridge.rs:2448-2463` |
| GET | `/moderation/restricted` | community owner/admin | Current ban/timeout list (`bridge.rs:2466-2478`) |

### Nostr moderation/staffing event kinds

| Kind | Name | Role required |
|---|---|---|
| 1984 | Report (NIP-56) | any authenticated member (write) |
| 9030 | Add member | community admin or owner |
| 9031 | Remove member | admin (member-role targets) or owner (not other owners) |
| 9032 | Change role | community owner only |
| 9033 | Set workspace profile | admin/owner, or any sender on a rosterless open relay |
| 9000/9001/9002 | NIP-29 put/remove user, edit metadata | channel owner/admin (elevated grants); self for departure |
| 9040/9041 | Ban / unban | community owner (unrestricted) / admin (not vs. owner/admin) |
| 9042/9043 | Timeout / untimeout | same as ban/unban |
| 9044 | Resolve report | community owner/admin |
| 9035/9036 | Identity archive / unarchive request | self, or community owner/admin, or cryptographically delegated consent |

---

## 14. Database role/permission models

Every table carrying role, permission, or restriction state:

| Table | Scope | Key columns | Migration |
|---|---|---|---|
| `channel_members` | Per-channel | `role member_role` enum `('owner','admin','member','guest','bot')` | `0001:29-30,132-145` |
| `relay_members` | Per-community | `role TEXT CHECK IN ('owner','admin','member')`, PK `(community_id,pubkey)` | `0001:574-584` |
| `relay_operators` | Platform-wide — **no `community_id` column**, deliberately | `role TEXT CHECK IN ('operator','moderator')` | `0035:12-21` |
| `relay_operator_audit` | Platform-wide, append-only | `op IN ('grant','revoke')`, `prev_role`/`new_role` | `0039:19-43` |
| `relay_admin_actions` / `relay_admin_outbox` | Enforcement state machine | `actor_role IN ('operator','moderator')`, `state` machine (pending→enforcing→succeeded/failed/cancelled) | `0036-0038` |
| `moderation_reports` | Per-community | `status IN ('open','resolved','dismissed','escalated','processing')` | `0006:15-64`, widened `0035:33-46` |
| `community_bans` | Per-community, per-member | `banned`, `ban_expires_at`, `muted_until` (timeout) | `0006:72-87` |
| `moderation_actions` | Per-community, audit | `action` vocab (12 values), `actor_authority IN ('community','relay_operator','relay_moderator')` | `0006:94-118`, `0035:28-31` |
| `relay_invites` | Per-community | `role TEXT CHECK (role = 'member')` — invite links can never grant admin | `0025:18-31` |
| `users` | Per-community, per-user | `agent_owner_pubkey`, `channel_add_policy` enum `('anyone','owner_only','nobody')`, `capabilities JSONB` | `0001:154-175,37` |
| `api_tokens` | Per-community, per-owner | `scopes JSONB`, optional `channel_ids JSONB` | `0001:472-489` |
| `archived_identities` | Per-community | `consent_path IN ('self','owner','admin')` | `0001:589-599` |
| `product_feedback` | Platform-wide | `status IN ('new','reviewed','archived')` | `0017`, status added `0035:49-51` |
| `_operator_global_tables` | Meta / lint registry | Explicit allowlist of tables deliberately not tenant-scoped | `0001:628-636` |

> **Dead code — do not replicate:** migrations 0041/0042 built an elaborate NIP-FI identity/authorization ledger (`identity_bindings`, `protected_object_authority` with a 29-value capability CHECK, `authorization_events`). Migration **0044 drops every one of these tables** with the commit note *"OSS Buzz is stateless for identity ('Buzz speaks Nostr, nothing else')."* Confirmed absent from the current `schema/schema.sql`. This was built, then reverted — it never shipped.

No static seed/fixture SQL exists anywhere in the repo. The only production "seeding" of platform authority is the `RELAY_OPERATOR_PUBKEYS`/`RELAY_OWNER_PUBKEY` environment variables, consumed at runtime — config always outranks any DB `relay_operators` row.

---

## 15. Hidden / backend-only features

Functionality that exists and is authorized server-side but has no reachable UI in the audited frontends.

| Feature | Backend evidence | Frontend status |
|---|---|---|
| Staff roster management (list/add/remove Operators & Moderators) | `GET/PUT/DELETE /operators*` (`admin/mod.rs:903-1088`) | **No UI at all** in admin-web |
| Report resolve/reopen/cancel actions | `POST /reports/:id/resolve\|reopen\|cancel` (`admin/mod.rs:468,679,765`) | `ReportDetail` is pure read-only — no action buttons rendered (`App.tsx:146-219`) |
| Role/capability self-discovery for the admin UI | `GET /probe` returns `{role, source, canAct, canStaff}`, doc comment says it exists so a UI can "discover the auth mode, role, and available capabilities before rendering" (`admin/mod.rs:125-142`) | Never called — admin-web improvises auth-mode detection off `/reports` instead |
| Admin console origin auto-discovery | `admin_api` field in NIP-11 document (`nip11.rs:62,165-179,367-369`) | Not consumed by admin-web (hardcodes its API prefix) or by the desktop client |
| Community-scoped moderation audit log & restricted-user list | `GET /moderation/audit`, `/moderation/restricted` (`bridge.rs:2448-2478`) | Desktop's `ModerationQueueCard` reads `/moderation/reports` and `/audit` (has an audit tab) — `/restricted` not confirmed wired to any UI |

---

## 16. Features currently missing from the frontend

Every one of these has a working backend endpoint today with zero corresponding UI in the audited Buzz frontends:

1. An Operators/Moderators roster page (view current staff, grant, revoke, see the append-only grant/revoke audit trail)
2. Resolve / reopen / cancel controls on the report detail view, with the same action taxonomy the backend enforces (`delete | kick | ban | timeout | dismiss | escalate`)
3. Any visible distinction in the console between an Operator and a Moderator viewer (different available actions, different empty states)
4. A platform-wide "communities" list/console for Operators (create/archive/unarchive/transfer currently has APIs but no dashboard — it's presumably driven by direct API calls or a CLI today)

---

## 17. Features that must be implemented in SWF Buzz

Every capability catalogued in §2–§14 that is not Local Agents or Git bridge is in scope. Concretely, SWF Buzz needs:

**Role & identity plumbing**
- Resolve and expose all three role planes (platform Operator/Moderator, community owner/admin/member, channel Owner/Admin/Member/Guest/Bot) plus agent-owner delegation and API-token scopes
- A single centralized permission-check layer (composable/hook), unlike reference Buzz's per-component inline checks — this is a design opportunity, not a requirement to copy the duplication

**Community & channel management**
- Full member/role/invite management per §8–§10, channel CRUD/permissions/membership per §3, with the exact same guard rails (admin cannot touch owner/admin targets; last-owner protection; invite links pinned to member)

**Moderation**
- Ban/unban/timeout/untimeout, report submit/resolve/dismiss/escalate/reopen/cancel, moderation queue + audit log, all tenant-scoped exactly as in §4/§13

**Platform/admin console**
- A genuinely role-aware console — this is where SWF Buzz should *exceed* reference Buzz, since admin-web never surfaces staffing or resolve actions despite the backend supporting them (§15–§16)
- Staff (Operator/Moderator) management UI
- Community provisioning/archive/unarchive/transfer UI (Operator-only)
- Feedback console with status workflow and attachment viewing

**Security posture to preserve**
- NIP-98 signed admin requests, Host/Origin binding, replay guards, last-operator invariant, config-outranks-DB precedence, fail-closed provisioning when config is incomplete

---

## 18. Features to exclude

### 1. Local Agents — confirmed self-contained, safe to drop entirely

Kinds 10100, 30174-30179, 24200, 44200, 43001-43006, with their own owner-private/shared-gated read model (`SHARED_GATED_KINDS`, `kind.rs:230,236-274`). Implementation: the `buzz-agent` crate, `crates/buzz-agent/tests/permission_boundary.rs` (MCP tool-call permission gating — a distinct concern from user/admin roles), `desktop/src-tauri/src/managed_agents/`, `docs/nips/NIP-PMA.md` (explicitly reservation-only — relays must reject kind:30179 until further work). No moderation/staffing code path in this report depends on these kinds.

### 2. Git access / Git app-level checks — confirmed self-contained, safe to drop entirely

Kinds 1617-1633, 30617-30621; `crates/git-credential-nostr`, `crates/git-sign-nostr`, `crates/buzz-core/src/git_perms.rs` (reuses the channel `MemberRole` vocabulary for `push:<role>` branch protection — this is the one place git code reads a role from the systems above, one-directional and read-only), the `api/git/*` Smart-HTTP + pre-receive-hook + HMAC policy-callback subsystem, `web/src/features/repos/**` (the web client's read-only repo browser).

Both subsystems were independently confirmed by two separate research passes to have no other code depending on them for authorization — excluding them does not remove any check that the rest of the product relies on.

---

## 19. Recommended SWF Buzz role architecture

Preserve the three-plane model exactly — it is a deliberate design, not an accident ("Two roles, not three… deliberately"). Recommendations, in order of what would most improve on reference Buzz rather than just copy it:

1. **Keep the planes separate but centralize the checks.** One `usePermission(scope, action)`-style composable per plane, backed by the same three primitives Buzz already has (`AdminRole`, community `relay_members.role`, channel `MemberRole`) — eliminates the ~15 duplicated inline checks found in §12.
2. **Build the admin console the backend already deserves.** Since the API supports staffing, role-aware probing, and full report enforcement, ship the UI for it from day one rather than reproducing admin-web's gap.
3. **Decide the "two operators" question explicitly (§6).** Either unify the admin-console Operator check and the community-provisioning allowlist check into one authority source, or document the split clearly in SWF Buzz's own architecture docs so it isn't rediscovered as a bug later.
4. **Reproduce the guard rails, not just the happy path:** last-owner/last-operator protection, admin-cannot-touch-owner/admin, invite-pinned-to-member, config-outranks-DB precedence, fail-closed provisioning. These are exactly the kind of invariant that's easy to silently drop in a rewrite and hard to notice missing until it's exploited.
5. **Do not build a "Super Admin."** There is no product requirement for one in Buzz today, and inventing one would be scope creep beyond what "replicate Buzz functionality" asks for. If SWF Buzz later needs a deployment-wide super-tier, treat it as new product design, not parity work — exactly as Buzz's own docs defer it.

---

## 20. Master capability table

Every discovered role-specific capability, one row each. `YES` = exists today in Buzz and is required for SWF Buzz parity · `NO` = excluded (Local Agents/Git) or does not exist · `COND` = exists with a scoping caveat explained in the row.

| # | Role | Scope | Feature / capability | Existing in Buzz? | SWF Buzz required? | Evidence | Source file |
|---|---|---|---|---|---|---|---|
| 1 | Operator | Platform | Read reports & feedback console-wide | YES | YES | GET /reports, /feedback | admin/mod.rs:191,281 |
| 2 | Operator | Platform | Resolve / reopen / cancel report | YES | YES | POST /reports/:id/resolve\|reopen\|cancel | admin/mod.rs:468,679,765 |
| 3 | Operator | Platform | Update feedback status | YES | YES | PATCH /feedback/:id | admin/mod.rs:841 |
| 4 | Operator | Platform | List/add/remove Operators & Moderators | YES | YES | `require_operator` gate | auth.rs:325-334; admin/mod.rs:903-1088 |
| 5 | Operator | Platform | Provision new community | YES | YES | POST /operator/communities | operator.rs:153 |
| 6 | Operator | Platform | Archive / unarchive community | YES | YES | POST /operator/communities/archive\|unarchive | operator.rs:207,269 |
| 7 | Operator | Platform | Transfer community ownership | YES | YES | POST /operator/communities/transfer | operator.rs:358 |
| 8 | Operator | Platform | List communities by owner / check host availability | YES | YES | GET /operator/communities, /availability | operator.rs:306,472 |
| 9 | Operator | Platform | Break-glass owner-fallback grant when config list is empty | YES | COND (design decision) | `AdminSource::OwnerFallback` | auth.rs:59-68,271-281 |
| 10 | Operator | Platform | Protected from self-elimination (last-operator invariant) | YES | YES | `DbError::LastOperator` | relay_operators.rs:175-177,237-239 |
| 11 | Moderator | Platform | Read reports & feedback console-wide | YES | YES | same routes as Operator | admin/mod.rs |
| 12 | Moderator | Platform | Resolve / reopen / cancel report, update feedback status | YES | YES | same routes as Operator | admin/mod.rs |
| 13 | Moderator | Platform | Blocked from staffing endpoints | YES (403) | YES | `require_operator` | auth.rs:325-334 |
| 14 | Moderator | Platform | Blocked from community provisioning/archive/transfer | YES (403) | YES | `RELAY_OPERATOR_PUBKEYS` check | operator.rs:93-103 |
| 15 | owner | Community | Unrestricted ban/timeout, even of admins | YES | YES | `decide_authority`, no guard rail | moderation_authz.rs:154 |
| 16 | owner | Community | Ban / unban / timeout / untimeout | YES | YES | kinds 9040-9043 | kind.rs:342-351 |
| 17 | owner | Community | Resolve / dismiss / escalate report, cascading actions | YES | YES | kind 9044 | kind.rs:356 |
| 18 | owner | Community | Add member | YES | YES | kind 9030 | relay_admin.rs:315-317 |
| 19 | owner | Community | Remove member/admin, never another owner | YES | YES | kind 9031 | relay_admin.rs:365-397 |
| 20 | owner | Community | Change member role (owner-only, cannot self-target or grant owner) | YES | YES | kind 9032 | relay_admin.rs:424-441 |
| 21 | owner | Community | Transfer ownership (prior owner demoted to member) | YES | YES | `transfer_ownership()` | relay_members.rs:514-611 |
| 22 | owner | Community | Set workspace profile / icon | YES | YES | kind 9033 | relay_admin.rs |
| 23 | owner | Community | Mint invite (any role selectable, still pinned to member at DB layer) | YES | YES | POST /api/invites | invites.rs:284-345; migrations/0025:18-31 |
| 24 | owner | Community | View moderation queue & audit log | YES | YES | GET /moderation/reports,/audit | bridge.rs:2422-2463 |
| 25 | owner | Community | Capped at 5 owned communities (configurable) | YES | COND (as a tunable constraint) | `MAX_COMMUNITIES_PER_OWNER` | relay_members.rs:456,464-473 |
| 26 | admin | Community | Ban/timeout — not vs. owner/fellow admin | YES | YES | guard rail in `decide_authority` | moderation_authz.rs:163-169 |
| 27 | admin | Community | Add member (cannot grant admin) | YES | YES | kind 9030 | relay_admin.rs:326-328 |
| 28 | admin | Community | Remove member-role targets only | YES | YES | atomic conditional delete | relay_admin.rs:379-384 |
| 29 | admin | Community | Cannot change any role | YES (blocked) | YES | kind 9032 owner-only | relay_admin.rs:424-426 |
| 30 | admin | Community | Resolve / dismiss / escalate report | YES | YES | kind 9044 | kind.rs:356 |
| 31 | admin | Community | Mint invite — member role only | YES | YES | role selector filtered | AddMemberDialog.tsx:129-132 |
| 32 | admin | Community | View moderation queue & audit log | YES | YES | same as owner | bridge.rs:2385-2399 |
| 33 | member | Community | Submit report | YES | YES | kind 1984, no gate | report.rs:44-94 |
| 34 | member | Community | Join via invite / leave | YES | YES | `claim_relay_membership()` | relay_members.rs:173-210 |
| 35 | member | Community | No management/moderation authority | YES (restricted) | YES | every gate above | moderation_authz.rs |
| 36 | Owner | Channel | Delete channel | YES | YES | `canDeleteChannel` | ChannelManagementModerationActions.tsx:52-56 |
| 37 | Owner | Channel | Archive / unarchive channel | YES | YES | edit dialog action | ChannelManagementSheet.tsx:897-927 |
| 38 | Owner | Channel | Edit name/about/visibility/TTL | YES | YES | elevated field gating | side_effects.rs:313-344+ |
| 39 | Owner | Channel | Grant elevated role to a member | YES | YES | `decide_put_user` | channel_authz.rs:111-167 |
| 40 | Owner | Channel | Immune to demotion/removal while sole owner | YES | YES | `is_sole_owner` | channel_authz.rs:67-71 |
| 41 | Owner | Channel | Remove any member (kick) | YES | YES | `classify_remove_other` | channel_authz.rs:210-216 |
| 42 | Admin | Channel | Manage settings, cannot delete channel | YES | YES | `useChannelModerationCapabilities` | ChannelManagementModerationActions.tsx:52-95 |
| 43 | Admin | Channel | Kick members, grant elevated role | YES | YES | same as owner (except delete) | channel_authz.rs |
| 44 | Member | Channel | Post messages; edit/delete own only | YES | YES | `canManageMessageForCurrentUser` | canManageMessage.ts:17-30 |
| 45 | Member | Channel | Remove own agent, without elevated role | YES | YES | `CheckAgentOwner` | channel_authz.rs:210-216 |
| 46 | Guest | Channel | Read-only participation (permission_level 1) | YES | YES | `MemberRole::Guest` | channel.rs:102-158 |
| 47 | Bot | Channel | Non-hierarchical automated participant, JSONB capability descriptor | YES | COND (excluding local-agent lifecycle specifics) | `users.capabilities`; `MemberRole::Bot=0` | migrations/0001:154-175; channel.rs:142-150 |
| 48 | agent-owner | Cross-cutting | Manage/delete a channel owned by the human's agent; edit/delete the agent's messages | YES | YES | `ownsAuthorAgent()`, `canManageOwnedAgentChannel` | ChannelManagementModerationActions.tsx:63-84 |
| 49 | API token | Connection | Scoped capability grants (Messages/Channels/Users/Jobs/Subscriptions/Files Read+Write, AdminChannels, AdminUsers) | YES | COND (excluding Repos* scopes) | `Scope` enum, 16 variants | scope.rs:16-86 |
| 50 | API token | Connection | Max 10 active tokens per (community, owner); optional channel restriction | YES | YES | `create_api_token_if_under_limit` | api_token.rs:62-70 |
| 51 | any privileged actor | Cross-cutting | Every privileged action recorded with an actor-authority label (community vs. relay_operator vs. relay_moderator) | YES | YES | `moderation_actions.actor_authority` | migrations/0035:28-31 |
| 52 | any | Cross-cutting | Identity archival with tiered consent (self / owner / admin) | YES | YES | kinds 9035/9036, `determine_consent_path` | identity_archive.rs:228-251 |
| 53 | n/a | Excluded | Local Agents: lifecycle, MCP permission boundary, managed-agent/persona/team catalogs | YES (exists) | NO — EXCLUDED | kinds 10100,30174-30179,24200,44200,43001-43006 | buzz-agent crate; managed_agents/ |
| 54 | n/a | Excluded | Git bridge: credentials, commit signing, push-role permissions, repo browser | YES (exists) | NO — EXCLUDED | kinds 1617-1633,30617-30621 | git-credential-nostr; git_perms.rs; api/git/* |
| 55 | n/a | Dead code | NIP-FI identity/authorization ledger (29-value capability CHECK) | NO — reverted | NO | built in 0041/0042, dropped in 0044 | migrations/0044_drop_nip_fi_ledger.sql |
| 56 | Operator/Moderator | Platform | Role-aware UI self-discovery endpoint exists but is unused | COND (backend only) | YES — build the UI for it | `GET /probe` | admin/mod.rs:125-142 |

---

*Compiled from six parallel, independently-sourced audit passes over `C:\Users\Pranshul\Downloads\buzz2.0\buzz` (read-only). A rendered, more visual version of this same audit is also published as an artifact: "Buzz Access Ledger."*
