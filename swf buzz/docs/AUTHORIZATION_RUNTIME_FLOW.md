# Authorization Runtime Flow

How SWF Buzz actually resolves "who is this, and what can they do" at runtime, end to end, for both
Development Mode and Okta — and the resulting Owner/Admin/Member behavior matrix. This is the
implementation of the plan in `docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md` §14/§15.

## 1. The authoritative state machine

`stores/session.ts`'s `AuthStatus`:

```
unauthenticated ──login──▶ authenticating ──┬──▶ resolvingIdentity ──▶ resolvingRole ──▶ ready
                                             │
                                             └──▶ authError (relay unreachable, token
                                                    exchange/verification failure, etc.)
```

- **`unauthenticated`**: default state; the router guard sends any non-public route here.
- **`authenticating`**: `AuthService.login()` is in flight (Okta browser round trip, or the
  Development Mode identity generation).
- **`resolvingIdentity`**: identity is known (`pubkey`, `employeeEmail`, `applicationUserId`) —
  entered by `session.setIdentity()` — but community role is not yet.
- **`resolvingRole`**: connecting the relay and querying community membership.
- **`ready`**: role is resolved (even if the resolved role is "no role" — a relay with no membership
  requirement, or a pubkey not in the roster, both legitimately resolve to `communityRole: null` and
  still reach `ready`). **This is the only state in which the router guard allows access to any
  protected route** — see `app/router/index.ts`.
- **`authError`**: something in the above failed; `session.authError` carries a user-facing message.
  Not reachable from `ready` — only from an in-progress login attempt.

Both Development Mode and Okta funnel through the **exact same** `resolveIdentityAndRole()` function
in `useAuth.ts` once `AuthService.login()` succeeds — this function does not branch on `authMode`
anywhere, per the explicit guidance in
`docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md` §12 (Development Mode must use the identical
authorization pipeline as production, not a shortcut).

## 2. The full sequence, as implemented

```
LoginView.vue → useAuth().loginWithOkta() / loginWithDevelopmentMode()
  │
  ├─ session.setAuthStatus("authenticating")
  ├─ AuthService.login()
  │    Okta:        system browser + native callback → verified {sub, email} (see OKTA_PKCE_SETUP.md)
  │    Development: DevSigningService generates an ephemeral keypair, returns its pubkey
  │
  ├─ setActiveSigningService(...)  — which SigningService subsequent Nostr writes use
  │
  ▼
useAuth.ts::resolveIdentityAndRole(result)
  │
  ├─ session.setIdentity({authMode, employeeEmail, applicationUserId, pubkey})
  │    → authStatus = "resolvingIdentity"
  │
  ├─ await relayConnectionService.connect(config.relayUrl)
  │    (NIP-42 relay authentication happens inside this — see
  │     docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md §2 for why this is a DIFFERENT
  │     authentication event from the application login above, not the same thing)
  │
  ├─ if connection.isUsable is false:
  │    session.setAuthError(...) → authStatus = "authError" — STOP, do not navigate
  │
  ├─ session.setAuthStatus("resolvingRole")
  ├─ members = await relayMembersService.fetchMembershipList()
  ├─ role = resolveMyRole(members, session.pubkey)   ← the ONE centralized function;
  │                                                      also used by useCommunityMembers()
  ├─ session.setCommunityRole(role) → authStatus = "ready"
  │
  ▼
router.push({name: "channels"})
```

**Critical property this closes** (the primary gap `docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md` §7
found): the dashboard is never navigated to until `authStatus === "ready"` — there is no window where
a role-gated nav item could flash into view before role is actually known, because navigation itself
is the very last step, gated behind the role resolution completing.

## 3. Where enforcement actually happens (three layers, all present)

| Layer | What it does | Can be bypassed by a modified client? |
|---|---|---|
| **Route guard** (`app/router/index.ts`) | Blocks any protected route unless `session.isReady`; blocks `/platform-admin` if the admin console isn't configured | Irrelevant to bypass — see below |
| **UI conditional rendering** (`v-if`/`v-else` throughout `CommunityMembersPanel.vue`, `ModerationQueuePanel.vue`, `PlatformAdminView.vue`, etc.) | Hides buttons/panels a role can't use | Yes, trivially — this is why the next two layers exist |
| **Service-layer pre-flight checks** (`RelayMembersService`, `ModerationService`, `AdminConsoleService` — every mutation method) | Calls the matching `permissions.ts` function and throws `AppError("permission_denied", ...)` before ever signing/publishing | Yes — a modified client (or a hand-crafted signed event sent directly to the relay) skips this layer entirely |
| **Relay-side authorization** (`../buzz`'s own `relay_admin.rs`/`moderation_authz.rs`, verified extensively in `docs/ROLE_PERMISSION_AUDIT.md`) | The actual, only-trustworthy security boundary | **No** — this is server-side; nothing on the client can bypass it |

**This is the correct architecture, and it's already fully in place** — the service-layer checks are
real, present, and independently re-verify permission (not just UI-driven), but they are explicitly
documented (`permissions.ts`'s own header comment) as *fail-fast UX*, not the security boundary. If a
`MEMBER` manually calls, say, `relayMembersService.addMember({..., actingRole: "owner"})` by lying
about their own role via a modified client, **two things happen**: (1) the client-side
`canAddMember()` check would actually pass (since the caller lied about `actingRole`), so the event
gets signed and published — but (2) the relay independently re-derives the ACTUAL role from its own
`relay_members` table (never trusting anything the client asserts about its own role) and rejects the
event if that real role doesn't authorize the action. **The permission_denied path in the client is a
courtesy for a well-behaved client that passes its true resolved role; it is not what stops a
malicious one — the relay is.**

## 4. Role → feature → enforcement matrix

`UI visible` = does the button/panel render · `Service allowed` = does the client-side service method
proceed without throwing, GIVEN the correct role is honestly passed · `Reason` = which
`permissions.ts` function, and why.

| Role | Feature | UI visible | Service allowed | Reason |
|---|---|---|---|---|
| **Member** | View channels/messages | Yes | Yes | No permission needed |
| **Member** | Submit a report | Yes | Yes | No role gate on submission (`ModerationService.submitReport`) |
| **Member** | View Community Members panel | Yes (read-only) | — | `canManage` false → management UI hidden, roster itself still visible |
| **Member** | Add/remove/promote a member | No | Denied | `canManageCommunityMembers(null|"member")` → false |
| **Member** | View Moderation Queue tab | No (shows "Moderators only") | Denied | `canViewModerationQueue("member")` → false |
| **Member** | Ban/timeout anyone | No | Denied | `canBanOrTimeout("member", ...)` → false |
| **Member** | `/platform-admin` route | Redirected away (if console not configured) or shown "Not authorized" (if configured but role insufficient) | Denied | Router guard + `AdminConsoleService` requests fail server-side with 403 regardless |
| **Admin** | Everything Member can do | Yes | Yes | — |
| **Admin** | Add member (role=member only) | Yes | Yes | `canAddMember("admin", "member")` → true |
| **Admin** | Add member (role=admin) | Role option hidden | Denied | `canAddMember("admin", "admin")` → false — `assignableRoles("admin")` excludes "admin" |
| **Admin** | Remove a plain member | Yes | Yes | `canRemoveMember("admin", "member", false)` → true |
| **Admin** | Remove an admin or the owner | Button hidden on that row | Denied | `canRemoveMember("admin", "admin"|"owner", false)` → false |
| **Admin** | Change any member's role | No UI anywhere for Admin | Denied | `canChangeRole` requires `actingRole === "owner"` |
| **Admin** | View Moderation Queue / audit log | Yes | Yes | `canViewModerationQueue("admin")` → true |
| **Admin** | Ban/timeout a plain member | Yes | Yes | `canBanOrTimeout("admin", "member")` → true |
| **Admin** | Ban/timeout the owner or a fellow admin | Button hidden on that row | Denied | `canBanOrTimeout("admin", "owner"|"admin")` → false — the one guard rail in the whole model |
| **Admin** | Unban/lift timeout anyone | Yes | Yes | `canUnbanOrUntimeout("admin")` → true — no guard rail on lifting a restriction |
| **Admin** | Resolve/dismiss/escalate a report | Yes | Yes | `canResolveReport("admin")` → true |
| **Owner** | Everything Admin can do | Yes | Yes | — |
| **Owner** | Add member at any role (member or admin) | Yes | Yes | `canAddMember("owner", ...)` → true for both |
| **Owner** | Remove any member/admin (never another owner) | Yes, except an owner row | Denied only for `targetRole==="owner"` | `canRemoveMember("owner", "owner", false)` → false — structural, not a permission gap |
| **Owner** | Change any member's role | Yes | Yes | `canChangeRole("owner", ...)` → true (except targeting self or the current owner, or granting "owner" — see `permissions.ts`) |
| **Owner** | Ban/timeout anyone, including an admin | Yes | Yes | `canBanOrTimeout("owner", ...)` → always true |
| **Platform Moderator** | `/platform-admin` Reports/Feedback tabs | Yes | Yes | `probe.canAct` → true |
| **Platform Moderator** | `/platform-admin` Staff tab | Hidden | Denied (relay-side 403) | `probe.canStaff` → false |
| **Platform Operator** | Everything Moderator can do, plus Staff tab | Yes | Yes | `probe.canAct && probe.canStaff` → both true |

## 5. Development Mode vs. Okta Mode — explicit, never mixed

```
Development Mode                          Okta Mode
      │                                         │
DevAuthService.login()                    OktaAuthService.login()
      │                                         │
 ephemeral in-memory keypair          verified {sub, email} via real OIDC+PKCE
      │                                         │
      └─────────────┬───────────────────────────┘
                     ▼
          resolveIdentityAndRole()   ← IDENTICAL code path, no authMode branch
                     │
          community role resolution (RelayMember lookup)
                     │
                     ▼
                  ready
```

Both paths produce the exact same `SessionState` shape and go through the exact same role-resolution
logic — the only difference is *how the pubkey was obtained* (an ephemeral local key vs. a paired
NIP-46 bunker behind a verified Okta identity). This is deliberate: it's what makes Development Mode
a safe, representative stand-in for testing the real authorization pipeline (see
`docs/ROLE_PERMISSION_MATRIX.md` §2 for how to use it to test each role locally).
