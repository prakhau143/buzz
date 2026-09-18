# Community membership design (Phase 3, DECISIONS.md D10)

Decision record, not an essay. Extends `swf buzz/backend/` (Phase 2) with `community_members` and
a minimal `communities` table. See `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §1 rows 3-4 for the endpoint
spec this phase implements, and `BACKEND_SESSION_DESIGN.md` for the session/auth layer this builds on.

## 1. Community creation wasn't in the Phase 3 endpoint list, but had to be added

The parity plan's rows 3-4 only specify membership CRUD (`GET/POST /api/communities/:id/members`,
`PATCH`/`DELETE .../:userId`) — they assume a community already exists to have members in. Nothing
in the plan creates one. Without *some* creation path, membership endpoints are untestable and
unusable. Added a bare-bones `POST /api/communities {name}`: any authenticated user may call it, and
the caller is inserted as `owner` in the same transaction the community row is created in. This
mirrors how channel creation (a later phase) auto-owns the creator — consistent with the existing
pattern rather than a one-off. Not itself part of the master prompt's invite/membership scope; flagged
here rather than silently added.

## 2. Viewing the member roster requires membership, not just authentication

`permissions.ts` only gates *managing* members (`canManageCommunityMembers` — owner/admin), not
*viewing* the roster. This backend's own call: `GET .../members` requires the caller to already be a
member of that community (any role) — a non-member gets `403`, not the roster, and a request against
a community the caller isn't in returns `403` rather than `404` for a non-existent one either (so the
endpoint doesn't let a stranger distinguish "this community doesn't exist" from "I'm just not in it").
A request against a truly non-existent community ID (`community_exists` check) still returns `404` —
that check happens before the membership check, since "does this resource exist at all" is a coarser
gate than "am I allowed to see it."

## 3. Authorization rules — ported verbatim, not reinvented

`backend/src/community_authz.rs` is a line-for-line behavioral port of
`src/features/community-members/permissions.ts`'s `canAddMember`/`canRemoveMember`/`canChangeRole`,
re-keyed from `RelayMemberRole`/`pubkey` to `Role`/`Uuid` (`user_id`). Notably ported faithfully
rather than "improved": there is no last-owner special case anywhere in the source being mirrored —
an owner can never be removed via the remove-member endpoint at all (not just "the last one"), and
*nobody* can remove or role-change themselves via these endpoints, regardless of role. If a future
phase needs owner transfer or self-leave, that's a deliberately separate endpoint/rule set, not a
loosening of these three functions.

## 4. What's deliberately out of scope for this phase

Invites, channels, messages, threads, DMs — Phase 4+ per `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §3. This
phase only adds `communities`, `community_members`, community creation, and the four membership
endpoints. The frontend's `RelayMembersService.ts`/`permissions.ts` have not been rewired to call this
new HTTP API yet — that migration (swap Nostr-event transport for HTTP calls, per D10's "build
alongside, then delete" sequencing) is follow-up work, not done in this phase.

## 5. Verification status

All 28 backend tests pass (`cargo test`), `cargo clippy --all-targets` and `cargo fmt --check` clean.
5 new integration tests drive the real Axum router end-to-end (add/remove/role-change under every
combination of owner/admin/member/non-member acting roles, conflict/not-found cases) against
`InMemoryRepo` — no live Postgres was available in this environment (Docker was down), so
`PostgresRepo`'s SQL for these new tables/queries has not been executed against a real database,
same disclosed gap as Phase 2.
