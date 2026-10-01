# OLD BUZZ Owner / Admin Audit

Source-grounded. Every rule below was read in the OLD BUZZ repository at
`../buzz` on 2026-09-23; file paths and line numbers are given so each claim can
be re-checked. Nothing here is inferred from general Nostr/NIP-29 knowledge.

Scope note: this audit covers **Parts 1–4** of the request (owner bootstrap,
owner/operator authentication, the permission matrix, and the SWF gap analysis).
Parts 5–6 (Phase 3 re-evaluation, UI 3.9 audit) are summarised in §12–§13 from
existing evidence and are explicitly marked where they are *carried forward*
rather than re-verified in this pass.

---

## 1. Executive summary

1. **A community gets its owner in exactly two ways**, and neither is a member
   event: relay startup from `RELAY_OWNER_PUBKEY`, or operator provisioning with
   `initial_owner_pubkey`. Both funnel into the same database routine.
2. **The member-admin events cannot create an owner.** kind:9030 refuses
   `role: owner` outright, and kind:9032 refuses it with an explicit
   `DESIGN:` comment. This is a deliberate guard, not a gap.
3. **Ownership transfer *does* exist** — `POST /operator/communities/transfer`,
   operator-authorised, atomic, with a compare-and-swap on the expected current
   owner. *(This corrects an earlier statement in this project that transfer was
   unsupported: the member-event path is blocked, the operator path is not.)*
4. **Owner and Operator are different planes.** Owner is per community
   (`relay_members`, proven by NIP-42). Operator is deployment-level
   (`RELAY_OPERATOR_PUBKEYS`, proven by NIP-98). One does not imply the other —
   with one narrow config-level exception documented in §4.3.
5. **Any community member may create a channel.** Channel creation carries a
   normal write scope, not an admin scope. SWF already matches this; it must not
   be "corrected" into an owner/admin-only rule.
6. **The one real SWF gap found** is ownership transfer: the relay supports it,
   the SWF client has no call site for it (§11).

---

## 2. OLD BUZZ first-owner creation

### 2.1 Path A — `RELAY_OWNER_PUBKEY` (deployment community)

| Step | Source |
|---|---|
| Config field | `crates/buzz-relay/src/config.rs:244-247` — *"When set, this pubkey is automatically bootstrapped into `relay_members` with the `owner` role on first startup."* |
| Fail-fast guard | `crates/buzz-relay/src/main.rs:319-327` — if `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` and no valid owner pubkey, the relay refuses to start: *"a relay that no one can administer"* |
| Startup call | `crates/buzz-relay/src/main.rs:407-413` — `db.bootstrap_owner(community, owner_pubkey)` |
| Database routine | `crates/buzz-db/src/store/relay_members.rs:381-393` → `bootstrap_owner_with_operation` at `:395-426` |

What the routine actually does (`relay_members.rs:405-424`), in one transaction:

```sql
-- 1. upsert the configured owner
INSERT INTO relay_members (community_id, pubkey, role, added_by)
VALUES ($1, $2, 'owner', NULL)
ON CONFLICT (community_id, pubkey) DO UPDATE SET role = 'owner', updated_at = now();

-- 2. demote any OTHER owner in this community
UPDATE relay_members SET role = 'admin', updated_at = now()
WHERE community_id = $1 AND role = 'owner' AND pubkey <> $2;
```

Answers to the questions asked:

- **If an owner already exists** and it is the configured key → idempotent
  no-op (`DO UPDATE SET role='owner'`).
- **If a *different* owner exists** → it is **demoted to `admin`**, not removed,
  not demoted to member. (Contrast with transfer, §2.3, which demotes to
  `member`.) So changing `RELAY_OWNER_PUBKEY` and restarting *does* move
  ownership, leaving the old owner as an admin.
- **Existing admins/members** are untouched — the `UPDATE` only matches
  `role = 'owner'`.
- `added_by` is `NULL`, marking a bootstrapped (not invited) owner.

### 2.2 Path B — operator-created community

| Step | Source |
|---|---|
| Endpoint | `POST /operator/communities` — `crates/buzz-relay/src/api/operator.rs` |
| Request | `{ host, initial_owner_pubkey, create_only }` (SWF sends `create_only: true` always — `src/features/communities/OperatorService.ts:217`) |
| Owner row | `crates/buzz-db/src/store/relay_members.rs:799-809` — `provision_owner()` |

`provision_owner` calls the **same** `bootstrap_owner_with_operation`
(`relay_members.rs:802-808`), differing only in the observability tag
(`WriterOperation::Authorization` instead of `Bootstrap`). So the owner row and
the "demote any other owner to admin" behaviour are identical to Path A.

`create_only: true` makes creation refuse an existing host rather than converge
on it; the legacy convergence mode could rotate an existing community's owner,
which is why SWF never sends `create_only: false` (asserted by
`tests/unit/security/identitySecurity.spec.ts`).

**The owner may be any pubkey** — `initial_owner_pubkey` is request data, not
the caller. The operator creating a community is *not* thereby a member or
owner of it.

### 2.3 Ownership transfer — supported, operator-only

| Step | Source |
|---|---|
| Endpoint | `POST /operator/communities/transfer` — `crates/buzz-relay/src/api/operator.rs:358-430` |
| Authorisation | `authorize_operator_request(...)` at `operator.rs:363-371` — NIP-98, operator only |
| Request | `{ community_id, new_owner_pubkey, expected_owner_pubkey }` (`operator.rs:373-400`) |
| Database | `crates/buzz-db/src/store/relay_members.rs:514` / `:818-836` |

Documented behaviour at `operator.rs:355-357`: *"The previous owner is demoted
to `member` (not `admin`). The transfer is instant and atomic at the database
layer."*

`expected_owner_pubkey` is a compare-and-swap guard — the doc comment at
`relay_members.rs:818-821` states it *"Verifies `expected_owner_pubkey` matches
the current owner inside the same transaction to prevent stale-owner races."*

Outcomes (`operator.rs:410-421`, plus the DB tests at `relay_members.rs:1308-1503`):

| Result | Meaning |
|---|---|
| `Transferred { previous_owner }` | done; previous owner is now `member` |
| `AlreadyOwner` | no-op |
| `NoOwner` | 404 — nothing to transfer from |
| `OwnerConflict` | `expected_owner_pubkey` did not match |
| `LimitReached` | transferee already at the per-owner community cap |

An existing **member can be promoted straight to owner this way** —
`relay_members.rs:1400` `transfer_ownership_promotes_existing_member`.

### 2.4 Explicit verification of the four questions

| Question | Answer | Source |
|---|---|---|
| Can kind:9030 assign `owner`? | **No** — *"invalid role: use kind:9032 to promote to owner"* | `crates/buzz-relay/src/handlers/relay_admin.rs:323-325` |
| Can kind:9032 assign `owner`? | **No, by design** — *"DESIGN: Ownership transfer via kind:9032 is intentionally blocked… could permanently lock out the current owner. Use RELAY_OWNER_PUBKEY config"* | `relay_admin.rs:436-440` |
| Can the admin CLI assign `owner`? | **No** — *"role 'owner' cannot be set via CLI — use RELAY_OWNER_PUBKEY config"* | `crates/buzz-admin/src/main.rs:307`, also `:244` |
| Operator-created owner | **Yes**, via `initial_owner_pubkey` | §2.2 |
| `RELAY_OWNER_PUBKEY` owner | **Yes**, at startup | §2.1 |
| Ownership transfer | **Yes**, operator API only | §2.3 |

So there are exactly **three** supported ways to make someone an owner: relay
config + restart, community provisioning, and the operator transfer endpoint.

---

## 3. Owner authentication (NIP-42)

```
owner's private key (never leaves the native/Rust layer)
  → WebSocket connect to the community's relay URL (tenant = HTTP Host)
  → relay sends AUTH challenge
  → client signs kind:22242 with the challenge + relay URL
  → relay verifies the signature and binds the connection to that pubkey
  → relay_members lookup for (community_id, pubkey)
  → role = owner | admin | member
  → community UI
```

In SWF the corresponding steps are `RelayConnectionService` (records the
**signed AUTH event's** pubkey into `connection.authenticatedPubkey`),
`beginIdentitySession` (refuses the session if that pubkey is not the identity
being established), and `relayMembersService.fetchMembershipList()` →
`resolveMyRole` — see `docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md` §9.

**A public key alone never authenticates.** It is an identifier; only a
signature over the relay's challenge proves possession. (This is the root of the
`0f61e5e4…`/`38eb252a…` incidents — see `docs/DEV_RESET_2026_09_22.md`.)

---

## 4. Operator authentication (NIP-98) — a different plane

```
operator's private key
  → sign kind:27235 (NIP-98) for the exact request URL + method
  → GET /operator/communities/availability
  → 200 = operator, 403 = not
  → platformRole = operator → /operator
```

### 4.1 Principal resolution

`crates/buzz-relay/src/config.rs:36-40` — in `nip98` mode the authenticated
pubkey resolves to:

1. `Operator/Config` if pubkey ∈ `RELAY_OPERATOR_PUBKEYS`
2. `Operator/OwnerFallback` if pubkey == `RELAY_OWNER_PUBKEY` **and**
   `RELAY_OPERATOR_PUBKEYS` is empty (*"evaluated from config, never runtime rows"*)
3. `Moderator/Db` from the `relay_operators` table
4. otherwise `None` → 403 — *"no fall-through role, ever"*

### 4.2 Owner ≠ Operator

| | Owner | Operator |
|---|---|---|
| Scope | one community | the deployment |
| Proven by | NIP-42 on the community socket | NIP-98 on `/operator/*` |
| Stored in | `relay_members.role` | `RELAY_OPERATOR_PUBKEYS` / `relay_operators` |
| Grants the other? | no | no |

An operator who provisions a community is **not** a member of it unless named as
`initial_owner_pubkey` or added like anyone else.

### 4.3 The one documented overlap

Rule 2 above is the single place where an *owner* config value can yield
*operator* authority — and only when no operator list is configured at all. It
is a deployment-config fallback so a relay is never left unadministrable; it is
not a role derivation and does not apply per community.

---

## 5. Community permission matrix (relay-enforced)

All rules from `crates/buzz-relay/src/handlers/relay_admin.rs` unless noted.
"Enforcement" is the relay's — the SWF client mirrors these client-side only for
fail-fast UX (`src/features/community-members/permissions.ts`).

| Capability | Owner | Admin | Member | Source |
|---|---|---|---|---|
| Add member (`role: member`) | ✅ | ✅ | ❌ | `relay_admin.rs:313-317` |
| Add member as `admin` | ✅ | ❌ | ❌ | `:326-328` — *"only owner can grant admin role"* |
| Add member as `owner` | ❌ | ❌ | ❌ | `:323-325` |
| Re-add existing member | no-op, role preserved | same | — | `:333-335` |
| Remove a `member` | ✅ | ✅ | ❌ | `:379-384` (admin path is an atomic conditional delete, closing a TOCTOU race) |
| Remove an `admin` | ✅ | ❌ | ❌ | `:402-404` — *"admins can only remove members"* |
| Remove an `owner` | ❌ | ❌ | ❌ | `:396-398` — *"cannot remove the relay owner"* |
| Remove yourself | ❌ | ❌ | ❌ | `:369-372` |
| Change a role (kind:9032) | ✅ | ❌ | ❌ | `:423-426` — *"must be owner"* |
| Change your own role | ❌ | ❌ | ❌ | `:428-431` |
| Set a role to `owner` | ❌ | ❌ | ❌ | `:436-440` (DESIGN) |
| Set workspace profile | ✅ | ✅ | ❌ | `:~290-305` (`RELAY_ADMIN_SET_WORKSPACE_PROFILE`) |
| Ownership transfer | ❌ (operator only) | ❌ | ❌ | §2.3 |
| Community deletion | operator/deployment | ❌ | ❌ | `crates/buzz-deletion`, `community_deletion_requests` |

### 5.1 Channels — a separate plane

| Capability | Rule | Source |
|---|---|---|
| **Create a channel** | **any authenticated member** — kind:9007 maps to `Scope::ChannelsWrite`, a normal write scope, *not* `Scope::AdminChannels` | `crates/buzz-relay/src/handlers/ingest.rs:518` |
| Creator bootstrap | the channel creator may add themselves as its first member | `crates/buzz-db/src/store/channel_members.rs:427-428` |
| Grant channel `owner`/`admin` | only channel owners/admins | `crates/buzz-relay/src/handlers/channel_authz.rs:28-30` |
| Change an active member's role | only channel owners/admins | `channel_authz.rs:31-33` |
| Demote the last channel owner | ❌ *"cannot demote the last owner — transfer ownership first"* | `channel_authz.rs:34-36` |
| Remove the last channel owner | ❌ | `channel_authz.rs:40-45` |
| Archive a channel (kind:9002 + `archived`) | `Scope::AdminChannels` | `ingest.rs:506-517` |

**Community role ≠ channel role.** A community owner is not automatically the
owner of any channel; channel membership and roles live in `channel_members`
with their own authorisation (`channel_authz.rs`). The two must not be merged.

---

## 6. SWF comparison and gaps

Compared against `src/features/access/capabilities.ts`,
`src/features/community-members/permissions.ts`,
`src/features/channels/channelPermissions.ts`, and `OperatorService.ts`.

| Capability | OLD BUZZ | SWF today | Status |
|---|---|---|---|
| Operator → Operator Dashboard | NIP-98 200 | `probeOperator` → `platformRole` → `/operator` | **PASS** |
| Operator ≠ Owner | separate planes | separate fields, guarded by `identitySecurity.spec.ts` | **PASS** |
| Create community (`create_only`) | operator only | `OperatorService.createCommunity` | **PASS** |
| Owner/admin/member resolution | `relay_members` after NIP-42 | `fetchMembershipList` → `resolveMyRole` | **PASS** |
| Add member / add admin | 9030 rules | `canAddMember` mirrors them | **PASS** |
| Remove member / admin | 9031 rules | `canRemoveMember` | **PASS** |
| Change role (owner only) | 9032 | `canChangeRole`, `assignableRoles` | **PASS** |
| Channel creation by any member | `ChannelsWrite` | `canCreateChannel = member !== null` | **PASS** — correctly *not* owner-gated |
| Moderation queue / reports | owner+admin | `canViewModerationQueue`, `ModerationService` | **PASS** |
| **Ownership transfer** | `POST /operator/communities/transfer` | **no call site anywhere in `src/`** | **MISSING (gap)** |
| Community deletion | deletion subsystem | not exposed | **INTENTIONALLY OUT OF SCOPE** |
| Message edit / delete / admin-delete | protocol kinds exist | no receive-side handling, no UI | **MISSING** (already recorded in the Phase 3 report) |
| Moderator platform role | `relay_operators` → `Moderator/Db` | no client probe | **INTENTIONALLY OUT OF SCOPE** (documented in `stores/session.ts`) |

### 6.1 The transfer gap in practice

This is the gap behind the current OWNER_A question. Because the relay *does*
support transfer, making `07227e7a…` (OWNER_A) the owner of
`swf-development-1790079628466.localhost:3000` is achievable **within OLD BUZZ
parity** — it needs `POST /operator/communities/transfer` signed by an operator
(`38eb252a…` is both the operator and the current owner), with
`expected_owner_pubkey = 38eb252a…`. The previous owner becomes a `member`.

That is a different answer from the earlier "only admin, new community, or a
direct DB write" summary, which was wrong because it considered only the member
events. Direct DB manipulation remains unnecessary and is not recommended.

---

## 7. Phase 3 status (carried forward — not re-verified in this pass)

Unchanged from `PHASE_3_FINAL_IMPLEMENTATION_REPORT.md` §20/§23/§24. Recorded
here only so this document is self-contained; the evidence lives there.

| Area | Status |
|---|---|
| Identity lifecycle, sign-out deletion, role isolation, both switch directions | PASS (live) |
| Channel creation / open / messaging / pagination / threads | PASS (live) |
| Reactions | PASS (`#h` fix live-verified); cross-client realtime *removal* fan-out is a relay limitation |
| Unread / mentions | PASS for the mention path; unread is local-only; badge rendering **NOT VERIFIED** in a GUI |
| Agent activity | PASS (type-level) |
| Responsive UI | **PARTIAL** — implemented at six breakpoints, never visually verified |
| Accessibility | **PARTIAL** — Escape/focus-visible/aria-live/aria-labels/focus-trap done; no keyboard walkthrough |
| 3.9 UI surface | **PARTIAL** — no Inbox view; no message edit/delete/admin-delete; composer attachment/voice/formatting not built |
| GUI smoke test | **PARTIAL** — needs a human |

**Phase 3 is PARTIAL.** Local tests passing is not the acceptance criterion; the
outstanding items are GUI-only verification and unbuilt 3.9 surface.

## 8. UI 3.9 status (carried forward)

Close controls were re-verified in this pass and are now consistent app-wide
(`src/components/CloseButton.vue`, regression-tested in
`tests/unit/components/closeButton.spec.ts`). Everything else in §7 stands.

---

## 9. Security considerations

1. **The relay is the authorization boundary.** Every client-side permission
   helper is fail-fast UX only; the relay re-checks (`relay_admin.rs` rejects on
   its own reading of `sender_role`).
2. **Owner lock-out is treated as a first-class risk** — it is the stated reason
   kind:9032 refuses `owner` (`relay_admin.rs:436-438`) and why transfer uses a
   compare-and-swap on the expected owner.
3. **No fall-through roles**: an unresolvable operator principal is 403, never a
   lesser role (`config.rs:40`).
4. **A public key never authenticates** (§3). SWF now refuses raw 64-char hex on
   the normal import path for exactly this reason (`DECISIONS.md` D16).

## 10. Open questions

1. Should SWF expose ownership transfer in the Operator Dashboard now that it is
   confirmed supported, or keep it deliberately out of reach?
2. `relay_operators` (Moderator) has no client probe — is a Moderator UI wanted?
3. Community deletion is a whole async subsystem; out of scope until asked.
