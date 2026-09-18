# Channel membership design (Phase 5, DECISIONS.md D10)

Decision record, not an essay. Extends `swf buzz/backend/` (Phases 2-4) with `channels` and
`channel_members`. See `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §1 rows "Channel creation" / "Channel
membership/roles" for the spec this phase implements, and `COMMUNITY_MEMBERSHIP_DESIGN.md` for the
community-plane precedent this mirrors.

## 1. Three role tiers, not old Buzz's five

The parity plan's own row for this feature notes old Buzz has 5 channel tiers
(owner/admin/member/guest/bot). Checked the actual client source before picking a schema:
`src/features/channels/channelPermissions.ts` only implements **3** (owner/admin/member) — no
`guest`/`bot` exist anywhere in current SWF Buzz. Ported what's actually there, not old Buzz's
fuller model. `channel_members.role` reuses the same `Role` enum/TEXT-CHECK vocabulary as
`community_members.role` (both are the 3-tier owner/admin/member shape) — this is **not** the same
role plane, just the same vocabulary; a `channel_authz.rs` decision never reads `community_members`
and vice versa (`channel_authz`'s own header comment).

## 2. Community role never substitutes for channel role

The single most important rule carried over from D10/the master prompt (§17): a community owner is
**not** automatically a channel owner, admin, or even a member of any given channel. Every channel
handler resolves the caller's channel role from an actual `channel_members` row
(`ChannelRepo::find_channel_role`) — community role is used only as the outer gate ("are you even
in this community at all," `require_community_and_caller_role`, reused verbatim from Phase 3), never
as a stand-in for channel authority. Covered by
`community_owner_is_not_automatically_a_member_of_a_channel_they_did_not_create` in
`tests/channel_membership_flow.rs`.

## 3. Channels are community-scoped, not globally visible

`channelPermissions.ts` only reasons at the channel plane — it doesn't say what governs seeing or
acting on a channel from *outside* its community. This backend's own call: every channel
endpoint requires the caller to be a community member (any role) of the channel's parent community
first, via the same `require_community_and_caller_role` helper Phase 3 already built — a stranger
to the community gets `403` even for an `open` channel, and `POST .../channels` (creation) is
likewise gated on community membership, not open to arbitrary authenticated users. This is an
extension of the source's model, not a contradiction of it.

## 4. Visibility rule for listing channels

`GET /api/communities/:id/channels` returns every `open` channel in the community, plus any
`private` channel the caller is already a `channel_members` row for. Not specified anywhere in
`channelPermissions.ts` (it has no "list channels" concept at all) — this backend's own call,
matching the obvious product expectation (you shouldn't see a private channel you haven't joined
in a channel list, but you should see open ones to be able to join them).

## 5. Authorization rules — ported verbatim from `channelPermissions.ts`

`backend/src/channel_authz.rs`, mirroring `community_authz.rs`'s file structure:

- `can_open_add_flow` ← `canAddChannelMember` (`channelPermissions.ts:28-34`): open channel admits
  anyone (even non-channel-members); private channel requires the actor to already be a channel
  member.
- `can_grant_channel_role` ← `assignableChannelRoles` (`channelPermissions.ts:36-47`): granting an
  elevated role (admin/owner) requires the actor to already be elevated (owner OR admin).
  **Confirmed and preserved, not "fixed"**: unlike the community plane (`community_authz::can_add_member`,
  where only an owner may ever grant admin and nobody may grant owner via that path), a channel
  *admin* may grant channel-*owner* — the source only checks `isElevated(myRole)`, not "is owner
  specifically." Test: `channel_admin_can_grant_channel_owner_intentional_asymmetry`.
- `can_manage_channel_member` ← `canManageChannelMember` (`channelPermissions.ts:58-60`): governs
  remove and role-change, elevated actors only. Deliberately has **no self-removal/self-role-change
  immunity**, unlike the community plane's `can_remove_member`/`can_change_role` — the source has no
  `isSelf` check anywhere in this file.
- `would_orphan_channel` ← `isSoleChannelOwner` (`channelPermissions.ts:62-74`), combined with the
  removal/demotion guard its own UI callers apply on top of it (`ChannelMemberRow.vue`): blocks
  removing or demoting a channel's sole owner. This is the one guard that *does* exist here, in
  place of self-immunity.

## 6. What's deliberately out of scope for this phase

Messages, threads, DMs — Phase 6+ per `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §3. This phase only adds
`channels`, `channel_members`, channel creation, channel listing, and the three membership
endpoints. The frontend's `ChannelService.ts`/`channelPermissions.ts`/`useChannelMemberActions.ts`
have not been rewired to call this new HTTP API yet — that migration is follow-up work, matching
D10's "build alongside, then delete" sequencing, not done in this phase.

## 7. Verification status

All 60 backend tests pass (`cargo test`): 35 unit (7 new `channel_authz` cases), 8 new integration
in `tests/channel_membership_flow.rs`, 17 pre-existing (Phases 2-4) unaffected. `cargo clippy
--all-targets` and `cargo fmt --check` clean. No live Postgres was available this session either
(Docker down) — `PostgresRepo`'s new `channels`/`channel_members` SQL has not been executed against
a real database, same disclosed gap as every prior phase.
