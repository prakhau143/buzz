# SWF BUZZ ADMIN PANEL — REVERSE ENGINEERING REPORT

**Method note:** every claim below is labeled `[CODE]` (read directly from old-Buzz or SWF-Buzz source, with file:line), `[DOCS]` (from repository documentation, cross-checked against code where noted), `[INFERRED]` (a reasonable but not directly confirmed conclusion), `[UNCLEAR]` (a real open question or an internal discrepancy found during research), or `NOT FOUND IN OLD BUZZ` (searched for, does not exist). Nothing here is invented. Old-Buzz repo root is referred to as `buzz/`; new project as `swf buzz/`.

---

## 1. Executive Summary

Old Buzz's admin/moderation surface is **not one system** — it is **three structurally separate systems** that share a database and a relay process but have almost no code in common:

1. **`admin-web/`** — a tiny, separate React SPA (4 routes, ~1,300 lines) for **deployment-wide** trust & safety triage: Reports and Feedback only. Served by the relay itself on a dedicated admin hostname, authenticated with NIP-98 (HTTP-signed Nostr events) or disabled. Principals are `Operator` or `Moderator` — a role system with **no relationship** to community membership roles.
2. **The old Buzz Desktop app's in-app "Settings → Moderation" panel** — **community-scoped** moderation for that community's own `owner`/`admin` members: a report queue, an audit log, and a per-message moderation menu (ban/kick/timeout). Reads go over NIP-98 HTTP to a `/moderation/*` bridge; writes are signed Nostr events published over the same WebSocket the app already uses for everything else.
3. **A separate `/operator/communities*` + `/api/invites` surface** for relay-instance-level community provisioning — confirmed to exist in the backend, with **no frontend anywhere in the repository** that calls it (admin-web doesn't, the desktop app wasn't checked for it but its own moderation client never references it).

The backend (`/api/admin/v1/*`, 13 routes) is **substantially more capable than admin-web's frontend uses**: it fully implements report resolution (delete/kick/ban/timeout/dismiss/escalate), report reopen/cancel, and operator-roster CRUD — **none of which admin-web's UI exposes**. Admin-web is read-only for reports and offers only a 3-state status toggle for feedback. This is a real, verified gap between what the backend can do and what the shipped frontend does, not a hypothesis.

SWF Buzz today (`swf buzz/`) has **zero** admin/moderation/report/feedback/ban/operator/audit functionality — confirmed exhaustively. It does display a read-only community role badge (owner/admin/member) with no enforcement behind it client-side.

**Critically for implementation planning:** SWF Buzz talks to the *same* `buzz-relay` backend old Buzz does. The entire backend (`/api/admin/v1/*`, `/moderation/*`, the database schema, the audit system) **already exists and requires no new backend work** to support an admin panel matching old Buzz's feature set. A new SWF Buzz admin panel can be built as a pure frontend addition, reusing the exact APIs admin-web and the old desktop app already call. Going *beyond* old Buzz's feature set (Dashboard, Users, standalone Bans page, etc.) would be new product scope with no backend precedent — clearly flagged as such throughout this report.

---

## 2. Old Buzz Admin Architecture

```
                         buzz-relay (single Rust process)
                                    │
        ┌───────────────────────────┼────────────────────────────┐
        │                           │                            │
  admin-web (SPA)          desktop app (React/Tauri)      /operator/communities*
  served on BUZZ_ADMIN_HOST  "Settings → Moderation"        + /api/invites
        │                           │                            │
  /api/admin/v1/*  (NIP-98)   /moderation/* (NIP-98, GET)   (backend only —
  Operator | Moderator        + WS-published signed events   no UI found
  (deployment-wide)           kind:1984/9040-9044             anywhere)
                               owner | admin (per-community)
```

- **admin-web** [CODE]: `buzz/admin-web/` — React 19 + Vite 8 SPA, no router library (hand-rolled `history.pushState`), no UI component library, hand-written CSS. Served directly by the relay process (`buzz/crates/buzz-relay/src/router.rs:55-61,156-202`) when `BUZZ_ADMIN_HOST`/`BUZZ_ADMIN_WEB_DIR` are configured, on a **separate hostname** the relay checks per-request (`is_admin_host`, `router.rs:174`). Calls only `/api/admin/v1/*`.
- **Desktop in-app moderation** [CODE]: `buzz/desktop/src/features/settings/ui/ModerationQueueCard.tsx` + `buzz/desktop/src/features/moderation/ui/{ReportMessageDialog,MessageModerationMenuItems}.tsx` + `buzz/desktop/src/shared/api/moderation.ts`. Reads via NIP-98 HTTP to `/moderation/reports|audit|restricted`; writes as Nostr events (kind:1984 report, kind:9040-9044 ban/unban/timeout/untimeout/resolve) published over the normal relay WebSocket.
- **Backend admin API** [CODE]: `buzz/crates/buzz-relay/src/api/admin/{mod.rs,auth.rs,error.rs}` — 13 routes nested at `/api/admin/v1`, only mounted when `state.config.admin.is_some()` (`router.rs:54,60-61`).
- **Backend moderation bridge** [CODE]: `buzz/crates/buzz-relay/src/api/bridge.rs:2422-2478` — `/moderation/reports`, `/moderation/audit`, `/moderation/restricted` (all GET), gated by `moderation_authz::authorize_moderation_action(..., ViewQueue)`, community-scoped via `TenantContext`.
- **Database**: shared Postgres, `buzz/schema/schema.sql` — tables detailed in §16.
- **Audit**: two independent mechanisms — `buzz-audit` crate's generic hash-chained `audit_log` (system/security events) and the separate `moderation_actions` table (moderation decisions/enforcement). See §14.

---

## 3. Complete Admin Feature Inventory

| Feature | Exists in Old Buzz? | Evidence | Frontend File | Backend API | Permission | Database | Status |
|---|---|---|---|---|---|---|---|
| Reports list (deployment-wide) | ✅ Yes | [CODE] | `admin-web/src/App.tsx:96-144` (`Reports`) | `GET /api/admin/v1/reports` | Operator or Moderator (or none if `disabled` mode) | `moderation_reports` | Read-only UI |
| Report detail | ✅ Yes | [CODE] | `App.tsx:146-219` (`ReportDetail`) | `GET /api/admin/v1/reports/:id` | same | `moderation_reports` + joined `events` | Read-only UI |
| Report resolution (delete/kick/ban/timeout/dismiss/escalate) | ✅ Backend yes, **UI no** | [CODE] backend `admin/mod.rs:462-660`; [CODE] frontend has zero calls (verified: no `resolve`/`reopen`/`cancel` string anywhere in `admin-web/src`) | **NOT FOUND IN OLD BUZZ ADMIN-WEB UI** | `POST /api/admin/v1/reports/:id/resolve` | Operator or Moderator | `moderation_reports`, `relay_admin_actions`, `moderation_actions`, `relay_admin_outbox`, + `community_bans`/`channel_members`/`events` depending on action | **Category D** — backend exists, UI missing |
| Report reopen | ✅ Backend yes, **UI no** | [CODE] `admin/mod.rs:679-741` | NOT FOUND in UI | `POST /api/admin/v1/reports/:id/reopen` | Operator or Moderator | `moderation_reports` | Category D |
| Report cancel (undo a failed enforcement) | ✅ Backend yes, **UI no** | [CODE] `admin/mod.rs:765-836` | NOT FOUND in UI | `POST /api/admin/v1/reports/:id/cancel` | Operator or Moderator | `relay_admin_actions` | Category D |
| Feedback list | ✅ Yes | [CODE] | `App.tsx:221-379` (`FeedbackList`), with client-side search/community/time/status filters | `GET /api/admin/v1/feedback` | any authenticated principal (read) | `product_feedback` | Full UI |
| Feedback detail (+ attachments) | ✅ Yes | [CODE] | `App.tsx:516-777` | `GET /api/admin/v1/feedback/:id`, `GET .../attachments/:sha256` | read | `product_feedback` | Full UI |
| Feedback status update | ✅ Yes | [CODE] | `App.tsx:394-456` (`FeedbackStatusControl`), 3 states only | `PATCH /api/admin/v1/feedback/:id` | Operator or Moderator | `product_feedback` | Full UI |
| Operator/Moderator roster view | ✅ Backend yes, **UI no** | [CODE] `admin/mod.rs:899-972` | NOT FOUND in admin-web UI | `GET /api/admin/v1/operators` | Operator only | `relay_operators` + config | Category D |
| Operator/Moderator roster edit (grant/revoke) | ✅ Backend yes, **UI no** | [CODE] `admin/mod.rs:981-1109` | NOT FOUND in admin-web UI | `PUT`/`DELETE /api/admin/v1/operators/:pubkey` | Operator only | `relay_operators` (+ `relay_operator_audit`, `[UNCLEAR]` exact write site — see §14) | Category D |
| Rich auth probe (`role`, `canAct`, `canStaff`) | ✅ Backend yes, **UI uses a cruder heuristic** | [CODE] backend `admin/mod.rs:145-189`; [CODE] frontend `admin-web/src/api.ts:157-168` never calls it, infers mode from `/reports`' status code only | `api.ts:probeAuthMode()` (crude version) | `GET /api/admin/v1/probe` (unused by frontend) | n/a | n/a | Category D (partially) |
| Dashboard (landing/overview page) | ❌ No | — | — | — | — | — | **NOT FOUND IN OLD BUZZ** |
| Users / Members (as an admin-panel page) | ❌ No (exists as an in-app Settings card, not an "admin panel" feature) | [CODE] `desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx` — see §12 | community-scoped Settings, not admin-web | none under `/api/admin/v1` | owner (promote/demote), owner+admin (view/remove) | `relay_members` | Exists, but as a normal in-app feature, not an "admin panel" |
| Communities (list/manage, deployment-wide) | ❌ No UI anywhere | [CODE] backend exists (`/operator/communities*`, `router.rs:87-106`) | **NOT FOUND** in admin-web or (as far as investigated) desktop | `GET/POST /operator/communities`, `/archive`, `/unarchive`, `/transfer`, `/availability` | [UNCLEAR] — not traced; likely a relay-operator/self-service concept distinct from `AdminRole` | not traced | Category D |
| Channels (as an admin-panel page) | ❌ No | — | — | — | — | — | NOT FOUND IN OLD BUZZ |
| Standalone Bans list/management page | ❌ No | [CODE] bans only ever appear as a *side effect* of resolving a report (`action=ban`) or the desktop per-message ban button; no page lists all current bans with bulk unban | — | no dedicated route | — | `community_bans` | NOT FOUND as a page — data exists, no page |
| Community-scoped moderation queue | ✅ Yes (desktop app, not admin-web) | [CODE] `ModerationQueueCard.tsx` | Settings → Moderation | `GET /moderation/reports` | owner/admin (client mirror) + server mod-authz gate | `moderation_reports` | Full UI, community-scoped |
| Community-scoped moderation audit log | ✅ Yes (desktop app) | [CODE] `ModerationQueueCard.tsx` Audit tab | Settings → Moderation | `GET /moderation/audit` | owner/admin + server gate | `moderation_actions` | Read-only, no filter/search/pagination |
| Currently-restricted members list | ✅ Yes (desktop app, used internally) | [CODE] `moderation.ts:listRestrictions` | used by `MessageModerationMenuItems.tsx` to toggle ban/timeout labels, not a standalone page | `GET /moderation/restricted` | owner/admin + server gate | `community_bans` | Internal use, not a standalone list page |
| Report filing (user files a report) | ✅ Yes (desktop app) | [CODE] `ReportMessageDialog.tsx` | any member | published as kind:1984 over WS, not HTTP | any member | `moderation_reports` (via relay event ingestion) | Full UI |
| Per-message ban/kick/timeout | ✅ Yes (desktop app) | [CODE] `MessageModerationMenuItems.tsx` | community moderators (owner/admin) | WS-published kind:9040-9043 events | owner/admin | `community_bans`, `channel_members` | Full UI, **no confirmation dialogs** |
| Role management (promote/demote member↔admin) | ✅ Yes (desktop app) | [CODE] `CommunityMembersSettingsCard.tsx` | Settings → Members | not traced (likely a signed Nostr event, not HTTP) | promote/demote: owner only; view/remove: owner+admin | `relay_members` | Full UI |
| Roles/Permissions (as an admin-panel *page*, e.g. a permission matrix editor) | ❌ No | — | — | — | — | — | NOT FOUND IN OLD BUZZ |
| Event moderation (delete arbitrary event outside a report) | ⚠️ Only via report resolution (`action=delete`) | [CODE] `admin/mod.rs`, `report_resolution.rs` | none standalone | `POST /api/admin/v1/reports/:id/resolve` (action=delete) | Operator/Moderator | `events` | Not a standalone feature |
| Search (global, cross-entity) | ❌ No — only feedback has a local text filter | [CODE] `App.tsx:265-277` | Feedback page only | none (client-side `.filter()`) | n/a | n/a | NOT FOUND as a real search feature — client-side substring filter only |
| System health / metrics UI | ❌ No | Health endpoints exist (`/health`, `/_liveness`, `/_readiness`) but are unauthenticated, non-admin, and have no UI | — | `router.rs:69-71` | none (public) | n/a | NOT FOUND IN OLD BUZZ (as an admin feature) |
| Storage / Media management (general) | ❌ No admin page; attachment *serving* exists only in the context of one feedback item | [CODE] `admin/mod.rs:340-406` | feedback detail only | scoped to one feedback's attachments | read | media store | NOT FOUND as a general feature |
| Git | Not investigated (out of scope — no evidence found in any fork's search) | — | — | — | — | — | NOT FOUND IN OLD BUZZ ADMIN SURFACES |
| Agents / Workflows (as admin features) | Not found in any admin surface investigated | — | — | — | — | — | NOT FOUND IN OLD BUZZ ADMIN SURFACES |
| Settings (an "admin settings" page, e.g. relay config editor) | ❌ No | — | — | — | — | — | NOT FOUND IN OLD BUZZ |
| Security (as an admin page) | ❌ No dedicated page (security is enforced throughout, not a UI surface) | — | — | — | — | — | NOT FOUND IN OLD BUZZ |
| API tokens | ❌ No — auth is NIP-98/NIP-42 signed-event based, not bearer tokens. `BUZZ_ADMIN_TOKEN` existed historically and was explicitly **removed** | [DOCS] `docs/admin/README.md:25-28`: "no longer recognised... ignored with a startup warning" | — | — | — | — | NOT FOUND (deliberately removed) |
| Activity logs (as a distinct feature from audit) | Not a separate concept — see §14 for the actual (two, not one) audit mechanisms | — | — | — | — | — | Folded into "Audit Logs" (§14) |

---

## 4. Admin Routes

**admin-web SPA routes** [CODE], confirmed independently from both the React component (`App.tsx:995-1003`) and the relay's own server-side allow-list (`router.rs:223-229`, `is_admin_spa_path`) — these match exactly:

| Route | Component | Notes |
|---|---|---|
| `/` (and any unmatched path) | `Reports` | Reports is the default/fallback view, not a distinct "home" page |
| `/reports` | `Reports` | Open-reports list |
| `/reports/:id` | `ReportDetail` | Read-only |
| `/feedback` | `FeedbackList` | With filters |
| `/feedback/:id` | `FeedbackDetailView` | With attachments |

That is the **complete** route set — 4 distinct pages (5 counting `/` as a duplicate of `/reports`). No nested layouts, no auth-gated sub-routes beyond the top-level NIP-07-extension gate.

**Desktop app's in-app moderation "routes"** are not URL routes — they are a Settings panel (`SettingsPanels.tsx:69,213,852`, "Moderation" entry rendering `<ModerationQueueCard/>`) plus contextual menu items (message action bar, member list), not addressable pages of their own [CODE].

---

## 5. Admin API Inventory

### `/api/admin/v1/*` (admin-web's API — 13 routes) [CODE], `buzz/crates/buzz-relay/src/api/admin/mod.rs`

| Method | Path | Handler:line | Purpose | Request | Response | Auth | Roles | DB tables | Audit? |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/probe` | `probe:145` | Discover auth mode/role/capabilities | none | `{status, authMode, role, source, canAct, canStaff}` | any | any | — | no |
| GET | `/reports` | `reports:191` | List reports | query: `communityId,status,scope,reportType,targetKind,before,after,limit(1-200,default 50)` — defaults to `status=escalated` unless `scope=all` | `Report[]` | read (works in `disabled` mode) | any | `moderation_reports` | no |
| GET | `/reports/:id` | `report_detail:242` | Report detail | — | `ReportDetail` (joins `events`, `relay_admin_actions`) | read | any | `moderation_reports`, `events`, `relay_admin_actions` | no |
| POST | `/reports/:id/resolve` | `resolve_report:462` | Act on a report | `{action: delete\|kick\|ban\|timeout\|dismiss\|escalate, requestId, expirationSecs?, reason?}` | `{status, activeAction}` | mutation (403 in `disabled` mode) | Operator or Moderator | `moderation_reports`, `relay_admin_actions`, `moderation_actions`, `relay_admin_outbox`, +`community_bans`/`channel_members`/`events` per action | **yes** — `moderation_actions` row per decision |
| POST | `/reports/:id/reopen` | `reopen_report:679` | Reopen a terminal report | `{requestId, reason?}` | terminal→open report; 409 if not terminal; idempotent on `requestId` | mutation | Operator or Moderator | `moderation_reports` | [UNCLEAR — not explicitly confirmed whether reopen itself writes `moderation_actions`] |
| POST | `/reports/:id/cancel` | `cancel_report:765` | Cancel a **failed** enforcement | `{actionId}` | ; 409 if not cancellable | mutation | Operator or Moderator | `relay_admin_actions` | [UNCLEAR] |
| GET | `/feedback` | `feedback:281` | List feedback | none (fixed limit 100, **no query params**) | `FeedbackSummary[]` | read | any | `product_feedback` | no |
| GET | `/feedback/:id` | `feedback_detail:317` | Feedback detail | — | `FeedbackDetail` | read | any | `product_feedback` | no |
| PATCH | `/feedback/:id` | `update_feedback_status:838` | Change status | `{status: new\|reviewed\|archived}` | updated status | mutation | Operator or Moderator | `product_feedback` | no (plain `UPDATE`, no audit row confirmed) |
| GET | `/feedback/:id/attachments/:sha256` | `feedback_attachment:340` | Fetch one attachment's bytes | — | binary, server-verified content-type | read | any | media store (via feedback's `imeta` tags) | `tracing::info!` log line only — **not** a DB audit row [CODE confirmed absence] |
| GET | `/operators` | `list_operators:899` | View roster | — | `{pubkey, effectiveRole, sources[]}[]` (config ∪ owner-fallback ∪ DB, unified) | mutation-principal required | **Operator only** | `relay_operators` + config | read, no write |
| PUT | `/operators/:pubkey` | `upsert_operator:981` | Grant/change role | `{role: operator\|moderator}` | ; 409 if pubkey is config-backed; 409 if would violate last-operator invariant | mutation | **Operator only** | `relay_operators` (+ `relay_operator_audit`? [UNCLEAR]) | [UNCLEAR whether this specific handler writes `relay_operator_audit`] |
| DELETE | `/operators/:pubkey` | `delete_operator:1058` | Revoke role | — | same 409 guards as PUT | mutation | **Operator only** | `relay_operators` | [UNCLEAR] |

**Error envelope** [CODE] `admin/error.rs`: `{"error":{"code","message","requestId"}}`; uniform 401/403 with no failure-mode oracle; `401` sets `WWW-Authenticate: Nostr`.

### `/moderation/*` (desktop app's bridge — community-scoped, 3 routes) [CODE], `buzz/crates/buzz-relay/src/api/bridge.rs:2422-2478`

| Method | Path | Purpose | Query | Response | Auth | DB |
|---|---|---|---|---|---|---|
| GET | `/moderation/reports` | Community's own moderation queue | `?status=&limit=` (cap 500) | report rows | NIP-98 + `ModerationAction::ViewQueue` mod-authz (403 "restricted: moderator access required" if not owner/admin of that community) | `moderation_reports` (tenant-scoped) |
| GET | `/moderation/audit` | Community's own moderation-action history | `?limit=` | action rows | same | `moderation_actions` (tenant-scoped) |
| GET | `/moderation/restricted` | Currently banned/timed-out members | — | ban rows | same | `community_bans` (tenant-scoped) |

**No POST/PATCH exists under `/moderation/*`** [CODE, confirmed via `grep '\.route(' router.rs`] — all writes for this surface are signed Nostr events published over WebSocket (see §8), not HTTP mutations.

### Desktop app's WebSocket-published moderation event kinds [CODE], `buzz/desktop/src/shared/api/moderation.ts`

| Function | Kind | Purpose |
|---|---|---|
| `submitReport` | 1984 (NIP-56 `KIND_REPORT`) | File a report |
| `banMember` | 9040 `KIND_MODERATION_BAN` | Ban a pubkey from the community |
| `unbanMember` | 9041 `KIND_MODERATION_UNBAN` | Lift a ban |
| `timeoutMember` | 9042 `KIND_MODERATION_TIMEOUT` | Mute a pubkey until a deadline |
| `untimeoutMember` | 9043 `KIND_MODERATION_UNTIMEOUT` | Lift a timeout |
| `resolveReport` | 9044 `KIND_MODERATION_RESOLVE_REPORT` | Record a report decision (sent *after* enforcement succeeds) |

These carry **no `h` (channel) tag** by design — bans/timeouts are community-wide, not per-channel [CODE, `moderation.ts:18-19` comment].

### Adjacent, out-of-admin-web-scope surfaces confirmed to exist [CODE], not investigated in depth

- `GET/POST /operator/communities`, `/operator/communities/archive`, `/unarchive`, `/transfer`, `/availability` — `router.rs:87-106`. **No frontend found anywhere** that calls these.
- `POST /api/invites`, `GET /api/join-policy`, `POST /api/invites/claim` — `router.rs:107-124`. Invite minting is documented as "owner/admin" but not traced further; not part of admin-web.

---

## 6. Authentication

Two entirely separate authentication mechanisms are used across the surfaces in this report, both from the `buzz-auth` crate [CODE, `buzz/crates/buzz-auth/src/{nip42.rs,nip98.rs}`]:

- **NIP-42** (WebSocket): relay sends `["AUTH","<challenge>"]` on connect; client signs a kind:22242 event with `challenge`+`relay` tags. Used for the normal relay connection (all of SWF Buzz's existing traffic, and old Buzz's WS-published moderation events). Successful NIP-42 auth grants **all known `Scope`s unconditionally** — per-channel access is enforced separately by membership checks, not by scope [CODE, `buzz-auth/src/lib.rs:151`]. `localhost`/`::1`/`127.0.0.1` are **aliased as equivalent** here [CODE, `nip42.rs:19-33`].
- **NIP-98** (HTTP): used by admin-web (`/api/admin/v1/*`) and the desktop moderation bridge (`/moderation/*`). Client signs a kind:27235 event per-request with `u` (exact URL incl. query string), `method`, and (for body-bearing requests) `payload` (SHA-256 of the body) tags, `Authorization: Nostr <base64 event>` header. `±60s` timestamp tolerance. **`localhost`/`::1`/`127.0.0.1` are explicitly treated as three distinct hosts** here — the opposite of NIP-42 — a deliberate anti-host-confusion measure for the admin surface [CODE, `nip98.rs:184-191` doc comment].
- admin-web's frontend uses a **NIP-07 browser extension** (e.g. nos2x, Alby) to produce these signatures via `window.nostr.signEvent()` — it never holds a private key itself [CODE, `admin-web/src/api.ts:32-57`]. If NIP-98 mode is required and no extension is detected, the SPA shows an installation prompt and renders nothing else [CODE, `App.tsx:939-993`].
- The admin API additionally checks the literal `Host` header against `config.admin.host` (exact match, sourced from server config — never the frontend-controlled Host header used for anything trust-bearing) and, if present, the `Origin` header [CODE, `admin/auth.rs:218-227`].
- Replay protection: the NIP-98 event's ID is claimed once via a Redis-backed store, **after** principal resolution succeeds (so an invalid/unrostered key can't burn replay slots at request rate) [CODE, `admin/auth.rs:232-234,209-212`]. Redis failure fails **closed** (403).
- A "disabled" auth mode exists for both admin-web and (implicitly, for the desktop bridge — not separately confirmed) — reads work with no credential; every mutation is rejected regardless of any header supplied [CODE, `admin/auth.rs:318-323`]. [DOCS] `docs/admin/README.md:154-182` states disabled mode "relies on network-layer controls (VPN/firewall)" and logs a `WARN` on every startup.
- `probeAuthMode()`/`GET /probe` is how the frontend discovers which mode is active. **The real backend `/probe` endpoint returns rich role/capability info that admin-web's actual frontend code never uses** — the frontend instead infers `disabled` vs `nip98` purely from whether an unauthenticated `GET /reports` returns 200 (§3, "Rich auth probe" row) [CODE confirmed both sides].

---

## 7. Authorization / Roles / Permissions

**Three non-overlapping role/permission systems coexist in old Buzz.** This is the single most important structural fact for building SWF Buzz's version correctly — do not conflate them.

### 7.1 `relay_members.role` / `MemberRole` — community membership role

- DB: `relay_members.role TEXT CHECK (role IN ('owner','admin','member'))` [CODE, `schema.sql:576-586`].
- Rust: `MemberRole` enum in `buzz-core` actually defines **five** values — `Owner, Admin, Member, Guest, Bot` [CODE, `buzz-core/src/channel.rs:108-119`], with hierarchy `Owner > Admin > Member > Guest` and `Bot` as a non-linear separate designation [CODE, `channel.rs:104`].
- **[UNCLEAR / discrepancy]**: the DB `CHECK` constraint only permits 3 of the 5 Rust enum values (`owner`/`admin`/`member`) — `guest` and `bot` are defined in code but not representable in this specific table's constraint. Not resolved by this research; flag for verification before assuming Guest/Bot are usable community roles in practice.
- This is the role checked by every desktop-app moderation gate found (`relayRole === "owner" || relayRole === "admin"`) and by member promote/demote (`CommunityMembersSettingsCard.tsx`).

### 7.2 `AdminRole` — deployment/platform-level (admin-web only)

- Exactly two values: `Operator`, `Moderator` [CODE, `admin/auth.rs:50-55`].
- Resolution order [CODE `admin/auth.rs:249-312`, cross-confirmed `[DOCS]` `docs/admin/README.md:96-117`]:
  1. `RELAY_OPERATOR_PUBKEYS` config env var (pubkey listed → Operator)
  2. Owner-fallback: pubkey == `RELAY_OWNER_PUBKEY`, **only if** the config operator list is empty
  3. `relay_operators` DB table row (`role IN ('operator','moderator')`)
  4. else → 403
- Config always outranks DB; a malformed `RELAY_OWNER_PUBKEY` is a **startup error**, not a warning — "silently discarding it would be a lockout" [DOCS, `docs/admin/README.md:116-117`].
- **Not derived from, or related to, `MemberRole` in any way** — an Operator has no special standing in any individual community's `relay_members` table, and vice versa [DOCS confirmed explicitly, `VISION_MODERATION.md:57`: "The relay/platform layer has its own operator-and-moderator roster, distinct from community owner and admin roles."].

### 7.3 `Scope` — orthogonal API capability flags (`buzz-auth`)

- `MessagesRead/Write, ChannelsRead/Write, AdminChannels, UsersRead/Write, AdminUsers, JobsRead/Write, SubscriptionsRead/Write, FilesRead/Write, ReposRead/Write, Unknown(String)` [CODE, `buzz-auth/src/scope.rs:16-61`].
- For a normal NIP-42 WebSocket connection, **all known scopes are granted unconditionally** on successful auth [CODE, `buzz-auth/src/lib.rs:151`] — this system is largely moot for the moderation/admin surfaces in this report and appears aimed at a different (non-admin) part of the HTTP bridge API (`/events`, `/query`, etc.). **[UNCLEAR]** whether any admin/moderation endpoint checks a `Scope` at all — no fork found one; `AdminRole` and `MemberRole` are the operative checks throughout everything documented above.

### 7.4 Permission Matrix

| Action | Owner (community) | Admin (community) | Member | Moderator (platform) | Operator (platform) |
|---|---|---|---|---|---|
| File a report | ✅ | ✅ | ✅ | n/a | n/a |
| View community moderation queue (`/moderation/reports`) | ✅ | ✅ | ❌ | n/a (different scope entirely) | n/a |
| Ban/kick/timeout within own community (per-message menu) | ✅ | ✅ | ❌ | n/a | n/a |
| Promote member → admin | ✅ | ❌ | ❌ | n/a | n/a |
| Demote admin → member | ✅ | ❌ | ❌ | n/a | n/a |
| View/remove members | ✅ | ✅ | ❌ | n/a | n/a |
| Read deployment-wide reports (`/api/admin/v1/reports`) | n/a | n/a | n/a | ✅ | ✅ |
| Resolve/reopen/cancel a report (`/api/admin/v1/reports/:id/*`) | n/a | n/a | n/a | ✅ | ✅ |
| Read/update product feedback | n/a | n/a | n/a | ✅ | ✅ |
| View operator roster (`GET /operators`) | n/a | n/a | n/a | ❌ | ✅ |
| Grant/revoke operator/moderator role (`PUT`/`DELETE /operators`) | n/a | n/a | n/a | ❌ | ✅ |

**Where enforcement actually happens** (per the report's own required rule — never trust frontend hiding):
- Community-level: the desktop app's client-side `owner`/`admin` check is **explicitly documented in its own source as a UI mirror, not the real gate** — "The queue is mod-only: only relay owners/admins may read `/moderation/*` (the relay returns 403 otherwise). Mirror that gate client-side so members never see the panel attempt a doomed fetch" [CODE, `ModerationQueueCard.tsx:50-52`]. Real enforcement is server-side, in `moderation_authz::authorize_moderation_action` (bridge.rs) and, for WS-published moderation events, presumably in the relay's event-ingestion validation (not independently traced by any fork — **[UNCLEAR]** exact code path for WS-event-level enforcement, though the pattern throughout this codebase is unambiguously server-authoritative).
- Platform-level: enforced entirely server-side in `admin/auth.rs`'s `authorize()`/`require_operator()`/`require_mutation_principal()` — admin-web's frontend does no role branching at all (it doesn't even know if it's talking to an Operator or a Moderator; it only branches on `authMode`). [DOCS] `docs/admin/README.md:128-129` states this explicitly: "Capability checks are server-authoritative; the desktop console hides Staffing tab controls for Moderators as a UX convenience only" (note: this doc line refers to a "desktop console" for staffing that **was not found** by any fork — possibly aspirational/stale documentation, or a feature not present in this checkout; flagged `[UNCLEAR]`).

---

## 8. Moderation System

### 8.1 Two independent moderation flows

**Flow A — Community-scoped, in-app (desktop app):**

```
Member                    Owner/Admin                     Relay (DB)
  │                            │                                │
  ├─ Report a message ─────────┼──── kind:1984 (WS) ───────────▶│ moderation_reports
  │  (ReportMessageDialog)     │                                │  status='open'
  │                            │                                │
  │                            ├─ Open Settings→Moderation ─────▶ GET /moderation/reports
  │                            │  (ModerationQueueCard, Queue)   │  (NIP-98, mod-authz)
  │                            │                                │
  │                            ├─ Resolve: ban/kick/delete ──────┼─ WS-published kind:9040/
  │                            │  (enforcement fires FIRST) ─────┼─  channel_members/events
  │                            │                                │  update, THEN:
  │                            ├─ Resolve: kind:9044 ────────────▶ moderation_actions row
  │                            │  ("reviewed and acted on")      │  moderation_reports.status=
  │                            │                                │  'resolved' (via WS ingestion)
  │                            │                                │
  │                            └─ View Audit tab ────────────────▶ GET /moderation/audit
  │                                                               (moderation_actions, read-only)
```

- **Report is a signal, never a trigger** — nothing auto-actions on a filed report [DOCS, `VISION_MODERATION.md:41`, cross-confirmed by schema comment `schema.sql:660-663`].
- Reports are **never public relay events** — filed privately, never fanned out to subscribers [DOCS, `VISION_MODERATION.md:41`].
- **Severity tiers** in the queue UI: `illegal` = critical; `malware`/`impersonation` = high; everything else = normal [CODE, `moderationQueue.ts:217-221`].
- **Resolvable actions depend on target kind** [CODE, `moderationQueue.ts:253-264` (desktop) and `report_resolution.rs:102-145` (backend, matches exactly)]: `event` targets → delete/kick/ban/timeout/dismiss/escalate; `pubkey` targets → ban/timeout/dismiss/escalate (no delete/kick — there's no message to delete); `blob` targets → dismiss/escalate only.
- **`timeout` is deliberately excluded** from the desktop one-click resolve menu — "Dropped from one-click until the resolve flow can collect a duration" [CODE, `ModerationQueueCard.tsx:249-251,137-139`] — a known, intentional incompleteness in old Buzz itself.
- **Ordering invariant**: enforcement (ban/kick/delete) always commits *before* the kind:9044 resolve event, because that event DMs the reporter "reviewed and acted on" — if enforcement fails, the report is deliberately left open rather than send a false confirmation [CODE, `ModerationQueueCard.tsx:103-111`].
- **No confirmation dialog exists anywhere** in this flow for ban/kick/timeout/delete — every action button is a direct single-click mutation, feedback via toast only [CODE, confirmed absent in `MessageModerationMenuItems.tsx` and `ModerationQueueCard.tsx`].
- One-click ban (both from the queue and from the per-message menu) is **always permanent and reason-less** — no UI collects a reason or expiry for ban, even though the underlying `banMember()` API supports both fields [CODE, `ModerationQueueCard.tsx:124`].

**Flow B — Deployment-wide, admin-web (Operator/Moderator triage):**

```
(same moderation_reports rows, but admin-web reads across ALL communities, not one)
                                    │
GET /api/admin/v1/reports  (default: status=escalated only, unless scope=all)
                                    │
        ── Operator/Moderator reviews in browser (read-only in the shipped UI) ──
                                    │
        backend fully supports resolve/reopen/cancel — but admin-web's UI
        never calls them. A developer using only the browser dashboard
        cannot currently take any action on a report.
```

- **Escalation**: reports categorized `illegal` **auto-escalate on ingest** — bypass community triage, land directly in the platform `status=escalated` queue with no moderator decision recorded [DOCS, `docs/admin/README.md:338-356`].
- **[UNCLEAR / possible stale doc]**: `VISION_MODERATION.md:53-56` (an earlier/more product-narrative doc) says "Escalation is a hook today, not a pipeline... the platform-side inbox that consumes it is a separate build" — this directly conflicts with `docs/admin/README.md`'s fully-specified escalation-queue routes and the actual working `/reports?status=escalated` default found in code. The `docs/admin/README.md` + code evidence is far more detailed/current; treat the `VISION_MODERATION.md` caveat as likely stale, but this was not resolved via git-blame/history and should be verified if it matters.

### 8.2 Full report state machine [CODE, cross-confirmed schema + handler code]

`moderation_reports.status`: `open → processing → resolved | dismissed | escalated`, with `resolved`/`dismissed`/`escalated` reachable back to `open` via reopen (409 if not currently terminal). `processing` is set while `active_action_id` is non-null (an enforcement action is in flight) [CODE, `schema.sql:665-716` comments].

`relay_admin_actions.state` (the HTTP-driven enforcement sub-state-machine): `pending → enforcing → succeeded | failed | cancelled`, with a `step_marker` (`mutation_committed`, `artifacts_done`) for crash-safe resumption via a lease+lock pattern (`FOR UPDATE SKIP LOCKED` polling, `relay_admin_actions.rs:1395-1461`) [CODE].

---

## 9. Reports

- **Data model** [CODE, `admin-web/src/types.ts:1-24`]: `id, communityId, communityHost, reporterPubkey, targetKind(event|pubkey|blob), target, channelId?, reportType, note?, status, createdAt` (+ detail adds `message: {authorPubkey, content, createdAt, deletedAt}|null`).
- **`reportType`** values, per NIP-56 [DOCS, `schema.sql:678` comment]: `illegal, nudity, malware, spam, impersonation, profanity, other`.
- **`note`** is explicitly mod-queue-only, never shown publicly [CODE, `schema.sql` comment near `moderation_reports.note`].
- **Idempotency**: a unique index on `(community_id, report_event_id)` prevents the same signed report event from creating duplicate rows [CODE, `schema.sql` `idx_moderation_reports_event`].
- **admin-web UI**: list (hardcoded `status=open&limit=100`, no filter/sort/pagination controls at all — despite the backend supporting rich query params) and read-only detail. **No action of any kind is available from admin-web.**
- **Desktop UI**: reports group by target (multiple reports against the same message collapse into one card with all reporters listed), full resolve menu (minus timeout), reopen/cancel not exposed in the desktop UI either (only via the admin-web-adjacent backend API, itself unused by admin-web's shipped frontend) — **[UNCLEAR]** whether reopen/cancel are reachable from *any* UI in the current old-Buzz checkout; evidence suggests they may be backend-only capabilities with no consuming frontend anywhere.

---

## 10. Bans

- **No standalone "Bans" page exists anywhere** in old Buzz — confirmed exhaustively (admin-web has none; desktop has no dedicated bans-list page, only the read-only `/moderation/restricted`-backed toggle state used inline in the per-message menu, and the Audit tab which is a general action log, not a ban-specific view).
- **Data model**: one row per member per community in `community_bans`, covering **both** ban and timeout as independent fields on the same row (not an append-log) [CODE, `schema.sql:724-739`]: `banned(bool), ban_expires_at, ban_reason, muted_until, mute_reason, actor_pubkey`. `ban_expires_at IS NULL AND banned=true` = permanent ban.
- **Enforcement point**: bans are enforced "at the identity seam" — i.e. checked at NIP-42 auth/connection time, not scattered through message-handling code [DOCS, `VISION_MODERATION.md:47-49`, `[INFERRED]` exact mechanism not independently code-traced by any fork].
- **Timeout is a separate, weaker restriction** — "write-block only" (a muted user can presumably still read) [CODE, `schema.sql` comment near `community_bans.muted_until`].
- Both are created/lifted only as a side effect of: (a) resolving a report with `action=ban|timeout`, or (b) the desktop app's direct per-message ban/timeout button — **never a standalone "ban this pubkey" form** anywhere.

---

## 11. Feedback

- **Data model** [CODE, `admin-web/src/types.ts:26-55`]: `id, communityId?(null if community purged), communityHost?, submitterPubkey, category?(bug|praise|needs-work), bodySummary/body, status(new|reviewed|archived), receivedAt`, detail adds `eventId, tags[][], eventCreatedAt`.
- **Deployment-global, not per-community** — `community_id` is provenance-only (`ON DELETE SET NULL`), registered in the schema's own `_operator_global_tables` meta-list as intentionally non-tenant-scoped [CODE, `schema.sql:827-846`]. This is a single cross-community inbox for the whole relay deployment.
- **Status lifecycle**: exactly 3 states, `new → reviewed → archived`, freely settable in any direction via one `PATCH`. No sub-statuses, no assignee, no internal comments/notes field distinct from the feedback body itself.
- **Attachments**: parsed client-side from the feedback event's `imeta` Nostr tags (url/mime/hash/size/dimensions/filename), fetched through an authenticated per-attachment endpoint (never raw `<img src>`, since that can't carry an Authorization header), object-URLs created and explicitly revoked on unmount/replacement to avoid leaking blob memory [CODE, `admin-web/src/App.tsx:685-777`]. Inline rendering is gated on the **server-verified** sniffed MIME type, never the reporter-supplied one — a documented XSS/spoofing defense [CODE, `App.tsx:735-738`].
- **admin-web is the only place feedback is manageable at all** — not found anywhere in the desktop app.
- **Stale test discrepancy found**: `admin-web/tests/routes.spec.ts` contains a test ("feedback status is stored locally by feedback id") referencing an "Acted on" checkbox and `acted-on`/`pending` statuses — **neither exists in the current `App.tsx`/`types.ts`** (which use `new/reviewed/archived` via a `<select>`, no checkbox). This is a genuine code/test mismatch found during research, not a feature to build against — flagged `[UNCLEAR]`, likely a stale test from an earlier iteration of the feature that wasn't removed.

---

## 12. Users / Members

**Not an admin-web feature at all.** What exists is entirely inside the desktop app's per-community Settings, and is a normal community-management feature, not a "trust & safety" admin surface:

- `desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx` [CODE] — promote member→admin / demote admin→member, gated `currentRole === "owner"` only (`canPromote`/`canDemote`); view/remove members gated to `owner`+`admin` (`canManageRelay`).
- This is the actual "Roles" UI in old Buzz — there is no separate roles/permissions *admin panel page* anywhere; role assignment is just one control on the community member list.
- Backed by `relay_members` (community-scoped role table, §7.1) — not traced whether the mutation is an HTTP call or a signed Nostr event by this research pass; [UNCLEAR].

**NOT FOUND IN OLD BUZZ**: a deployment-wide "Users" page (i.e. a list of all users across all communities) anywhere in admin-web or the desktop app.

---

## 13. Communities / Channels

- **NOT FOUND IN OLD BUZZ**: any admin-panel page listing/managing communities or channels.
- A **backend-only** community-lifecycle API exists (`/operator/communities*` — provision/archive/unarchive/transfer/availability, `router.rs:87-106`) with **no frontend found anywhere** in this repository that calls it. [UNCLEAR] whether it's used by an external tool/CLI not in this repo, or is simply unused/future-facing.
- Multi-step community-deletion workflow tables exist (`community_deletion_requests/approvals/checkpoints/manifest_keys`, `schema.sql:1219-1445`) — flagged by the database research pass as present but not investigated in depth; **[UNCLEAR]** whether any UI drives this anywhere.
- Channels have **no admin-surface presence** at all — channel creation/management is a normal in-app community feature, never an admin-panel concern in old Buzz.

---

## 14. Audit Logs

**Three separate, non-unified audit mechanisms exist** — a new admin panel must decide whether to present these as one merged view or as distinct sections; old Buzz never unifies them itself.

### 14.1 `audit_log` — generic system/security hash-chained log [CODE]

- Table: `schema.sql:645-658`. Columns: `community_id, seq(monotonic per community), hash, prev_hash, action, actor_pubkey, object_id, detail(jsonb), created_at`. PK `(community_id, seq)`.
- **Hash-chained**: `crates/buzz-audit/src/hash.rs` — `GENESIS_HASH = [0u8;32]` for a community's first entry; `compute_hash()` is SHA-256 over the entry's fields **including** `community_id` and `prev_hash`, so both content tampering and entry reordering/splicing are detectable per-community [CODE].
- **`AuditAction` enum** — the *only* values this log can hold [CODE, `buzz-audit/src/action.rs:6-31`]: `EventCreated, EventDeleted, ChannelCreated, ChannelUpdated, ChannelDeleted, MemberAdded, MemberRemoved, AuthSuccess, AuthFailure, RateLimitExceeded, MediaUploaded`. **Moderation actions (ban/kick/delete-message) are NOT in this enum** — they live exclusively in `moderation_actions` (14.2).
- `AuditService::log()` assigns `seq`/`prev_hash`/`hash`/`created_at` **server-side only** — `NewAuditEntry` is deliberately not `Deserialize` so no client-supplied blob can become one [CODE, `buzz-audit/src/entry.rs:46-56`]. `detail` is explicitly documented as never allowed to hold secret/bearer-token material.
- `AuditService::verify_chain()` exists [CODE, `service.rs:169`, exact verification semantics `[INFERRED]` from signature/naming, body not fully read by the fork].
- **No IP/client-metadata field exists structurally** anywhere in `AuditEntry`/`NewAuditEntry` [CODE confirmed absence] — only `actor_pubkey` + a JSON `detail` blob (which is explicitly barred from secrets, not extended for request metadata by the type itself). If IP is ever captured it would be a call-site convention inside `detail`, not verified by this research.
- **No UI reads this log anywhere** — neither admin-web nor the desktop app's Audit tab reads `audit_log`; the desktop Audit tab reads `moderation_actions` instead (14.2). `audit_log` currently has **no admin-panel consumer at all** in old Buzz.

### 14.2 `moderation_actions` — moderation decision/enforcement trail [CODE]

- Table: `schema.sql:746-779`. Columns: `id, actor_pubkey, action(delete_message|kick|ban|unban|timeout|untimeout|dismiss_report|escalate|resolve:delete|resolve:kick|resolve:ban|resolve:timeout), target_pubkey?, target_event_id?, channel_id?, reason_code, public_reason, private_reason, matched_principal(self|owner, NIP-OA), actor_authority(community|relay_operator|relay_moderator), created_at`.
- **`public_reason` is broadcast verbatim** to the channel as the tombstone's reason and DM'd to the affected user — **not sanitized or redacted** [DOCS, `docs/admin/README.md:298-303`, security-relevant].
- **`private_reason`** is mod/audit-only, never shown publicly.
- **`actor_authority`** distinguishes a community-scoped actor from a deployment-level operator/moderator acting on a community they don't belong to — important for a future "who did this and under what authority" column in an audit UI.
- **This is what the desktop app's Audit tab actually displays** — read-only, flat list, no filter/search/pagination in the shipped UI.
- **Not exposed by admin-web at all** — a report's resolution creates a row here, but admin-web has no page that lists `moderation_actions` deployment-wide (only embedded, partially, inside a single report's detail response — exact shape not fully traced).

### 14.3 `relay_operator_audit` — operator-roster mutation trail [CODE]

- Table: `schema.sql:1875-1891`. Append-only: `id, actor_pubkey, target_pubkey, op(grant|revoke), prev_role, new_role, created_at, seq(identity column, the sole chronology key)`.
- Doc comment: "One row per PUT/DELETE /operators/{pubkey} mutation... Written only inside the upsert/delete transactions; no UPDATE/DELETE path" [CODE, `schema.sql:1867-1874`].
- **[UNCLEAR — real, unresolved finding]**: the backend-API research pass grepped `admin/mod.rs`, `auth.rs`, and the `relay_admin_actions.rs` store file and found **no reference to this table anywhere** in the code paths behind `PUT`/`DELETE /operators/:pubkey`, despite the table's own doc comment saying that's exactly what should write it. It may be written by the separate `/operator/communities*` (`api::operator`) surface instead, or by code not covered by any research pass. **This needs direct verification before an SWF Buzz implementation assumes operator-roster changes are audited today** — the table exists and is schema-ready, but this research could not confirm it is actually being written to by the one API surface that logically should.
- **No UI reads this table anywhere** — not found in admin-web (no operator UI exists at all in admin-web's frontend) or the desktop app.

---

## 15. Operators

- Role values: `operator`, `moderator` (§7.2). Two-tier authority source: config (env vars, highest priority, immutable via API) and DB (`relay_operators` table, mutable via API, subject to a "last-operator" protection that blocks a mutation that would leave the deployment with zero operators when no config operator exists) [CODE, `admin/mod.rs:981-1109`, `[DOCS]` `docs/admin/README.md:144-152`].
- **Fully implemented on the backend** (view roster with unified `effectiveRole`+`sources[]`, grant, revoke) — **completely absent from admin-web's shipped UI**. This is the single largest "backend exists, UI missing" gap found in this entire research pass.
- No UI anywhere (admin-web or desktop) lets an Operator see or change this roster today.

---

## 16. Database Mapping

```
Admin Feature                → API                              → DB Table(s)
──────────────────────────────────────────────────────────────────────────────
Deployment reports (r/w)     → GET/POST /api/admin/v1/reports*   → moderation_reports
                                                                    relay_admin_actions
                                                                    moderation_actions
                                                                    relay_admin_outbox
                                                                    (+ community_bans /
                                                                     channel_members / events
                                                                     depending on action)
Deployment feedback (r/w)    → GET/PATCH /api/admin/v1/feedback* → product_feedback
Operator roster (r/w)        → GET/PUT/DELETE /operators         → relay_operators
                                                                    (relay_operator_audit —
                                                                     [UNCLEAR] if actually written)
Community moderation queue   → GET /moderation/reports           → moderation_reports (tenant)
Community moderation audit   → GET /moderation/audit             → moderation_actions (tenant)
Community restrictions       → GET /moderation/restricted        → community_bans (tenant)
Report filing                → WS kind:1984                      → moderation_reports (insert)
Ban/unban/timeout/untimeout  → WS kind:9040-9043                 → community_bans
Report resolve (in-app)      → WS kind:9044                      → moderation_reports.status,
                                                                    moderation_actions
Member role promote/demote   → (not traced — likely WS event)    → relay_members
System/security audit        → (no consumer UI)                  → audit_log (hash-chained)
```

**Full table list confirmed relevant to admin/moderation** [CODE, all from `schema.sql`, exact line ranges in the underlying research]: `communities`, `channels`, `channel_members`, `users`, `relay_members`, `relay_invites`, `audit_log`, `moderation_reports`, `community_bans`, `moderation_actions`, `product_feedback`, `relay_operators`, `relay_admin_actions`, `relay_admin_outbox`, `relay_operator_audit`. (`community_deletion_*` tables exist and are moderation-adjacent but not investigated in depth — flagged, not included in the mapping above.)

---

## 17. Old Buzz UI/UX

### 17.1 admin-web (the browser dashboard)

- **Stack**: React 19, Vite 8, **no router library** (hand-rolled `history.pushState`+`popstate` `usePath()`/`Link`), **no UI component library** (hand-written CSS, `styles.css`), no toast library, no modal/dialog library.
- **Layout**: single fixed header (`app-header`: brand mark + 2-item horizontal nav — Reports, Feedback) + `<main>`. **No sidebar.** No responsive hamburger/collapse logic found in the read component code (not separately verified against `styles.css` media queries).
- **Cards**: `record-card` pattern — icon, primary content block, a right-aligned date, an arrow — used identically for both reports and feedback list rows.
- **Detail views**: a `<dl>` definition-list pattern (`detail`/`dt`/`dd`), not tables.
- **Filters**: only on the Feedback list — text search (client-side substring match across summary/host/category/submitter), community dropdown, time-range dropdown (24h/7d/30d/any), status dropdown. **All client-side** — filtering happens in a `useMemo` over the already-fetched full list, not server-side query params (even though the backend `/reports` supports rich server-side filters that the Reports page never uses, and `/feedback` has no server-side filter params at all).
- **Pagination**: none — fixed `limit=100` for reports, `limit=100`(implicit, no param at all — server default) for feedback. No "load more."
- **Loading/empty/error states**: generic "Loading…", generic "No records.", and a two-branch error state — "Access denied" specifically for a 403, "Could not load data" for anything else, both with a Retry button [CODE, `App.tsx:71-94`].
- **Confirmation dialogs**: **none exist** — consistent with admin-web having no destructive-action buttons at all in its shipped UI.
- **Toast notifications**: none — errors surface inline (a small `status-error` span next to the specific control that failed, e.g. feedback status update).
- **Dark/light theme**: not found in the component code (would require checking `styles.css` directly for `prefers-color-scheme`, not done by this pass — flag `[UNCLEAR]`).
- **Security posture**: a strict CSP is served by the relay specifically for the admin host (`frame-ancestors 'none'`, no `unsafe-inline`/`unsafe-eval`) precisely **because** the admin session's credential-signing capability (via the browser's NIP-07 extension) must never be exposed to an embedded/framed context [CODE+DOCS, `router.rs:259-265`, `docs/admin/README.md:198-224`].

### 17.2 Desktop in-app moderation

- **Report filing**: modal dialog, 7 category buttons (single-select), optional free-text note, explicit "reporter is anonymous to the author" copy, toast success/failure, no post-submission tracking for the reporter.
- **Per-message menu**: dropdown menu items injected into the existing message action bar — Timeout (submenu: 1h/24h/7d) ↔ Lift timeout, Kick (channel-scoped only), Ban ↔ Lift ban — toggled based on live restriction-state query. **Self-moderation is blocked** (can't act on your own messages) [CODE, `MessageModerationMenuItems.tsx:57-63`].
- **Queue card**: two tabs (Queue, Audit) inside the normal Settings panel chrome. Queue groups multiple reports against one target into a single card with a severity badge, a "prior actions against this target" warning banner when relevant, and a Resolve dropdown scoped to what's structurally valid for that target kind.
- **No confirmation dialogs anywhere** in this surface either — every destructive action (ban/kick/delete/timeout) is a single click with toast feedback only.

---

## 18. New SWF Buzz Current State

[CODE, exhaustively verified — see method note]

- **Zero** admin, moderation, report, feedback, ban, operator, or audit code exists anywhere in `swf buzz/src` or `swf buzz/src-tauri/src`.
- The only role-adjacent code: `Member.role: "owner"|"admin"|"member"` (`src/types/domain.ts`, `src/protocol/membership.ts:17`) — parsed **read-only** from relay-authored kind:39001/39002 events, used only to render a badge (`MemberRow.vue:23`) — **no enforcement, no gating, purely cosmetic** on the client.
- Router: exactly 3 routes — `/login`, `/` (channels), `/dm` — no admin route.
- Protocol reference (`docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md`): **zero** kinds related to moderation/reports/bans/feedback/admin/operator are defined — SWF Buzz's protocol layer does not yet know about kind:1984 or 9040-9044 at all.
- Tauri backend: 357 lines total, 4 IPC commands (Okta login + secure-storage get/set/delete), **zero business logic** — confirms SWF Buzz follows the exact same "fat frontend / thin native shell" philosophy old Buzz's desktop app used (where moderation logic also lived entirely client-side as signed-event publishers, not in Rust).
- No UI component library (hand-rolled Vue components against CSS custom-property design tokens) — architecturally similar posture to admin-web's own hand-rolled approach, though a different framework (Vue vs React).
- Dependencies: Vue 3.5, vue-router 5, Pinia 4, TanStack Vue Query 5, `nostr-tools` 2.25, `@tauri-apps/api` 2.

---

## 19. Old vs New Gap Analysis

| Feature | Old Buzz | New SWF Buzz | Missing? | Reusable Code? | Backend Required? | Frontend Required? |
|---|---|---|---|---|---|---|
| Deployment reports (read) | admin-web | none | Yes | Protocol pattern only (new Vue views) | **No** — `/api/admin/v1/reports*` already exists | Yes |
| Deployment reports (resolve/reopen/cancel) | Backend yes, UI no (old Buzz gap too) | none | Yes | none | **No** | Yes — and SWF Buzz could *exceed* old Buzz here by actually building the UI old Buzz never shipped |
| Deployment feedback (r/w) | admin-web | none | Yes | none | **No** | Yes |
| Operator roster (r/w) | Backend yes, UI no (old Buzz gap too) | none | Yes | none | **No** | Yes — same opportunity to exceed old Buzz |
| Community moderation queue | desktop app | none | Yes | none (different framework) | **No** — `/moderation/*` already exists | Yes |
| Report filing | desktop app | none | Yes | none | **No** — relay already accepts kind:1984 | Yes, **plus** SWF Buzz's protocol layer needs a new `src/protocol/reports.ts`-equivalent builder/parser (kind not yet in its registry) |
| Ban/kick/timeout (per-message) | desktop app | none | Yes | none | **No** — relay already accepts kind:9040-9043 | Yes, plus new protocol builders |
| Role promote/demote | desktop app | none (read-only display exists) | Yes (write side) | Read-side already exists (`membership.ts`) | **No** | Yes |
| Community-wide "Bans" page | NOT FOUND IN OLD BUZZ EITHER | none | N/A — not a gap, a genuinely new feature if wanted | — | No (data exists in `community_bans`) | New scope |
| Dashboard/overview page | NOT FOUND IN OLD BUZZ | none | N/A | — | — | New scope if wanted |
| Deployment-wide Users/Communities/Channels admin pages | NOT FOUND IN OLD BUZZ | none | N/A | — | — | New scope if wanted |
| Unified Audit Log UI (merging all 3 mechanisms) | NOT FOUND IN OLD BUZZ (each mechanism has at most a partial, separate consumer) | none | N/A | — | Possibly — see `relay_operator_audit` write-site question (§14.3) | New scope if wanted |

**Category summary** (per the user's requested A–H buckets):

- **A. Already available in SWF Buzz**: nothing.
- **B. Partially available**: community role *display* (read-only badge) — the data plumbing exists, the write/management side does not.
- **C. Completely missing**: report filing/queue/resolution, feedback, operator roster UI, ban/kick/timeout UI, role promote/demote UI, audit views.
- **D. Backend exists but UI missing** (true for SWF Buzz **and inherited from old Buzz itself**): report resolve/reopen/cancel, operator roster CRUD — building these in SWF Buzz doesn't just achieve parity with old Buzz, it would *exceed* what old Buzz's own shipped admin-web ever did.
- **E. UI exists but backend missing**: none found — SWF Buzz has no admin UI at all yet, so there's nothing to be missing a backend for.
- **F. Requires new database schema**: none for feature parity with old Buzz — every table needed already exists in the shared `buzz-relay` database. (Would only apply if SWF Buzz's admin panel is expanded beyond old Buzz's scope, e.g. a genuinely new "Dashboard" concept needing new aggregation tables — not evidenced as necessary.)
- **G. Requires new API**: none for feature parity — every endpoint needed already exists on the relay. New endpoints would only be needed to go *beyond* old Buzz (e.g. server-side pagination/filtering for reports if the client-side approach proves inadequate at scale — but the backend already supports rich query params admin-web just never used, so even this is arguably already covered).
- **H. Requires only frontend work**: **the entire admin panel**, for parity with (and in two places, improvement over) old Buzz — this is the central finding of this report.

---

## 20. Recommended SWF Buzz Admin Architecture

**Decision: Option B — admin routes inside the existing SWF Buzz application**, not a separate app, not a Tauri-native admin surface, and not "both."

**Why**, grounded in what was actually found (not preference):

1. SWF Buzz's own architecture is already "the desktop app *is* the same Vue SPA that runs in a browser" [CODE, §18] — there is no existing split between a "web-only" and "desktop-only" frontend to reconcile, unlike old Buzz (which genuinely had two separate codebases: admin-web in React, the desktop app in a different React tree). Adding admin routes to the one SWF Buzz Vue app automatically makes them available in both the browser dev flow and `npm run tauri dev`/the packaged desktop app, satisfying the user's Part 12 requirement ("available from the local development environment") with zero extra work.
2. Old Buzz built admin-web as a **separate app** specifically because it needed to be served from a **different hostname** (`BUZZ_ADMIN_HOST`) with a different, stricter CSP, by the relay process itself, independent of whatever community/desktop-client hostname convention is in play. **That constraint doesn't obviously apply to SWF Buzz's situation** — SWF Buzz is a single desktop-first client connecting to a relay it doesn't itself serve static files from. Replicating admin-web's separate-app-separate-hostname pattern would be solving a problem SWF Buzz doesn't have (unless a future requirement demands a same-origin-isolated, IT-managed, browser-only admin tool independent of the desktop app entirely — not evidenced as a current need).
3. SWF Buzz's Tauri backend is proven to be a thin shell with zero business logic (§18); an admin panel needs no new Rust/native capability — it's exactly the same shape of work (Vue views + composables + a new protocol-adapter module) as every other feature already in the app.
4. SWF Buzz's `SigningService` abstraction (`getActiveSigningService().signEvent(...)`) already used for NIP-42 relay auth is **generic** — it signs any Nostr event shape, so it can equally produce NIP-98-signed HTTP requests (needed for `/api/admin/v1/*` and `/moderation/*`) with no new signing infrastructure, just a new protocol module analogous to `src/protocol/messages.ts` etc.

**Recommendation is therefore: build admin as new `src/features/admin/` (or similar) composables/services + new `src/views/Admin*.vue` + new router entries, gated by a route guard analogous to the existing auth guard**, reusing the existing design-token/component system rather than introducing a UI library. Do **not** build a separate `admin-web`-style project, and do **not** build anything admin-specific in `src-tauri/`.

---

## 21. Proposed Admin Navigation

Based on what was **actually found** in old Buzz (not the illustrative example in the request) — two tiers, matching the two real role systems (§7):

```
Admin (visible only if the signed-in identity is a platform Operator or Moderator, OR the
       current community's owner/admin — see note below)
├── Community Moderation                    (owner/admin of the CURRENT community — Tier 1)
│   ├── Queue                                → mirrors old Buzz's ModerationQueueCard "Queue" tab
│   ├── Audit                                → mirrors its "Audit" tab
│   └── Restricted members                   → NEW: old Buzz never surfaced this as its own page
│                                               (only used it internally); worth promoting to a
│                                               real page since the data already exists
│
└── Platform Admin                          (deployment Operator/Moderator only — Tier 2)
    ├── Reports                              → parity with admin-web, PLUS the resolve/reopen/
    │                                           cancel actions admin-web itself never shipped
    ├── Feedback                             → parity with admin-web
    └── Operators                            (Operator role only) → parity with the backend,
                                                a page admin-web itself never shipped
```

Notes on scope decisions, each justified against findings:
- **Two top-level sections, not one flat list** — because old Buzz's own architecture never unifies community moderation and platform admin; presenting them as one flat nav would misrepresent the actual permission model and confuse who can see what.
- **No "Dashboard/Overview," "Users," "Communities," "Channels," "Settings," "Security," "API tokens"** sections are proposed, because none exist in old Buzz and nothing in this research surfaced a concrete need for them — adding them would be inventing scope, which the user explicitly prohibited at this stage. If wanted, they'd be a deliberate, separately-scoped Phase, not part of a "faithful admin panel" v1.
- **"Restricted members" as its own page** is the one deliberate addition beyond old Buzz's literal navigation, because the underlying `/moderation/restricted` data already exists and is already fetched by old Buzz's own UI (just not surfaced as a standalone page) — a low-risk, low-cost completion of something old Buzz clearly intended (it built the read endpoint) but didn't finish presenting.

| Section | Old Buzz had it? | SWF Buzz needs it? | Backend dependency | Permission | Priority |
|---|---|---|---|---|---|
| Community Moderation → Queue | ✅ (desktop) | Yes, for parity | none — exists | owner/admin (community) | High |
| Community Moderation → Audit | ✅ (desktop) | Yes, for parity | none — exists | owner/admin (community) | High |
| Community Moderation → Restricted members | ⚠️ data only, no page | Nice-to-have | none — exists | owner/admin (community) | Medium |
| Platform Admin → Reports (read) | ✅ (admin-web) | Yes, for parity | none — exists | Operator/Moderator | High |
| Platform Admin → Reports (resolve/reopen/cancel) | ⚠️ backend only | Yes — closes a real old-Buzz gap | none — exists | Operator/Moderator | High |
| Platform Admin → Feedback | ✅ (admin-web) | Yes, for parity | none — exists | Operator/Moderator (write), any (read) | High |
| Platform Admin → Operators | ⚠️ backend only | Yes — closes a real old-Buzz gap | none — exists | Operator only | Medium |

---

## 22. Proposed Page-by-Page Specification

*(Deliberately specified only for the sections justified above — not a speculative full IA.)*

### Community Moderation → Queue
- **Purpose**: let the current community's owner/admin review and act on reports filed within it.
- **Data**: `GET /moderation/reports` (NIP-98-signed via the active `SigningService`).
- **Grouping**: by target (event/pubkey/blob), matching old Buzz's collapse-by-target UX — multiple reports against one target become one card.
- **Actions**: dismiss, escalate, and (for `event`/`pubkey` targets, as old Buzz's own matrix defines) delete/kick/ban — **plus timeout, which old Buzz deliberately never shipped in its one-click menu**; SWF Buzz can close this gap since it's building fresh, but must then design a small reason/duration collection step old Buzz never built either.
- **Confirmation**: old Buzz shipped **zero** confirmations for destructive actions. Recommend SWF Buzz diverge here deliberately (a lightweight confirm step for ban/delete) since this is a real, known UX gap in old Buzz, not a deliberate design choice documented anywhere — flag this explicitly as an intentional improvement, not a "faithful port."
- **Auth**: NIP-98 signed per-request via the existing `SigningService`; visibility gated on the current community's `Member.role` being `owner`/`admin` (client mirror only, matching old Buzz's own documented pattern — real enforcement is the relay's 403).

### Community Moderation → Audit
- **Purpose**: read-only history of moderation actions taken in the current community.
- **Data**: `GET /moderation/audit`.
- **Old Buzz had no filter/search/pagination here** — a faithful v1 can match that; if SWF Buzz wants more, that's new scope, not parity.

### Community Moderation → Restricted members
- **Purpose**: a standalone view of currently banned/timed-out members (old Buzz only used this data internally).
- **Data**: `GET /moderation/restricted`.
- **Actions**: unban/lift-timeout, mirroring the per-message menu's existing toggle capability, now given its own page.

### Platform Admin → Reports
- **Purpose**: deployment-wide trust & safety triage.
- **Data**: `GET /api/admin/v1/reports` (**use the real server-side query params old Buzz's frontend never used** — `communityId/status/scope/reportType/targetKind/before/after/limit** — this alone is an improvement over old Buzz's hardcoded `status=open&limit=100`).
- **Detail + actions**: `GET /api/admin/v1/reports/:id` plus `POST .../resolve|reopen|cancel` — **all three unimplemented by old Buzz's own UI**; building them is genuinely new relative to old Buzz's shipped product, even though it's zero new backend work.
- **Auth**: NIP-98, principal resolved server-side to Operator or Moderator; SWF Buzz's UI should use the real `GET /probe` response (role/canAct/canStaff) rather than repeating old Buzz's crude heuristic.

### Platform Admin → Feedback
- Parity with admin-web: list with filters (can start client-side exactly as old Buzz did, since there's no evidence the client-side approach was ever a real problem), detail with attachments, 3-state status control.

### Platform Admin → Operators
- **Purpose**: view/grant/revoke platform Operator/Moderator roles — a page old Buzz's backend fully supports but never shipped a UI for.
- **Data**: `GET/PUT/DELETE /api/admin/v1/operators*`.
- Must surface the config-backed-immutability (409) and last-operator-protection (409) behaviors old Buzz's backend already enforces, with clear error messaging (not present in old Buzz to reference, since no UI existed — this needs original design work, informed by the backend's actual 409 semantics documented in §5/§15).

---

## 23. API Requirements

**None required.** Every endpoint a v1 SWF Buzz admin panel needs already exists and is already exercised by *something* in old Buzz (even if not by admin-web's shipped frontend):

- `/api/admin/v1/probe`, `/reports*`, `/feedback*`, `/operators*` — all exist, all NIP-98.
- `/moderation/reports|audit|restricted` — exist, NIP-98, community-scoped.
- WS-published kind:1984 (report), kind:9040-9044 (ban/unban/timeout/untimeout/resolve) — exist, accepted by the relay today.

**What SWF Buzz needs on its own side** (frontend-only, per §19/§20):
1. A new NIP-98 HTTP-signing helper (reusing `SigningService.signEvent`) — analogous to `admin-web/src/api.ts`'s `signNip98`, but there is no reason to duplicate that exact code; it should be written fresh against SWF Buzz's existing service abstractions.
2. New protocol builder/parser modules for kind:1984 and kind:9040-9044, added to `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` with the same source-citation discipline the project already requires (citing `buzz-core`'s kind constants and the relay's event-ingestion validation for these kinds — **not yet independently verified against the relay's WS-side acceptance logic by this research pass**, since all forks focused on the HTTP surfaces; **flag this as the one piece of backend-facing verification still needed before implementation**, even though it requires no *new* backend code — only confirming the exact wire shape SWF Buzz must produce).

---

## 24. Database Requirements

**None.** No new table, column, or migration is needed for feature parity with old Buzz. All required tables already exist in the shared `buzz-relay` Postgres database (§16). This is a purely additive-frontend project against existing backend surfaces.

---

## 25. Permission Matrix

*(Repeated here per the requested report structure — identical to §7.4; see that section for full sourcing.)*

| Action | Owner (community) | Admin (community) | Member | Moderator (platform) | Operator (platform) |
|---|---|---|---|---|---|
| File a report | ✅ | ✅ | ✅ | n/a | n/a |
| View/act in community moderation queue | ✅ | ✅ | ❌ | n/a | n/a |
| Promote/demote members | ✅ (promote+demote) | ❌ | ❌ | n/a | n/a |
| Read deployment reports | n/a | n/a | n/a | ✅ | ✅ |
| Resolve/reopen/cancel deployment reports | n/a | n/a | n/a | ✅ | ✅ |
| Read/update feedback | n/a | n/a | n/a | ✅ | ✅ |
| View/edit operator roster | n/a | n/a | n/a | ❌ | ✅ |

---

## 26. Security Requirements

Carried forward from old Buzz's own (verified) practice, since it represents real, working security engineering, not aspiration:

- **NIP-98 signing per request**, with `u`/`method`/`payload` tags and a fresh nonce per signing — reuse this exact shape, don't invent a new auth scheme.
- **`localhost`/`127.0.0.1`/`::1` must be treated as distinct hosts** for any NIP-98 URL-binding check, matching `buzz-auth/nip98.rs`'s deliberate choice (opposite of NIP-42's aliasing) — get this wrong and a local dev binding assumption could become a production host-confusion bug.
- **Never trust client-side role checks as the security boundary** — every gate must be enforced server-side already (it is, in the existing relay); SWF Buzz's client-side role checks exist only to avoid showing a doomed UI, exactly as old Buzz's own code comments document.
- **`reason` fields on moderation actions are PUBLIC** — broadcast and DM'd verbatim; any new UI must warn users of this before they type into that field (old Buzz's own docs flag this as a real, easy-to-misuse footgun — worth an explicit UI warning SWF Buzz can add that old Buzz's docs mention but which was not confirmed to exist in any UI).
- **Strict CSP** on any admin surface, matching the relay-enforced `ADMIN_CSP` — if SWF Buzz's admin views are just more routes in the existing app (per §20), they inherit the app's existing CSP posture; if a future decision moves toward a separate admin surface, replicate old Buzz's exact CSP string as a starting point (`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`).
- **Attachment MIME rendering must trust only server-verified type**, never client/reporter-supplied — replicate old Buzz's exact defensive pattern (§11) if/when SWF Buzz builds feedback-attachment rendering.
- **No new secrets/credentials** — the existing `SigningService` abstraction already handles all signing; nothing about admin functionality introduces a new credential type.

---

## 27. Testing Strategy

Old Buzz's own test coverage for this surface is informative:
- `admin-web/tests/*.spec.ts` — Playwright, covers: route deep-linking, empty/error states, auth-mode probing (disabled/nip98/no-extension), NIP-98 signing correctness (including the same-second-retry nonce-collision edge case), 401-retry-once semantics, object-URL lifecycle for attachments, CSP compliance (reads the *actual* server CSP constant to avoid the test drifting from reality), responsive filter-row layout.
- **No test in old Buzz exercises the resolve/reopen/cancel/operator-roster endpoints from the frontend, because the frontend never calls them** — SWF Buzz building these will need genuinely new test coverage with no old-Buzz precedent to crib from at the frontend-integration level (backend-level Rust tests for these do exist per the backend fork's research, just not exercised end-to-end from any UI).

Recommended for SWF Buzz, following the project's existing testing conventions (per `docs/TESTING.md`'s established bar):
- Protocol-layer unit tests for the new kind:1984/9040-9044 builders/parsers, mirroring the existing `tests/unit/protocol/*.spec.ts` pattern.
- A real integration test against the local relay (the project's own stated gap-closing priority, per `docs/TESTING.md`/`docs/KNOWN_LIMITATIONS.md`) exercising at least one full resolve flow — this would be **new ground old Buzz itself never covered from a frontend test**, so no shortcut/reference implementation exists to copy.
- CSP compliance test analogous to `admin-web/tests/csp.spec.ts`, reading the actual relay-served CSP rather than a hardcoded copy, if a separate admin surface is ever built (moot under the recommended in-app-routes architecture, §20).

---

## 28. Implementation Roadmap

Adjusted from the illustrative 8-phase template to what was actually found — phases ordered by dependency, not by the template's assumed order:

| Phase | Scope | Files (new, under `swf buzz/`) | Backend | DB | Complexity | Depends on |
|---|---|---|---|---|---|---|
| 1 | Protocol foundation | `src/protocol/reports.ts`, `src/protocol/moderation.ts` (kind:1984, 9040-9044 builders/parsers) + `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` update with source citations | none | none | Medium (needs relay-side WS-ingestion verification, §23) | — |
| 2 | NIP-98 HTTP signing | `src/services/adminApiClient.ts` (or similar) reusing `signingServiceRegistry` | none | none | Low-Medium | — |
| 3 | Community Moderation (Queue + Audit + Restricted) | `src/features/moderation/*`, `src/views/ModerationView.vue` (or nested under a settings-equivalent) | none | none | Medium | Phases 1-2 |
| 4 | Report filing + per-message ban/kick/timeout | extends `src/features/messages/` with new menu items + `ReportDialog.vue` | none | none | Medium | Phases 1-2 |
| 5 | Platform Admin — Reports (incl. resolve/reopen/cancel — new relative to old Buzz's own UI) | `src/features/admin/reports/*`, `src/views/AdminReportsView.vue` | none | none | Medium-High (new UX design needed, no old-Buzz UI to mirror for the action side) | Phase 2 |
| 6 | Platform Admin — Feedback | `src/features/admin/feedback/*`, `src/views/AdminFeedbackView.vue` | none | none | Medium | Phase 2 |
| 7 | Platform Admin — Operators (new relative to old Buzz's own UI) | `src/features/admin/operators/*`, `src/views/AdminOperatorsView.vue` | none | none | Medium (needs original UX for 409 conflict states) | Phase 2 |
| 8 | Role promote/demote UI (community) | extends existing member-list feature | none | none | Low-Medium | — |
| 9 | Testing | protocol unit tests, real-relay integration tests, (CSP test only if architecture changes) | — | — | Medium | all above |

**Not phased** (explicitly out of this roadmap because no old-Buzz precedent or clear requirement was found): Dashboard/overview, deployment-wide Users/Communities/Channels pages, a unified 3-way audit-log merge, relay configuration UI, system health/metrics UI.

---

## 29. Features NOT Found in Old Buzz

Explicit, exhaustive list (all confirmed by at least one fork's targeted search, not merely "not mentioned"):

- Dashboard / overview / landing admin page
- Deployment-wide Users page
- Communities admin page (backend exists, zero UI)
- Channels admin page
- Standalone Bans list/management page
- Standalone Roles/Permissions editor page
- Global cross-entity search (only feedback's local text filter exists)
- System health/metrics admin UI
- General storage/media management admin UI
- Git-related admin functionality
- Agents/Workflows admin functionality
- Relay configuration UI
- A dedicated "Security" admin page
- API tokens (the concept was explicitly removed — `BUZZ_ADMIN_TOKEN` deprecated)
- A unified/merged audit log view (three separate mechanisms exist, no page merges them)
- Confirmation dialogs for any destructive moderation action, anywhere
- Toast-based error reporting in admin-web (inline only)
- Server-side pagination controls in any admin-web page (fixed limits only)
- A "moderator" community role (only owner/admin exist at the community level; "Moderator" only exists at the platform/Operator-Moderator level)

---

## 30. Unknowns / Needs Verification

Every genuinely open question surfaced during this research, collected in one place:

1. Whether `guest`/`bot` `MemberRole` values (defined in Rust) are actually usable given the DB `CHECK` constraint on `relay_members.role` only permits `owner`/`admin`/`member` (§7.1).
2. Whether `PUT`/`DELETE /api/admin/v1/operators/:pubkey` actually writes a `relay_operator_audit` row — no fork found this reference in the code paths that logically should produce it (§14.3). This is the single most concrete "verify before you build on this assumption" item in the report.
3. The exact JSON shape of `moderation_actions`/`relay_admin_actions` data embedded in a single report's detail response (`GET /reports/:id`) — referenced but not fully unpacked by any fork.
4. Whether `docs/admin/README.md`'s reference to a "desktop console" that "hides Staffing tab controls for Moderators" describes a real, found feature — no fork found a Staffing tab anywhere in the desktop app; possibly describes admin-web itself (imprecisely) or is stale documentation (§7.4).
5. Whether `VISION_MODERATION.md`'s "escalation inbox is a separate build, not done yet" caveat is stale relative to the fully-implemented escalation queue found in code and in `docs/admin/README.md` (§8.2) — likely stale, not confirmed via git history.
6. The exact server-side validation/enforcement path for WS-published moderation events (kind:9040-9044, 1984) — confirmed the relay accepts and stores them (via the DB tables they populate), but the specific Rust validation code was not read by any fork (all focused on the HTTP surfaces).
7. Whether `/operator/communities*` and `/api/invites` have **any** consuming frontend anywhere in the full monorepo (only admin-web and the desktop app's moderation-specific code were searched; a broader repo-wide search for these specific paths was not exhaustively performed).
8. Dark/light theme support in admin-web — not verified (would require reading `admin-web/src/styles.css` directly, not done in this pass).
9. Exact mutation mechanism (HTTP vs. signed Nostr event) for community member role promote/demote (`CommunityMembersSettingsCard.tsx`) — not traced to its data layer.
10. `community_deletion_*` tables/workflow — acknowledged to exist, not investigated; unclear if in scope for "admin panel" at all.

---

## 31. Final Recommendation

Build the SWF Buzz admin panel as **new routes and features inside the existing SWF Buzz Vue application** (§20), requiring **zero new backend or database work** (§23-24), targeting the **verified** old-Buzz feature set (§3) rather than the larger illustrative list in the original request — because that larger list was, on exhaustive inspection, mostly **not part of old Buzz at all**. Two deliberate, clearly-labeled departures from strict "port old Buzz" scope are recommended:

1. **Build the report resolve/reopen/cancel UI and the operator-roster UI** — both fully supported by the existing backend, neither ever shipped by old Buzz's own admin-web frontend. This isn't scope creep; it's completing what old Buzz's backend team built but the frontend team never finished.
2. **Add basic confirmation for destructive moderation actions** (ban/delete) — old Buzz shipped literally zero confirmation dialogs anywhere in this surface, which reads as a gap rather than a deliberate product decision (nothing in the docs defends this choice).

Everything else in this report's §3 inventory marked "NOT FOUND IN OLD BUZZ" should stay out of scope unless the user separately decides to grow the product beyond old Buzz's historical footprint — that would be a new product decision, not something this reverse-engineering pass can justify on its own.

**Per the user's explicit instruction: no implementation has begun. This report is the complete deliverable for this stage — awaiting approval before any code is written.**
