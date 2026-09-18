//! End-to-end HTTP tests of Phase 7 (DECISIONS.md D10: threaded replies)
//! against the real Axum router, using `InMemoryRepo` -- same house style
//! as `tests/messages_flow.rs`. See docs/THREADS_DESIGN.md.

use chrono::Utc;
use serde_json::{json, Value};
use std::sync::Arc;
use swf_buzz_backend::jwks::JwksVerifier;
use swf_buzz_backend::repo::memory::InMemoryRepo;
use swf_buzz_backend::routes;
use swf_buzz_backend::state::AppState;
use swf_buzz_backend::token;
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

async fn post_message(
    app: &TestApp,
    token: &str,
    channel_id: Uuid,
    content: &str,
    parent_message_id: Option<Uuid>,
) -> reqwest::Response {
    reqwest::Client::new()
        .post(format!("{}/api/channels/{channel_id}/messages", app.base))
        .bearer_auth(token)
        .json(&json!({ "content": content, "parent_message_id": parent_message_id }))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn reply_to_a_top_level_message_has_itself_as_root() {
    let app = spawn_app().await;
    let (_owner_id, owner_token) = app.login_as("thread-owner-1").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    let root: Value = post_message(&app, &owner_token, channel_id, "root message", None)
        .await
        .json()
        .await
        .unwrap();
    let root_id = Uuid::parse_str(root["id"].as_str().unwrap()).unwrap();
    assert!(root["parent_message_id"].is_null());
    assert!(root["root_message_id"].is_null());
    assert_eq!(root["depth"], 0);

    let reply: Value = post_message(&app, &owner_token, channel_id, "a reply", Some(root_id))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(reply["parent_message_id"], root_id.to_string());
    assert_eq!(reply["root_message_id"], root_id.to_string());
    assert_eq!(reply["depth"], 1);
}

#[tokio::test]
async fn reply_to_a_reply_has_root_pointing_at_the_original_top_level_message_not_the_immediate_parent(
) {
    let app = spawn_app().await;
    let (_owner_id, owner_token) = app.login_as("thread-owner-2").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    let root: Value = post_message(&app, &owner_token, channel_id, "root", None)
        .await
        .json()
        .await
        .unwrap();
    let root_id = Uuid::parse_str(root["id"].as_str().unwrap()).unwrap();

    let reply1: Value = post_message(&app, &owner_token, channel_id, "reply 1", Some(root_id))
        .await
        .json()
        .await
        .unwrap();
    let reply1_id = Uuid::parse_str(reply1["id"].as_str().unwrap()).unwrap();

    // A reply to reply1 -- its root must be the ORIGINAL top-level message
    // (root_id), never reply1_id, even though reply1 is its immediate
    // parent. This is the flattening rule -- the test most likely to catch
    // a bug where root chains through intermediate replies instead of
    // always pointing at the top-level ancestor.
    let reply2: Value = post_message(&app, &owner_token, channel_id, "reply 2", Some(reply1_id))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(reply2["parent_message_id"], reply1_id.to_string());
    assert_eq!(
        reply2["root_message_id"],
        root_id.to_string(),
        "root_message_id must flatten to the original top-level ancestor, not chain through reply1"
    );
    assert_eq!(reply2["depth"], 2);

    // Counters: root's descendant_count counts BOTH reply1 and reply2 (all
    // descendants); root's reply_count counts only reply1 (direct child).
    // reply1's own reply_count counts only reply2 (its one direct child).
    let root_after: Value = reqwest::Client::new()
        .get(format!("{}/api/messages/{root_id}/thread", app.base))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(root_after["root"]["reply_count"], 1);
    assert_eq!(root_after["root"]["descendant_count"], 2);
}

#[tokio::test]
async fn replying_to_a_message_in_a_different_channel_is_rejected() {
    let app = spawn_app().await;
    let (_owner_id, owner_token) = app.login_as("thread-owner-3").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_a = create_channel(&app, &owner_token, community_id, "general").await;
    let channel_b = create_channel(&app, &owner_token, community_id, "random").await;

    let root: Value = post_message(&app, &owner_token, channel_a, "root in channel A", None)
        .await
        .json()
        .await
        .unwrap();
    let root_id = Uuid::parse_str(root["id"].as_str().unwrap()).unwrap();

    // Attempt a reply, posted to channel B, whose parent lives in channel A.
    let resp = post_message(
        &app,
        &owner_token,
        channel_b,
        "cross-channel reply",
        Some(root_id),
    )
    .await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn replying_to_a_nonexistent_message_is_not_found() {
    let app = spawn_app().await;
    let (_owner_id, owner_token) = app.login_as("thread-owner-4").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    let resp = post_message(
        &app,
        &owner_token,
        channel_id,
        "reply to nothing",
        Some(Uuid::new_v4()),
    )
    .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn depth_limit_is_enforced() {
    let app = spawn_app().await;
    let (_owner_id, owner_token) = app.login_as("thread-owner-5").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    let root: Value = post_message(&app, &owner_token, channel_id, "root", None)
        .await
        .json()
        .await
        .unwrap();
    let mut current_id = Uuid::parse_str(root["id"].as_str().unwrap()).unwrap();

    // Build a chain of exactly THREAD_DEPTH_LIMIT (100) replies, depths
    // 1..=100 -- every one of these must succeed (100 is the cap, not the
    // first rejected depth).
    for i in 1..=100 {
        let reply: Value = post_message(
            &app,
            &owner_token,
            channel_id,
            &format!("reply depth {i}"),
            Some(current_id),
        )
        .await
        .json()
        .await
        .unwrap();
        current_id = Uuid::parse_str(reply["id"].as_str().unwrap()).unwrap();
    }

    // The 101st-deep reply (depth 101) must be rejected.
    let resp = post_message(
        &app,
        &owner_token,
        channel_id,
        "one reply too deep",
        Some(current_id),
    )
    .await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn get_thread_returns_root_and_replies_oldest_first() {
    let app = spawn_app().await;
    let (_owner_id, owner_token) = app.login_as("thread-owner-6").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    let root: Value = post_message(&app, &owner_token, channel_id, "root", None)
        .await
        .json()
        .await
        .unwrap();
    let root_id = Uuid::parse_str(root["id"].as_str().unwrap()).unwrap();

    for i in 1..=3 {
        post_message(
            &app,
            &owner_token,
            channel_id,
            &format!("reply {i}"),
            Some(root_id),
        )
        .await;
    }

    let thread: Value = reqwest::Client::new()
        .get(format!("{}/api/messages/{root_id}/thread", app.base))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(thread["root"]["id"], root_id.to_string());
    let replies = thread["replies"].as_array().unwrap();
    assert_eq!(replies.len(), 3);
    assert_eq!(replies[0]["content"], "reply 1");
    assert_eq!(replies[1]["content"], "reply 2");
    assert_eq!(replies[2]["content"], "reply 3");
}

#[tokio::test]
async fn thread_summaries_returns_batched_counts_for_multiple_threads() {
    let app = spawn_app().await;
    let (_owner_id, owner_token) = app.login_as("thread-owner-7").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;

    let root_a: Value = post_message(&app, &owner_token, channel_id, "thread A root", None)
        .await
        .json()
        .await
        .unwrap();
    let root_a_id = Uuid::parse_str(root_a["id"].as_str().unwrap()).unwrap();
    let root_b: Value = post_message(&app, &owner_token, channel_id, "thread B root", None)
        .await
        .json()
        .await
        .unwrap();
    let root_b_id = Uuid::parse_str(root_b["id"].as_str().unwrap()).unwrap();

    post_message(&app, &owner_token, channel_id, "A reply 1", Some(root_a_id)).await;
    post_message(&app, &owner_token, channel_id, "A reply 2", Some(root_a_id)).await;
    post_message(&app, &owner_token, channel_id, "B reply 1", Some(root_b_id)).await;

    let summaries: Value = reqwest::Client::new()
        .get(format!(
            "{}/api/messages/thread-summaries?ids={root_a_id},{root_b_id}",
            app.base
        ))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let summaries = summaries.as_array().unwrap();
    assert_eq!(summaries.len(), 2);
    let a = summaries
        .iter()
        .find(|s| s["root_message_id"] == root_a_id.to_string())
        .unwrap();
    assert_eq!(a["reply_count"], 2);
    let b = summaries
        .iter()
        .find(|s| s["root_message_id"] == root_b_id.to_string())
        .unwrap();
    assert_eq!(b["reply_count"], 1);
}

#[tokio::test]
async fn non_channel_member_cannot_read_a_thread_even_if_a_community_member() {
    let app = spawn_app().await;
    let (_owner_id, owner_token) = app.login_as("thread-owner-8").await;
    let (stranger_id, stranger_token) = app.login_as("thread-stranger-8").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let channel_id = create_channel(&app, &owner_token, community_id, "general").await;
    add_community_member(&app, &owner_token, community_id, stranger_id).await;

    let root: Value = post_message(&app, &owner_token, channel_id, "root", None)
        .await
        .json()
        .await
        .unwrap();
    let root_id = Uuid::parse_str(root["id"].as_str().unwrap()).unwrap();

    let resp = reqwest::Client::new()
        .get(format!("{}/api/messages/{root_id}/thread", app.base))
        .bearer_auth(&stranger_token)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 403);

    // thread-summaries is a best-effort batch lookup -- an inaccessible id
    // is silently omitted, not a 403 for the whole request.
    let summaries: Value = reqwest::Client::new()
        .get(format!(
            "{}/api/messages/thread-summaries?ids={root_id}",
            app.base
        ))
        .bearer_auth(&stranger_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(summaries.as_array().unwrap().len(), 0);
}
