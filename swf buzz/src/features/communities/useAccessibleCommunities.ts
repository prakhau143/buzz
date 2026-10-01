import { computed, ref } from "vue";
import { useSessionStore } from "@/stores/session";
import { useAccessStore } from "@/stores/access";
import { discoverMemberships, probeMembership, type Membership } from "@/features/access/communityDiscovery";
import type { RelayMemberRole } from "@/protocol/relayMembers";

/**
 * Communities the CURRENT identity can actually open — never the same thing as
 * "communities this device remembers".
 *
 *   recent addresses (candidates; grant nothing)
 *     → signed membership probe per relay (NIP-98 `POST /query`: the relay
 *       authenticates the key and answers 403 to a non-member)
 *     → role from the relay-signed kind 13534 roster
 *     → ONLY owner / admin / member are accessible
 *
 * Excluded: not a member, refused/blocked, unreachable, unknown to the relay
 * (404, forgotten by `discoverMemberships`), or allowed in without a roster role
 * (an open relay that doesn't name this pubkey — not a verified member).
 * Nothing about membership is ever stored locally as authority: the answer is
 * re-asked every time the switcher opens and again right before a switch.
 */
const ACCESSIBLE_ROLES: ReadonlySet<RelayMemberRole> = new Set(["owner", "admin", "member"]);

export function isAccessibleRole(role: RelayMemberRole | null | undefined): role is RelayMemberRole {
  return !!role && ACCESSIBLE_ROLES.has(role);
}

export function accessibleOnly(memberships: readonly Membership[]): Membership[] {
  return memberships.filter((m) => isAccessibleRole(m.role));
}

export function useAccessibleCommunities() {
  const session = useSessionStore();
  const access = useAccessStore();
  const verifying = ref(false);
  /** Set once this identity's candidates have been asked at least once in this component's life. */
  const verified = ref(false);

  const accessible = computed(() => accessibleOnly(access.memberships));

  async function refresh(): Promise<void> {
    const pubkey = session.pubkey;
    if (!pubkey || verifying.value) return;
    verifying.value = true;
    try {
      const found = await discoverMemberships(pubkey);
      // The identity may have switched while the probes were in flight.
      if (session.pubkey !== pubkey) return;
      access.$patch({ memberships: found.memberships, unreachable: found.unreachable });
      verified.value = true;
    } finally {
      verifying.value = false;
    }
  }

  /** Fresh, relay-side answer for ONE community, just before switching to it. */
  async function verify(relayUrl: string): Promise<{ ok: true; role: RelayMemberRole } | { ok: false; reason: string }> {
    const pubkey = session.pubkey;
    if (!pubkey) return { ok: false, reason: "No identity is signed in." };
    const outcome = await probeMembership(relayUrl, pubkey);
    if (outcome.status === "member" && isAccessibleRole(outcome.role)) return { ok: true, role: outcome.role };
    const reason =
      outcome.status === "unreachable"
        ? "That community can't be reached right now."
        : outcome.status === "gone"
          ? "That community no longer exists."
          : "This identity is not a member of that community.";
    return { ok: false, reason };
  }

  return { accessible, verifying, verified, refresh, verify };
}
