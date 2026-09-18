//! End-to-end HTTP tests of Phase 3 (DECISIONS.md D10: community membership
//! and roles) against the real Axum router, using `InMemoryRepo` since no
//! live Postgres is available in this environment (see
//! docs/COMMUNITY_MEMBERSHIP_DESIGN.md and the final report for what
//! remains unverified against real infrastructure). Proves the routing,
//! extractor, and `community_authz` wiring end-to-end; does NOT prove the
//! `PostgresRepo` implementation.

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
    /// Creates a user directly in the repo (bypassing the Okta bootstrap
    /// HTTP flow, which Phase 2's own tests already cover) and mints a
    /// valid session token for them, returning `(user_id, bearer_token)`.
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

async fn add_member(
    app: &TestApp,
    acting_token: &str,
    community_id: Uuid,
    user_id: Uuid,
    role: &str,
) -> StatusCode {
    reqwest::Client::new()
        .post(format!(
            "{}/api/communities/{community_id}/members",
            app.base
        ))
        .bearer_auth(acting_token)
        .json(&json!({ "user_id": user_id, "role": role }))
        .send()
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn unauthenticated_request_is_rejected() {
    use swf_buzz_backend::repo::CommunityRepo;
    let app = spawn_app().await;
    let community_id = app
        .repo
        .create_community("x", Uuid::new_v4())
        .await
        .unwrap()
        .id;
    let resp = reqwest::Client::new()
        .get(format!(
            "{}/api/communities/{community_id}/members",
            app.base
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn owner_bootstraps_community_and_admin_can_add_members_but_not_admins() {
    let app = spawn_app().await;
    let (owner_id, owner_token) = app.login_as("owner-sub").await;
    let (admin_id, admin_token) = app.login_as("admin-sub").await;
    let (member_id, member_token) = app.login_as("member-sub").await;
    let (other_id, _) = app.login_as("other-sub").await;

    let community_id = create_community(&app, &owner_token, "Engineering").await;

    // Owner grants admin.
    assert_eq!(
        add_member(&app, &owner_token, community_id, admin_id, "admin").await,
        200
    );
    // Owner attempting to grant ownership via this path is rejected.
    assert_eq!(
        add_member(&app, &owner_token, community_id, other_id, "owner").await,
        403
    );
    // Admin can add a plain member.
    assert_eq!(
        add_member(&app, &admin_token, community_id, member_id, "member").await,
        200
    );
    // Admin cannot add another admin.
    assert_eq!(
        add_member(&app, &admin_token, community_id, other_id, "admin").await,
        403
    );
    // A plain member cannot add anyone.
    assert_eq!(
        add_member(&app, &member_token, community_id, other_id, "member").await,
        403
    );
    // Adding an already-existing member is a conflict.
    assert_eq!(
        add_member(&app, &owner_token, community_id, admin_id, "member").await,
        409
    );
    // Adding a user who has never logged in (doesn't exist) is not found.
    assert_eq!(
        add_member(&app, &owner_token, community_id, Uuid::new_v4(), "member").await,
        404
    );

    // A member of the community can list the roster.
    let list_resp = reqwest::Client::new()
        .get(format!(
            "{}/api/communities/{community_id}/members",
            app.base
        ))
        .bearer_auth(&member_token)
        .send()
        .await
        .unwrap();
    assert_eq!(list_resp.status(), 200);
    let members: Vec<Value> = list_resp.json().await.unwrap();
    assert_eq!(members.len(), 3);

    // A non-member is forbidden from listing, not told "not found" (avoids
    // leaking community existence to strangers).
    let (_, stranger_token) = app.login_as("stranger-sub").await;
    let stranger_resp = reqwest::Client::new()
        .get(format!(
            "{}/api/communities/{community_id}/members",
            app.base
        ))
        .bearer_auth(&stranger_token)
        .send()
        .await
        .unwrap();
    assert_eq!(stranger_resp.status(), 403);

    let _ = owner_id; // used only to document intent; owner acts via owner_token above
}

#[tokio::test]
async fn only_owner_changes_roles_never_touching_owner_never_self_never_granting_owner() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("owner-2").await;
    let (admin_id, admin_token) = app.login_as("admin-2").await;
    let (member_id, _) = app.login_as("member-2").await;
    let community_id = create_community(&app, &owner_token, "HR").await;
    add_member(&app, &owner_token, community_id, admin_id, "admin").await;
    add_member(&app, &owner_token, community_id, member_id, "member").await;

    let client = reqwest::Client::new();

    // Owner promotes member -> admin: allowed.
    let ok = client
        .patch(format!(
            "{}/api/communities/{community_id}/members/{member_id}",
            app.base
        ))
        .bearer_auth(&owner_token)
        .json(&json!({ "role": "admin" }))
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 200);

    // Admin (non-owner) attempting to change a role is forbidden.
    let forbidden = client
        .patch(format!(
            "{}/api/communities/{community_id}/members/{member_id}",
            app.base
        ))
        .bearer_auth(&admin_token)
        .json(&json!({ "role": "member" }))
        .send()
        .await
        .unwrap();
    assert_eq!(forbidden.status(), 403);

    // Owner cannot change their own role via this path.
    let (owner_user_id, _) = {
        // fetch caller's own id by hitting session info isn't available here;
        // instead re-derive from the members list.
        let list: Vec<Value> = client
            .get(format!(
                "{}/api/communities/{community_id}/members",
                app.base
            ))
            .bearer_auth(&owner_token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let owner_row = list.iter().find(|m| m["role"] == "owner").unwrap();
        (
            Uuid::parse_str(owner_row["user_id"].as_str().unwrap()).unwrap(),
            (),
        )
    };
    let self_change = client
        .patch(format!(
            "{}/api/communities/{community_id}/members/{owner_user_id}",
            app.base
        ))
        .bearer_auth(&owner_token)
        .json(&json!({ "role": "admin" }))
        .send()
        .await
        .unwrap();
    assert_eq!(self_change.status(), 403);

    // Owner cannot grant ownership via role change either.
    let grant_owner = client
        .patch(format!(
            "{}/api/communities/{community_id}/members/{member_id}",
            app.base
        ))
        .bearer_auth(&owner_token)
        .json(&json!({ "role": "owner" }))
        .send()
        .await
        .unwrap();
    assert_eq!(grant_owner.status(), 403);
}

#[tokio::test]
async fn removal_rules_owner_immune_self_immune_admin_limited_to_members() {
    let app = spawn_app().await;
    let (_, owner_token) = app.login_as("owner-3").await;
    let (admin_id, admin_token) = app.login_as("admin-3").await;
    let (member_id, _) = app.login_as("member-3").await;
    let community_id = create_community(&app, &owner_token, "Support").await;
    add_member(&app, &owner_token, community_id, admin_id, "admin").await;
    add_member(&app, &owner_token, community_id, member_id, "member").await;

    let client = reqwest::Client::new();

    // Admin cannot remove another admin.
    let (admin2_id, _) = app.login_as("admin-3b").await;
    add_member(&app, &owner_token, community_id, admin2_id, "admin").await;
    let admin_removes_admin = client
        .delete(format!(
            "{}/api/communities/{community_id}/members/{admin2_id}",
            app.base
        ))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(admin_removes_admin.status(), 403);

    // Admin can remove a plain member.
    let admin_removes_member = client
        .delete(format!(
            "{}/api/communities/{community_id}/members/{member_id}",
            app.base
        ))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap();
    assert_eq!(admin_removes_member.status(), 200);

    // Nobody can remove themselves via this path, even the owner.
    let list: Vec<Value> = client
        .get(format!(
            "{}/api/communities/{community_id}/members",
            app.base
        ))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let owner_user_id = list.iter().find(|m| m["role"] == "owner").unwrap()["user_id"]
        .as_str()
        .unwrap()
        .to_string();
    let self_removal = client
        .delete(format!(
            "{}/api/communities/{community_id}/members/{owner_user_id}",
            app.base
        ))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap();
    assert_eq!(self_removal.status(), 403);

    // The owner can never be removed via this path, even by themselves
    // (covered above) or -- there being only one owner here -- nobody else
    // has standing to try; removing a non-existent membership is 404.
    let not_found = client
        .delete(format!(
            "{}/api/communities/{community_id}/members/{}",
            app.base,
            Uuid::new_v4()
        ))
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap();
    assert_eq!(not_found.status(), 404);
}

#[tokio::test]
async fn nonexistent_community_is_not_found() {
    let app = spawn_app().await;
    let (_, token) = app.login_as("solo-sub").await;
    let resp = reqwest::Client::new()
        .get(format!(
            "{}/api/communities/{}/members",
            app.base,
            Uuid::new_v4()
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}
