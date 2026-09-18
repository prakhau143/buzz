//! Repository traits. Two implementations exist: `postgres` (real, used in
//! production -- exercised against a live `swf_buzz` Postgres database via
//! a manual HTTP smoke test as of Phase 6, see project memory; not covered
//! by this crate's own automated `cargo test` suite, which still runs
//! against `memory` only) and `memory` (an in-process test double used to
//! unit-test route-handler logic -- idempotent upsert, session
//! expiry/revocation -- without requiring a live Postgres instance in CI).

pub mod memory;
pub mod postgres;

use crate::invite_authz::InviteState;
use crate::models::{
    Channel, ChannelMember, ChannelVisibility, Community, CommunityMember, DmConversation,
    DmMessage, Invite, Message, Role, Session, ThreadSummary, User,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[async_trait]
pub trait UserRepo: Send + Sync {
    /// Finds a user by `okta_sub`, updating `email`/`display_name` if
    /// changed, or inserts a new row. Same `okta_sub` logging in twice must
    /// always resolve to the same `User::id` — this is the identity
    /// invariant the whole no-Nostr migration depends on (DECISIONS.md D10).
    async fn upsert_by_okta_sub(
        &self,
        okta_sub: &str,
        email: Option<&str>,
        display_name: Option<&str>,
    ) -> Result<User, sqlx::Error>;

    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, sqlx::Error>;
}

/// Phase 3 (DECISIONS.md D10): community membership/roles. The authorization
/// *decision* (who may add/remove/change-role) lives in `community_authz.rs`
/// — this trait only stores/retrieves rows, it never decides anything.
#[async_trait]
pub trait CommunityRepo: Send + Sync {
    async fn create_community(
        &self,
        name: &str,
        owner_user_id: Uuid,
    ) -> Result<Community, sqlx::Error>;

    async fn community_exists(&self, community_id: Uuid) -> Result<bool, sqlx::Error>;

    /// The caller's own role in a community, or `None` if they aren't a
    /// member — feeds directly into `community_authz`'s `acting_role`.
    async fn find_role(
        &self,
        community_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<Role>, sqlx::Error>;

    async fn list_members(&self, community_id: Uuid) -> Result<Vec<CommunityMember>, sqlx::Error>;

    async fn add_member(
        &self,
        community_id: Uuid,
        user_id: Uuid,
        role: Role,
    ) -> Result<CommunityMember, sqlx::Error>;

    /// `None` if the target wasn't a member to begin with.
    async fn update_role(
        &self,
        community_id: Uuid,
        user_id: Uuid,
        new_role: Role,
    ) -> Result<Option<CommunityMember>, sqlx::Error>;

    /// `true` if a row was actually removed.
    async fn remove_member(&self, community_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error>;
}

/// The result of an atomic claim attempt (`InviteRepo::claim`). Never
/// constructed by hand outside a repo impl -- it's the one channel through
/// which "what state was this invite really in, and what happened" reaches
/// the HTTP handler, which maps each variant to the exact status code the
/// master prompt specifies (§14).
#[derive(Debug, Clone)]
pub enum ClaimOutcome {
    NotFound,
    /// Never `InviteState::Valid` in practice -- a valid invite falls
    /// through to `AlreadyMember`/`Joined` instead.
    Invalid(InviteState),
    AlreadyMember {
        community: Community,
        role: Role,
    },
    Joined {
        community: Community,
        membership: CommunityMember,
    },
}

/// Phase 4 (DECISIONS.md D10): community invites. `claim` is the one method
/// that must be internally atomic -- see each impl for how (Postgres:
/// `SELECT ... FOR UPDATE` inside a transaction; in-memory: a single mutex
/// held for the whole critical section). Every other method is a plain
/// single-row operation with no atomicity requirement of its own.
#[async_trait]
pub trait InviteRepo: Send + Sync {
    #[allow(clippy::too_many_arguments)]
    async fn create_invite(
        &self,
        community_id: Uuid,
        token_hash: &str,
        created_by_user_id: Uuid,
        expires_at: DateTime<Utc>,
        max_uses: Option<i32>,
    ) -> Result<Invite, sqlx::Error>;

    async fn find_by_id(&self, id: Uuid) -> Result<Option<Invite>, sqlx::Error>;

    /// `true` if an invite matching `(id, community_id)` exists (whether or
    /// not it was already revoked -- idempotent).
    async fn revoke(&self, id: Uuid, community_id: Uuid) -> Result<bool, sqlx::Error>;

    /// Public, unauthenticated preview: the invite's current state plus its
    /// community's display name only -- never `community_id` or any other
    /// internal identifier (see docs/INVITE_DESIGN.md). `None` = no invite
    /// with this token exists at all.
    async fn preview_by_token_hash(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<(InviteState, String)>, sqlx::Error>;

    /// The atomic claim transaction (master prompt §12/§13).
    async fn claim(
        &self,
        token_hash: &str,
        claiming_user_id: Uuid,
        now: DateTime<Utc>,
    ) -> Result<ClaimOutcome, sqlx::Error>;
}

/// Phase 5 (DECISIONS.md D10): channels + channel membership -- a
/// permission plane separate from `CommunityRepo`. The authorization
/// *decision* lives in `channel_authz.rs`; this trait only stores/retrieves
/// rows.
#[async_trait]
pub trait ChannelRepo: Send + Sync {
    async fn create_channel(
        &self,
        community_id: Uuid,
        name: &str,
        visibility: ChannelVisibility,
        description: Option<&str>,
        creator_user_id: Uuid,
    ) -> Result<Channel, sqlx::Error>;

    async fn find_channel(&self, channel_id: Uuid) -> Result<Option<Channel>, sqlx::Error>;

    /// Channels in `community_id` visible to `caller_id`: every `open`
    /// channel, plus any `private` channel the caller already belongs to.
    async fn list_visible_channels(
        &self,
        community_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<Channel>, sqlx::Error>;

    /// The caller's own role in a channel, or `None` if they aren't a
    /// member -- feeds directly into `channel_authz`'s `actor_channel_role`.
    async fn find_channel_role(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<Role>, sqlx::Error>;

    async fn list_channel_members(
        &self,
        channel_id: Uuid,
    ) -> Result<Vec<ChannelMember>, sqlx::Error>;

    async fn add_channel_member(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
        role: Role,
    ) -> Result<ChannelMember, sqlx::Error>;

    /// `None` if the target wasn't a channel member to begin with.
    async fn update_channel_role(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
        new_role: Role,
    ) -> Result<Option<ChannelMember>, sqlx::Error>;

    /// `true` if a row was actually removed.
    async fn remove_channel_member(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, sqlx::Error>;

    /// Every channel `user_id` currently belongs to -- used only to build
    /// the realtime WebSocket subscription's initial channel-membership
    /// snapshot at connect time (`routes::realtime`), never for HTTP
    /// authorization decisions (those always re-check a specific channel).
    async fn list_channel_ids_for_user(&self, user_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error>;
}

/// Hard cap on `Message::depth`, matching old Buzz's own
/// `resolve_nip10_thread_meta` limit (`ingest.rs:879-882`,
/// `OLD_BUZZ_COMMUNITY_CHANNEL_DM_BEHAVIOR_AUDIT.md` §14).
pub const THREAD_DEPTH_LIMIT: i32 = 100;

/// Domain-level failure modes for `MessageRepo::create_message` when a
/// `parent_message_id` is given -- distinct from `Database` (an actual I/O
/// failure) so the route handler can map each to the right HTTP status
/// (404/422) instead of a generic 500. Validated *inside* the same
/// operation that performs the insert (not pre-checked by the caller) so
/// Postgres can enforce it under a row lock -- see
/// `PostgresRepo::create_message` and docs/THREADS_DESIGN.md.
#[derive(Debug, thiserror::Error)]
pub enum CreateMessageError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("parent message not found")]
    ParentNotFound,
    #[error("parent message belongs to a different channel")]
    CrossChannelParent,
    #[error("thread depth limit exceeded")]
    DepthLimitExceeded,
}

/// Phase 6/7 (DECISIONS.md D10): channel messages, including threaded
/// replies. `sender_user_id` on write always comes from the caller's
/// authenticated session (`AuthUser`), never from the request body -- this
/// trait's `create_message` signature doesn't even accept a
/// client-suppliable sender, so the handler layer can't get this wrong.
#[async_trait]
pub trait MessageRepo: Send + Sync {
    /// `parent_message_id = None` writes an ordinary top-level message
    /// (`depth = 0`, no counters touched). `Some(parent)` writes a reply:
    /// validates the parent exists and is in `channel_id` (else
    /// `CrossChannelParent`/`ParentNotFound`), computes `depth =
    /// parent.depth + 1` (else `DepthLimitExceeded` past the cap), resolves
    /// `root_message_id` to the parent's own root (or the parent itself if
    /// the parent has none), and atomically increments the parent's
    /// `reply_count` and the root's `descendant_count`/`last_reply_at` in
    /// the same transaction as the insert.
    async fn create_message(
        &self,
        channel_id: Uuid,
        sender_user_id: Uuid,
        content: &str,
        parent_message_id: Option<Uuid>,
    ) -> Result<Message, CreateMessageError>;

    /// Keyset-paginated history, newest-first (`seq DESC`). `before_seq =
    /// None` returns the most recent `limit` messages; `Some(seq)` returns
    /// the next `limit` messages strictly older than `seq` -- pass the
    /// `seq` of the last item in the previous page to page backwards in
    /// time. Race-free and gap/duplicate-free regardless of concurrent
    /// inserts, since `seq` is a monotonic sequence, not a timestamp.
    async fn list_messages(
        &self,
        channel_id: Uuid,
        before_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<Message>, sqlx::Error>;

    async fn find_message(&self, message_id: Uuid) -> Result<Option<Message>, sqlx::Error>;

    /// A thread's replies only (the root itself is not included -- callers
    /// that want the root fetch it separately via `find_message`),
    /// oldest-first (`seq ASC`, the natural reading order for a thread,
    /// deliberately the opposite direction from `list_messages`'s
    /// newest-first channel timeline -- see docs/THREADS_DESIGN.md).
    /// `after_seq = None` returns the first `limit` replies; `Some(seq)`
    /// returns the next `limit` replies strictly newer than `seq`.
    async fn list_thread_replies(
        &self,
        root_message_id: Uuid,
        after_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<Message>, sqlx::Error>;

    /// Batched `{reply_count, descendant_count, last_reply_at}` lookup for
    /// multiple thread roots in one call -- avoids an N+1 query per
    /// rendered reply-count badge. Silently omits ids that don't exist;
    /// the route handler is responsible for filtering to ids the caller is
    /// actually authorized to see.
    async fn thread_summaries(
        &self,
        root_message_ids: &[Uuid],
    ) -> Result<Vec<ThreadSummary>, sqlx::Error>;
}

#[async_trait]
pub trait SessionRepo: Send + Sync {
    async fn create(
        &self,
        user_id: Uuid,
        token_hash: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<Session, sqlx::Error>;

    /// Returns the session and its owning user only if the session exists
    /// AND is currently valid (`is_valid`) — an expired or revoked row is
    /// treated identically to "not found" by every caller, never
    /// distinguished, so a caller can't be tricked into branching on stale
    /// session metadata.
    async fn find_valid_by_token_hash(
        &self,
        token_hash: &str,
    ) -> Result<Option<(Session, User)>, sqlx::Error>;

    async fn revoke_by_token_hash(&self, token_hash: &str) -> Result<(), sqlx::Error>;
}

/// Builds the canonical dedup key for a participant set: sort the ids,
/// join with `,`. Order-independent (the caller can pass participants in
/// any order and always get the same key back) and shared by every
/// `DmRepo` impl so "what counts as the same conversation" can't drift
/// between `memory` and `postgres`.
pub fn dm_participant_key(participant_ids: &[Uuid]) -> String {
    let mut sorted: Vec<String> = participant_ids.iter().map(Uuid::to_string).collect();
    sorted.sort();
    sorted.join(",")
}

/// Phase 8 (DECISIONS.md D10): direct messages -- conversations,
/// participants, and their own flat (non-threaded, no channel) message
/// stream. See docs/DM_DESIGN.md.
#[async_trait]
pub trait DmRepo: Send + Sync {
    /// Race-safe find-or-create by exact participant set. Two concurrent
    /// calls with the same set (in any order) always resolve to the same
    /// conversation id -- see `dm_participant_key` and
    /// `PostgresRepo::open`'s `ON CONFLICT` for the mechanism.
    async fn open(&self, participant_ids: &[Uuid]) -> Result<DmConversation, sqlx::Error>;

    /// The caller's own conversations, newest-created first. A
    /// simplification, not true "most recently active" ordering (which
    /// would need a denormalized `last_message_at` column) -- see
    /// docs/DM_DESIGN.md.
    async fn list_conversations_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<DmConversation>, sqlx::Error>;

    async fn find_conversation(
        &self,
        conversation_id: Uuid,
    ) -> Result<Option<DmConversation>, sqlx::Error>;

    async fn is_participant(
        &self,
        conversation_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, sqlx::Error>;

    /// Every conversation id `user_id` currently participates in -- used
    /// only to build the realtime `/ws` subscription's initial DM
    /// membership snapshot at connect time, same pattern as
    /// `ChannelRepo::list_channel_ids_for_user`.
    async fn list_conversation_ids_for_user(&self, user_id: Uuid)
        -> Result<Vec<Uuid>, sqlx::Error>;

    async fn create_dm_message(
        &self,
        conversation_id: Uuid,
        sender_user_id: Uuid,
        content: &str,
    ) -> Result<DmMessage, sqlx::Error>;

    /// Keyset-paginated, newest-first -- identical convention to
    /// `MessageRepo::list_messages`.
    async fn list_dm_messages(
        &self,
        conversation_id: Uuid,
        before_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<DmMessage>, sqlx::Error>;
}
