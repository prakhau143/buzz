//! End-to-end HTTP + WebSocket tests of Phase 8 (DECISIONS.md D10: direct
//! messages) against the real Axum router, using `InMemoryRepo` -- same
//! house style as `tests/messages_flow.rs`/`tests/threads_flow.rs`. See
//! docs/DM_DESIGN.md.

use chrono::Utc;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use swf_buzz_backend::jwks::JwksVerifier;
use swf_buzz_backend::repo::memory::InMemoryRepo;
use swf_buzz_backend::routes;
use swf_buzz_backend::state::AppState;
use swf_buzz_backend::token;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use uuid::Uuid;

struct TestApp {
    base: String,
    repo: Arc<InMemoryRepo>,
}

impl TestApp {
    async fn login_as(&self, okta_sub: &str) -> (Uuid, String) {
        use swf_buzz_backend::repo::{SessionRepo, UserRepo};
        let user = self
            .repo
            .upsert_by_okta_sub(okta_sub, None, None)
            .await
            .unwrap();
        let raw = token::generate();
        self.repo
            .create(
                user.id,
                &token::hash(&raw),
                Utc::now() + chrono::Duration::hours(1),
            )
            .await
            .unwrap();
        (user.id, raw)
    }
}

async fn spawn_app() -> TestApp {
    let repo = Arc::new(InMemoryRepo::new());
    let state = AppState {
        users: repo.clone(),
        sessions: repo.clone(),
        communities: repo.clone(),
        invites: repo.clone(),
        channels: repo.clone(),
        messages: repo.clone(),
        dms: repo.clone(),
        jwks: Arc::new(JwksVerifier::new("issuer".into(), "aud".into())),
        session_ttl: chrono::Duration::hours(12),
        invite_base_url: "http://localhost:5173".to_string(),
        realtime: swf_buzz_backend::realtime::Broadcaster::new(),
    };
    let app = routes::router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    TestApp {
        base: format!("http://{addr}"),
        repo,
    }
}

async fn open_dm(app: &TestApp, acting_token: &str, user_ids: &[Uuid]) -> reqwest::Response {
    reqwest::Client::new()
        .post(format!("{}/api/dm/open", app.base))
        .bearer_auth(acting_token)
        .json(&json!({ "user_ids": user_ids }))
        .send()
        .await
        .unwrap()
}

async fn send_dm(
    app: &TestApp,
    token: &str,
    conversation_id: Uuid,
    content: &str,
) -> reqwest::Response {
    reqwest::Client::new()
        .post(format!("{}/api/dm/{conversation_id}/messages", app.base))
        .bearer_auth(token)
        .json(&json!({ "content": content }))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn opening_a_dm_creates_a_conversation_with_both_participants() {
    let app = spawn_app().await;
    let (a_id, a_token) = app.login_as("dm-a-1").await;
    let (b_id, _) = app.login_as("dm-b-1").await;

    let resp: Value = open_dm(&app, &a_token, &[a_id, b_id])
        .await
        .json()
        .await
        .unwrap();
    let mut participants: Vec<String> = resp["participant_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    participants.sort();
    let mut expected = vec![a_id.to_string(), b_id.to_string()];
    expected.sort();
    assert_eq!(participants, expected);
}

#[tokio::test]
async fn opening_the_same_pair_twice_returns_the_same_conversation_even_sequentially() {
    let app = spawn_app().await;
    let (a_id, a_token) = app.login_as("dm-a-2").await;
    let (b_id, b_token) = app.login_as("dm-b-2").await;

    let first: Value = open_dm(&app, &a_token, &[a_id, b_id])
        .await
        .json()
        .await
        .unwrap();
    // Reversed order, opened by the OTHER participant -- must still
    // resolve to the same conversation (order-independent dedup key).
    let second: Value = open_dm(&app, &b_token, &[b_id, a_id])
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(first["id"], second["id"]);
}

#[tokio::test]
async fn opening_the_same_pair_concurrently_never_creates_a_duplicate_conversation() {
    let app = spawn_app().await;
    let (a_id, a_token) = app.login_as("dm-a-3").await;
    let (b_id, b_token) = app.login_as("dm-b-3").await;

    let pair = [a_id, b_id];
    let (r1, r2) = tokio::join!(
        open_dm(&app, &a_token, &pair),
        open_dm(&app, &b_token, &pair),
    );
    let v1: Value = r1.json().await.unwrap();
    let v2: Value = r2.json().await.unwrap();
    assert_eq!(
        v1["id"], v2["id"],
        "two concurrent opens for the same participant set must resolve to one conversation"
    );

    // No duplicate should exist for either participant's own listing.
    let list: Value = reqwest::Client::new()
        .get(format!("{}/api/dm", app.base))
        .bearer_auth(&a_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn opening_a_dm_without_including_yourself_is_rejected() {
    let app = spawn_app().await;
    let (_a_id, a_token) = app.login_as("dm-a-4").await;
    let (b_id, _) = app.login_as("dm-b-4").await;
    let (c_id, _) = app.login_as("dm-c-4").await;

    // Caller tries to open a DM between two OTHER users, without
    // themselves in the set.
    let resp = open_dm(&app, &a_token, &[b_id, c_id]).await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn opening_a_dm_with_only_yourself_is_rejected() {
    let app = spawn_app().await;
    let (a_id, a_token) = app.login_as("dm-a-5").await;
    let resp = open_dm(&app, &a_token, &[a_id]).await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn a_third_party_cannot_read_or_post_in_a_dm_they_are_not_part_of() {
    let app = spawn_app().await;
    let (a_id, a_token) = app.login_as("dm-a-6").await;
    let (b_id, _) = app.login_as("dm-b-6").await;
    let (_, stranger_token) = app.login_as("dm-stranger-6").await;

    let conversation: Value = open_dm(&app, &a_token, &[a_id, b_id])
        .await
        .json()
        .await
        .unwrap();
    let conversation_id = Uuid::parse_str(conversation["id"].as_str().unwrap()).unwrap();

    let post = send_dm(&app, &stranger_token, conversation_id, "sneaking in").await;
    assert_eq!(post.status(), 403);

    let get = reqwest::Client::new()
        .get(format!("{}/api/dm/{conversation_id}/messages", app.base))
        .bearer_auth(&stranger_token)
        .send()
        .await
        .unwrap();
    assert_eq!(get.status(), 403);
}

#[tokio::test]
async fn sending_and_reading_a_dm_message_works_and_sender_comes_from_session() {
    let app = spawn_app().await;
    let (a_id, a_token) = app.login_as("dm-a-7").await;
    let (b_id, b_token) = app.login_as("dm-b-7").await;

    let conversation: Value = open_dm(&app, &a_token, &[a_id, b_id])
        .await
        .json()
        .await
        .unwrap();
    let conversation_id = Uuid::parse_str(conversation["id"].as_str().unwrap()).unwrap();

    // Body tries to spoof a different sender -- must be ignored; only the
    // route's own `content` field is read, sender always comes from the
    // session (there's no sender field the client could even set).
    let sent: Value = send_dm(&app, &a_token, conversation_id, "hello B")
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(sent["sender_user_id"], a_id.to_string());

    let history: Value = reqwest::Client::new()
        .get(format!("{}/api/dm/{conversation_id}/messages", app.base))
        .bearer_auth(&b_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let messages = history.as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["content"], "hello B");
    assert_eq!(messages[0]["sender_user_id"], a_id.to_string());
}

#[tokio::test]
async fn unauthenticated_dm_requests_are_rejected() {
    let app = spawn_app().await;
    let open = reqwest::Client::new()
        .post(format!("{}/api/dm/open", app.base))
        .json(&json!({ "user_ids": [Uuid::new_v4(), Uuid::new_v4()] }))
        .send()
        .await
        .unwrap();
    assert_eq!(open.status(), 401);

    let list = reqwest::Client::new()
        .get(format!("{}/api/dm", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(list.status(), 401);
}

#[tokio::test]
async fn a_connected_websocket_receives_a_dm_message_from_the_other_participant() {
    let app = spawn_app().await;
    let (a_id, a_token) = app.login_as("dm-a-8").await;
    let (b_id, b_token) = app.login_as("dm-b-8").await;

    let conversation: Value = open_dm(&app, &a_token, &[a_id, b_id])
        .await
        .json()
        .await
        .unwrap();
    let conversation_id = Uuid::parse_str(conversation["id"].as_str().unwrap()).unwrap();

    let ws_url = format!(
        "ws://{}/ws?token={}",
        app.base.trim_start_matches("http://"),
        b_token
    );
    let (mut ws_stream, _) = tokio_tungstenite::connect_async(ws_url)
        .await
        .expect("b's websocket should connect");

    tokio::time::sleep(Duration::from_millis(50)).await;

    send_dm(&app, &a_token, conversation_id, "dm fan-out works").await;

    let received = tokio::time::timeout(Duration::from_secs(2), ws_stream.next())
        .await
        .expect("timed out waiting for the realtime DM event")
        .expect("stream ended unexpectedly")
        .expect("websocket error");

    let WsMessage::Text(text) = received else {
        panic!("expected a text frame, got {received:?}");
    };
    let payload: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(payload["type"], "dm_message.created");
    assert_eq!(payload["conversation_id"], conversation_id.to_string());
    assert_eq!(payload["message"]["content"], "dm fan-out works");

    ws_stream.close(None).await.ok();
}

#[tokio::test]
async fn a_socket_connected_before_a_dm_is_opened_does_not_receive_its_messages() {
    let app = spawn_app().await;
    let (a_id, a_token) = app.login_as("dm-a-9").await;
    let (b_id, b_token) = app.login_as("dm-b-9").await;

    // b connects to /ws BEFORE the DM exists.
    let ws_url = format!(
        "ws://{}/ws?token={}",
        app.base.trim_start_matches("http://"),
        b_token
    );
    let (mut ws_stream, _) = tokio_tungstenite::connect_async(ws_url)
        .await
        .expect("b's websocket should connect");
    tokio::time::sleep(Duration::from_millis(50)).await;

    let conversation: Value = open_dm(&app, &a_token, &[a_id, b_id])
        .await
        .json()
        .await
        .unwrap();
    let conversation_id = Uuid::parse_str(conversation["id"].as_str().unwrap()).unwrap();
    send_dm(&app, &a_token, conversation_id, "missed this").await;

    let result = tokio::time::timeout(Duration::from_millis(300), ws_stream.next()).await;
    assert!(
        result.is_err(),
        "a DM opened after connecting must not be picked up by the connect-time snapshot"
    );

    ws_stream.close(None).await.ok();
}
