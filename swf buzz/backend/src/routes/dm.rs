//! Phase 8 (DECISIONS.md D10): direct messages -- HTTP write/read and
//! realtime fan-out over the same `/ws` connection channel messages use.
//! `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §1 rows "Direct messages" and
//! "Profile -> DM". The last backend phase of the no-Nostr migration --
//! see docs/DM_DESIGN.md for the schema/race-safety rationale.
//!
//! `sender_user_id` always comes from the caller's authenticated session
//! (`AuthUser`), never the request body -- same rule as channel messages
//! (`routes::messages`). Every DM action (list/send/read) requires the
//! caller to actually be a `dm_participants` row for that conversation;
//! the one exception is `POST /api/dm/open`, where the caller supplies the
//! *other* participant(s) to open a conversation with -- but the caller
//! themselves must always be included in that set, so `open` can never be
//! used to add a third party to a conversation the caller isn't part of.

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::models::{DmConversation, DmMessage};
use crate::realtime::{NewDmMessageEvent, RealtimeEvent};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use uuid::Uuid;

/// Same bound as channel messages (`routes::messages::MAX_CONTENT_LEN`) --
/// one consistent content-length rule across both message stores rather
/// than two numbers to keep in sync.
const MAX_CONTENT_LEN: usize = 8_000;

#[derive(Serialize)]
pub struct DmConversationView {
    pub id: Uuid,
    /// Derived from `DmConversation::participant_key` (already the
    /// canonical sorted participant list) rather than a second query --
    /// see docs/DM_DESIGN.md §2. `participant_key` itself is never
    /// serialized (the model's `#[serde(skip)]`); this is the one place
    /// its contents reach an API response, parsed back into real ids.
    pub participant_ids: Vec<Uuid>,
    pub created_at: DateTime<Utc>,
}

impl From<DmConversation> for DmConversationView {
    fn from(c: DmConversation) -> Self {
        let participant_ids = c
            .participant_key
            .split(',')
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        DmConversationView {
            id: c.id,
            participant_ids,
            created_at: c.created_at,
        }
    }
}

#[derive(Serialize)]
pub struct DmMessageView {
    pub id: Uuid,
    pub seq: i64,
    pub conversation_id: Uuid,
    pub sender_user_id: Uuid,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<DmMessage> for DmMessageView {
    fn from(m: DmMessage) -> Self {
        DmMessageView {
            id: m.id,
            seq: m.seq,
            conversation_id: m.conversation_id,
            sender_user_id: m.sender_user_id,
            content: m.content,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

async fn require_participant(
    state: &AppState,
    conversation_id: Uuid,
    caller_id: Uuid,
) -> Result<(), ApiError> {
    let exists = state.dms.find_conversation(conversation_id).await?;
    if exists.is_none() {
        return Err(ApiError::NotFound("conversation not found"));
    }
    if !state.dms.is_participant(conversation_id, caller_id).await? {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct OpenDmRequest {
    pub user_ids: Vec<Uuid>,
}

/// `POST /api/dm/open` — idempotent find-or-create by exact participant
/// set. The caller must be one of `user_ids`; at least 2 distinct
/// participants are required (a "DM with yourself only" isn't a
/// conversation). Race-safe under concurrent calls for the same set --
/// see `DmRepo::open` / docs/DM_DESIGN.md §2.
pub async fn open_dm(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Json(req): Json<OpenDmRequest>,
) -> Result<Json<DmConversationView>, ApiError> {
    let unique_ids: BTreeSet<Uuid> = req.user_ids.iter().copied().collect();
    if !unique_ids.contains(&caller.id) {
        return Err(ApiError::Validation(
            "you must be one of the conversation's participants",
        ));
    }
    if unique_ids.len() < 2 {
        return Err(ApiError::Validation(
            "a conversation requires at least two distinct participants",
        ));
    }
    let ids: Vec<Uuid> = unique_ids.into_iter().collect();

    // Every participant must be a real user -- otherwise `open` would
    // silently create a conversation with a dangling foreign key that
    // fails later (e.g. when someone tries to list it). Fail fast here
    // instead.
    for &id in &ids {
        if state.users.find_by_id(id).await?.is_none() {
            return Err(ApiError::Validation("unknown participant"));
        }
    }

    let conversation = state.dms.open(&ids).await?;
    Ok(Json(conversation.into()))
}

/// `GET /api/dm` — the caller's own conversations, newest-created first
/// (see docs/DM_DESIGN.md for why "newest-created" rather than
/// "most-recently-active").
pub async fn list_conversations(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
) -> Result<Json<Vec<DmConversationView>>, ApiError> {
    let conversations = state.dms.list_conversations_for_user(caller.id).await?;
    Ok(Json(
        conversations
            .into_iter()
            .map(DmConversationView::from)
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct SendDmRequest {
    pub content: String,
}

/// `POST /api/dm/:id/messages` — requires the caller to be a participant.
/// Publishes a `RealtimeEvent::NewDmMessage` to every connected `/ws`
/// socket whose membership snapshot includes this conversation (see
/// `routes::realtime`).
pub async fn send_dm_message(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(conversation_id): Path<Uuid>,
    Json(req): Json<SendDmRequest>,
) -> Result<Json<DmMessageView>, ApiError> {
    require_participant(&state, conversation_id, caller.id).await?;

    let trimmed = req.content.trim();
    if trimmed.is_empty() {
        return Err(ApiError::Validation("content must not be empty"));
    }
    if trimmed.chars().count() > MAX_CONTENT_LEN {
        return Err(ApiError::Validation("content exceeds the maximum length"));
    }

    let message = state
        .dms
        .create_dm_message(conversation_id, caller.id, trimmed)
        .await?;

    state
        .realtime
        .publish(RealtimeEvent::NewDmMessage(NewDmMessageEvent {
            conversation_id,
            message: message.clone(),
        }));

    Ok(Json(message.into()))
}

#[derive(Deserialize)]
pub struct ListDmMessagesQuery {
    pub before_seq: Option<i64>,
    pub limit: Option<i64>,
}

const DEFAULT_PAGE_LIMIT: i64 = 50;
const MAX_PAGE_LIMIT: i64 = 200;

/// `GET /api/dm/:id/messages?before_seq=&limit=` — requires participancy.
/// Same keyset-pagination convention as `routes::messages::list_messages`
/// (newest-first, `seq` not `created_at`).
pub async fn list_dm_messages(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(conversation_id): Path<Uuid>,
    Query(query): Query<ListDmMessagesQuery>,
) -> Result<Json<Vec<DmMessageView>>, ApiError> {
    require_participant(&state, conversation_id, caller.id).await?;
    let limit = query
        .limit
        .unwrap_or(DEFAULT_PAGE_LIMIT)
        .clamp(1, MAX_PAGE_LIMIT);
    let messages = state
        .dms
        .list_dm_messages(conversation_id, query.before_seq, limit)
        .await?;
    Ok(Json(
        messages.into_iter().map(DmMessageView::from).collect(),
    ))
}
