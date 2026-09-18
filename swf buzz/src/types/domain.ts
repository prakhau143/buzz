/**
 * Domain models used by the UI/composable layer. These are protocol-agnostic —
 * conversion from raw Nostr events happens exclusively in `src/protocol/`.
 * See docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md for the wire-format source of truth.
 */

export type ConnectionStatus =
  "connecting" | "connected" | "disconnected" | "reconnecting" | "auth_failed" | "error";

export interface UserProfile {
  pubkey: string;
  displayName: string;
  avatarUrl?: string;
  isAgent: boolean;
}

export type ChannelVisibility = "open" | "private";
export type ChannelType = "stream" | "forum" | "dm";

export interface Channel {
  id: string;
  name: string;
  about?: string;
  topic?: string;
  visibility: ChannelVisibility;
  channelType: ChannelType;
  archived: boolean;
  /** Only set when channelType === "dm" */
  dmParticipants?: string[];
}

export type MessageStatus = "sending" | "sent" | "failed";

export interface ThreadMarkers {
  rootId?: string;
  parentId?: string;
}

export interface Reaction {
  emoji: string;
  emojiUrl?: string;
  count: number;
  reactedByMe: boolean;
  reactorPubkeys: string[];
}

export interface Message {
  id: string;
  channelId: string;
  authorPubkey: string;
  content: string;
  createdAt: number;
  thread: ThreadMarkers;
  mentions: string[];
  reactions: Reaction[];
  status: MessageStatus;
  isSystemMessage: boolean;
  isAgentMessage: boolean;
}

export interface ThreadSummary {
  rootId: string;
  replyCount: number;
  lastReplyAt?: number;
  participants: string[];
}

export interface Member {
  pubkey: string;
  role: "owner" | "admin" | "member";
  profile?: UserProfile;
}

export type RelayMemberRole = "owner" | "admin" | "member";

/**
 * A community-wide (relay-wide) member — distinct from `Member` above, which is
 * scoped to one channel. See docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2a and
 * docs/ROLE_PERMISSION_AUDIT.md §1 for why these are two separate role planes.
 */
export interface RelayMember {
  pubkey: string;
  role: RelayMemberRole;
  profile?: UserProfile;
}

export type AgentActivityState = "idle" | "working";

export interface AgentActivity {
  agentPubkey: string;
  state: AgentActivityState;
  detail?: string;
  source: "observer_frame" | "typing_fallback";
}

export interface Invite {
  id: string;
  channelId: string;
  createdByPubkey: string;
  createdAt: number;
}

export interface PresenceInfo {
  pubkey: string;
  status: "online" | "away" | "offline";
  updatedAt: number;
}

/** A queued community moderation report — `GET /moderation/reports` row. */
export interface ModerationReportSummary {
  id: string;
  reportEventId: string;
  reporterPubkey: string;
  targetKind: "event" | "pubkey" | "blob";
  target: string;
  channelId: string | null;
  reportType: string;
  note: string | null;
  status: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  actionId: string | null;
  createdAt: string;
}

/** A community moderation audit entry — `GET /moderation/audit` row. */
export interface ModerationActionRecord {
  id: string;
  actorPubkey: string;
  action: string;
  targetPubkey: string | null;
  targetEventId: string | null;
  channelId: string | null;
  reasonCode: string | null;
  publicReason: string | null;
  privateReason: string | null;
  createdAt: string;
}

/** An active ban/timeout — `GET /moderation/restricted` row. */
export interface CommunityRestriction {
  pubkey: string;
  banned: boolean;
  banExpiresAt: string | null;
  banReason: string | null;
  mutedUntil: string | null;
  muteReason: string | null;
  actorPubkey: string;
  updatedAt: string;
}

// --- Deployment-wide admin console (/api/admin/v1/*) — see
// docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §11. A separate role plane
// (platform Operator/Moderator) from the community owner/admin/member above.

export interface AdminProbeResult {
  status: string;
  authMode: "nip98" | "disabled";
  role: "operator" | "moderator" | null;
  source: "config" | "owner_fallback" | "db" | null;
  canAct: boolean;
  canStaff: boolean;
}

/** A deployment-wide report — `GET /api/admin/v1/reports` row. */
export interface AdminReport {
  id: string;
  communityId: string;
  communityHost: string;
  reportEventId: string;
  reporterPubkey: string;
  targetKind: "event" | "pubkey" | "blob";
  target: string;
  channelId: string | null;
  reportType: string;
  note: string | null;
  status: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  actionId: string | null;
  createdAt: string;
}

/** Deployment-wide feedback — `GET /api/admin/v1/feedback` row. */
export interface AdminFeedback {
  id: string;
  communityId: string | null;
  communityHost: string | null;
  submitterPubkey: string;
  category: string | null;
  bodySummary: string;
  status: "new" | "reviewed" | "archived";
  receivedAt: string;
}

/** An entry in the Operator/Moderator roster — `GET /api/admin/v1/operators` row. */
export interface AdminOperatorEntry {
  pubkey: string;
  effectiveRole: "operator" | "moderator";
  sources: string[];
}
