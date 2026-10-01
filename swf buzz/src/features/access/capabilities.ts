import { computed, type ComputedRef } from "vue";
import { useSessionStore } from "@/stores/session";
import type { RelayMemberRole } from "@/protocol/relayMembers";
import type { PlatformRole } from "@/stores/session";
import {
  canManageCommunityMembers,
  canViewModerationQueue,
} from "@/features/community-members/permissions";

/**
 * The ONE place that turns authoritative role state into UI capabilities
 * (docs/SWF_ROLE_MODEL.md, docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §10).
 *
 * Two independent planes, never derived from each other:
 *
 *   platformRole   "operator" | null   — the relay's answer to THIS pubkey's
 *                                        signed NIP-98 probe on /operator/*
 *                                        (RELAY_OPERATOR_PUBKEYS). Deployment-level.
 *   communityRole  owner|admin|member|null — this pubkey's `relay_members` row
 *                                        in the community it opened (NIP-42).
 *
 * Rules the capabilities encode:
 *  - an operator is NOT thereby a member/owner of any community (may have
 *    `communityRole === null` and still reach the Operator dashboard);
 *  - an owner/admin is NOT thereby an operator (no deployment actions, ever);
 *  - "signed in" alone grants nothing beyond identity.
 *
 * Only capabilities with real protocol/backend support are exposed — no fake
 * buttons.
 *
 * Message edit/delete are deliberately NOT here even though Phase 4B built
 * them: they are per-message decisions, not session-wide ones. Whether I may
 * edit or delete depends on the message's author, the channel's visibility and
 * my role *in that channel*, so they live in
 * `features/channels/channelPermissions.ts` and are evaluated per row. Hoisting
 * them into a session-level capability would have to answer "can I edit?"
 * without knowing which message, and the only safe answer would be the wrong
 * one.
 */
export interface Capabilities {
  // Platform plane
  canAccessOperatorDashboard: boolean;
  canManageDeployment: boolean;
  canCreateCommunity: boolean;
  // Community plane
  canOpenCommunity: boolean;
  canManageCommunityMembers: boolean;
  canModerateCommunity: boolean;
  canCreateChannel: boolean;
  canInviteToCommunity: boolean;
}

// The platform plane's only value today (mirrors stores/session.ts). Compared as
// a constant: `platformRole` is written solely from the relay's operator probe.
const OPERATOR: PlatformRole = "operator";

export function capabilitiesFor(platformRole: PlatformRole | null, communityRole: RelayMemberRole | null): Capabilities {
  const operator = platformRole === OPERATOR;
  const member = communityRole !== null;
  return {
    canAccessOperatorDashboard: operator,
    canManageDeployment: operator,
    canCreateCommunity: operator,
    canOpenCommunity: member,
    // Any authenticated member may create a channel and becomes its owner
    // (OLD BUZZ protocol, kind:9007 — PHASE_3_OLD_BUZZ_PROTOCOL_AUDIT.md §3).
    canCreateChannel: member,
    canManageCommunityMembers: canManageCommunityMembers(communityRole),
    canModerateCommunity: canViewModerationQueue(communityRole),
    canInviteToCommunity: canManageCommunityMembers(communityRole),
  };
}

/** Reactive capabilities for the signed-in identity. Read-only; recomputed on any role change. */
export function useCapabilities(): ComputedRef<Capabilities> {
  const session = useSessionStore();
  return computed(() => capabilitiesFor(session.platformRole, session.communityRole));
}
