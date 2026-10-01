/**
 * Pure, unit-testable mirror of the relay's CHANNEL-level (NIP-29) membership
 * authorization rules — a separate permission plane from community
 * (relay-wide) roles, see `../community-members/permissions.ts`'s doc
 * comment for that distinction. Source-verified against
 * `../buzz/crates/buzz-relay/src/handlers/channel_authz.rs`
 * (`decide_put_user`/`classify_remove_other`) this session — not assumed.
 *
 * IMPORTANT: this is a fast-fail UX layer only, not a security boundary.
 * `channel_authz.rs` (and `handle_put_user`/`handle_remove_user` in
 * `side_effects.rs`) is the sole real enforcement point.
 */
import type { ChannelVisibility } from "@/types/domain";
import type { MemberRole } from "@/protocol/membership";

function isElevated(role: MemberRole | null): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Who may open the "add member" flow for a channel at all. Mirrors
 * `decide_put_user`'s visibility gate (channel_authz.rs:119-133): open
 * channels admit any authenticated user (even a non-member); private
 * channels require the actor to already be an active member — a
 * non-member's self-add into a private channel is rejected too
 * (`ActorNotAuthorized`), so this is not just "can add others."
 */
export function canAddChannelMember(
  myRole: MemberRole | null,
  visibility: ChannelVisibility,
): boolean {
  if (visibility === "private") return myRole !== null;
  return true;
}

/**
 * Which channel roles the add-member/role-change picker should offer.
 * Mirrors channel_authz.rs:128-132: granting an elevated role (admin/owner)
 * requires the actor to already be elevated (owner OR admin — unlike the
 * community-level model, a channel admin may grant channel-owner via this
 * path too, since the rule only checks `actor_role.is_elevated()`, not
 * "is owner specifically"). A non-elevated (or non-member, open-channel)
 * actor may only add at plain `member`.
 */
export function assignableChannelRoles(myRole: MemberRole | null): MemberRole[] {
  return isElevated(myRole) ? ["member", "admin", "owner"] : ["member"];
}

/**
 * Who may remove another member, or change an existing active member's
 * role. Mirrors `classify_remove_other` (channel_authz.rs:210-215, owner/
 * admin → `Allow` for any target) and the role-change gate inside
 * `decide_put_user` (channel_authz.rs:153, "only owners/admins may change
 * an active member's role"). Deliberately does NOT cover the
 * `CheckAgentOwner` path (a plain member removing an agent/bot they own) —
 * that's a bot-management case out of scope for this human-facing UI.
 */
export function canManageChannelMember(myRole: MemberRole | null): boolean {
  return isElevated(myRole);
}

/**
 * Whether I may edit a given message.
 *
 * Only the author may edit, and OLD BUZZ additionally re-gates on current
 * access: a person removed from a private channel cannot go back and rewrite
 * their old messages (`ingest.rs` `validate_edit_ownership`). Both conditions
 * are mirrored here so the menu item does not appear when the publish would be
 * refused — the relay remains the actual enforcement point.
 */
export function canEditMessage(params: {
  myPubkey: string | null;
  authorPubkey: string;
  myRole: MemberRole | null;
  visibility: ChannelVisibility;
}): boolean {
  if (!params.myPubkey || params.myPubkey !== params.authorPubkey) return false;
  return params.myRole !== null || params.visibility === "open";
}

/**
 * Whether I may delete a given message, and by which path.
 *
 * `"self"` → kind:5, the author's own retraction. `"admin"` → kind:9005, which
 * is the ONLY path that lets a channel owner/admin remove somebody else's
 * message; sending kind:5 for that case is refused by the relay because kind:5
 * is gated on authorship alone. `null` → no delete offered.
 *
 * An author who has lost access to a private channel falls through to the
 * admin path if they hold a channel role, and otherwise gets nothing — matching
 * `side_effects.rs:614-654`.
 */
export function messageDeleteMode(params: {
  myPubkey: string | null;
  authorPubkey: string;
  myRole: MemberRole | null;
  visibility: ChannelVisibility;
}): "self" | "admin" | null {
  // No identity, no delete path — including the admin one. Without a signed-in
  // key there is nothing to sign the deletion with, so offering the action
  // would produce a publish that can only fail.
  if (!params.myPubkey) return null;
  const isAuthor = params.myPubkey === params.authorPubkey;
  if (isAuthor && (params.myRole !== null || params.visibility === "open")) return "self";
  if (isElevated(params.myRole)) return "admin";
  return null;
}

/**
 * Whether removing/demoting `target` would orphan the channel (the
 * `LastOwnerRemoval`/`LastOwnerDemotion` guard, channel_authz.rs:34-45,
 * mirroring `is_sole_owner`). `members` must be the channel's current
 * active roster.
 */
export function isSoleChannelOwner(
  members: { pubkey: string; role: MemberRole }[],
  pubkey: string,
): boolean {
  const owners = members.filter((m) => m.role === "owner");
  return owners.length === 1 && owners[0].pubkey === pubkey;
}
