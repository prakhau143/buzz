/**
 * Community (relay-wide) member management — kinds 9030/9031/9032 + the
 * relay-authored kind:13534 snapshot. See docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md
 * §2a. Every mutation runs a client-side permission pre-flight (`permissions.ts`)
 * before signing/publishing — fail-fast UX only, the relay is the real gate.
 */
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import { AppError } from "@/services/errors";
import {
  buildAddRelayMemberEvent,
  buildChangeRelayMemberRoleEvent,
  buildRemoveRelayMemberEvent,
  parseRelayMembershipListEvent,
  relayMembershipListFilter,
  type RelayMember,
  type RelayMemberRole,
} from "@/protocol/relayMembers";
import { canAddMember, canChangeRole, canRemoveMember } from "./permissions";

class RelayMembersService {
  /**
   * Returns `null` when the relay has never published a kind:13534 snapshot —
   * this means the relay does not require/enforce community membership (an
   * "open" relay), not an error. Callers must not treat `null` as a failure.
   */
  async fetchMembershipList(): Promise<RelayMember[] | null> {
    const events = await fetchEventsOnce([relayMembershipListFilter()]);
    if (events.length === 0) return null;
    // Plain NIP-01 replaceable event — take the newest if more than one arrived.
    const newest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
    return parseRelayMembershipListEvent(newest);
  }

  async addMember(params: {
    pubkey: string;
    role: RelayMemberRole;
    actingRole: RelayMemberRole | null;
  }): Promise<void> {
    if (!canAddMember(params.actingRole, params.role)) {
      throw new AppError("permission_denied", "You don't have permission to do that.");
    }
    await signAndPublish(buildAddRelayMemberEvent({ pubkey: params.pubkey, role: params.role }));
  }

  async removeMember(params: {
    pubkey: string;
    targetRole: RelayMemberRole;
    actingRole: RelayMemberRole | null;
    selfPubkey: string | null;
  }): Promise<void> {
    const isSelf = !!params.selfPubkey && params.selfPubkey === params.pubkey;
    if (!canRemoveMember(params.actingRole, params.targetRole, isSelf)) {
      throw new AppError("permission_denied", "You don't have permission to do that.");
    }
    await signAndPublish(buildRemoveRelayMemberEvent({ pubkey: params.pubkey }));
  }

  async changeRole(params: {
    pubkey: string;
    targetRole: RelayMemberRole;
    newRole: RelayMemberRole;
    actingRole: RelayMemberRole | null;
    selfPubkey: string | null;
  }): Promise<void> {
    const isSelf = !!params.selfPubkey && params.selfPubkey === params.pubkey;
    if (!canChangeRole(params.actingRole, params.targetRole, isSelf, params.newRole)) {
      throw new AppError("permission_denied", "You don't have permission to do that.");
    }
    await signAndPublish(
      buildChangeRelayMemberRoleEvent({ pubkey: params.pubkey, role: params.newRole }),
    );
  }
}

export const relayMembersService = new RelayMembersService();
