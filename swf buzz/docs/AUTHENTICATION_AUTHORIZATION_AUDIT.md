# SWF Buzz — Authentication, Authorization & Role/Permission Audit

> **Update — implementation follow-up landed.** Every gap this audit identified in §9 (except the
> one `UNKNOWN` observation, which was never reproduced in the follow-up work) has since been
> addressed: real Okta OIDC+PKCE via a native custom-URL-scheme callback (not the loopback listener
> this audit originally found), JWKS signature verification (closing D9), the `sub` claim is now
> threaded through as `applicationUserId`, a real identity/role-resolution step now runs before the
> dashboard renders (closing the §7 gap), and `/platform-admin` now has a router-level guard. The
> body of this document below is preserved as the point-in-time research it was — see
> `docs/AUTHORIZATION_RUNTIME_FLOW.md` and `docs/OKTA_PKCE_SETUP.md` for the current, as-built state.

**Purpose**: determine exactly how login/identity/roles work today, before introducing production
Okta authentication. This is a research document only — **no source code was modified to produce
it**.

**Method note**: every claim below is labeled `[CODE]` (read directly from current SWF Buzz source,
file:line cited), `[DOCS]` (from an existing SWF Buzz doc, cross-checked against code where noted),
`[INFERRED]` (a reasonable conclusion from the code's structure, not a direct statement in it), or
`UNKNOWN / REQUIRES CONFIRMATION` (a real open question this pass could not resolve from source).
Nothing here is invented. This document is scoped to SWF Buzz's own code
(`C:\Users\Pranshul\Downloads\buzz2.0\swf buzz`); where the reference Buzz app (`../buzz`) is cited
for comparison, it's marked explicitly.

---

## Table of contents

1. [Current login system](#1-current-login-system)
2. [Current authentication architecture](#2-current-authentication-architecture)
3. [User identity](#3-user-identity)
4. [Roles](#4-roles)
5. [Permissions](#5-permissions)
6. [Community / tenant model](#6-community--tenant-model)
7. [Login → role → dashboard flow](#7-login--role--dashboard-flow)
8. [UI access control](#8-ui-access-control)
9. [Security gaps](#9-security-gaps)
10. [Okta compatibility](#10-okta-compatibility)
11. [Okta role mapping](#11-okta-role-mapping)
12. [Development Mode (post-Okta design)](#12-development-mode-post-okta-design)
13. [Required login states](#13-required-login-states)
14. [Final recommendation](#14-final-recommendation)
15. [Implementation phases](#15-implementation-phases)

---

## 1. Current login system

### Login screen
`src/views/LoginView.vue` — a single unauthenticated route (`meta: { public: true }`,
`src/app/router/index.ts:8-12`). Renders one of two buttons:
- **"Sign in with Okta"** — shown only when `config.oktaIssuer && config.oktaClientId` are both set
  (`LoginView.vue:20,37`) — a **best-effort UI hint only**; the actual source of truth is the
  separate Rust-side `SWF_BUZZ_OKTA_ISSUER`/`SWF_BUZZ_OKTA_CLIENT_ID` process env vars
  (`LoginView.vue:17-19` comment), which can be out of sync with the Vite-side `VITE_OKTA_*` vars.
- **"Continue in Development Mode"** — shown only when `import.meta.env.DEV` is true
  (`LoginView.vue:49`) — **compiled out of production builds entirely**, not just CSS-hidden
  `[CODE, DOCS SECURITY.md:27]`.

### Development Mode button → identity → session
Exact call chain, `useAuth.ts:94-113` (`loginWithDevelopmentMode`):
```
LoginView.vue "Continue in Development Mode"
  → useAuth().loginWithDevelopmentMode()
  → devAuthService.login()                         (authService.dev.ts:14-21)
      → devSigningService.getPublicKey()            (signingService.dev.ts:20-22)
  → setActiveSigningService(devSigningService)       (signingServiceRegistry.ts:11-13)
  → session.setSession({authMode:"development", employeeEmail:"dev@local.test", pubkey})
  → relayConnectionService.connect(config.relayUrl)  (useAuth.ts:30-32)
  → router.push({name:"channels"})
```

### Identity/key generation
`DevSigningService` (`signingService.dev.ts:12-18`):
```ts
export class DevSigningService implements SigningService {
  readonly mode = "development" as const;
  private readonly secretKey: Uint8Array;
  constructor() {
    this.secretKey = generateSecretKey();   // nostr-tools/pure, fresh secp256k1 keypair
  }
```
The keypair is generated **in the constructor**, and the instance itself is a **module-level
singleton** created once when `useAuth.ts` is first evaluated (`useAuth.ts:17`:
`const devSigningService = new DevSigningService();`, at module scope, not inside the composable
function). Practical effect: the dev identity's pubkey is fixed for the lifetime of one running
process (one app launch), not regenerated on every click of "Continue in Development Mode" within
the same process — but **is** regenerated on every fresh process start, since the module
re-evaluates from scratch. `[CODE]`

### Signing service
`getActiveSigningService()`/`setActiveSigningService()` (`signingServiceRegistry.ts`) hold exactly
one active `SigningService` implementation at a time — a plain module-level variable, not a Pinia
store. Every feature that needs to sign an event goes through `services/publish.ts`'s
`signAndPublish()`, which calls `getActiveSigningService().signEvent(...)`
(`services/publish.ts:26-33`). `[CODE]`

### Session state
`stores/session.ts` (Pinia, `useSessionStore`) — **entirely in-memory, never persisted**:
```ts
export interface SessionState {
  isAuthenticated: boolean;
  authMode: AuthMode | null;      // "production" | "development"
  employeeEmail: string | null;
  pubkey: string | null;
}
```
No `localStorage`/`sessionStorage`/Tauri-secure-storage read exists for this store, and no Pinia
persistence plugin is installed (`main.ts:9-14` only installs plain `createPinia()`). `[CODE,
verified — grepped the whole `src/` tree for `localStorage`/`sessionStorage`/`persistedstate`,
zero hits relating to session state]`

### Authentication state / router guard
`app/router/index.ts:32-41`:
```ts
router.beforeEach((to) => {
  const session = useSessionStore();
  if (!to.meta.public && !session.isAuthenticated) return { name: "login" };
  if (to.name === "login" && session.isAuthenticated) return { name: "channels" };
  return true;
});
```
This is the **entire** authentication gate for every route. It checks only
`session.isAuthenticated` (a boolean) — it does **not** check `authMode`, role, community
membership, or anything else. Every non-public route (`/`, `/dm`, `/platform-admin`) is gated
identically: "is *some* session active," full stop. `[CODE]`

### Logout
`useAuth.ts:115-126` (`logout`):
```ts
async function logout() {
  const service = session.authMode === "production" ? oktaAuthService : devAuthService;
  await service.logout().catch(...);
  clearActiveSigningService();
  relayConnectionService.disconnect();
  session.clearSession();
  pendingBunkerPairing.value = null;
  await router.push({ name: "login" });
}
```
`DevAuthService.logout()` is a no-op (`authService.dev.ts:23-25`, "nothing to tear down for the
in-memory dev signer"). `OktaAuthService.logout()` disconnects the NIP-46 bunker connection
(`authService.okta.ts:52-54`). Session clearing is synchronous and complete: no stale pubkey,
signing service, or relay connection survives a logout. `[CODE]`

### Application startup behavior
`main.ts` mounts the Vue app with Pinia + Vue Router + Vue Query — **no auto-login, no session
restore, no token-refresh-on-boot logic exists anywhere** (`main.ts:1-15`, `App.vue:1-10` is just
an `ErrorBoundary` + `RouterView`). Every fresh process launch starts with `isAuthenticated: false`
and the router guard redirects to `/login`. `[CODE]`

> **UNKNOWN / REQUIRES CONFIRMATION** — during interactive verification of this build (in a
> separate session, driving the actual native Tauri window via Chrome DevTools Protocol), a
> **process that had been killed and relaunched from scratch was observed rendering the
> authenticated `ChannelsView` directly, with no login screen shown.** Given the code in this
> section — no persistence path exists anywhere for `session`/`SigningService` state — this
> observation is **not explained by anything in the current source** and was not root-caused in
> that pass (time-boxed; possible explanations include a process-tracking mistake amid heavy
> process churn during that debugging session, or a WebView2-level behavior not yet understood).
> **This should be independently re-verified with a clean, carefully-tracked test** (kill every
> `swf-buzz.exe`/`msedgewebview2.exe` process, confirm zero remain, relaunch once, observe) before
> trusting that "every fresh launch starts logged out" as a guarantee. If reproduced, it would be a
> **significant, high-priority finding** — a session persisting when the design explicitly commits
> to no persistence.

### What happens after login
`connectRelay()` (`useAuth.ts:30-32`) calls `relayConnectionService.connect(config.relayUrl)` —
opens the WebSocket to the single, statically-configured relay URL and performs NIP-42 auth (see
§2). The router then navigates to `{name: "channels"}`. **No community/role/membership resolution
step runs as part of login** — see §7 for why this matters.

### What happens after logout
Full teardown as described above; user lands on `/login`. No relay subscriptions survive
(`relayConnectionService.disconnect()` tears down the socket and all registered subscriptions per
`docs/ARCHITECTURE.md` §7).

### How the current user is identified
Solely by `session.pubkey` — a 64-char hex Nostr public key. There is no separate internal user ID,
no database row representing "this SWF Buzz user" independent of the Nostr keypair currently
active. See §3.

---

## 2. Current authentication architecture

| Mechanism | Present? | Purpose | Where |
|---|---|---|---|
| Development auth | **Yes** | Exercise the UI before real infra exists | `authService.dev.ts` |
| Okta (OIDC Authorization Code + PKCE) | **Yes, code-complete, unverified against a real tenant** | Authenticate *the employee* to the company | `src-tauri/src/auth/oidc.rs`, `authService.okta.ts` |
| Generic OIDC (non-Okta) | No — hardcoded to Okta's `/v1/authorize`, `/v1/token` paths | — | `oidc.rs:114-146` uses Okta-specific endpoint conventions |
| OAuth (bare, non-OIDC) | No | — | — |
| NIP-42 | **Yes** | Relay-level connection authentication (see distinction below) | `RelayConnectionService` via `nostr-tools`' `Relay`; relay-side in `../buzz` |
| NIP-46 | **Yes, code-complete, no real bunker exists to test against** | Remote signing — authorizes *Nostr protocol actions* | `signingService.nip46.ts` |
| Local/in-memory identity | **Yes** | Development Mode's ephemeral keypair | `signingService.dev.ts` |
| Wallet/key-based identity | No separate concept — the Nostr keypair *is* the identity in both dev and production signing paths | — | — |
| Session tokens (app-level) | **No** — `session.isAuthenticated` is a plain boolean, not a token | — | `stores/session.ts` |
| Refresh tokens | **No** — Okta's `id_token` is decoded once for display and discarded; no `refresh_token` is requested (`scope` in `oidc.rs:120` is `"openid email profile"`, no `offline_access`) | — | `oidc.rs` |
| Access tokens (Okta) | **Requested implicitly** (OIDC always issues one alongside `id_token`) but **never read or used** — `TokenResponse` (`oidc.rs:72-75`) only deserializes `id_token` | — | `oidc.rs` |

### APPLICATION LOGIN vs. RELAY AUTHENTICATION — explicitly distinguished

These are **two separate mechanisms answering two separate questions**, and the current code
already keeps them architecturally separate (`docs/ARCHITECTURE.md` §6, §7):

| | **Application login** | **Relay authentication (NIP-42)** |
|---|---|---|
| Question answered | "Is this a legitimate SWF Buzz user, and which employee/identity are they?" | "May this specific Nostr pubkey read/write on this specific relay connection?" |
| Mechanism | Okta OIDC (production) or Development Mode (dev-only) | NIP-42 challenge/response, `nostr-tools`' `Relay` class |
| Where enforced | Client-side gate only (`router.beforeEach`) — **the relay has no idea Okta happened** | Relay-side (`../buzz`'s `handlers/auth.rs`, confirmed in prior audit `docs/ROLE_PERMISSION_AUDIT.md` §9) |
| Result | `session.isAuthenticated = true`, unlocks client-side routing | The WebSocket connection is authenticated as a specific pubkey; the relay's own ban/membership/scope checks apply per event |
| Failure mode | Stuck on `/login` | `ConnectionBadge` shows `auth_failed`/`error` (`stores/connection.ts` `ConnectionStatus` type, `types/domain.ts:7-8`) |

**Critical architectural fact**: application login (Okta or Dev Mode) and relay authentication
(NIP-42) are connected **only** by which `SigningService` is active when
`relayConnectionService.connect()` runs. There is **no server-side link between "this employee
passed Okta" and "the relay accepted this pubkey"** — the relay only ever sees a Nostr pubkey and a
valid signature; it has no visibility into Okta, employee identity, or SWF Buzz's own session
concept at all. This is expected and correct for a self-hosted Nostr relay, but it means: **anyone
holding a signing capability for a given pubkey can authenticate to the relay, regardless of
whether they ever went through SWF Buzz's own login UI.** The relay's own authorization (community
membership, roles) is the only real gate on *what that pubkey can do* — see §8/§9.

---

## 3. User identity

### What currently represents "a user"

There is **no internal application user ID, no database, and no user table in SWF Buzz itself** —
SWF Buzz is a pure client; all persistent state lives in the relay's own Postgres (owned by `../buzz`,
out of SWF Buzz's control; see `docs/ROLE_PERMISSION_AUDIT.md` §14 for that schema). The only thing
SWF Buzz's own session model tracks is:

```ts
// stores/session.ts
{ isAuthenticated, authMode, employeeEmail, pubkey }
```

`pubkey` (a Nostr public key) is the **sole identifier** the app uses everywhere — for message
authorship, for community-role lookups (`RelayMember.pubkey`, `permissions.ts`'s `isSelf` checks),
for the avatar shown in the top bar (`AppShell.vue:42`), for everything. `employeeEmail` is display
text only, never used as a lookup key anywhere in the codebase. `[CODE, verified by grep — no
function anywhere takes `employeeEmail` as a parameter for role/permission/membership resolution]`

### The identity mapping SWF Buzz actually has today

```
Okta ID token → { sub, email }        (oidc.rs:77-81, decoded but sub is UNUSED downstream — see below)
        ↓ (email only)
AuthResult { employeeEmail, pubkey? }  (authService.okta.ts:24-50 — pubkey is OPTIONAL and comes
        ↓                              from the NIP-46 bunker restore, NOT from Okta at all)
session.pubkey                         (stores/session.ts — the ONLY identity the rest of the app uses)
        ↓
RelayMember lookup (community role)    (features/community-members/useCommunityMembers.ts — matches
        ↓                              session.pubkey against the relay's kind:13534 snapshot)
RelayMemberRole ("owner"|"admin"|"member" | null)
        ↓
Permission functions (permissions.ts)
```

### Gaps in this mapping, found directly in code

1. **Okta's `sub` claim (the actual stable Okta user identifier) is computed by Rust and returned
   to the frontend, but never used.** `OktaLoginResult { subject: String, employee_email:
   Option<String> }` (`oidc.rs:42-45`) is returned by the `start_okta_login` Tauri command, but
   `OktaAuthService.login()` (`authService.okta.ts:24-50`) only destructures and forwards
   `result.employeeEmail` — `result.subject` is read from the Rust response (`OktaLoginResult`
   interface at `authService.okta.ts:6-9` even *declares* the field) but is **discarded, never
   assigned into `AuthResult`, `session`, or anywhere else.** `[CODE, verified: `subject` does not
   appear anywhere after line 9 of `authService.okta.ts`]` — a real, present-day gap: there is no
   stable application-level user identifier derived from Okta at all today, only a mutable email
   string.
2. **Okta identity and Nostr pubkey are explicitly and deliberately NOT linked by any mechanism
   today** — `docs/DECISIONS.md` D3 states this is "unresolved... not resolvable from source,"
   and lists it as an open product question. `login()` in `authService.okta.ts` can return
   successfully from Okta with **no pubkey at all** (`pendingBunkerPairing` state,
   `useAuth.ts:59-60`) if no NIP-46 bunker is paired — the user must manually paste a `bunker://`
   URI (`LoginView.vue:65-77`) to complete authentication. There is no automatic Okta → bunker
   provisioning.
3. **A pubkey is not validated to belong to the currently-Okta-authenticated employee in any way**
   — whichever bunker connection happens to be paired (via `secure_storage_get`, persisted keychain
   entries `nip46_transport_secret_key`/`nip46_bunker_pointer`) becomes the active identity. If a
   different bunker were paired than the one the Okta-authenticated employee "should" use, nothing
   in this code would notice or reject it. This is a direct consequence of gap 2.

### The mapping requested by the audit prompt

```
Okta User
  ↓
Application User
  ↓
Nostr identity/public key
  ↓
Community Membership
  ↓
Role
  ↓
Permissions
```

**Current status of each link**:
| Link | Status |
|---|---|
| Okta User → Application User | **Missing.** No "Application User" concept exists at all — `employeeEmail` is a display string, `sub` is discarded (gap 1 above). |
| Application User → Nostr identity | **Missing** (follows from the above — there's no Application User to link from). What exists instead: Okta login → optional bunker pairing → pubkey, with no enforced relationship (gap 2/3 above). |
| Nostr identity → Community Membership | **Exists**, client-side: `useCommunityMembers()`'s `myRole` computed property matches `session.pubkey` against the relay's `RelayMember[]` list (`features/community-members/useCommunityMembers.ts:24-28`). |
| Community Membership → Role | **Exists** — the matched `RelayMember.role` field, straight from the relay's kind:13534 snapshot. |
| Role → Permissions | **Exists** — `features/community-members/permissions.ts`'s pure functions (`canManageCommunityMembers`, `canBanOrTimeout`, etc.), consumed by both the service pre-flight checks and the UI. |

**Bottom line**: the *back half* of this chain (Nostr identity → membership → role → permissions)
is real and implemented (built this project cycle, see `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md`
§2a/§2b). The *front half* (Okta User → Application User → Nostr identity) has no enforced linkage
at all today — this is the primary gap this audit's Okta section (§10/§11) must address.

---

## 4. Roles

Searched the entire SWF Buzz repository (`src/`, `src-tauri/`, `docs/`, `tests/`) for every
role/permission/capability reference. Results, separated by what's **implemented in code** vs.
**referenced only in docs/research**:

### Implemented in SWF Buzz code today

| Role | Scope | Defined in |
|---|---|---|
| `owner` | Community (one relay = one community) | `protocol/relayMembers.ts:16` (`RelayMemberRole`), `types/domain.ts` (`RelayMemberRole`) |
| `admin` | Community | same |
| `member` | Community (default/floor role) | same |

That is **the entire set of roles implemented in SWF Buzz client code**. There is no "moderator"
role, no "super admin" role, no "platform admin" role, and no "organization"/"tenant" concept
distinct from "community" anywhere in SWF Buzz's own source. `[CODE, verified by exhaustive grep
for `role`, `Role`, `permission`, `Permission`, `admin`, `owner`, `moderator`, `super`, `platform`,
`tenant`, `organization`, `capabilities`, `membership` across `src/` and `src-tauri/src/`]`

### Referenced in SWF Buzz's *own* docs (as target architecture / research, not yet built as
distinct roles)

- **Operator / Moderator** (platform-wide, distinct from community roles) — documented extensively
  in `docs/ROLE_PERMISSION_AUDIT.md` §1 and `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §1 as the
  **reference Buzz app's** deployment-wide role plane. SWF Buzz's `PlatformAdminView.vue` /
  `AdminConsoleService.ts` (`features/platform-admin/`) **consume** this role plane by calling
  `GET /probe` and gating UI on the returned `role: "operator" | "moderator" | null` — but SWF Buzz
  does not *define* these roles; it reads them from the relay's separate admin-console API. There
  is no SWF Buzz-side enum/type modeling "Operator" as a first-class app concept the way `owner`/
  `admin`/`member` are (`types/domain.ts`'s `AdminProbeResult.role` is a plain string union, used
  only for display and one boolean gate, not fed into `permissions.ts`'s shared permission
  functions).
- **"Super Admin"** — **does not exist anywhere**, neither in SWF Buzz nor in the reference Buzz
  app it's built against. `docs/ROLE_PERMISSION_AUDIT.md` §6 documents this explicitly, citing the
  reference app's own design docs stating "two roles, not three... deliberately." Any future design
  work should not invent one without a product decision to do so.
- **Channel-level roles** (`owner`/`admin`/`member`/`guest`/`bot`, a *separate* role plane from
  community roles in the reference app) — **not implemented in SWF Buzz at all**. `types/domain.ts`'s
  `Member.role` type (channel members, distinct from `RelayMember.role`) is typed
  `"owner" | "admin" | "member"` (`types/domain.ts:68-72`) but **no code anywhere reads or acts on
  it** beyond a cosmetic badge in `MemberRow.vue:23` (`v-else-if="member.role !== 'member'"`,
  displaying a text label). No permission function in the whole codebase branches on channel-level
  role. `[CODE, confirmed by grep for `Member.role`/`member.role` outside `MemberRow.vue`]`

### Role matrix (only roles with real code behind them)

| Role | Scope | Capabilities (source-backed) |
|---|---|---|
| `member` (community) | Community | Submit reports, report messages, join/leave channels, send/edit/delete own messages. No management authority. |
| `admin` (community) | Community | Everything `member` can do, plus: add plain members, remove plain-member-role targets, ban/timeout non-owner/non-admin targets, resolve/dismiss/escalate reports, view moderation queue + audit log. Cannot promote/demote, cannot touch owner or fellow admins. |
| `owner` (community) | Community | Everything `admin` can do, unrestricted (including against admins), plus change any member's role, mint invites at any role. |
| `operator` (platform, read-only consumer in SWF Buzz) | Deployment-wide | Resolve/dismiss/escalate deployment reports, manage feedback status, **and** staff the Operator/Moderator roster (`canStaff` gate in `PlatformAdminView.vue`). |
| `moderator` (platform, read-only consumer in SWF Buzz) | Deployment-wide | Same report/feedback actions as `operator`, **cannot** staff the roster. |

No `channel`-scoped role has any enforced capability in SWF Buzz today (see above).

---

## 5. Permissions

Every permission function that actually exists, from `features/community-members/permissions.ts`
(community plane) — this is the **complete, exhaustive list** of client-side permission logic in
the codebase:

| Function | What it gates |
|---|---|
| `canManageCommunityMembers(role)` | Whether the Community Members panel's management UI (add/remove/change-role) renders at all |
| `canAddMember(actingRole, roleToGrant)` | Add-member role picker options and the add-member action itself |
| `canRemoveMember(actingRole, targetRole, isSelf)` | The "Remove" button per member row |
| `canChangeRole(actingRole, targetRole, isSelf, newRole)` | "Make admin"/"Make member" buttons |
| `assignableRoles(actingRole)` | Which roles the add-member `<select>` offers |
| `canViewModerationQueue(role)` | Whether the Moderation tab's content renders (vs. "Moderators only" message) |
| `canBanOrTimeout(actingRole, targetRole)` | Ban/Timeout buttons, both in `CommunityMemberRow.vue` and `ModerationQueuePanel.vue`'s resolve actions |
| `canUnbanOrUntimeout(actingRole)` | Unban/lift-timeout buttons |
| `canResolveReport(actingRole)` | Report resolve actions (dismiss/escalate/ban/timeout/kick) |

### Permission matrix

`YES` = allowed · `COND` = allowed with a restriction · `NO` = blocked · `—` = not applicable to that role's scope.

| Permission | member | admin | owner | moderator (platform) | operator (platform) |
|---|---|---|---|---|---|
| Read channels/messages | YES | YES | YES | — | — |
| Send message | YES | YES | YES | — | — |
| Submit report | YES | YES | YES | — | — |
| View community moderation queue | NO | YES | YES | — | — |
| Add community member | NO | COND (member role only) | YES | — | — |
| Remove community member | NO | COND (member-role targets only) | YES (not another owner) | — | — |
| Change community member role | NO | NO | YES | — | — |
| Ban / timeout | NO | COND (not owner/admin) | YES | — | — |
| Unban / lift timeout | NO | YES | YES | — | — |
| Resolve/dismiss/escalate report (community) | — | YES | YES | — | — |
| View deployment-wide reports | — | — | — | YES | YES |
| Resolve deployment-wide reports | — | — | — | YES | YES |
| Manage feedback status | — | — | — | YES | YES |
| Manage Operator/Moderator roster | — | — | — | NO | YES |
| Create/edit/delete communities | — | — | **NO SWF BUZZ UI EXISTS FOR THIS** | — | — |
| Billing / cost controls | — | — | — | — | **NOT FOUND ANYWHERE** — no billing concept exists in SWF Buzz or the reference Buzz app (confirmed in `docs/ROLE_PERMISSION_AUDIT.md`) |
| Platform settings / deployment config | — | — | — | — | **NOT FOUND** — no UI or API for this in either codebase |

Community creation/deletion is entirely absent from SWF Buzz's client — see §6.

---

## 6. Community / tenant model

### What is a community?

**One relay connection = one community**, a hard architectural assumption baked into
`config.relayUrl` being a single static value (`app/config.ts:14`, `readEnv("VITE_RELAY_URL", ...)`).
There is **no multi-community switcher, no "workspace picker," no concept of connecting to more
than one community at a time** anywhere in SWF Buzz. `[CODE, INFERRED from the absence of any
second relay-URL config, any community-selector component, or any per-community-scoped query key
beyond the single active connection]`

### Who owns a community?

The relay-side `owner` role in `relay_members` (one row per community, enforced relay-side per
`docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` §2a). SWF Buzz has no UI to create a community or
become its owner — ownership is established entirely outside SWF Buzz's client, either via the
relay's own deployment config (`RELAY_OWNER_PUBKEY`) or the reference app's Operator-only
`/operator/communities` provisioning API, which SWF Buzz's `AdminConsoleService.ts` deliberately
does not implement (documented as out of scope, `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` §11).

### How does a user join?

Not implemented in SWF Buzz today. The `InviteService` (kind:9009) creates/lists invite events but
has **no acceptance/claim flow** — `docs/DECISIONS.md` D4 documents this is a confirmed server-side
no-op, deliberately not built further. The reference app's *real*, enforced invite mechanism
(`POST /api/invites` + `/api/invites/claim`, a separate HTTP surface) is **not implemented in SWF
Buzz at all** (`docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` Open Question 10). **Practical
consequence: there is currently no working way for a new user to join a community through SWF
Buzz's own UI.** Community membership (the `relay_members` row a user needs to do anything beyond
being an anonymous connection, depending on whether the relay enforces membership at all) must be
granted out-of-band today (direct DB write, or the reference app's own client, or the
community-members "Add member" feature *if* the adding user is already an owner/admin).

### Can one user belong to multiple communities?

**Architecturally not supported by SWF Buzz's client** — since there is only ever one active relay
connection, a given running instance of SWF Buzz can only ever reflect membership/role in the one
community it's connected to. `UNKNOWN / REQUIRES CONFIRMATION`: whether this is an acceptable
permanent product constraint, or whether multi-community support (switching relay URLs at runtime,
or connecting to several simultaneously) is a real future requirement — nothing in SWF Buzz's own
docs commits to an answer either way.

### Can a user have different roles in different communities?

Not applicable given the above — SWF Buzz only ever sees one community's role for the currently
active pubkey at a time.

### Who can invite members / remove members / change roles / create communities / delete communities?

- Invite (real, enforced mechanism): **not implemented in SWF Buzz** (see above).
- Remove members / change roles: owner/admin, per §4/§5, enforced client-side pre-flight and
  (per prior audit) relay-side for real.
- Create communities: **no SWF Buzz UI** — this is Operator-only in the reference app's separate
  provisioning API, not implemented here.
- Delete communities: **no SWF Buzz UI**, same reasoning.

### What data is community-scoped vs. platform-scoped?

- **Community-scoped** (everything SWF Buzz's main UI reads/writes): channels, messages, threads,
  reactions, DMs, presence, typing, community membership/roles, moderation reports/actions/audit
  for that one community.
- **Platform-scoped** (accessed only via `features/platform-admin/`, a separate host entirely):
  deployment-wide reports (cross-community), feedback, the Operator/Moderator roster. This is a
  genuinely separate role plane and a genuinely separate HTTP origin (`config.adminUrl`), not
  merely a different UI section of the same data.

### Complete lifecycle, as it actually exists in code today

```
User
  ↓ [NOT IMPLEMENTED IN SWF BUZZ] — no working invite/join flow
Invitation
  ↓ [MANUAL/OUT-OF-BAND] — someone with owner/admin adds the pubkey directly,
  ↓                         or a DB/relay-admin action happens outside SWF Buzz
Membership (relay_members row)
  ↓ [IMPLEMENTED] — RelayMembersService.addMember(), permission-checked
Role assignment
  ↓ [IMPLEMENTED] — RelayMembersService.changeRole(), owner-only
Access (permission-gated UI + relay-side enforcement)
  ↓ [IMPLEMENTED]
Role change
  ↓ [IMPLEMENTED]
Removal
  ↓ [IMPLEMENTED] — RelayMembersService.removeMember()
Logout
  ↓ [IMPLEMENTED] — useAuth().logout()
```

The **join/invitation step is the one genuine hole** in an otherwise-implemented lifecycle.

---

## 7. Login → role → dashboard flow

### Documented/expected flow (from the audit prompt)

```
User opens SWF Buzz → Login → Identity verified → Application user resolved →
Memberships loaded → Current community selected → Role resolved → Permissions resolved →
Dashboard rendered → Only allowed navigation/features displayed
```

### What actually happens in SWF Buzz today

```
User opens SWF Buzz
  ↓
router.beforeEach redirects to /login (session.isAuthenticated === false)
  ↓
User clicks "Continue in Development Mode" or "Sign in with Okta"
  ↓
AuthService.login() resolves an identity claim (employeeEmail; pubkey for dev mode always,
  for Okta only if a bunker is already paired)
  ↓
session.setSession(...) — sets isAuthenticated=true, authMode, employeeEmail, pubkey
  ↓
relayConnectionService.connect(config.relayUrl) — fires, but login navigation does NOT wait for
  the connection to succeed (connectRelay() is called without awaiting the connect() promise's
  resolution before router.push, per useAuth.ts:31,53,83,105 — connectRelay() itself is a
  fire-and-forget `void` call)
  ↓
router.push({name:"channels"}) — happens immediately after session.setSession(), NOT gated on
  relay connection success, community role resolution, or anything else
  ↓
ChannelsView.vue mounts → useChannels()/useChannelMembers() etc. start querying — but
  useCommunityMembers() (the ONLY thing that resolves community role) is NOT called here at
  all; it's called only inside CommunityMembersPanel.vue / ModerationQueuePanel.vue /
  CommunityMemberRow.vue, which only mount when the user manually opens the details pane AND
  clicks the "Community" or "Moderation" tab
  ↓
Dashboard renders — with NO role-based navigation filtering, because role hasn't been resolved yet
```

### Gap analysis: what's missing vs. the "expected" flow

| Expected step | Status |
|---|---|
| Identity verified | **Partial** — Okta ID token signature is not verified (D9); dev mode has no verification concept by design |
| Application user resolved | **Missing** — no Application User concept exists (§3) |
| Memberships loaded | **Missing as a login step** — community role is fetched lazily, only when a moderation-related component happens to mount, not as part of the login sequence |
| Current community selected | **N/A / trivially "the only one"** — no selection UI exists because only one community is ever reachable per running instance |
| Role resolved | **Deferred, not part of login** — see above |
| Permissions resolved | **Deferred, not part of login** — same |
| Dashboard rendered with only allowed nav/features | **Partially true, inconsistently timed** — `PlatformAdminView`'s link in the sidebar footer is gated by `isPlatformAdminConfigured()` (a build-time config check, not a role check) at `ChannelsView.vue`; the Community/Moderation tabs render their own internal role gates only once their own composables resolve, which happens **after** the tab is already visible and clicked, producing a visible flash from "loading" to "you don't have permission" for a plain member — not a true pre-filtered nav |

**This is the most actionable finding for the Okta integration work**: there is currently no single
"resolve who I am and what I can do" step that runs once, early, after login — role/permission
resolution is scattered, lazy, and per-component. A real production auth rollout should introduce
exactly this step (see §14/§15).

---

## 8. UI access control

### What's audited

| Surface | Gate found | File |
|---|---|---|
| `/platform-admin` route | Only `session.isAuthenticated` (router guard) — **no role check at the routing level** | `app/router/index.ts:32-41` |
| Platform Admin sidebar link | `isPlatformAdminConfigured()` — checks `config.adminUrl` is set, **not** whether the user holds any role | `views/ChannelsView.vue` |
| Platform Admin page content | `useAdminProbe()`'s `probe.canAct` — a real role check, but it runs **inside** the already-navigated-to page, not before | `features/platform-admin/ui/PlatformAdminView.vue` |
| Staff tab (Platform Admin) | `probe.canStaff` | same |
| Community Members management UI | `canManage` (`canManageCommunityMembers`) | `CommunityMembersPanel.vue` |
| Moderation Queue tab content | `canManage` (`canViewModerationQueue` via the same `useCommunityMembers()` role) | `ModerationQueuePanel.vue` |
| Per-member ban/timeout/remove/role-change buttons | Individual permission functions, computed per-row | `CommunityMemberRow.vue` |
| Report button on a message | Self-authorship only (`isOwnMessage`), **not a role check** — any member may report any other member's message | `MessageItem.vue` |

### UI enforcement vs. business/service enforcement vs. data-level enforcement

**UI hiding is not security, and this project's own code correctly does not treat it as such** —
every mutation service method (`RelayMembersService`, `ModerationService`, `AdminConsoleService`)
runs the *same* permission function the UI uses, as a pre-flight check, **before** signing/
publishing (e.g. `RelayMembersService.addMember()` calls `canAddMember()` and throws
`AppError("permission_denied", ...)` if it fails — `RelayMembersService.ts`). This is explicitly
documented in code comments as **"fail-fast UX only, not a security boundary"**
(`permissions.ts:7-14`), citing the correct reasoning: the real relay-side authorization (in
`../buzz`) is the only trustworthy enforcement point, because a modified client or a hand-crafted
signed event could always skip the SWF Buzz client entirely and talk to the relay directly.

So, concretely:
- **UI enforcement**: exists, consistently, for every sensitive action found.
- **Business/service-layer enforcement**: exists, consistently — every mutation method has a
  pre-flight permission check, not just the UI component.
- **Data-level enforcement**: exists, but **entirely outside SWF Buzz** — in the relay
  (`../buzz`'s own authorization code, verified extensively in `docs/ROLE_PERMISSION_AUDIT.md`).
  SWF Buzz itself has zero data storage or enforcement of its own; it is a pure client. This is the
  correct architecture for a Nostr-relay-backed app, but it means **SWF Buzz's own "service-layer"
  checks are cosmetic in the security sense**, even though they're real code, not just a hidden
  button — they improve UX (fast, clear errors) but contribute nothing to actual security if
  bypassed. This is accurately described in the code's own comments and should stay that way in
  any Okta work — **do not let anyone mistake the client-side permission functions for a security
  boundary.**

### Genuine gap found

The `/platform-admin` **route itself** has no role gate — any authenticated user (dev-mode or Okta,
any role or no community role at all) can navigate to `/platform-admin` and see the page shell
(sidebar, tab buttons) before `useAdminProbe()` resolves and (if unauthorized) replaces the content
with a "Not authorized" `StateView`. This is a **UI-polish gap, not a security gap** (no sensitive
data or action is exposed before the probe resolves — the page starts in a loading state and the
actual report/feedback/roster data queries are all separately gated behind `isPlatformAdminConfigured()`
and, transitively, the relay's own 403 responses) but is worth fixing for a cleaner UX: gate the
route itself, not just its content.

---

## 9. Security gaps

Ranked by severity, all found directly in source:

1. **[HIGH] Okta ID token signature is not verified.** `oidc.rs`'s `decode_id_token_claims` decodes
   the JWT payload without checking its signature against Okta's JWKS. Documented as a known,
   deliberate gap in `docs/DECISIONS.md` D9 and `docs/SECURITY.md` — **must be fixed before this
   flow is used against real production employee identities.** Without this, a network position
   capable of intercepting the (loopback-only, but still) token exchange could substitute a forged
   ID token, though PKCE + `state` + the loopback-only redirect significantly narrow the practical
   attack surface for a local desktop flow.
2. **[HIGH] No linkage between Okta identity and Nostr pubkey (D3, unresolved).** As detailed in
   §3, an Okta login can succeed with `pubkey` entirely absent (pending bunker pairing), and once a
   bunker *is* paired, nothing verifies it "belongs to" the Okta-authenticated employee in any way.
   In principle, any employee who successfully logs into Okta could pair with *any* `bunker://` URI
   they can obtain — there is no enforcement that the bunker is provisioned specifically for them.
   This is the single most important architectural question to resolve before Okta goes to
   production (see §10/§11).
3. **[MEDIUM] Okta's `sub` claim is discarded.** As found in §3 — there is currently no stable
   application-level identifier derived from the employee's Okta account; only a mutable `email`
   string is carried forward. If email changes (marriage, rename, org migration), any future code
   that keyed off `employeeEmail` would silently lose continuity. Nothing does yet, but this is a
   latent trap for anyone who builds such a feature without noticing `sub` is already being thrown
   away.
4. **[MEDIUM] Route-level role gating is absent; only content-level gating exists.** Documented in
   §8 — not a data-exposure risk today, but a pattern that will silently continue to *not* gate new
   routes unless someone remembers to add a content-level check inside every new page component.
   A router-level role guard (in addition to the existing authentication-only guard) would close
   this class of future mistake structurally rather than relying on every new view to remember.
5. **[MEDIUM] No session expiration or token refresh exists at the application level.**
   `session.isAuthenticated` never expires on its own — once true, it stays true until an explicit
   `logout()` call or the process exits (in-memory state). For Okta, no `access_token`/
   `refresh_token` is even retained (§2), so there is no mechanism to re-verify the employee is
   still authorized by Okta during a long-running session — SWF Buzz would keep trusting a session
   indefinitely even if the employee were deprovisioned in Okta mid-session, until the app is
   restarted. `UNKNOWN / REQUIRES CONFIRMATION`: how long a typical desktop session runs in
   practice, and whether this matters for this product's threat model — for many internal desktop
   apps, this is an accepted tradeoff, but it should be a deliberate one.
6. **[LOW-MEDIUM] Development Mode's identity, while clearly labeled, uses the exact same
   `SigningService`/`AuthService` interfaces as production** — this is *good* (it's the correct way
   to keep dev mode from diverging architecturally, and it's compiled out of production builds
   entirely), but it means any bug in the shared plumbing (`useAuth.ts`, `signingServiceRegistry.ts`,
   `publish.ts`) affects both paths identically — there's no isolation between "a bug only Dev Mode
   can hit" and "a bug production can hit," which is worth knowing when triaging.
7. **[LOW] "UNKNOWN / REQUIRES CONFIRMATION" session-persistence observation from §1.** If the
   anomaly described there (an authenticated view rendering on what was believed to be a fresh
   process launch) is reproduced and confirmed real rather than a tracking mistake, it would
   contradict the documented "no persistence, ever" design and needs root-causing before Okta
   ships — a persisted session that survives process restarts without any explicit persistence
   code existing would be a serious, hard-to-reason-about bug.
8. **[LOW] No tenant/community isolation logic exists in SWF Buzz because none is needed by its own
   architecture** (§6) — this is not a gap today (one relay connection = one community, enforced by
   there being no way to address a second one), but it means **if multi-community support is ever
   added, tenant isolation will need to be designed from scratch** — there is no existing
   scaffolding (no `communityId` parameter threaded through any query key, service method, or
   permission function) to build on.
9. **[LOW] Admin-web-style "never call `/probe` before rendering" mistake, avoided here but worth
   naming**: `PlatformAdminView.vue` *does* call `probe()` before rendering sensitive content —
   this is not a gap, it's called out here specifically because the reference Buzz app's own
   `admin-web` frontend was found to have exactly this mistake (`docs/ROLE_PERMISSION_AUDIT.md`
   §15) — confirming SWF Buzz correctly avoided repeating it.
10. **[INFORMATIONAL] Privilege escalation via role spoofing**: not possible through the client —
    every role-changing action (`changeRole`, `addMember` with `role: "admin"`) is relay-enforced
    server-side per the prior audit; the client's own permission checks cannot be tricked into
    granting a role, only into attempting an action the relay will independently re-check and
    reject if unauthorized.

---

## 10. Okta compatibility

### Where Okta can be introduced without breaking the current architecture

**The architecture already anticipated this split correctly** — `docs/ARCHITECTURE.md` §6's
diagram (`UI → AuthService → session → SigningService → bunker → remote signer`) and the existing
`AuthService`/`SigningService` interface separation (`features/auth/types.ts`,
`features/signing/types.ts`) mean **Okta itself requires no architectural change** — it's already
implemented (`OktaAuthService`, `src-tauri/src/auth/oidc.rs`). What's missing is not "can Okta be
added" (it already has been) but **the identity-mapping and role-resolution layer downstream of
it** (§3, §7).

### Recommendation: OIDC Authorization Code + PKCE for the native Tauri app — confirmed correct

The current implementation already uses exactly this (`oidc.rs`), and it is the right choice: PKCE
means the public desktop client never needs a client secret; the loopback-listener + system-browser
pattern (not an embedded webview) is the platform-recommended approach for native OAuth clients and
avoids the security and UX problems of an embedded login webview. **No change recommended here** —
finish it (JWKS verification, D9) rather than replace it.

### Can the current architecture support the full requested chain?

```
Okta Identity → Application User → Nostr Identity → Community Membership → Role → Permissions
```

| Link | Can the current architecture support it? |
|---|---|
| Okta Identity (verified) | Yes, once D9 (JWKS verification) is fixed — no architectural blocker |
| → Application User | **No application-user concept exists to build this link onto** — needs new code, not a fix to existing code. See §14/§15 Phase 2. |
| → Nostr Identity | Exists today only via manual bunker pairing (D3) — needs a provisioning decision, not just code (§11) |
| → Community Membership | Already works (`RelayMember` lookup) |
| → Role | Already works |
| → Permissions | Already works |

### Exactly which files would need modification

| File | Change needed |
|---|---|
| `src-tauri/src/auth/oidc.rs` | Add JWKS fetch + RS256 signature verification (D9). Consider requesting `offline_access` scope + persisting `access_token`/`refresh_token` if session-expiration (§9 gap 5) is to be addressed. |
| `src/features/auth/authService.okta.ts` | Stop discarding `result.subject` — propagate Okta's `sub` claim into `AuthResult` and onward into session state as a stable application-user identifier. |
| `src/stores/session.ts` | Add a field for the Okta `sub` (or a genuine "Application User" concept — see §11) alongside `employeeEmail`/`pubkey`. |
| `src/features/auth/useAuth.ts` | Insert a role/membership-resolution step into the login flow (currently absent — see §7) between `session.setSession()` and `router.push()`, so the dashboard never renders before role is known. |
| `src/app/router/index.ts` | Add a role-aware guard (not just authentication) for role-gated routes like `/platform-admin` (§8 gap). |
| **New file(s)** — an "Application User"/identity-resolution service (§11) | Whatever mechanism is chosen for Okta → Nostr identity provisioning (D3) needs a home; does not exist yet. |

### Files that should NOT change

- `src-tauri/src/storage/secure_store.rs` — the OS-keychain wrapper is already correctly scoped and
  minimal; no reason to touch it for Okta work.
- `src/features/signing/signingService.nip46.ts` / `signingService.dev.ts` — the `SigningService`
  abstraction is already correct; Okta work should build *on top of* this interface, not modify it.
- `src/features/community-members/permissions.ts`, `src/features/moderation/*` — the
  role/permission logic downstream of identity resolution is already correct and relay-verified;
  Okta work is entirely upstream of this layer and shouldn't need to touch it.
- `../buzz` (the reference repo) — read-only reference per every prior session's standing rule; the
  relay's own NIP-42/role model does not need or want any Okta awareness (see §2's
  APPLICATION LOGIN vs. RELAY AUTHENTICATION distinction — keep them separate).

---

## 11. Okta role mapping

### A. Okta groups | B. SWF Buzz database/community membership | C. Hybrid

| | A. Okta groups | B. SWF Buzz/relay membership | C. Hybrid |
|---|---|---|---|
| What it would require | Okta admin configures groups, issues a custom claim/scope carrying group membership; SWF Buzz reads it from the ID token | Nothing new — already fully implemented (`relay_members`, community `owner`/`admin`/`member`) | Okta authenticates identity only; SWF Buzz/relay membership determines role (this is what the user's stated preference describes) |
| Who administers roles | IT/Okta admins, outside the product | Community owners/admins, inside the product | Community owners/admins, inside the product |
| Matches the reference Buzz app's own model? | No — the reference app's roles (community owner/admin/member, platform Operator/Moderator) are entirely relay/DB-driven, never IdP-driven (confirmed across `docs/ROLE_PERMISSION_AUDIT.md`) | **Yes, exactly** | **Yes, exactly** (Okta contributes identity only) |
| Consistency with the existing permission model already built this project cycle | N/A — would require rebuilding `permissions.ts` around Okta group claims instead of `RelayMember.role` | **Already matches** — zero rework | **Already matches** — zero rework |
| Handles a user's role differing per community | Awkward — Okta groups are typically global, not naturally scoped per-community without significant Okta-side configuration per community | **Natural** — this is exactly what `relay_members` already models, per-community | **Natural**, same reasoning |
| Risk of drift between Okta and actual product state | High — Okta group membership and relay membership would be two separate sources of truth that could disagree | None — one source of truth | None — one source of truth |

### Analysis: is the user's stated preference (Okta = identity, SWF Buzz = roles/permissions)
### correct for this project?

**Yes — this is confirmed correct, not just accepted at face value.** Three independent pieces of
evidence support it:

1. **The reference Buzz app itself never uses an identity provider for authorization** — every
   role (community owner/admin/member, platform Operator/Moderator) is resolved from its own
   relay/database state, keyed by Nostr pubkey, with zero IdP involvement anywhere in that
   architecture (`docs/ROLE_PERMISSION_AUDIT.md`, exhaustively audited). Since SWF Buzz's entire
   product goal is to replicate that app's business functionality, matching its role-source
   architecture avoids reinventing a parallel, inconsistent system.
2. **SWF Buzz's own already-built permission layer (`permissions.ts`, this project cycle) is
   entirely `RelayMember.role`-driven** and works correctly today, independent of any auth
   mechanism — Development Mode and Okta both already funnel into the exact same role-resolution
   code path (`useCommunityMembers()`), because role resolution reads `session.pubkey` (whichever
   auth method produced it) against relay state, never `session.authMode` or anything Okta-specific.
   Option A (Okta groups) would require **rebuilding** this already-correct, already-tested layer.
3. **Community membership is inherently per-community and dynamic** (a user's role can change via
   `changeRole()`, can differ across communities in principle) — Okta groups are a poor natural fit
   for this kind of frequently-changing, per-tenant state; a relay/DB-backed model is architecturally
   the right tool.

**Recommendation: confirm Option C (Hybrid) precisely as the user proposed** — Okta answers only
"who is this employee," SWF Buzz's existing community-membership/role system (already fully
implemented) answers "what can they do." The only real work remaining is the identity-*linkage*
step (Okta employee ↔ specific Nostr pubkey/bunker), not the role/permission logic itself, which
needs no change.

---

## 12. Development Mode (post-Okta design)

Requirements restated from the prompt, with a determination of what's needed for each:

| Requirement | Current status | What's needed |
|---|---|---|
| Remain available only in local development | **Already true** — `import.meta.env.DEV` gate, compiled out entirely (`LoginView.vue:49`, `docs/SECURITY.md:27`) | Nothing — keep as-is |
| Never available in production | **Already true**, same mechanism | Nothing — keep as-is |
| Create a clearly marked development identity | **Already true** — `employeeEmail: "dev@local.test"` (`authService.dev.ts:18`), UI copy explicitly says "Uses a temporary in-memory identity" (`LoginView.vue:55`) | Nothing — keep as-is |
| Use the same application authorization pipeline as real users | **Already true today** — `loginWithDevelopmentMode()` calls the identical `session.setSession()`/`connectRelay()`/router flow as Okta (`useAuth.ts:94-113` vs. `41-68`) | **Must be preserved** as the identity-resolution/role-loading step (§7's recommended fix) is added — the new step must run identically for both `authMode` values, not be special-cased to skip for dev mode |
| Still resolve role/membership/permissions | **Already true** — `useCommunityMembers()` reads `session.pubkey` regardless of `authMode`; a dev-mode pubkey seeded into `relay_members` resolves a real role exactly like a production pubkey would (this was directly verified interactively this project cycle — see `docs/E2E_TEST_RESULTS.md`'s "Update" section) | Nothing — keep as-is |
| Not bypass authorization | **Already true** — Development Mode has no elevated relay-side privilege; a dev-mode pubkey with no `relay_members` row is just an ordinary unrecognized pubkey, subject to the exact same relay-side checks as any other | Nothing — keep as-is |

**Conclusion: Development Mode's design already satisfies every stated requirement.** The only
thing that could regress this is if the new Okta-driven identity-resolution/role-loading step (§7,
§14/§15) is implemented in a way that's coupled to `authMode === "production"` rather than running
uniformly for any resolved `session.pubkey`. **Explicit implementation guidance**: build the new
role/permission-resolution step as a pure function of `session.pubkey`, called identically after
*either* `loginWithOkta`/`completeBunkerPairing` or `loginWithDevelopmentMode` succeeds — never
branch on `authMode` inside that step.

---

## 13. Required login states

| State | Currently modeled? | Where | Expected UI behavior |
|---|---|---|---|
| Logged out | Yes | `session.isAuthenticated === false` | `/login` screen |
| Logging in | Yes | `useAuth().isLoading` | Buttons disabled, no explicit spinner text found — `[CODE]` `LoginView.vue` disables both buttons via `:disabled="isLoading"` but shows no loading indicator copy |
| Authentication callback (Okta redirect) | **Implicit, not a distinct UI state** — the OIDC loopback flow is a blocking Rust command (`oidc.rs:99`, synchronous, runs on Tauri's blocking threadpool); the frontend just awaits `invoke("start_okta_login")` inside `isLoading`. No distinct "waiting for browser callback" UI state exists — it's indistinguishable from any other loading state. | `authService.okta.ts:24-27` | Same generic "isLoading" treatment as everything else |
| Authenticated | Yes | `session.isAuthenticated === true` | Redirected off `/login` to `/` |
| Loading profile | **Not modeled** — no "profile" concept beyond `employeeEmail`/`pubkey`, already available synchronously from `AuthResult` | — | N/A today |
| Loading memberships | **Not modeled as a distinct state** — `useCommunityMembers()`'s own `isLoading` exists, but only within whichever component happens to mount it, not as a global post-login state (§7 gap) | `useCommunityMembers.ts` | Currently: nothing shown until the user manually opens Community/Moderation tabs |
| Selecting community | **N/A** — no multi-community support exists (§6) | — | — |
| No community | **Partially modeled** — `CommunityMembersPanel.vue`'s `members === null` branch shows "No community roster on this relay" gracefully, but only reachable by manually opening that tab | `CommunityMembersPanel.vue` | Correct messaging exists, just not surfaced proactively |
| Unauthorized | **Modeled per-surface, not globally** — `PlatformAdminView.vue`'s "Not authorized" `StateView` when `!probe?.canAct`; `ModerationQueuePanel.vue`'s "Moderators only" message | Various | Consistent pattern, could be centralized |
| Session expired | **Not modeled at all** — no expiration concept exists (§9 gap 5) | — | Nothing happens; session just silently continues indefinitely until explicit logout |
| Logout | Yes | `useAuth().logout()` | Full teardown, redirect to `/login` |
| Authentication failure | Yes | `useAuth().error` (a plain string) | Shown inline on `LoginView.vue:80` |
| Relay connection failure | Yes, well-developed | `stores/connection.ts`'s `ConnectionStatus` (`connecting\|connected\|disconnected\|reconnecting\|auth_failed\|error`), surfaced via `ConnectionBadge.vue` with context-aware messages (e.g. "Can't reach the local Buzz relay") | Top-bar badge, persistent and informative — this is the most mature state-handling in the whole auth/session system |

---

## 14. Final recommendation

### A. Current architecture

Two independent auth mechanisms (Development Mode, Okta OIDC+PKCE) both funnel into one
`SigningService` abstraction, which is the sole source of the one identity concept the rest of the
app uses: a Nostr `pubkey`. Community role/permission resolution (owner/admin/member) is fully
implemented and relay-verified, but resolved lazily and locally per-component rather than as part
of a login sequence. Platform-wide roles (Operator/Moderator) are consumed read-only via a separate
admin-console API, gated correctly with a `/probe` pre-check.

### B. Current gaps

1. Okta `sub` claim discarded; no Application User concept.
2. Okta identity ↔ Nostr pubkey linkage is manual, unenforced (D3).
3. Okta ID token signature not verified (D9).
4. Role/membership resolution is not part of the login flow — it's deferred and per-component.
5. Route-level role gating doesn't exist (only content-level).
6. No session expiration/refresh concept.
7. `UNKNOWN`: a possible session-persistence anomaly observed once, unconfirmed (§1).

### C. Required architecture

```
Okta OIDC (PKCE) → verified ID token (JWKS-checked) → { sub, email }
        ↓
Application User (NEW — keyed by Okta `sub`, the stable identifier)
        ↓
Nostr Identity — via an explicit, confirmed provisioning decision (D3): either (a) a
  per-employee bunker directory keyed by `sub`, (b) an Okta custom claim carrying the bunker
  URI, or (c) a one-time pairing flow whose result is then remembered against `sub`
        ↓
Community Membership (ALREADY IMPLEMENTED — RelayMember lookup by pubkey)
        ↓
Role (ALREADY IMPLEMENTED)
        ↓
Permissions (ALREADY IMPLEMENTED)
```

A single new **identity-resolution step**, run once right after `AuthService.login()` succeeds and
before `router.push({name:"channels"})`, should own turning "an authenticated identity claim" into
"a resolved pubkey + role," for both Okta and Development Mode uniformly.

### D. Role/permission matrix

See §4/§5 in full — reproduced here at a glance:

| Role | member | admin | owner | moderator | operator |
|---|---|---|---|---|---|
| Scope | Community | Community | Community | Platform | Platform |
| Manage members | NO | COND | YES | — | — |
| Moderate | NO | COND | YES | — | — |
| Change roles | NO | NO | YES | — | — |
| Deployment reports | — | — | — | YES | YES |
| Staff roster | — | — | — | NO | YES |

### E. Login flow (recommended)

```
Login screen → AuthService.login() (Okta or Dev Mode) → identity claim resolved
  → [NEW] resolveIdentityAndRole(pubkey) — fetches community membership, resolves role,
     primes any role-dependent caches — runs for BOTH auth modes identically
  → session.setSession(...) with role now known
  → relayConnectionService.connect() — AWAITED this time, or at minimum its failure state
     surfaced before the dashboard claims to be ready
  → router.push({name:"channels"}) — only after the above resolves (success OR a handled
     failure state, not silently racing ahead)
  → Dashboard renders with nav already filtered by the now-known role
```

### F. Okta integration plan

1. Fix D9 (JWKS signature verification) — `oidc.rs`.
2. Stop discarding `sub` — thread it through `AuthResult` → `session`.
3. Make an explicit product decision on D3 (bunker provisioning mechanism) — this cannot be
   resolved from code; it's a product/infra decision requiring the team.
4. Build the identity-resolution step (§14.C) as new code, not a modification of existing
   role/permission logic.
5. Add route-level role gating for `/platform-admin` (and any future role-gated routes).

### G. Development Mode plan

No changes required to Development Mode's own behavior — see §12 in full. The only requirement is
that new login-flow code (F.4) treats `authMode` as irrelevant to role resolution, branching only
on `session.pubkey`.

### H. Implementation plan

See §15 for the full phased breakdown.

### I. Security checklist

- [ ] Okta ID token signature verified against JWKS (D9)
- [ ] Okta `sub` claim captured and used as the Application User's stable identifier
- [ ] Explicit, confirmed decision on Okta↔Nostr identity linkage (D3) — not resolvable in code
      alone
- [ ] Route-level role guard added for role-gated routes
- [ ] Session-expiration behavior explicitly decided (even if the decision is "not needed for this
      product's threat model," make it a decision, not a silent gap)
- [ ] Confirm/rule out the session-persistence anomaly from §1
- [ ] Re-confirm Development Mode still uses the identical authorization pipeline after any of the
      above changes (see §12's explicit guidance)
- [ ] No change to `permissions.ts`/relay-side enforcement — verify this explicitly after Okta work
      lands, since it's easy to accidentally duplicate or diverge role logic when adding a new auth
      path

### J. Files that need to change

See §10's table — `oidc.rs`, `authService.okta.ts`, `stores/session.ts`, `useAuth.ts`,
`app/router/index.ts`, plus one new identity-resolution service/composable.

### K. Files that should NOT be changed

See §10's table — `secure_store.rs`, both `SigningService` implementations,
`features/community-members/permissions.ts`, `features/moderation/*`, and `../buzz` itself.

### L. Test plan

- Unit tests for the new identity-resolution step's pure logic (given a pubkey and a
  `RelayMember[]` snapshot, resolve the correct role) — mirrors the existing
  `permissions.ts`/`communityPermissions.spec.ts` testing pattern already established.
- Unit test confirming Development Mode and Okta both invoke the identity-resolution step
  identically (a regression test for the §12 guidance — assert no `authMode` branch exists inside
  that step).
- Manual/interactive test (once a real Okta tenant + JWKS are available): verify a forged/altered
  ID token is rejected once D9 is fixed — this cannot be meaningfully unit-tested without a real or
  mocked JWKS endpoint.
- Manual test: session behavior when Okta access is revoked mid-session (if session-expiration is
  implemented) vs. today's "keeps working until app restart" baseline (if it's explicitly decided
  not to be implemented, document that decision and skip this test).
- Re-run the full existing gate suite (`npm run typecheck && npm run lint && npm run test && npm run
  build`, `cargo check && cargo clippy --all-targets && cargo fmt --check`) after every phase, per
  this project's established discipline.

---

## 15. Implementation phases

| Phase | Objective | Files | Dependencies | Expected result | Tests | Risks |
|---|---|---|---|---|---|---|
| **1. Authentication abstraction** | Confirm/harden the existing `AuthService`/`SigningService` split — no new interfaces needed, this already exists correctly | `features/auth/types.ts`, `features/signing/types.ts` (review only) | None | Documented confirmation that no change is needed here | N/A (review) | Low — this phase is verification, not construction |
| **2. Application user identity mapping** | Introduce an "Application User" concept keyed by Okta `sub`; stop discarding it | `authService.okta.ts`, `stores/session.ts`, `oidc.rs` (thread `subject` through if not already) | Phase 1 | `session` carries a stable Okta `sub` alongside `pubkey`/`employeeEmail` | Unit test: login result includes `sub` | Low — additive change |
| **3. Membership/role resolution** | Build the single identity-resolution step (§14.C/E) that runs once after login for both auth modes | New: an identity-resolution composable/service; modifies `useAuth.ts` | Phase 2 | Role is known before the dashboard renders, for both Dev Mode and Okta | Unit tests per §14.L | Medium — must not special-case `authMode`, per §12 |
| **4. Permission enforcement** | Verify no regression to existing `permissions.ts`/service pre-flight checks; extend route-level gating | `app/router/index.ts`, `permissions.ts` (review, likely no change) | Phase 3 | `/platform-admin` (and future role-gated routes) gated at the router level, not just content-level | Regression run of existing 128+ unit tests | Low-medium — router guard changes touch every route |
| **5. Role-aware UI** | Use the now-early-resolved role to pre-filter navigation (sidebar links, tab visibility) instead of each component discovering its own permission after mounting | `ChannelsView.vue`, `AppShell.vue` | Phase 4 | No more "flash of unauthorized content" while a component's own query resolves | Manual/interactive verification (screenshot-based, per this project's established pattern) | Low |
| **6. Okta OIDC + PKCE** | Fix D9 (JWKS verification); resolve D3 (bunker provisioning) per product decision | `oidc.rs`, new provisioning code per D3's chosen option | A real Okta tenant + JWKS endpoint; a team decision on D3 | Production-grade Okta login, cryptographically verified | Cannot be fully automated-tested without real infra — manual verification required, documented as such (mirrors this project's existing honest labeling in `docs/E2E_TEST_RESULTS.md`) | High — D3 is a product decision, not just code; D9 needs real Okta infra to verify against |
| **7. Logout/session handling** | Decide and implement (or explicitly decline) session expiration; ensure logout remains complete | `useAuth.ts`, `stores/session.ts` | Phase 6 (if token refresh is part of the decision) | A documented, deliberate session-lifetime policy, not a silent gap | Unit + manual | Medium — depends on the product decision made |
| **8. Tauri desktop callback/deep-link handling** | Confirm the existing loopback-listener approach (already correct) continues to work as other phases land; no architectural change expected | `oidc.rs` | Phase 6 | No regression | Manual, against a real Okta tenant | Low — this is already implemented correctly |
| **9. End-to-end role testing** | Interactive verification of every role (member/admin/owner/moderator/operator) against a real relay, mirroring the methodology already proven this project cycle (CDP-driven clicking, real Postgres seeding, screenshot verification — see `docs/E2E_TEST_RESULTS.md`) | N/A (testing only) | Phases 1-8 | Confirmed, observed-not-just-unit-tested correctness for every role | The CDP-driven interactive method already validated this cycle | Medium — resource-intensive on constrained hardware, per this project's own documented machine constraints |
| **10. Security validation** | Walk the full checklist in §14.I; confirm every gap in §9 is either fixed or explicitly, deliberately accepted with documented reasoning | All of the above | Phases 1-9 | A signed-off security posture, not silence | Manual review against §9's list, item by item | Low if prior phases were done carefully; the risk here is skipping items, not technical difficulty |

---

*Compiled entirely from direct inspection of current SWF Buzz source
(`C:\Users\Pranshul\Downloads\buzz2.0\swf buzz`) plus its own existing documentation
(`docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DECISIONS.md`) and this project's prior
cross-referenced audits of the reference Buzz app (`docs/ROLE_PERMISSION_AUDIT.md`,
`docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md`). No source code was modified to produce this document.
Treat as a snapshot dated 2026-09-15 — re-verify citations against current source before acting on
them.*
