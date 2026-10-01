/**
 * Direct messages — the verified live path only: KIND_DM_OPEN (41010) +
 * KIND_DM_HIDE (41012) + relay-authored KIND_DM_VISIBILITY (30622).
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §8. Once opened, all message/
 * reaction traffic is the ordinary kind:9/kind:7 set scoped by `h` — see
 * protocol/messages.ts and protocol/reactions.ts, not this file.
 *
 * kind:41001 is a dead constant — declared at `crates/buzz-core/src/kind.rs:513`
 * but emitted by nothing in the OLD BUZZ tree — so it stays unimplemented here.
 *
 * kind:41011 is NOT unverified, contrary to what this comment said before
 * 2026-09-23: `crates/buzz-relay/src/handlers/command_executor.rs:431-566`
 * (`handle_dm_add_member`) is a real transactional handler, `is_command_kind()`
 * includes it (`kind.rs:823`), and the CLI ships a sender
 * (`buzz-cli/src/commands/dms.rs:111-126`). It adds participants to a group DM
 * by creating a NEW DM channel, because participant sets are immutable. Left
 * unimplemented by choice, not by uncertainty — see
 * docs/PHASE_4_IMPLEMENTATION_PLAN.md §3 (4E).
 */
import type { UnsignedEvent } from "@/features/signing/types";
import { KIND_DM_HIDE, KIND_DM_OPEN, KIND_DM_VISIBILITY } from "./kinds";
import type { NostrFilter, RawNostrEvent } from "./types";

/**
 * 1-8 other participants (2-9 total including the caller).
 *
 * The `d` tag is a fresh random UUID per call, and is REQUIRED for correctness
 * rather than decoration. Without it the event is `{kind, pubkey, tags,
 * content:""}` with a second-resolution `created_at`, so two opens of the same
 * conversation by the same person within one second hash to the *same event
 * id*. The relay dedups command events by id and answers the loser with the
 * plain string `"duplicate: already processed"` — which carries no
 * `channel_id`, leaving the caller with no conversation to open. That is not
 * hypothetical: a retrying client collides with itself. A unique `d` makes
 * every open a distinct event, so the relay always executes `open_dm` (itself
 * find-or-create on the participant set) and always answers with the channel
 * id. OLD BUZZ's own CLI does exactly this — `buzz-cli/src/commands/dms.rs:58`
 * `Uuid::new_v4()` pushed as `["d", …]`.
 */
export function buildDmOpenEvent(otherParticipantPubkeys: string[]): UnsignedEvent {
  if (otherParticipantPubkeys.length < 1 || otherParticipantPubkeys.length > 8) {
    throw new Error("A DM requires 1-8 other participants.");
  }
  return {
    kind: KIND_DM_OPEN,
    content: "",
    tags: [
      ...otherParticipantPubkeys.map((pubkey) => ["p", pubkey]),
      ["d", crypto.randomUUID()],
    ],
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
