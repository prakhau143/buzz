//! Server-side CHANNEL-level authorization -- a separate permission plane
//! from `community_authz.rs` (community/relay-wide roles). Ported
//! *verbatim in behavior* from the frontend's
//! `src/features/channels/channelPermissions.ts`, re-keyed from `pubkey`
//! to `user_id`/`Role`. A community owner is NOT automatically a channel
//! owner/member of any given channel -- only an actual `channel_members`
//! row (represented here as `Option<Role>`) governs anything in this file.
//! This is now the real enforcement point (unlike `channelPermissions.ts`,
//! which is fast-fail UX only per its own header comment).

use crate::models::{ChannelVisibility, Role};

fn is_elevated(role: Option<Role>) -> bool {
    matches!(role, Some(Role::Owner) | Some(Role::Admin))
}

/// Who may open the "add channel member" flow at all. Mirrors
/// `channelPermissions.ts:28-34` (`canAddChannelMember`): open channels
/// admit any (community-member) user even if they aren't yet a channel
/// member; private channels require the actor to already be an active
/// channel member -- a non-member's self-add into a private channel is
/// rejected too, this is not just "can add others."
pub fn can_open_add_flow(actor_channel_role: Option<Role>, visibility: ChannelVisibility) -> bool {
    match visibility {
        ChannelVisibility::Private => actor_channel_role.is_some(),
        ChannelVisibility::Open => true,
    }
}

/// Whether the given actor may grant `role_to_grant` when adding a member
/// or changing an existing member's role. Mirrors `channelPermissions.ts:36-47`
/// (`assignableChannelRoles`): granting an elevated role (admin/owner)
/// requires the actor to already be elevated (owner OR admin). Deliberately
/// asymmetric vs. `community_authz::can_add_member` (there, only an owner
/// may ever grant admin, and nobody may grant owner via that path): here a
/// channel *admin* may grant channel-*owner* too. Do not "fix" this -- it
/// mirrors the ported source exactly.
pub fn can_grant_channel_role(actor_channel_role: Option<Role>, role_to_grant: Role) -> bool {
    is_elevated(actor_channel_role) || role_to_grant == Role::Member
}

/// Who may remove another member, or change an existing active member's
/// role, at all -- before the last-owner guard below. Mirrors
/// `channelPermissions.ts:58-60` (`canManageChannelMember`). Deliberately
/// has NO self-removal/self-role-change immunity (unlike the community
/// plane's `can_remove_member`/`can_change_role`) -- the only additional
/// guard here is `would_orphan_channel`.
pub fn can_manage_channel_member(actor_channel_role: Option<Role>) -> bool {
    is_elevated(actor_channel_role)
}

/// Whether acting on a member who currently `target_is_sole_owner` would
/// orphan the channel -- pass `becomes_non_owner = true` for a removal, or
/// `new_role != Role::Owner` for a role change. Mirrors
/// `channelPermissions.ts:62-74` (`isSoleChannelOwner`), which that file's
/// UI callers combine with `canManageChannelMember` to disable the
/// remove/demote action for a sole owner -- this function is that same
/// guard, now enforced server-side.
pub fn would_orphan_channel(target_is_sole_owner: bool, becomes_non_owner: bool) -> bool {
    target_is_sole_owner && becomes_non_owner
}

#[cfg(test)]
mod tests {
    use super::*;
    use Role::*;

    #[test]
    fn open_channel_admits_anyone_private_requires_existing_membership() {
        assert!(can_open_add_flow(None, ChannelVisibility::Open));
        assert!(can_open_add_flow(Some(Member), ChannelVisibility::Open));
        assert!(!can_open_add_flow(None, ChannelVisibility::Private));
        assert!(can_open_add_flow(Some(Member), ChannelVisibility::Private));
    }

    #[test]
    fn only_elevated_actors_grant_elevated_roles_but_admin_may_grant_owner() {
        assert!(can_grant_channel_role(Some(Owner), Owner));
        assert!(can_grant_channel_role(Some(Admin), Owner)); // intentional asymmetry, do not "fix"
        assert!(can_grant_channel_role(Some(Admin), Admin));
        assert!(can_grant_channel_role(None, Member));
        assert!(can_grant_channel_role(Some(Member), Member));
        assert!(!can_grant_channel_role(Some(Member), Admin));
        assert!(!can_grant_channel_role(None, Admin));
        assert!(!can_grant_channel_role(None, Owner));
    }

    #[test]
    fn only_elevated_actors_manage_members() {
        assert!(can_manage_channel_member(Some(Owner)));
        assert!(can_manage_channel_member(Some(Admin)));
        assert!(!can_manage_channel_member(Some(Member)));
        assert!(!can_manage_channel_member(None));
    }

    #[test]
    fn removing_or_demoting_a_non_sole_owner_never_orphans_the_channel() {
        assert!(!would_orphan_channel(false, true));
        assert!(!would_orphan_channel(false, false));
    }

    #[test]
    fn removing_or_demoting_the_sole_owner_orphans_the_channel() {
        assert!(would_orphan_channel(true, true)); // removal
        assert!(would_orphan_channel(true, true)); // demotion to a non-owner role
    }

    #[test]
    fn reassigning_the_sole_owner_to_owner_again_is_not_a_demotion() {
        assert!(!would_orphan_channel(true, false));
    }
}
