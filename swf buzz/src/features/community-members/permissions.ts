/**
 * Pure, unit-testable mirror of the relay's community (NIP-43) authorization
 * rules — see docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2a and
 * docs/ROLE_PERMISSION_AUDIT.md §1/§8 for the source-verified rules this
 * encodes.
 *
 * IMPORTANT: this is a fast-fail UX layer only, not a security boundary.
 * `RelayMembersService` calls these before publishing so the UI can show a
 * clear error instead of waiting on a round trip the relay will reject
 * anyway — the relay (`../buzz/crates/buzz-relay/src/handlers/relay_admin.rs`)
 * is the sole real enforcement point. See
 * docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md §9 ("Is client-side authorization
 * ever real, or purely cosmetic?").
 */
import type { RelayMember, RelayMemberRole } from "@/protocol/relayMembers";

/**
 * The single, centralized way to resolve a pubkey's community role from a
 * membership snapshot — used both by `useCommunityMembers()` (for display)
 * and the post-login identity-resolution step in `useAuth.ts` (for
 * authorization), so the two can never drift. `members === null` means "no
 * relay membership snapshot exists" (an open relay — see
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2a), which resolves to `null`
 * (no role), same as "not a recognized member."
 */
export function resolveMyRole(
  members: RelayMember[] | null,
  pubkey: string | null,
): RelayMemberRole | null {
  if (!members || !pubkey) return null;
  return members.find((m) => m.pubkey === pubkey)?.role ?? null;
}

export function canManageCommunityMembers(role: RelayMemberRole | null): boolean {
  return role === "owner" || role === "admin";
}

/** Who may add a new member at the given role. Mirrors relay_admin.rs:315-328. */
export function canAddMember(actingRole: RelayMemberRole | null, roleToGrant: RelayMemberRole): boolean {
  if (roleToGrant === "owner") return false; // ownership never changes via this path
  if (actingRole === "owner") return true;
  if (actingRole === "admin") return roleToGrant === "member";
  return false;
}

/** Who may remove a given member. Mirrors relay_admin.rs:365-397. */
export function canRemoveMember(
  actingRole: RelayMemberRole | null,
  targetRole: RelayMemberRole,
  isSelf: boolean,
): boolean {
  if (isSelf) return false; // "cannot remove yourself"
  if (targetRole === "owner") return false; // an owner can never be removed via this path
  if (actingRole === "owner") return true; // owner may remove admin or member
  if (actingRole === "admin") return targetRole === "member"; // admin: member-role targets only
  return false;
}

/** Who may promote/demote a given member to a new role. Mirrors relay_admin.rs:422-441. */
export function canChangeRole(
  actingRole: RelayMemberRole | null,
  targetRole: RelayMemberRole,
  isSelf: boolean,
  newRole: RelayMemberRole,
): boolean {
  if (actingRole !== "owner") return false; // role changes are owner-only
  if (isSelf) return false; // "cannot change your own role"
  if (targetRole === "owner") return false; // the owner's own role can't be overwritten this way
  if (newRole === "owner") return false; // ownership only changes via transfer, not this path
  return true;
}

/** Which roles the invite/add-member role picker should offer for the acting user. */
export function assignableRoles(actingRole: RelayMemberRole | null): RelayMemberRole[] {
  if (actingRole === "owner") return ["member", "admin"];
  if (actingRole === "admin") return ["member"];
  return [];
}

// --- Moderation authority (kinds 9040-9044) — same community role plane. ---
// Mirrors ../buzz/crates/buzz-relay/src/handlers/moderation_authz.rs:146-181
// (`decide_authority`), which this project's own docs/ROLE_PERMISSION_AUDIT.md
// §4 and docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md §4/§8 document in full.

/** Who may view the moderation queue and audit log. */
export function canViewModerationQueue(role: RelayMemberRole | null): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Who may ban or time out a given target. The owner is unrestricted; an
 * admin cannot ban/timeout the owner or a fellow admin — the one guard rail
 * in the whole community moderation model.
 */
export function canBanOrTimeout(
  actingRole: RelayMemberRole | null,
  targetRole: RelayMemberRole | null,
): boolean {
  if (actingRole === "owner") return true;
  if (actingRole === "admin") return targetRole !== "owner" && targetRole !== "admin";
  return false;
}

/** Unban/untimeout carry no guard rail — any owner/admin may lift a restriction. */
export function canUnbanOrUntimeout(actingRole: RelayMemberRole | null): boolean {
  return actingRole === "owner" || actingRole === "admin";
}

/** Resolving/dismissing/escalating a report carries no guard rail either. */
export function canResolveReport(actingRole: RelayMemberRole | null): boolean {
  return actingRole === "owner" || actingRole === "admin";
}
