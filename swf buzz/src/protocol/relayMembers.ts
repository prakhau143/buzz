/**
 * Community (relay-wide) membership — owner/admin/member, distinct from the
 * per-channel NIP-29 roles in `membership.ts`. This is Buzz's NIP-43 relay
 * roster: kinds 9030 (add), 9031 (remove), 9032 (change role), and the
 * relay-authored kind:13534 snapshot event.
 *
 * Verified against ../buzz source, not guessed:
 * - kind numbers: crates/buzz-core/src/kind.rs:389-398
 * - 9030/9031/9032 tag shape (`p` + optional `role`):
 *   desktop/src/shared/api/relayMembers.ts:148-169 (`publishRelayAdminEvent`)
 * - kind:13534 tag shape (`["member", pubkey, role]`, no `#d` tag — a plain
 *   NIP-01 replaceable event, only the newest per-relay-pubkey survives):
 *   crates/buzz-db/src/store/relay_members.rs:1013-1024
 * - Absence of a kind:13534 snapshot means the relay does not require/enforce
 *   community membership (an "open" relay) — this must not be treated as a
 *   denial. See docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §9.
 *
 * See docs/ROLE_PERMISSION_AUDIT.md §1/§8 and docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md
 * §1/§3/§4 for the full authorization rules this UI/service layer mirrors
 * client-side for fast-fail UX — the relay remains the sole real enforcement
 * boundary (see blueprint §9).
 */
import type { UnsignedEvent } from "@/features/signing/types";
import {
  KIND_NIP43_MEMBERSHIP_LIST,
  KIND_RELAY_ADMIN_ADD_MEMBER,
  KIND_RELAY_ADMIN_CHANGE_ROLE,
  KIND_RELAY_ADMIN_REMOVE_MEMBER,
} from "./kinds";
import type { NostrFilter, RawNostrEvent } from "./types";

export type RelayMemberRole = "owner" | "admin" | "member";

export interface RelayMember {
  pubkey: string;
  role: RelayMemberRole;
}

const HEX64 = /^[0-9a-f]{64}$/;

function isRelayMemberRole(value: string | undefined): value is RelayMemberRole {
  return value === "owner" || value === "admin" || value === "member";
}

/** kind:13534 tags are `["member", pubkey, role]`. Also tolerates a legacy `["p", pubkey, _, role]`
 *  shape (mirrors ../buzz/desktop's own parser) in case an older relay build emits it. */
export function parseRelayMembershipListEvent(event: RawNostrEvent): RelayMember[] {
  const seen = new Set<string>();
  const members: RelayMember[] = [];

  for (const tag of event.tags) {
    const [name, rawPubkey, roleOrSpare, legacyRole] = tag;
    if (name !== "member" && name !== "p") continue;
    if (!rawPubkey) continue;

    const pubkey = rawPubkey.trim().toLowerCase();
    if (!HEX64.test(pubkey) || seen.has(pubkey)) continue;
    seen.add(pubkey);

    const rawRole = name === "member" ? roleOrSpare : legacyRole;
    members.push({ pubkey, role: isRelayMemberRole(rawRole) ? rawRole : "member" });
  }

  return members;
}

export function relayMembershipListFilter(): NostrFilter {
  return { kinds: [KIND_NIP43_MEMBERSHIP_LIST], limit: 1 };
}

export function buildAddRelayMemberEvent(params: {
  pubkey: string;
  role: RelayMemberRole;
}): UnsignedEvent {
  return {
    kind: KIND_RELAY_ADMIN_ADD_MEMBER,
    content: "",
    tags: [
      ["p", params.pubkey],
      ["role", params.role],
    ],
  };
}

export function buildRemoveRelayMemberEvent(params: { pubkey: string }): UnsignedEvent {
  return {
    kind: KIND_RELAY_ADMIN_REMOVE_MEMBER,
    content: "",
    tags: [["p", params.pubkey]],
  };
}

export function buildChangeRelayMemberRoleEvent(params: {
  pubkey: string;
  role: RelayMemberRole;
}): UnsignedEvent {
  return {
    kind: KIND_RELAY_ADMIN_CHANGE_ROLE,
    content: "",
    tags: [
      ["p", params.pubkey],
      ["role", params.role],
    ],
  };
}
