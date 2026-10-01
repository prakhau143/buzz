/**
 * Verified kind registry — mirrors docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md exactly.
 * Do not add a kind here without a source citation in that document.
 */

// Channel metadata
export const KIND_NIP29_CREATE_GROUP = 9007;
export const KIND_NIP29_EDIT_METADATA = 9002;
export const KIND_NIP29_GROUP_METADATA = 39000;

// Channel membership
export const KIND_NIP29_PUT_USER = 9000;
export const KIND_NIP29_REMOVE_USER = 9001;
export const KIND_NIP29_JOIN_REQUEST = 9021;
export const KIND_NIP29_LEAVE_REQUEST = 9022;
export const KIND_NIP29_GROUP_ADMINS = 39001;
export const KIND_NIP29_GROUP_MEMBERS = 39002;
export const KIND_MEMBER_ADDED_NOTIFICATION = 44100;
export const KIND_MEMBER_REMOVED_NOTIFICATION = 44101;

// Community (relay-wide) membership — NIP-43, distinct from per-channel NIP-29
// membership above. Verified against ../buzz/crates/buzz-core/src/kind.rs:389-398
// and ../buzz/crates/buzz-db/src/store/relay_members.rs:1013-1024 (exact tag shapes).
export const KIND_RELAY_ADMIN_ADD_MEMBER = 9030;
export const KIND_RELAY_ADMIN_REMOVE_MEMBER = 9031;
export const KIND_RELAY_ADMIN_CHANGE_ROLE = 9032;
export const KIND_NIP43_MEMBERSHIP_LIST = 13534;
/** Community icon (owner/admin; `["icon", dataURL|https]`) — docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §12. */
export const KIND_RELAY_ADMIN_SET_ICON = 9033;

// Settings & feedback — docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §12.
/** Product feedback: sidecarred by the relay into `product_feedback`, never stored/fanned out. */
export const KIND_PRODUCT_FEEDBACK = 42000;
/** NIP-30 emoji set; Buzz uses one per author with `d = "buzz:custom-emoji"`. */
export const KIND_EMOJI_SET = 30030;
export const CUSTOM_EMOJI_SET_D_TAG = "buzz:custom-emoji";

// Channel messages
export const KIND_STREAM_MESSAGE = 9;
export const KIND_STREAM_MESSAGE_V2 = 40002;
export const KIND_SYSTEM_MESSAGE = 40099;
/** SWF Buzz's renderable message kind set (mirrors desktop/src/shared/constants/kinds.ts:91-96). */
export const RENDERABLE_MESSAGE_KINDS = [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2] as const;

/**
 * Message edit. Tags `h`=channel, `e`=target event id; content is the new text.
 * The relay enforces authorship itself (`ingest.rs` `validate_edit_ownership`):
 * only the target's effective author — or the owning human of an agent author —
 * may edit, and a non-member of a private channel is refused even for their own
 * old message. Client-side gating is therefore UX, never the security boundary.
 * Verified: ../buzz/crates/buzz-core/src/kind.rs:483,
 * ../buzz/desktop/src-tauri/src/events.rs:359 (`build_message_edit`).
 */
export const KIND_STREAM_MESSAGE_EDIT = 40003;

/**
 * NIP-29 channel delete-event — the ADMIN delete path.
 *
 * Distinct from KIND_DELETION (5): kind:5 is the author's own NIP-09
 * retraction, kind:9005 additionally admits a channel owner/admin deleting
 * somebody else's message (`side_effects.rs:569-655`). Sending kind:5 with a
 * role check is the classic wrong implementation — the relay would refuse it,
 * because kind:5 is gated on authorship alone.
 * Verified: ../buzz/crates/buzz-core/src/kind.rs:341,
 * ../buzz/crates/buzz-relay/src/handlers/moderation_authz.rs:31.
 */
export const KIND_NIP29_DELETE_EVENT = 9005;

/**
 * Conversation pin — SWF's ONE pin representation (docs/PHASE_G_PINNED_MESSAGES_EVERYONE.md).
 * Tags `h` = channel / DM channel, `e` = the pinned message, `action` = "pin" |
 * "unpin", optional `author` = the pinned message's author (a claim, verified
 * against the message whenever it is loaded). The kind already exists in the
 * relay's allow-list — `KIND_STREAM_MESSAGE_PINNED`, h-scoped, membership-gated —
 * but the relay applies NO role check to it, so every reader resolves the
 * active pin with `features/pins/pinModel.ts`, which drops unauthorized pins.
 * Verified: ../buzz/crates/buzz-core/src/kind.rs:484-485,
 * ../buzz/crates/buzz-relay/src/handlers/ingest.rs:477,713.
 */
export const KIND_STREAM_MESSAGE_PINNED = 40004;

// Reactions
export const KIND_REACTION = 7;

// Standard NIP-09 deletion — generic self-authored retraction of any event by
// its id. Verified against ../buzz/crates/buzz-core/src/kind.rs:56 and its use
// for reaction retraction in ../buzz/crates/buzz-relay/src/handlers/side_effects.rs:233
// (`validate_standard_deletion_event`, self-authorship enforced, works for any kind).
export const KIND_DELETION = 5;

// Moderation — NIP-56 report + community moderation commands. Verified against
// ../buzz/crates/buzz-core/src/kind.rs:327,358-370 and
// ../buzz/desktop/src/shared/api/moderation.ts (exact tag shapes).
export const KIND_REPORT = 1984;
export const KIND_MODERATION_BAN = 9040;
export const KIND_MODERATION_UNBAN = 9041;
export const KIND_MODERATION_TIMEOUT = 9042;
export const KIND_MODERATION_UNTIMEOUT = 9043;
export const KIND_MODERATION_RESOLVE_REPORT = 9044;

// Presence / typing
export const KIND_PRESENCE_UPDATE = 20001;
export const KIND_PRESENCE_SNAPSHOT = 40902;
export const KIND_TYPING_INDICATOR = 20002;

// Invites
export const KIND_NIP29_CREATE_INVITE = 9009;

// Direct messages
export const KIND_DM_OPEN = 41010;
/**
 * Group-DM add-member. This was previously annotated "UNVERIFIED — no confirmed
 * live handler"; that was wrong. The handler is real:
 * ../buzz/crates/buzz-relay/src/handlers/command_executor.rs:431-566.
 */
export const KIND_DM_ADD_MEMBER = 41011;
export const KIND_DM_HIDE = 41012;
/** UNVERIFIED — no confirmed live handler. Do not implement against this. */
export const KIND_DM_CREATED = 41001;
export const KIND_DM_VISIBILITY = 30622;
export const KIND_GIFT_WRAP = 1059;

// Threads (overlays only — never client-submitted)
export const KIND_THREAD_SUMMARY = 39005;
export const KIND_WINDOW_BOUNDS = 39006;

/**
 * NIP-78 / NIP-RS per-client read state, for cross-device read-position sync.
 * Parameterized-replaceable, keyed `(pubkey, kind, d)`; stored globally with
 * `channel_id = NULL` because it is user-owned personal data, not channel data;
 * content is NIP-44 encrypted to the author's own keypair, so the relay stores
 * it without ever interpreting it.
 * Verified: ../buzz/crates/buzz-core/src/kind.rs:70-75.
 */
export const KIND_READ_STATE = 30078;

// Profile / agents
export const KIND_PROFILE_METADATA = 0;
export const KIND_AGENT_PROFILE = 10100;
export const KIND_PERSONA = 30175;
export const KIND_MANAGED_AGENT = 30177;
export const KIND_AGENT_OBSERVER_FRAME = 24200;
export const KIND_AGENT_TURN_METRIC = 44200;
export const KIND_AGENT_ENGRAM = 30174;

// Inbox / feed kinds.
// Verified against ../buzz/crates/buzz-core/src/kind.rs and the feed SQL in
// ../buzz/crates/buzz-db/src/store/feed.rs — see @/protocol/inbox for how the
// relay groups these into feed categories.
/** A reminder attached to a stream message or time (`kind.rs:491`). Feeds "needs action". */
export const KIND_STREAM_REMINDER = 40007;
/** A workflow step waiting for human approval (`kind.rs:578`). Feeds "needs action". */
export const KIND_WORKFLOW_APPROVAL_REQUESTED = 46010;
/** An agent job was requested (`kind.rs:518`). */
export const KIND_JOB_REQUEST = 43001;
/** Progress update for an in-flight agent job (`kind.rs:522`). */
export const KIND_JOB_PROGRESS = 43003;
/** Final result of a completed agent job (`kind.rs:524`). */
export const KIND_JOB_RESULT = 43004;

/** Kinds the relay authors itself — a client must never attempt to publish these. */
export const RELAY_ONLY_KINDS = new Set<number>([
  KIND_NIP29_GROUP_METADATA,
  KIND_NIP29_GROUP_ADMINS,
  KIND_NIP29_GROUP_MEMBERS,
  KIND_MEMBER_ADDED_NOTIFICATION,
  KIND_MEMBER_REMOVED_NOTIFICATION,
  KIND_SYSTEM_MESSAGE,
  KIND_DM_VISIBILITY,
  KIND_THREAD_SUMMARY,
  KIND_WINDOW_BOUNDS,
  KIND_PRESENCE_SNAPSHOT,
  KIND_NIP43_MEMBERSHIP_LIST,
]);
