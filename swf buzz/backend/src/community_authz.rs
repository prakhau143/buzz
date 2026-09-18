//! Server-side community-membership authorization -- the real enforcement
//! point (master prompt §25: never trust a client-asserted role). Ported
//! *verbatim in behavior* from the frontend's
//! `src/features/community-members/permissions.ts`, re-keyed from `pubkey`
//! to `user_id`/`Role`. Keep these two files in sync if the rules ever
//! change; this is the security boundary, `permissions.ts` is UX-only
//! fast-fail (see that file's own header comment).

use crate::models::Role;

/// Who may add a new member at the given role.
/// Mirrors `permissions.ts:39-44` (`canAddMember`).
pub fn can_add_member(acting_role: Option<Role>, role_to_grant: Role) -> bool {
    if role_to_grant == Role::Owner {
        return false; // ownership never changes via this path
    }
    match acting_role {
        Some(Role::Owner) => true,
        Some(Role::Admin) => role_to_grant == Role::Member,
        _ => false,
    }
}

/// Who may remove a given member. Mirrors `permissions.ts:47-57`
/// (`canRemoveMember`). Note there is no separate "last owner" guard in the
/// ported source -- an owner can never be removed via this path at all
/// (`targetRole === "owner" => false`, unconditionally), and nobody --
/// regardless of role -- can remove themselves via this path
/// (`isSelf => false`, unconditionally).
pub fn can_remove_member(acting_role: Option<Role>, target_role: Role, is_self: bool) -> bool {
    if is_self {
        return false; // "cannot remove yourself"
    }
    if target_role == Role::Owner {
        return false; // an owner can never be removed via this path
    }
    match acting_role {
        Some(Role::Owner) => true, // owner may remove admin or member
        Some(Role::Admin) => target_role == Role::Member, // admin: member-role targets only
        _ => false,
    }
}

/// Who may promote/demote a given member to a new role. Mirrors
/// `permissions.ts:60-71` (`canChangeRole`).
pub fn can_change_role(
    acting_role: Option<Role>,
    target_role: Role,
    is_self: bool,
    new_role: Role,
) -> bool {
    if acting_role != Some(Role::Owner) {
        return false; // role changes are owner-only
    }
    if is_self {
        return false; // "cannot change your own role"
    }
    if target_role == Role::Owner {
        return false; // the owner's own role can't be overwritten this way
    }
    if new_role == Role::Owner {
        return false; // ownership only changes via transfer, not this path
    }
    true
}

/// Who may create or revoke a community invite (Phase 4, DECISIONS.md D10).
/// Not a port of anything in `permissions.ts` -- invites didn't previously
/// exist in that file's scope -- this mirrors the same owner/admin authority
/// tier `canManageCommunityMembers` already uses, which is also the tier the
/// master prompt assigns invite creation to (§6, §16).
pub fn can_manage_invites(acting_role: Option<Role>) -> bool {
    matches!(acting_role, Some(Role::Owner) | Some(Role::Admin))
}

#[cfg(test)]
mod tests {
    use super::*;
    use Role::*;

    #[test]
    fn owner_can_add_admin_or_member_never_owner() {
        assert!(can_add_member(Some(Owner), Admin));
        assert!(can_add_member(Some(Owner), Member));
        assert!(!can_add_member(Some(Owner), Owner));
    }

    #[test]
    fn admin_can_add_member_only() {
        assert!(can_add_member(Some(Admin), Member));
        assert!(!can_add_member(Some(Admin), Admin));
        assert!(!can_add_member(Some(Admin), Owner));
    }

    #[test]
    fn member_and_non_member_can_add_nobody() {
        assert!(!can_add_member(Some(Member), Member));
        assert!(!can_add_member(None, Member));
    }

    #[test]
    fn owner_can_remove_admin_or_member_never_owner_never_self() {
        assert!(can_remove_member(Some(Owner), Admin, false));
        assert!(can_remove_member(Some(Owner), Member, false));
        assert!(!can_remove_member(Some(Owner), Owner, false));
        assert!(!can_remove_member(Some(Owner), Member, true));
    }

    #[test]
    fn admin_can_remove_member_only() {
        assert!(can_remove_member(Some(Admin), Member, false));
        assert!(!can_remove_member(Some(Admin), Admin, false));
        assert!(!can_remove_member(Some(Admin), Owner, false));
    }

    #[test]
    fn nobody_can_remove_themselves_via_this_path() {
        assert!(!can_remove_member(Some(Owner), Admin, true));
        assert!(!can_remove_member(Some(Admin), Member, true));
    }

    #[test]
    fn only_owner_can_change_roles_never_touching_owner_never_self_never_granting_owner() {
        assert!(can_change_role(Some(Owner), Member, false, Admin));
        assert!(can_change_role(Some(Owner), Admin, false, Member));
        assert!(!can_change_role(Some(Admin), Member, false, Admin));
        assert!(!can_change_role(Some(Owner), Owner, false, Member));
        assert!(!can_change_role(Some(Owner), Member, false, Owner));
        assert!(!can_change_role(Some(Owner), Member, true, Admin));
    }

    #[test]
    fn owner_and_admin_manage_invites_member_and_non_member_do_not() {
        assert!(can_manage_invites(Some(Owner)));
        assert!(can_manage_invites(Some(Admin)));
        assert!(!can_manage_invites(Some(Member)));
        assert!(!can_manage_invites(None));
    }
}
