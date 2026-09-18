//! End-to-end HTTP + WebSocket tests of Phase 6 (DECISIONS.md D10: channel
//! messages and realtime fan-out) against the real Axum router, using
//! `InMemoryRepo` since no live Postgres is available in this environment
//! (Docker was down this session too — see docs/MESSAGING_DESIGN.md and the
//! final report for what remains unverified against real infrastructure).

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

async fn create_community(app: &TestApp, owner_token: &str, name: &str) -> Uuid {
    let resp: Value = reqwest::Client::new()
        .post(format!("{}/api/communities", app.base))
        .bearer_auth(owner_token)
        .json(&json!({ "name": name }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    Uuid::parse_str(resp["id"].as_str().unwrap()).unwrap()
}

async fn create_channel(app: &TestApp, acting_token: &str, community_id: Uuid, name: &str) -> Uuid {
    let resp: Value = reqwest::Client::new()
        .post(format!(
            "{}/api/communities/{community_id}/channels",
            app.base
        ))
        .bearer_auth(acting_token)
        .json(&json!({ "name": name, "visibility": "open" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    Uuid::parse_str(resp["id"].as_str().unwrap()).unwrap()
}

async fn add_community_member(
    app: &TestApp,
    acting_token: &str,
    community_id: Uuid,
    user_id: Uuid,
) {
    let status = reqwest::Client::new()
        .post(format!(
            "{}/api/communities/{community_id}/members",
            app.base
        ))
        .bearer_auth(acting_token)
        .json(&json!({ "user_id": user_id, "role": "member" }))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, 200, "test setup: add_community_member failed");
}

async fn add_channel_member(app: &TestApp, acting_token: &str, channel_id: Uuid, user_id: Uuid) {
    let status = reqwest::Client::new()
        .post(format!("{}/api/channels/{channel_id}/members", app.base))
        .bearer_auth(acting_token)
        .json(&json!({ "user_id": user_id, "role": "member" }))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, 200, "test setup: add_channel_member failed");
}

#[tokio::test]
async fn unauthenticated_message_requests_are_rejected() {
    let app = spawn_app().await;
    let post = reqwest::Client::new()
        .post(format!(
            "{}/api/channels/{}/messages",
            app.base,
            Uuid::new_v4()
        ))
        .json(&json!({ "content": "hi" }))
        .send()
        .await
        .unwrap();
    assert_eq!(post.status(), 401);

    let get = reqwest::Client::new()
        .get(format!(
            "{}/api/channels/{}/messages",
            app.base,
            Uuid::new_v4()
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(get.status(), 401);
}

#[tokio::test]
async fn non_channel_member_cannot_post_or_read_even_if_a_community_member() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("msg-owner-1").await;
    let (stranger_id, stranger_token) = app.login_as("msg-stranger-1").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;

    // stranger joins the community but never the channel
    reqwest::Client::new()
        .post(format!(
            "{}/api/communities/{community_id}/members",
            app.base
        ))
        .bearer_auth(&owner_token)
        .json(&json!({ "user_id": stranger_id, "role": "member" }))
        .send()
        .await
        .unwrap();

    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    let post = reqwest::Client::new()
        .post(format!("{}/api/channels/{channel_id}/messages", app.base))
        .bearer_auth(&stranger_token)
        .json(&json!({ "content": "hi" }))
        .send()
        .await
        .unwrap();
    assert_eq!(post.status(), 403);

    let get = reqwest::Client::new()
        .get(format!("{}/api/channels/{channel_id}/messages", app.base))
        .bearer_auth(&stranger_token)
        .send()
        .await
        .unwrap();
    assert_eq!(get.status(), 403);
}

#[tokio::test]
async fn member_posts_a_message_and_sender_id_comes_from_session_not_the_body() {
    let app = spawn_app().await;
    let (owner_id, owner_token) = app.login_as("msg-owner-2").await;
    let (someone_else_id, _) = app.login_as("msg-else-2").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    let resp = reqwest::Client::new()
        .post(format!("{}/api/channels/{channel_id}/messages", app.base))
        .bearer_auth(&owner_token)
        // attempt to spoof sender_user_id in the body -- must be ignored
        .json(&json!({ "content": "hello world", "sender_user_id": someone_else_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["sender_user_id"], owner_id.to_string());
    assert_eq!(body["content"], "hello world");
    assert!(body["parent_message_id"].is_null());
}

#[tokio::test]
async fn empty_and_oversized_content_is_rejected() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("msg-owner-3").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    let empty = reqwest::Client::new()
        .post(format!("{}/api/channels/{channel_id}/messages", app.base))
        .bearer_auth(&owner_token)
        .json(&json!({ "content": "   " }))
        .send()
        .await
        .unwrap();
    assert_eq!(empty.status(), 422);

    let too_long = reqwest::Client::new()
        .post(format!("{}/api/channels/{channel_id}/messages", app.base))
        .bearer_auth(&owner_token)
        .json(&json!({ "content": "x".repeat(8_001) }))
        .send()
        .await
        .unwrap();
    assert_eq!(too_long.status(), 422);
}

#[tokio::test]
async fn history_paginates_newest_first_with_no_duplicates_or_gaps() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("msg-owner-4").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    let mut sent_ids = Vec::new();
    for i in 0..12 {
        let resp: Value = reqwest::Client::new()
            .post(format!("{}/api/channels/{channel_id}/messages", app.base))
            .bearer_auth(&owner_token)
            .json(&json!({ "content": format!("message {i}") }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        sent_ids.push(resp["id"].as_str().unwrap().to_string());
    }

    // page 1: newest 5
    let page1: Vec<Value> = reqwest::Client::new()
        .get(format!(
            "{}/api/channels/{channel_id}/messages?limit=5",
            app.base
        ))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page1.len(), 5);
    let page1_ids: Vec<String> = page1
        .iter()
        .map(|m| m["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        page1_ids,
        sent_ids[7..12].iter().rev().cloned().collect::<Vec<_>>(),
        "page 1 should be the 5 newest messages, newest first"
    );

    // page 2: continue with before_seq from the last item of page 1
    let before_seq = page1.last().unwrap()["seq"].as_i64().unwrap();
    let page2: Vec<Value> = reqwest::Client::new()
        .get(format!(
            "{}/api/channels/{channel_id}/messages?limit=5&before_seq={before_seq}",
            app.base
        ))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page2.len(), 5);
    let page2_ids: Vec<String> = page2
        .iter()
        .map(|m| m["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        page2_ids,
        sent_ids[2..7].iter().rev().cloned().collect::<Vec<_>>(),
        "page 2 should continue with the next 5 older messages, no overlap/gap with page 1"
    );

    // no id appears in both pages
    for id in &page1_ids {
        assert!(!page2_ids.contains(id), "page 1/2 must not overlap");
    }
}

/// The realtime fan-out claim, proven end-to-end: a real WebSocket client
/// connects to the real `/ws` route on the real listener spawned by
/// `spawn_app`, a message is posted over plain HTTP by a different user,
/// and the connected socket is asserted to actually receive it -- not just
/// that the broadcaster's `publish`/`subscribe` pair works in isolation.
#[tokio::test]
async fn a_connected_websocket_receives_a_message_posted_by_another_member() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("msg-owner-5").await;
    let (member_id, member_token) = app.login_as("msg-member-5").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;
    add_community_member(&app, &owner_token, community_id, member_id).await;
    add_channel_member(&app, &owner_token, channel_id, member_id).await;

    let ws_url = format!(
        "ws://{}/ws?token={}",
        app.base.trim_start_matches("http://"),
        member_token
    );
    let (mut ws_stream, _) = tokio_tungstenite::connect_async(ws_url)
        .await
        .expect("member's websocket should connect");

    // give the server a moment to register the subscription before we post
    tokio::time::sleep(Duration::from_millis(50)).await;

    reqwest::Client::new()
        .post(format!("{}/api/channels/{channel_id}/messages", app.base))
        .bearer_auth(&owner_token)
        .json(&json!({ "content": "fan-out works" }))
        .send()
        .await
        .unwrap();

    let received = tokio::time::timeout(Duration::from_secs(2), ws_stream.next())
        .await
        .expect("timed out waiting for the realtime event")
        .expect("stream ended unexpectedly")
        .expect("websocket error");

    let WsMessage::Text(text) = received else {
        panic!("expected a text frame, got {received:?}");
    };
    let payload: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(payload["type"], "message.created");
    assert_eq!(payload["channel_id"], channel_id.to_string());
    assert_eq!(payload["message"]["content"], "fan-out works");

    ws_stream.close(None).await.ok();
}

#[tokio::test]
async fn websocket_upgrade_without_a_valid_token_is_rejected() {
    let app = spawn_app().await;
    let ws_url = format!(
        "ws://{}/ws?token=not-a-real-token",
        app.base.trim_start_matches("http://")
    );
    let err = tokio_tungstenite::connect_async(ws_url).await;
    assert!(
        err.is_err(),
        "an invalid token must not be allowed to upgrade"
    );
}

/// A socket only receives events for channels it was a member of *at
/// connect time* -- joining a new channel afterward doesn't retroactively
/// subscribe it. Documents the limitation with a real test, not just prose.
#[tokio::test]
async fn websocket_does_not_receive_events_for_a_channel_joined_after_connecting() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("msg-owner-6").await;
    let (member_id, member_token) = app.login_as("msg-member-6").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    // connect BEFORE joining the channel
    let ws_url = format!(
        "ws://{}/ws?token={}",
        app.base.trim_start_matches("http://"),
        member_token
    );
    let (mut ws_stream, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();

    add_community_member(&app, &owner_token, community_id, member_id).await;
    add_channel_member(&app, &owner_token, channel_id, member_id).await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    reqwest::Client::new()
        .post(format!("{}/api/channels/{channel_id}/messages", app.base))
        .bearer_auth(&owner_token)
        .json(&json!({ "content": "should not be seen by the stale socket" }))
        .send()
        .await
        .unwrap();

    let result = tokio::time::timeout(Duration::from_millis(500), ws_stream.next()).await;
    assert!(
        result.is_err(),
        "connecting before joining a channel must not retroactively receive that channel's events"
    );

    ws_stream.close(None).await.ok();
}
