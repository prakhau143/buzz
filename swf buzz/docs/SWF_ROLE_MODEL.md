# SWF Buzz Role Model

SWF Buzz uses the OLD BUZZ role model exactly. There is **no "Super Admin"**. The source-verified facts behind this document are in `OLD_BUZZ_BOOTSTRAP_AND_SWF_DEPENDENCY_AUDIT.md`.

```
                    SWF BUZZ
                       │
            ┌──────────┴──────────┐
            │                     │
        OPERATOR              COMMUNITY
   deployment-level                │
        role             ┌─────────┼─────────┐
                         │         │         │
                       Owner     Admin     Member
```

| Role | Level | Where it lives | Proven by | Lives in |
|---|---|---|---|---|
| **Operator** | deployment-wide | relay env `RELAY_OPERATOR_PUBKEYS` | **NIP-98** signed HTTP request to `/operator/*` | relay configuration (no DB row for provisioning) |
| **Owner** | one community | `relay_members.role = 'owner'` | **NIP-42** (WebSocket), NIP-98 for HTTP | database |
| **Admin** | one community | `relay_members.role = 'admin'` | NIP-42 / NIP-98 | database |
| **Member** | one community | `relay_members.role = 'member'` | NIP-42 / NIP-98 | database |

## 1. Operator

- Deployment-wide authority. It spans communities and belongs to none of them.
- Can **create communities** (`POST /operator/communities`), **list** the communities a key owns (`GET /operator/communities?owner_pubkey=`), **name the first owner** (`initial_owner_pubkey`), and (in the relay) archive / transfer communities.
- Authenticates with **NIP-98**: a signed kind-27235 event whose `u` tag is `RELAY_OPERATOR_API_ORIGIN` + path, replay-protected, signer ∈ `RELAY_OPERATOR_PUBKEYS`. There is no `X-Pubkey` fallback on `/operator/*`.
- **Not stored in SWF.** SWF asks the relay every time it needs to know (`OperatorService.isOperator()` → `GET /operator/communities/availability`: `200` operator, `403` not). It is never taken from localStorage, Pinia state, a role label, a hostname, or a public key.
- In the app: **Operator Dashboard** (`/operator`, `OperatorDashboardView`).

## 2. Owner

- Owner of **one particular community**: a `relay_members` row with `role = 'owner'`.
- Authenticates with **NIP-42** (the community WebSocket). The relay looks up the role for the host-resolved community.
- Can manage members (add/remove, promote to admin — kind 9030/9031/9032), create invites, and do everything an admin can.
- Cannot be created by another owner: ownership changes only through the operator (create with `initial_owner_pubkey`, or transfer) or relay configuration; kind 9032 refuses `role = owner`.

## 3. Admin

- Community-level. Members (kind 9030 for `member` only), invites, moderation.
- Assigned by an **owner**. Cannot promote to admin, remove admins or owners.

## 4. Member

- Community participant. Uses channels and messages the community's rules allow.
- Assigned by an owner/admin (kind 9030, "Add member" by public key), by claiming an invite (always `member`), or by `buzz-admin add-member`.

## 5. Authentication method for each

| Role | Method | What the relay checks |
|---|---|---|
| Operator | NIP-98 on `/operator/*` | valid signature, exact `u`/origin, not replayed, key ∈ `RELAY_OPERATOR_PUBKEYS` |
| Owner / Admin / Member | NIP-42 challenge (WebSocket) | valid signature over the challenge for **that community's host**, then ban gate, then `relay_members` membership and role |
| Any (HTTP) | NIP-98 | same signature checks; `POST /query` etc. also membership-gated |

A **public key alone never authenticates** anyone. It is an identifier that can be shown, copied and sent to an owner. Authentication is a signature by the matching private key, produced in Rust.

## 6. Scope of each role

- **Operator** — relay-wide. Holds **no** implicit membership in any community: on a closed relay a pure operator cannot even enter a community.
- **Owner, Admin, Member** — community-specific. A person can be owner of one community and member of another.

## 7. How the first Operator is configured

The first Operator is **never created by the app or by generating a key**. It is deployment configuration:

```
RELAY_OPERATOR_PUBKEYS=<64-char hex public key>[,<another>...]
RELAY_OPERATOR_API_ORIGIN=<http(s) origin the operator signs for, e.g. https://admin.example.com>
```

1. The person creates or imports their identity in SWF Buzz (Rust generates the key; the app shows the **public** key).
2. The deployer puts that public key in the relay's `RELAY_OPERATOR_PUBKEYS` and restarts the relay.
3. That person's private key can now sign NIP-98 requests the relay accepts. Nothing changes on their device.

Creating a local key does **not** make anyone an operator. Without the env var (the default), provisioning is disabled for everybody.

## 8. How the first Community Owner is assigned

Operator Dashboard → **Create Community** → name / address → **First owner (public key)** → `POST /operator/communities` with

```json
{ "host": "<community host>", "initial_owner_pubkey": "<owner hex>", "create_only": true }
```

The relay creates the community and the owner row in one transaction: `communities(host)` + `relay_members(role='owner', added_by NULL)`. The owner then signs in with their own key (NIP-42). The operator is **not** added.

`create_only: true` is **always** sent. The relay's default mode would let an operator-signed request rotate an existing community's owner; SWF never uses it (enforced by a test).

(The deployment's own community, if any, takes its owner from the relay env `RELAY_OWNER_PUBKEY` at startup — a relay deployment setting, not something the SWF app does.)

## 9. Why Operator ≠ Owner

- Different **scope**: deployment vs. one community.
- Different **storage**: relay env vs. `relay_members`.
- Different **proof**: NIP-98 on `/operator/*` vs. NIP-42 in the community.
- Different **powers**: the operator creates tenancy and names owners but has no say inside a community; an owner governs one community but cannot create communities or see others.
- The operator can be a different key from the owner, and an operator who is not named owner or added is **not even a member**. Merging them would give one key both tenant-creation power and implicit control of every community.

OLD BUZZ does not merge them (audit §5), and neither does SWF.

## 10. NIP-98 vs NIP-42

| | NIP-98 | NIP-42 |
|---|---|---|
| Transport | HTTP request | WebSocket handshake |
| Proves | this key signed *this exact request* (URL, method, body hash) | this key answered *this relay's challenge* |
| Used by SWF for | operator probe / list / create, invite mint / claim, membership probe (`POST /query`) | signing in to a community (owner / admin / member) |
| Verifies Operator? | **Yes** | **No** |
| Verifies Owner/Admin/Member? | HTTP calls to a community | **Yes** |
| Scope | per request | per connection, per community host |

The Operator distinction: operator status is checked by **NIP-98**, not NIP-42. NIP-42 is community-scoped and membership-gated, so it cannot express a deployment-level role.

## 11. The two planes are read, never inferred (added 2026-09-22)

`platformRole` and `communityRole` are resolved independently and neither is ever
derived from the other (`DECISIONS.md` D14):

```
platformRole   "operator" | null        ← relay's answer to THIS pubkey's signed
                                          NIP-98 probe on /operator/* (200 / 403)
communityRole  owner|admin|member|null  ← THIS pubkey's relay_members row, via NIP-42
```

Consequences, each enforced in code rather than by convention:

- An operator with `communityRole === null` still reaches `/operator`. Being an
  operator is not membership (§6, §9).
- An owner or admin never gains a deployment capability, no matter how senior
  they are inside their community.
- Being signed in, by itself, grants nothing beyond identity.

**Operator status is evidence, not a boolean.** The probe result is only accepted
together with the pubkey that signed it. If the signer of the NIP-98 event is not
the session's pubkey (and the verified NIP-42 AUTH pubkey), the app raises an
explicit identity-mismatch error and refuses to route — it does **not** quietly
fall back to member state, because a silent downgrade is indistinguishable from a
successful attack. See `IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md`.

### Capabilities come from one place

`src/features/access/capabilities.ts` is the only translation from role state to
UI permissions; components ask for a capability and never re-derive a role:

| Plane | Capabilities |
|---|---|
| Platform (operator) | `canAccessOperatorDashboard`, `canManageDeployment`, `canCreateCommunity` |
| Community | `canOpenCommunity`, `canCreateChannel`, `canManageCommunityMembers`, `canModerateCommunity`, `canInviteToCommunity` |

Only capabilities with real protocol support are exposed. Message edit/delete are
deliberately absent until the receive side exists — no fake buttons.

### A worked diagnosis (2026-09-22)

A report that "importing the operator key shows the member UI" was traced with the
Rust audit log and turned out **not** to be a role bug: the imported backup derived
to `7e13d4f6…` (a `member`), not the configured operator `0f61e5e4…`. The relay
correctly returned 403 and the app correctly showed member UI. Recorded here
because the failure mode looks identical to a routing bug from the outside, and the
first question must always be *which key actually got imported* — the log line
`swf-buzz: identity imported — pubkey=…` answers it. A public key cannot be turned
back into a private key, so a lost operator backup means provisioning a new
operator (§7), not recovering the old one.

## Where this shows up in the app

| Concern | Code |
|---|---|
| Operator detection (only source) | `src/features/communities/OperatorService.ts` → `isOperator()` |
| Role → UI capabilities (only source) | `src/features/access/capabilities.ts` |
| Session identity + both roles | `src/stores/session.ts` (`platformRole`, `communityRole`) |
| Identity lifecycle (sign-in / sign-out / switch) | `src/features/auth/identitySession.ts` |
| Public identity diagnostics (dev-only) | `src/features/identity/ui/IdentityDiagnosticsPanel.vue`, `src/stores/diagnostics.ts` |
| Post-sign-in routing | `src/features/auth/useAuth.ts` → `resolveAccess()` → `/operator` for operators |
| Operator screen | `src/views/OperatorDashboardView.vue` (re-checks the relay on arrival) |
| Create community | `src/features/communities/ui/CreateCommunityDialog.vue`, `OperatorService.createCommunity()` |
| Owner/Admin/Member management | `src/features/community-members/*` (kind 9030/9031/9032), `RelayInviteService` |
| Guards | `tests/unit/security/identitySecurity.spec.ts` (operator authority, `create_only`, no browser storage) |
