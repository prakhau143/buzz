# Role / Permission Matrix

The reference matrix for SWF Buzz's actual implemented roles — **Owner, Admin, Member** (community)
and **Operator, Moderator** (platform, consumed read-only from the relay's separate admin console).
No other role exists in this codebase; see `docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md` §4 for the
full audit confirming this (no "Super Admin," no channel-level role enforcement, no
organization/tenant concept beyond "community").

For the full UI-visible/service-allowed/reason breakdown, see
`docs/AUTHORIZATION_RUNTIME_FLOW.md` §4 — this document is the compact reference matrix plus the
local test-identity setup procedure (Phase 14).

## 1. Permission matrix

`YES` = allowed · `COND` = allowed with a restriction (see footnote) · `NO` = blocked · `—` = not
applicable to that role's scope.

| Permission | Member | Admin | Owner | Moderator | Operator |
|---|---|---|---|---|---|
| View channels/messages | YES | YES | YES | — | — |
| Send message | YES | YES | YES | — | — |
| Submit report | YES | YES | YES | — | — |
| View community moderation queue | NO | YES | YES | — | — |
| Add community member | NO | COND¹ | YES | — | — |
| Remove community member | NO | COND² | COND³ | — | — |
| Change community member role | NO | NO | YES | — | — |
| Ban / timeout | NO | COND⁴ | YES | — | — |
| Unban / lift timeout | NO | YES | YES | — | — |
| Resolve / dismiss / escalate report (community) | — | YES | YES | — | — |
| View deployment-wide reports | — | — | — | YES | YES |
| Resolve deployment-wide reports | — | — | — | YES | YES |
| Manage feedback status | — | — | — | YES | YES |
| Manage Operator/Moderator roster | — | — | — | NO | YES |
| Create/edit/delete communities | **no SWF Buzz UI exists for this** | | | | |
| Billing / cost controls | **not found anywhere** — no billing concept exists in SWF Buzz or the reference Buzz app | | | | |
| Platform settings / deployment config | **not found** — no UI or API for this in either codebase | | | | |

¹ Admin may only grant role `member`, never `admin`.
² Admin may only remove a target whose current role is exactly `member`.
³ Owner may remove admin/member but never another owner.
⁴ Admin cannot ban/timeout a target whose role is `owner` or `admin` — the one guard rail in the
whole community moderation model.

## 2. Local test identities — how to verify each role

SWF Buzz has no invite/join UI (`docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md` §6) and this project's
default local dev relay is deliberately an **open relay** with no `relay_members` rows and no
`RELAY_OWNER_PUBKEY` configured — meaning there is no owner to bootstrap through any normal flow.
The only way to exercise the owner/admin-gated paths locally is to seed test rows directly into
Postgres, exactly as was done and verified earlier this project cycle (see
`docs/E2E_TEST_RESULTS.md`'s "Update" section for the full transcript of this being done and
producing correct, role-appropriate UI).

**This does not modify any production authorization rule** — it only inserts rows into the exact
same `relay_members` table the relay's own `relay_admin.rs` reads at runtime; the authorization logic
itself is untouched.

**Development Mode's identity is now deterministic** (see `signingService.dev.ts` and
`docs/WEB_LOCAL_DEVELOPMENT.md` §7) — a fixed test keypair, never random by default — specifically so
a role seeded once here survives every future dev-server restart instead of needing to be re-seeded
per session:

```
DEV_PUBKEY = 79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
```

This is a publicly-known test value (the secp256k1 generator point), never a secret. This project's
own `dc4b45d3-7f95-4e60-9bbf-52a8f34c9b46` community (host `localhost:3000`, matching
`VITE_RELAY_URL=ws://localhost:3000`) has this pubkey seeded as `owner` as of this writing — verified
end-to-end (see §4 below), not just inserted and assumed.

### Procedure

1. Sign in via **Development Mode** — with the deterministic identity above, the pubkey is already
   known ahead of time; no capture step is needed for this identity specifically (still true for an
   Okta/bunker-paired production identity, whose pubkey does vary per pairing).
2. Find the target community's ID:
   ```sh
   docker exec buzz-postgres psql -U buzz -d buzz -c "SELECT id, host FROM communities;"
   ```
3. Seed the desired role for that pubkey:
   ```sh
   docker exec buzz-postgres psql -U buzz -d buzz -c "
     INSERT INTO relay_members (community_id, pubkey, role, added_by)
     VALUES ('<community-id>', '<64-char-hex-pubkey>', 'owner', 'local-test-seed');
   "
   ```
   Use `'owner'`, `'admin'`, or `'member'` as needed. To test multiple community roles
   *simultaneously* rather than one at a time, pass `DevSigningService("ephemeral")` instead of the
   deterministic default to get a fresh distinct pubkey per instance (see `signingService.dev.ts`).
4. **The relay will not automatically publish a fresh kind:13534 membership snapshot just because the
   table changed** — a direct SQL insert bypasses the event that normally triggers republication, and
   the relay's own 60s background maintenance reconciler (`BUZZ_NIP43_RECONCILE_INTERVAL_SECS`,
   `main.rs`) was observed NOT to pick up a community's very first-ever snapshot on its own during
   verification. Trigger one for real by performing any now-authorized admin action as the seeded
   identity — e.g. add a second test member through the Community panel's own "Add member" form (kind
   9030). This is not a workaround, it's exercising the real code path, which has the side effect of
   republishing an up-to-date snapshot. Confirmed working exactly this way: a scripted kind:9030 add
   (then kind:9031 remove, to clean the throwaway member back out) produced
   `"NIP-43 membership list published","member_count":1` in the relay's own log, immediately followed
   by that snapshot being resolvable as `owner` through the app's normal `fetchMembershipList()` path.
5. Reload the app (or wait for the Community panel's `staleTime` to lapse) to see the newly-seeded
   role reflected.
6. **Clean up afterward** so the shared local dev database doesn't accumulate test rows:
   ```sh
   docker exec buzz-postgres psql -U buzz -d buzz -c "DELETE FROM relay_members;"
   ```
   (Leave the deterministic dev owner row in place between sessions if you want Development Mode to
   keep resolving to `owner` without re-seeding — that's the whole point of it being deterministic.)

### Platform Operator/Moderator test identities

**Not locally testable in this environment** — this project's local dev relay has no
`BUZZ_ADMIN_HOST` configured at all (`GET /api/admin/v1/probe` 404s), so there is no deployment-admin
console to seed an Operator/Moderator identity against. See
`docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md` §6 and `docs/KNOWN_LIMITATIONS.md` — this is an
environment/infrastructure blocker, not a code gap. Testing this role requires a relay deployment
with the admin console enabled.

## 3. What this matrix deliberately does NOT include

Per the explicit product exclusions carried through every audit this project cycle: **Local Agents**
and **App-level Git access/checks** have no role/permission surface in SWF Buzz at all (they were
never implemented — see `docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §18 for why). Nothing in this
matrix references them, and nothing should be added for them without a separate, explicit product
decision to bring them in scope.
