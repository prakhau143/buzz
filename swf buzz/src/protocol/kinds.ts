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

// Channel messages
export const KIND_STREAM_MESSAGE = 9;
export const KIND_STREAM_MESSAGE_V2 = 40002;
export const KIND_SYSTEM_MESSAGE = 40099;
/** SWF Buzz's renderable message kind set (mirrors desktop/src/shared/constants/kinds.ts:91-96). */
export const RENDERABLE_MESSAGE_KINDS = [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2] as const;

// Reactions
export const KIND_REACTION = 7;

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
/** UNVERIFIED — no confirmed live handler. Do not implement against this. */
export const KIND_DM_ADD_MEMBER = 41011;
export const KIND_DM_HIDE = 41012;
/** UNVERIFIED — no confirmed live handler. Do not implement against this. */
export const KIND_DM_CREATED = 41001;
export const KIND_DM_VISIBILITY = 30622;
export const KIND_GIFT_WRAP = 1059;

// Threads (overlays only — never client-submitted)
export const KIND_THREAD_SUMMARY = 39005;
export const KIND_WINDOW_BOUNDS = 39006;

// Profile / agents
export const KIND_PROFILE_METADATA = 0;
export const KIND_AGENT_PROFILE = 10100;
export const KIND_PERSONA = 30175;
export const KIND_MANAGED_AGENT = 30177;
export const KIND_AGENT_OBSERVER_FRAME = 24200;
export const KIND_AGENT_TURN_METRIC = 44200;
export const KIND_AGENT_ENGRAM = 30174;

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
