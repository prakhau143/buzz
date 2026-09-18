/**
 * The owner/admin/member authorization *rules* for the new HTTP-backed
 * community membership are byte-for-byte identical to the old pubkey-based
 * ones in `../community-members/permissions.ts` (both were ported verbatim
 * into `backend/src/community_authz.rs` — see
 * `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` row "Community roles": "rules are
 * already correct and directly portable; only the transport ... and the
 * identity key (pubkey → user_id) need to change"). Re-exported here rather
 * than duplicated, so the two can never drift; only the identity-resolution
 * helper differs (userId-keyed instead of pubkey-keyed), because the old
 * one's signature is hardwired to `RelayMember`/pubkey.
 */
export {
  canManageCommunityMembers,
  canAddMember,
  canRemoveMember,
  canChangeRole,
  assignableRoles,
} from "@/features/community-members/permissions";

import type { CommunityMember, CommunityRole } from "./CommunityService";

/** The new-backend equivalent of `resolveMyRole` — keyed by `userId`, not `pubkey`. */
export function resolveMyCommunityRole(
  members: CommunityMember[] | null,
  userId: string | null,
): CommunityRole | null {
  if (!members || !userId) return null;
  return members.find((m) => m.userId === userId)?.role ?? null;
}
