use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct User {
    pub id: Uuid,
    pub okta_sub: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    #[serde(skip)]
    pub created_at: DateTime<Utc>,
    #[serde(skip)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

impl Session {
    pub fn is_valid(&self, now: DateTime<Utc>) -> bool {
        self.revoked_at.is_none() && self.expires_at > now
    }
}

/// Community role plane (DECISIONS.md D10, ported from the frontend's
/// `src/features/community-members/permissions.ts`, itself a mirror of
/// `../buzz/crates/buzz-relay/src/handlers/relay_admin.rs`). Three tiers
/// only -- no `guest`/`bot` (those exist at the *channel* plane in old Buzz,
/// a separate later phase, per OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md row 7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Owner,
    Admin,
    Member,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Owner => "owner",
            Role::Admin => "admin",
            Role::Member => "member",
        }
    }
}

impl std::str::FromStr for Role {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "owner" => Ok(Role::Owner),
            "admin" => Ok(Role::Admin),
            "member" => Ok(Role::Member),
            other => Err(format!("unknown role: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Community {
    pub id: Uuid,
    pub name: String,
    #[serde(skip)]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommunityMember {
    pub community_id: Uuid,
    pub user_id: Uuid,
    pub role: Role,
    pub joined_at: DateTime<Utc>,
}

/// Channel visibility (DECISIONS.md D10, Phase 5). Mirrors
/// `src/types/domain.ts`'s `ChannelVisibility`, the type
/// `channelPermissions.ts` gates on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelVisibility {
    Open,
    Private,
}

impl ChannelVisibility {
    pub fn as_str(self) -> &'static str {
        match self {
            ChannelVisibility::Open => "open",
            ChannelVisibility::Private => "private",
        }
    }
}

impl std::str::FromStr for ChannelVisibility {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "open" => Ok(ChannelVisibility::Open),
            "private" => Ok(ChannelVisibility::Private),
            other => Err(format!("unknown channel visibility: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Channel {
    pub id: Uuid,
    pub community_id: Uuid,
    pub name: String,
    pub visibility: ChannelVisibility,
    pub description: Option<String>,
    pub created_by_user_id: Uuid,
    #[serde(skip)]
    pub created_at: DateTime<Utc>,
}

/// Channel-plane role -- a *separate* permission plane from
/// `CommunityMember::role` even though it happens to reuse the same `Role`
/// enum (both are the 3-tier owner/admin/member vocabulary). A community
/// owner is NOT automatically a channel owner/member of any given channel
/// -- only an actual `channel_members` row governs channel authorization
/// (DECISIONS.md D10; see docs/CHANNEL_MEMBERSHIP_DESIGN.md).
#[derive(Debug, Clone, Serialize)]
pub struct ChannelMember {
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub role: Role,
    pub joined_at: DateTime<Utc>,
}

/// Phase 6/7 (DECISIONS.md D10): a channel message. `seq` is the
/// pagination/ordering key (monotonic), distinct from `id` (a random UUID
/// that does not sort chronologically). `root_message_id` always points at
/// the top-level ancestor -- never chains through an intermediate reply --
/// mirroring old Buzz's own ancestry-flattening rule
/// (`OLD_BUZZ_COMMUNITY_CHANNEL_DM_BEHAVIOR_AUDIT.md` §14,
/// `derive_ancestry_from_parent_tags`). `reply_count` (direct children
/// only) and `descendant_count` (every nested reply) are only meaningful
/// on a message that is itself a thread root or parent -- see
/// docs/THREADS_DESIGN.md.
#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: Uuid,
    pub seq: i64,
    pub channel_id: Uuid,
    pub sender_user_id: Uuid,
    pub content: String,
    pub parent_message_id: Option<Uuid>,
    pub root_message_id: Option<Uuid>,
    pub depth: i32,
    pub reply_count: i32,
    pub descendant_count: i32,
    pub last_reply_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Batched aggregate for `GET /api/messages/thread-summaries` -- avoids an
/// N+1 query per rendered "💬 N replies" badge. Mirrors the shape of old
/// Buzz's own `get_thread_summary` (`thread.rs:541-608`), minus the
/// `participants` list (not required by any SWF UI yet; add if needed).
#[derive(Debug, Clone, Serialize)]
pub struct ThreadSummary {
    pub root_message_id: Uuid,
    pub reply_count: i32,
    pub descendant_count: i32,
    pub last_reply_at: Option<DateTime<Utc>>,
}

/// Phase 4 (DECISIONS.md D10): a community invite. The raw bearer token is
/// never stored -- only `token_hash` (see `token::hash`, same convention as
/// `sessions.token_hash`). `max_uses = None` means unlimited.
#[derive(Debug, Clone, Serialize)]
pub struct Invite {
    pub id: Uuid,
    pub community_id: Uuid,
    pub token_hash: String,
    pub created_by_user_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub max_uses: Option<i32>,
    pub used_count: i32,
    pub created_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

/// Phase 8 (DECISIONS.md D10): a direct-message conversation. `id` is the
/// stable identity a client navigates to/subscribes on; `participant_key`
/// is an internal dedup key (see `DmRepo::open`/docs/DM_DESIGN.md) that no
/// API response exposes.
#[derive(Debug, Clone, Serialize)]
pub struct DmConversation {
    pub id: Uuid,
    #[serde(skip)]
    pub participant_key: String,
    pub created_at: DateTime<Utc>,
}

/// A separate message stream from `messages` (channel messages) -- no
/// `channel_id`, no thread columns; a DM has no channel and no threading.
/// See docs/DM_DESIGN.md for why this is its own table rather than a reuse
/// of `messages`.
#[derive(Debug, Clone, Serialize)]
pub struct DmMessage {
    pub id: Uuid,
    pub seq: i64,
    pub conversation_id: Uuid,
    pub sender_user_id: Uuid,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
