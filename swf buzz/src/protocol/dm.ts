/**
 * Direct messages — the verified live path only: KIND_DM_OPEN (41010) +
 * KIND_DM_HIDE (41012) + relay-authored KIND_DM_VISIBILITY (30622).
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §8. Once opened, all message/
 * reaction traffic is the ordinary kind:9/kind:7 set scoped by `h` — see
 * protocol/messages.ts and protocol/reactions.ts, not this file.
 *
 * kind:41001 and kind:41011 are UNVERIFIED (no confirmed relay handler) and
 * are intentionally not implemented here — see docs/DECISIONS.md D1.G.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import { KIND_DM_HIDE, KIND_DM_OPEN, KIND_DM_VISIBILITY } from "./kinds";
import type { NostrFilter, RawNostrEvent } from "./types";

/** 1-8 other participants (2-9 total including the caller). */
export function buildDmOpenEvent(otherParticipantPubkeys: string[]): UnsignedEvent {
  if (otherParticipantPubkeys.length < 1 || otherParticipantPubkeys.length > 8) {
    throw new Error("A DM requires 1-8 other participants.");
  }
  return {
    kind: KIND_DM_OPEN,
    content: "",
    tags: otherParticipantPubkeys.map((pubkey) => ["p", pubkey]),
  };
}

/** Hides a DM channel from the sidebar. Re-publish buildDmOpenEvent() with the same participants to unhide. */
export function buildDmHideEvent(dmChannelId: string): UnsignedEvent {
  return { kind: KIND_DM_HIDE, content: "", tags: [["h", dmChannelId]] };
}

export function buildDmVisibilityFilter(myPubkey: string): NostrFilter {
  return { kinds: [KIND_DM_VISIBILITY], "#p": [myPubkey], limit: 1 };
}

/** Parses the relay-signed kind:30622 hidden-DM list for the current viewer. */
export function parseDmVisibilityEvent(event: RawNostrEvent): { hiddenChannelIds: string[] } {
  return {
    hiddenChannelIds: event.tags
      .filter((t) => t[0] === "h")
      .map((t) => t[1])
      .filter((v): v is string => !!v),
  };
}
