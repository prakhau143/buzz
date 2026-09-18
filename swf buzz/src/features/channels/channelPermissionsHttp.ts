/**
 * The owner/admin/member authorization *rules* for the new HTTP-backed
 * channel plane are byte-for-byte identical to the old pubkey-based ones in
 * `./channelPermissions.ts` (both were ported verbatim into
 * `backend/src/channel_authz.rs` — see
 * `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` row "Channel membership/roles").
 * Re-exported here rather than duplicated so the two can never drift; only
 * the identity-resolution helper differs (userId-keyed instead of
 * pubkey-keyed), because the old one's signature is hardwired to `pubkey`.
 *
 * Includes the intentional asymmetry vs. the community plane, preserved
 * exactly, not "fixed": a channel *admin* (not just owner) may grant
 * channel-owner (`assignableChannelRoles`), and there is no self-removal
 * immunity (`canManageChannelMember` has no `isSelf` parameter at all).
 */
export {
  canAddChannelMember,
  assignableChannelRoles,
  canManageChannelMember,
} from "./channelPermissions";

import type { HttpChannelMember } from "./ChannelServiceHttp";

export type ChannelRole = "owner" | "admin" | "member";

/** The new-backend equivalent of `isSoleChannelOwner` — keyed by `userId`, not `pubkey`. */
export function isSoleChannelOwnerById(members: HttpChannelMember[], userId: string): boolean {
  const owners = members.filter((m) => m.role === "owner");
  return owners.length === 1 && owners[0].userId === userId;
}

/** The new-backend equivalent of resolving "my role" from a member roster. */
export function resolveMyChannelRole(
  members: HttpChannelMember[] | null,
  userId: string | null,
): ChannelRole | null {
  if (!members || !userId) return null;
  return members.find((m) => m.userId === userId)?.role ?? null;
}
