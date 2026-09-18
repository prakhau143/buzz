//! Phase 6 (DECISIONS.md D10): channel messages -- HTTP write, cursor-paged
//! history read, and realtime fan-out over `/ws`. Replaces buzz-relay's
//! Nostr transport for messaging entirely (OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md
//! §1 row "Messages") -- not a small delta.
//!
//! `sender_user_id` always comes from the caller's authenticated session
//! (`AuthUser`), never from the request body -- master prompt §20 is
//! explicit and repeated on this point. Posting/reading requires the caller
//! to be an actual *channel* member (not just a community member) -- see
//! `require_channel_membership` below.

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::models::Message;
use crate::realtime::{NewMessageEvent, RealtimeEvent};
use crate::routes::channels::require_channel_and_community_membership;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A message's maximum length in characters. Chosen to be generous for a
/// chat message while ruling out pathological payloads; not derived from
/// any old-Buzz source value (none was found for this) -- see
/// docs/MESSAGING_DESIGN.md.
const MAX_CONTENT_LEN: usize = 8_000;

#[derive(Serialize)]
pub struct MessageView {
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

impl From<Message> for MessageView {
    fn from(m: Message) -> Self {
        MessageView {
            id: m.id,
            seq: m.seq,
            channel_id: m.channel_id,
            sender_user_id: m.sender_user_id,
            content: m.content,
            parent_message_id: m.parent_message_id,
            root_message_id: m.root_message_id,
            depth: m.depth,
            reply_count: m.reply_count,
            descendant_count: m.descendant_count,
            last_reply_at: m.last_reply_at,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

/// Confirms the caller is both a community member (via
/// `require_channel_and_community_membership`, Phase 5) AND an actual
/// *channel* member -- posting/reading messages requires real
/// `channel_members` standing, not just "some role in the parent
/// community" (community role never substitutes for channel role,
/// DECISIONS.md D10).
async fn require_channel_membership(
    state: &AppState,
    channel_id: Uuid,
    caller_id: Uuid,
) -> Result<(), ApiError> {
    require_channel_and_community_membership(state, channel_id, caller_id).await?;
    let channel_role = state
        .channels
        .find_channel_role(channel_id, caller_id)
        .await?;
    if channel_role.is_none() {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    /// Phase 7: if present, this message is a reply. The parent must exist
    /// and be in the same channel; `root_message_id`/`depth` are always
    /// server-computed from it, never accepted from the client -- see
    /// `MessageRepo::create_message` and docs/THREADS_DESIGN.md.
    #[serde(default)]
    pub parent_message_id: Option<Uuid>,
}

/// `POST /api/channels/:id/messages` — requires channel membership. On
/// success, publishes a `NewMessageEvent` to every connected `/ws` socket
/// whose membership snapshot includes this channel (see
/// docs/MESSAGING_DESIGN.md).
pub async fn send_message(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Json<MessageView>, ApiError> {
    require_channel_membership(&state, channel_id, caller.id).await?;

    let trimmed = req.content.trim();
    if trimmed.is_empty() {
        return Err(ApiError::Validation("content must not be empty"));
    }
    if trimmed.chars().count() > MAX_CONTENT_LEN {
        return Err(ApiError::Validation("content exceeds the maximum length"));
    }

    let message = state
        .messages
        .create_message(channel_id, caller.id, trimmed, req.parent_message_id)
        .await?;

    state
        .realtime
        .publish(RealtimeEvent::NewMessage(NewMessageEvent {
            channel_id,
            message: message.clone(),
        }));

    Ok(Json(message.into()))
}

#[derive(Deserialize)]
pub struct ListMessagesQuery {
    pub before_seq: Option<i64>,
    pub limit: Option<i64>,
}

const DEFAULT_PAGE_LIMIT: i64 = 50;
const MAX_PAGE_LIMIT: i64 = 200;

/// `GET /api/channels/:id/messages?before_seq=&limit=` — requires channel
/// membership. Newest-first; pass the `seq` of the last item in a page as
/// `before_seq` to fetch the next (older) page. See
/// docs/MESSAGING_DESIGN.md for why `seq`, not `created_at`, is the
/// pagination key.
pub async fn list_messages(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<Json<Vec<MessageView>>, ApiError> {
    require_channel_membership(&state, channel_id, caller.id).await?;
    let limit = query
        .limit
        .unwrap_or(DEFAULT_PAGE_LIMIT)
        .clamp(1, MAX_PAGE_LIMIT);
    let messages = state
        .messages
        .list_messages(channel_id, query.before_seq, limit)
        .await?;
    Ok(Json(messages.into_iter().map(MessageView::from).collect()))
}

#[derive(Serialize)]
pub struct ThreadView {
    pub root: MessageView,
    pub replies: Vec<MessageView>,
}

#[derive(Deserialize)]
pub struct ThreadRepliesQuery {
    pub after_seq: Option<i64>,
    pub limit: Option<i64>,
}

/// `GET /api/messages/:rootId/thread?after_seq=&limit=` — requires
/// membership in the root message's channel (the same-channel invariant on
/// every reply means checking the root's channel is sufficient for the
/// whole thread). Replies are oldest-first (`seq ASC`) — the natural
/// reading order for a thread, the opposite direction from the channel
/// timeline's newest-first (see docs/THREADS_DESIGN.md).
pub async fn get_thread(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(root_id): Path<Uuid>,
    Query(query): Query<ThreadRepliesQuery>,
) -> Result<Json<ThreadView>, ApiError> {
    let root = state
        .messages
        .find_message(root_id)
        .await?
        .ok_or(ApiError::NotFound("thread root message not found"))?;
    require_channel_membership(&state, root.channel_id, caller.id).await?;

    let limit = query
        .limit
        .unwrap_or(DEFAULT_PAGE_LIMIT)
        .clamp(1, MAX_PAGE_LIMIT);
    let replies = state
        .messages
        .list_thread_replies(root_id, query.after_seq, limit)
        .await?;

    Ok(Json(ThreadView {
        root: root.into(),
        replies: replies.into_iter().map(MessageView::from).collect(),
    }))
}

#[derive(Deserialize)]
pub struct ThreadSummariesQuery {
    pub ids: String,
}

#[derive(Serialize)]
pub struct ThreadSummaryView {
    pub root_message_id: Uuid,
    pub reply_count: i32,
    pub descendant_count: i32,
    pub last_reply_at: Option<DateTime<Utc>>,
}

/// `GET /api/messages/thread-summaries?ids=id1,id2,...` — batched
/// `{reply_count, descendant_count, last_reply_at}` lookup for rendering
/// "💬 N replies" badges without an N+1 query per message. Silently omits
/// any id that doesn't exist, belongs to a channel the caller isn't a
/// member of, or isn't itself a thread root/parent (has no replies) —
/// this is a best-effort batch lookup, not an all-or-nothing request, so a
/// caller can pass every visible message id in a channel and just get
/// summaries back for the ones that are actually threads.
pub async fn thread_summaries(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Query(query): Query<ThreadSummariesQuery>,
) -> Result<Json<Vec<ThreadSummaryView>>, ApiError> {
    let ids: Vec<Uuid> = query
        .ids
        .split(',')
        .filter(|s| !s.trim().is_empty())
        .filter_map(|s| Uuid::parse_str(s.trim()).ok())
        .collect();

    let mut visible_ids = Vec::with_capacity(ids.len());
    for id in ids {
        let Some(msg) = state.messages.find_message(id).await? else {
            continue;
        };
        if require_channel_membership(&state, msg.channel_id, caller.id)
            .await
            .is_ok()
        {
            visible_ids.push(id);
        }
    }

    let summaries = state.messages.thread_summaries(&visible_ids).await?;
    Ok(Json(
        summaries
            .into_iter()
            .map(|s| ThreadSummaryView {
                root_message_id: s.root_message_id,
                reply_count: s.reply_count,
                descendant_count: s.descendant_count,
                last_reply_at: s.last_reply_at,
            })
            .collect(),
    ))
}
