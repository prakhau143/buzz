//! `GET /ws` — Phase 6 (DECISIONS.md D10) realtime message fan-out.
//!
//! Authenticated via a `?token=` query param, not an `Authorization`
//! header: the browser `WebSocket` constructor cannot set arbitrary headers
//! on the handshake request, so this is the one endpoint in the whole API
//! where the session bearer token travels in the URL rather than a header.
//! Tradeoff and mitigation documented in docs/MESSAGING_DESIGN.md — the
//! token is hashed and validated exactly the same way as every other
//! endpoint (no weaker check), the exposure is "the same bearer secret
//! that already exists" appearing in one additional place (URL/access
//! logs), not a new kind of secret or a new privilege.
//!
//! On successful upgrade, the connection receives every channel message
//! posted to a channel, and every DM message posted to a conversation,
//! that was in the caller's `channel_members`/`dm_participants` roster *at
//! connect time* — a snapshot, not a live-updating subscription set.
//! Joining a new channel or opening a new DM after connecting requires a
//! reconnect to start receiving its messages. Documented limitation, not
//! silently assumed away.

use crate::error::ApiError;
use crate::realtime::RealtimeEvent;
use crate::state::AppState;
use crate::token;
use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use serde::Deserialize;
use std::collections::HashSet;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct RealtimeQuery {
    pub token: String,
}

pub async fn upgrade(
    State(state): State<AppState>,
    Query(query): Query<RealtimeQuery>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, ApiError> {
    let token_hash = token::hash(&query.token);
    let (_session, user) = state
        .sessions
        .find_valid_by_token_hash(&token_hash)
        .await?
        .ok_or(ApiError::SessionInvalid)?;

    let member_channel_ids: HashSet<Uuid> = state
        .channels
        .list_channel_ids_for_user(user.id)
        .await?
        .into_iter()
        .collect();
    let member_conversation_ids: HashSet<Uuid> = state
        .dms
        .list_conversation_ids_for_user(user.id)
        .await?
        .into_iter()
        .collect();

    Ok(ws.on_upgrade(move |socket| {
        handle_socket(socket, state, member_channel_ids, member_conversation_ids)
    }))
}

async fn handle_socket(
    mut socket: WebSocket,
    state: AppState,
    member_channel_ids: HashSet<Uuid>,
    member_conversation_ids: HashSet<Uuid>,
) {
    let mut events = state.realtime.subscribe();
    loop {
        tokio::select! {
            event = events.recv() => {
                let event = match event {
                    Ok(event) => event,
                    // A slow consumer missed some events -- keep the
                    // connection alive rather than dropping it; the client
                    // still has the HTTP history endpoint to catch up.
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => break,
                };
                let visible = match &event {
                    RealtimeEvent::NewMessage(e) => member_channel_ids.contains(&e.channel_id),
                    RealtimeEvent::NewDmMessage(e) => member_conversation_ids.contains(&e.conversation_id),
                };
                if !visible {
                    continue;
                }
                if !forward_event(&mut socket, &event).await {
                    break;
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(WsMessage::Close(_))) | None => break,
                    Some(Ok(_)) => continue, // no client->server protocol yet
                    Some(Err(_)) => break,
                }
            }
        }
    }
}

async fn forward_event(socket: &mut WebSocket, event: &RealtimeEvent) -> bool {
    let payload = match event {
        RealtimeEvent::NewMessage(e) => serde_json::json!({
            "type": "message.created",
            "channel_id": e.channel_id,
            "message": e.message,
        }),
        RealtimeEvent::NewDmMessage(e) => serde_json::json!({
            "type": "dm_message.created",
            "conversation_id": e.conversation_id,
            "message": e.message,
        }),
    };
    let Ok(text) = serde_json::to_string(&payload) else {
        return true; // serialization failure is a bug, not a reason to kill the socket
    };
    socket.send(WsMessage::Text(text.into())).await.is_ok()
}
