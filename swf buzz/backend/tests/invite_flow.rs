//! End-to-end HTTP tests of Phase 4 (DECISIONS.md D10: community invites)
//! against the real Axum router, using `InMemoryRepo` since no live
//! Postgres is available in this environment (see docs/INVITE_DESIGN.md and
//! the final report for what remains unverified against real
//! infrastructure — in particular, the `SELECT ... FOR UPDATE` row-lock
//! guarantee `PostgresRepo::claim` relies on is exercised here only via
//! `InMemoryRepo`'s single-mutex critical section, which proves the
//! routing/handler/authz wiring and the *outcome* under concurrent HTTP
//! requests, not Postgres's own locking mechanism).

use chrono::Utc;
use reqwest::StatusCode;
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

async fn create_invite(
    app: &TestApp,
    acting_token: &str,
    community_id: Uuid,
    body: Value,
) -> (StatusCode, Value) {
    let resp = reqwest::Client::new()
        .post(format!(
            "{}/api/communities/{community_id}/invites",
            app.base
        ))
        .bearer_auth(acting_token)
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let body = resp.json().await.unwrap();
    (status, body)
}

async fn claim(app: &TestApp, claimer_token: &str, code: &str) -> (StatusCode, Value) {
    let resp = reqwest::Client::new()
        .post(format!("{}/api/invites/claim", app.base))
        .bearer_auth(claimer_token)
        .json(&json!({ "code": code }))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let body = resp.json().await.unwrap();
    (status, body)
}

#[tokio::test]
async fn only_owner_or_admin_can_create_an_invite() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("owner-1").await;
    let (member_id, member_token) = app.login_as("member-1").await;
    let community_id = create_community(&app, &owner_token, "Engineering").await;
    reqwest::Client::new()
        .post(format!(
            "{}/api/communities/{community_id}/members",
            app.base
        ))
        .bearer_auth(&owner_token)
        .json(&json!({ "user_id": member_id, "role": "member" }))
        .send()
        .await
        .unwrap();

    let (owner_status, owner_body) =
        create_invite(&app, &owner_token, community_id, json!({})).await;
    assert_eq!(owner_status, 200);
    assert!(owner_body["code"].as_str().unwrap().len() > 10);
    assert!(owner_body["url"]
        .as_str()
        .unwrap()
        .starts_with("http://localhost:5173/invite/"));
    assert_eq!(owner_body["max_uses"], Value::Null);

    let (member_status, _) = create_invite(&app, &member_token, community_id, json!({})).await;
    assert_eq!(member_status, 403);
}

#[tokio::test]
async fn invalid_ttl_and_max_uses_are_rejected() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("owner-2").await;
    let community_id = create_community(&app, &owner_token, "HR").await;

    let (too_short, _) =
        create_invite(&app, &owner_token, community_id, json!({ "ttl_secs": 10 })).await;
    assert_eq!(too_short, 422);

    let (too_long, _) = create_invite(
        &app,
        &owner_token,
        community_id,
        json!({ "ttl_secs": 999_999_999 }),
    )
    .await;
    assert_eq!(too_long, 422);

    let (bad_max_uses, _) =
        create_invite(&app, &owner_token, community_id, json!({ "max_uses": 0 })).await;
    assert_eq!(bad_max_uses, 422);
}

#[tokio::test]
async fn claiming_a_valid_invite_joins_as_member_and_claiming_again_is_idempotent() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("owner-3").await;
    let (_, joiner_token) = app.login_as("joiner-3").await;
    let community_id = create_community(&app, &owner_token, "Support").await;
    let (_, invite_body) = create_invite(&app, &owner_token, community_id, json!({})).await;
    let code = invite_body["code"].as_str().unwrap();

    let (status, body) = claim(&app, &joiner_token, code).await;
    assert_eq!(status, 200);
    assert_eq!(body["status"], "joined");
    assert_eq!(body["membership"]["role"], "member");
    assert_eq!(body["community"]["name"], "Support");

    let (status_again, body_again) = claim(&app, &joiner_token, code).await;
    assert_eq!(status_again, 200);
    assert_eq!(body_again["status"], "already_member");
}

#[tokio::test]
async fn a_max_uses_one_invite_is_never_over_claimed_under_concurrent_requests() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("owner-4").await;
    let (_, first_token) = app.login_as("first-4").await;
    let (_, second_token) = app.login_as("second-4").await;
    let community_id = create_community(&app, &owner_token, "Sales").await;
    let (_, invite_body) =
        create_invite(&app, &owner_token, community_id, json!({ "max_uses": 1 })).await;
    let code = invite_body["code"].as_str().unwrap().to_string();

    let base = app.base.clone();
    let code_a = code.clone();
    let code_b = code.clone();
    let (result_a, result_b) = tokio::join!(
        tokio::spawn(async move {
            reqwest::Client::new()
                .post(format!("{base}/api/invites/claim"))
                .bearer_auth(&first_token)
                .json(&json!({ "code": code_a }))
                .send()
                .await
                .unwrap()
                .status()
        }),
        tokio::spawn({
            let base = app.base.clone();
            async move {
                reqwest::Client::new()
                    .post(format!("{base}/api/invites/claim"))
                    .bearer_auth(&second_token)
                    .json(&json!({ "code": code_b }))
                    .send()
                    .await
                    .unwrap()
                    .status()
            }
        })
    );
    let statuses = [result_a.unwrap(), result_b.unwrap()];
    let joined_count = statuses.iter().filter(|s| **s == 200).count();
    let exhausted_count = statuses.iter().filter(|s| **s == 409).count();
    assert_eq!(
        joined_count, 1,
        "exactly one concurrent claim against a max_uses=1 invite must succeed"
    );
    assert_eq!(
        exhausted_count, 1,
        "the other concurrent claim must see the invite as exhausted"
    );
}

#[tokio::test]
async fn expired_invite_claim_and_preview_are_gone() {
    use swf_buzz_backend::repo::{CommunityRepo, InviteRepo};

    let app = spawn_app().await;
    let (owner_id, _) = app.login_as("owner-5").await;
    let (_, joiner_token) = app.login_as("joiner-5").await;
    let community_id = app
        .repo
        .create_community("Legal", owner_id)
        .await
        .unwrap()
        .id;

    // Bypass the HTTP create endpoint's minimum-ttl validation to construct
    // an already-expired invite directly (real time can't be fast-forwarded
    // in this test process) -- exercises the same `claim`/`preview_by_token_hash`
    // code path an aged-out real invite would hit.
    let raw_code = token::generate();
    let token_hash = token::hash(&raw_code);
    InviteRepo::create_invite(
        app.repo.as_ref(),
        community_id,
        &token_hash,
        owner_id,
        Utc::now() - chrono::Duration::seconds(1),
        None,
    )
    .await
    .unwrap();

    let (status, _) = claim(&app, &joiner_token, &raw_code).await;
    assert_eq!(status, 410);

    let preview = reqwest::Client::new()
        .get(format!("{}/api/invites/{raw_code}/preview", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(preview.status(), 410);
}

#[tokio::test]
async fn revoked_invite_cannot_be_claimed_and_only_owner_or_admin_can_revoke() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("owner-6").await;
    let (_, other_member_token) = app.login_as("other-6").await;
    let (_, joiner_token) = app.login_as("joiner-6").await;
    let community_id = create_community(&app, &owner_token, "Finance").await;
    let (_, invite_body) = create_invite(&app, &owner_token, community_id, json!({})).await;
    let code = invite_body["code"].as_str().unwrap().to_string();
    let invite_id = invite_body["id"].as_str().unwrap().to_string();

    // A non-member has no standing to revoke.
    let forbidden = reqwest::Client::new()
        .post(format!("{}/api/invites/{invite_id}/revoke", app.base))
        .bearer_auth(&other_member_token)
        .send()
        .await
        .unwrap();
    assert_eq!(forbidden.status(), 403);

    let revoked = reqwest::Client::new()
        .post(format!("{}/api/invites/{invite_id}/revoke", app.base))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap();
    assert_eq!(revoked.status(), 200);

    let (claim_status, _) = claim(&app, &joiner_token, &code).await;
    assert_eq!(claim_status, 410);

    // Public preview agrees.
    let preview = reqwest::Client::new()
        .get(format!("{}/api/invites/{code}/preview", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(preview.status(), 410);
}

#[tokio::test]
async fn claiming_or_previewing_an_unknown_code_is_not_found() {
    let app = spawn_app().await;
    let (_, joiner_token) = app.login_as("joiner-7").await;

    let (claim_status, _) = claim(&app, &joiner_token, "not-a-real-code").await;
    assert_eq!(claim_status, 404);

    let preview = reqwest::Client::new()
        .get(format!("{}/api/invites/not-a-real-code/preview", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(preview.status(), 404);
}

#[tokio::test]
async fn public_preview_of_a_valid_invite_exposes_only_the_community_name() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("owner-8").await;
    let community_id = create_community(&app, &owner_token, "Design").await;
    let (_, invite_body) = create_invite(&app, &owner_token, community_id, json!({})).await;
    let code = invite_body["code"].as_str().unwrap();

    // No Authorization header at all -- this is the public landing-page path.
    let resp = reqwest::Client::new()
        .get(format!("{}/api/invites/{code}/preview", app.base))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["community_name"], "Design");
    assert_eq!(
        body.as_object().unwrap().len(),
        1,
        "preview must expose nothing beyond community_name"
    );
}

#[tokio::test]
async fn claim_requires_authentication() {
    let app = spawn_app().await;
    let resp = reqwest::Client::new()
        .post(format!("{}/api/invites/claim", app.base))
        .json(&json!({ "code": "anything" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}
