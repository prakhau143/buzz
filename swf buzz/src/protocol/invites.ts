/**
 * Invites — KIND_NIP29_CREATE_INVITE (9009). docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §7.
 *
 * UNVERIFIED — DO NOT IMPLEMENT ACCEPTANCE: the relay's side-effect handler for
 * 9009 is a confirmed no-op. This module only builds/parses the create-invite
 * event itself; do not add an "accept invite" flow that implies server-side
 * enforcement (expiry, single-use, revocation) — see docs/DECISIONS.md D4.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import type { Invite } from "@/types/domain";
import { KIND_NIP29_CREATE_INVITE } from "./kinds";
import { firstTagValue, type RawNostrEvent } from "./types";

export function buildCreateInviteEvent(channelId: string): UnsignedEvent {
  return { kind: KIND_NIP29_CREATE_INVITE, content: "", tags: [["h", channelId]] };
}

export function parseInviteEvent(event: RawNostrEvent): Invite | null {
  const channelId = firstTagValue(event, "h");
  if (!channelId) return null;
  return {
    id: event.id,
    channelId,
    createdByPubkey: event.pubkey,
    createdAt: event.created_at,
  };
}
