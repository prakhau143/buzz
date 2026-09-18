//! End-to-end HTTP tests of Phase 5 (DECISIONS.md D10: channels and channel
//! membership) against the real Axum router, using `InMemoryRepo` since no
//! live Postgres is available in this environment (Docker was down this
//! session too — see docs/CHANNEL_MEMBERSHIP_DESIGN.md and the final
//! report for what remains unverified against real infrastructure).

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

async fn add_community_member(
    app: &TestApp,
    acting_token: &str,
    community_id: Uuid,
    user_id: Uuid,
    role: &str,
) {
    let status = reqwest::Client::new()
        .post(format!(
            "{}/api/communities/{community_id}/members",
            app.base
        ))
        .bearer_auth(acting_token)
        .json(&json!({ "user_id": user_id, "role": role }))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, 200, "test setup: add_community_member failed");
}

async fn create_channel(
    app: &TestApp,
    acting_token: &str,
    community_id: Uuid,
    name: &str,
    visibility: &str,
) -> reqwest::Response {
    reqwest::Client::new()
        .post(format!(
            "{}/api/communities/{community_id}/channels",
            app.base
        ))
        .bearer_auth(acting_token)
        .json(&json!({ "name": name, "visibility": visibility }))
        .send()
        .await
        .unwrap()
}

async fn add_channel_member(
    app: &TestApp,
    acting_token: &str,
    channel_id: Uuid,
    user_id: Uuid,
    role: &str,
) -> reqwest::StatusCode {
    reqwest::Client::new()
        .post(format!("{}/api/channels/{channel_id}/members", app.base))
        .bearer_auth(acting_token)
        .json(&json!({ "user_id": user_id, "role": role }))
        .send()
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn unauthenticated_channel_requests_are_rejected() {
    let app = spawn_app().await;
    let resp = reqwest::Client::new()
        .post(format!(
            "{}/api/communities/{}/channels",
            app.base,
            Uuid::new_v4()
        ))
        .json(&json!({ "name": "general", "visibility": "open" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn non_community_member_cannot_create_a_channel() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("chan-owner-1").await;
    let (_, stranger_token) = app.login_as("chan-stranger-1").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;

    let resp = create_channel(&app, &stranger_token, community_id, "general", "open").await;
    assert_eq!(resp.status(), 403);
}

#[tokio::test]
async fn any_community_member_can_create_a_channel_and_becomes_its_owner() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("chan-owner-2").await;
    let (member_id, member_token) = app.login_as("chan-member-2").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    add_community_member(&app, &owner_token, community_id, member_id, "member").await;

    // A plain community member (not owner/admin) can create a channel --
    // ungated per master prompt §18.
    let resp = create_channel(&app, &member_token, community_id, "random", "open").await;
    assert_eq!(resp.status(), 200);
    let channel: Value = resp.json().await.unwrap();
    let channel_id = Uuid::parse_str(channel["id"].as_str().unwrap()).unwrap();

    let members: Vec<Value> = reqwest::Client::new()
        .get(format!("{}/api/channels/{channel_id}/members", app.base))
        .bearer_auth(&member_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(members.len(), 1);
    assert_eq!(members[0]["user_id"], member_id.to_string());
    assert_eq!(members[0]["role"], "owner");
}

#[tokio::test]
async fn community_owner_is_not_automatically_a_member_of_a_channel_they_did_not_create() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("chan-owner-3").await;
    let (creator_id, creator_token) = app.login_as("chan-creator-3").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    add_community_member(&app, &owner_token, community_id, creator_id, "member").await;

    let resp = create_channel(
        &app,
        &creator_token,
        community_id,
        "private-room",
        "private",
    )
    .await;
    assert_eq!(resp.status(), 200);
    let channel: Value = resp.json().await.unwrap();
    let channel_id = Uuid::parse_str(channel["id"].as_str().unwrap()).unwrap();

    // The community owner has never joined this private channel -- listing
    // its roster as the community owner must be forbidden, exactly like a
    // stranger to the channel (community role never substitutes for
    // channel role).
    let resp = reqwest::Client::new()
        .get(format!("{}/api/channels/{channel_id}/members", app.base))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 403);

    // Nor can the community owner remove the channel's creator from it --
    // they have no channel-level standing at all here.
    let resp = reqwest::Client::new()
        .delete(format!(
            "{}/api/channels/{channel_id}/members/{creator_id}",
            app.base
        ))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 403);
}

#[tokio::test]
async fn open_channel_allows_self_add_private_channel_rejects_non_member_self_add() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("chan-owner-4").await;
    let (open_joiner_id, open_joiner_token) = app.login_as("chan-open-joiner-4").await;
    let (priv_joiner_id, priv_joiner_token) = app.login_as("chan-priv-joiner-4").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    add_community_member(&app, &owner_token, community_id, open_joiner_id, "member").await;
    add_community_member(&app, &owner_token, community_id, priv_joiner_id, "member").await;

    let open_resp = create_channel(&app, &owner_token, community_id, "open-room", "open").await;
    let open_channel_id = Uuid::parse_str(
        open_resp.json::<Value>().await.unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let priv_resp = create_channel(&app, &owner_token, community_id, "priv-room", "private").await;
    let priv_channel_id = Uuid::parse_str(
        priv_resp.json::<Value>().await.unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();

    // Self-add into the open channel by a community member who isn't yet a
    // channel member succeeds, at `member` role.
    assert_eq!(
        add_channel_member(
            &app,
            &open_joiner_token,
            open_channel_id,
            open_joiner_id,
            "member"
        )
        .await,
        200
    );

    // Self-add into the private channel by a non-channel-member is
    // rejected, even though they ARE a community member.
    assert_eq!(
        add_channel_member(
            &app,
            &priv_joiner_token,
            priv_channel_id,
            priv_joiner_id,
            "member"
        )
        .await,
        403
    );
}

#[tokio::test]
async fn channel_admin_can_grant_channel_owner_intentional_asymmetry() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("chan-owner-5").await;
    let (creator_id, creator_token) = app.login_as("chan-creator-5").await;
    let (admin_id, admin_token) = app.login_as("chan-admin-5").await;
    let (target_id, _) = app.login_as("chan-target-5").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    for uid in [creator_id, admin_id, target_id] {
        add_community_member(&app, &owner_token, community_id, uid, "member").await;
    }

    let resp = create_channel(&app, &creator_token, community_id, "room", "open").await;
    let channel_id =
        Uuid::parse_str(resp.json::<Value>().await.unwrap()["id"].as_str().unwrap()).unwrap();

    // Creator (channel owner) promotes `admin_id` to channel admin.
    assert_eq!(
        add_channel_member(&app, &creator_token, channel_id, admin_id, "admin").await,
        200
    );

    // Channel admin adds `target_id` directly as channel OWNER -- allowed,
    // per `channel_authz::can_grant_channel_role`'s documented asymmetry
    // (a channel admin, unlike a community admin, may grant the top role).
    assert_eq!(
        add_channel_member(&app, &admin_token, channel_id, target_id, "owner").await,
        200
    );

    let members: Vec<Value> = reqwest::Client::new()
        .get(format!("{}/api/channels/{channel_id}/members", app.base))
        .bearer_auth(&creator_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let target_row = members
        .iter()
        .find(|m| m["user_id"] == target_id.to_string())
        .unwrap();
    assert_eq!(target_row["role"], "owner");
}

#[tokio::test]
async fn removing_or_demoting_the_sole_channel_owner_is_blocked() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("chan-owner-6").await;
    let community_id = create_community(&app, &owner_token, "Eng").await;
    let resp = create_channel(&app, &owner_token, community_id, "solo-room", "open").await;
    let channel: Value = resp.json().await.unwrap();
    let channel_id = Uuid::parse_str(channel["id"].as_str().unwrap()).unwrap();

    let members: Vec<Value> = reqwest::Client::new()
        .get(format!("{}/api/channels/{channel_id}/members", app.base))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let sole_owner_id = members[0]["user_id"].as_str().unwrap().to_string();

    // Removing the sole owner is blocked (would orphan the channel).
    let del = reqwest::Client::new()
        .delete(format!(
            "{}/api/channels/{channel_id}/members/{sole_owner_id}",
            app.base
        ))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap();
    assert_eq!(del.status(), 403);

    // Demoting the sole owner to member is blocked too.
    let demote = reqwest::Client::new()
        .patch(format!(
            "{}/api/channels/{channel_id}/members/{sole_owner_id}",
            app.base
        ))
        .bearer_auth(&owner_token)
        .json(&json!({ "role": "member" }))
        .send()
        .await
        .unwrap();
    assert_eq!(demote.status(), 403);
}

#[tokio::test]
async fn nonexistent_channel_is_not_found() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("chan-owner-7").await;
    let resp = reqwest::Client::new()
        .get(format!(
            "{}/api/channels/{}/members",
            app.base,
            Uuid::new_v4()
        ))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}
