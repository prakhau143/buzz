use crate::auth::bearer_token;
use crate::error::ApiError;
use crate::models::User;
use crate::state::AppState;
use crate::token;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize)]
pub struct UserView {
    pub id: Uuid,
    pub okta_sub: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
}

impl From<User> for UserView {
    fn from(u: User) -> Self {
        UserView {
            id: u.id,
            okta_sub: u.okta_sub,
            email: u.email,
            display_name: u.display_name,
        }
    }
}

#[derive(Deserialize)]
pub struct BootstrapRequest {
    pub id_token: String,
}

#[derive(Serialize)]
pub struct BootstrapResponse {
    pub session_token: String,
    pub expires_at: DateTime<Utc>,
    pub user: UserView,
}

/// `POST /api/session/bootstrap` — called by the Tauri desktop process
/// immediately after its own PKCE token exchange succeeds (see
/// `oidc::login` in src-tauri and docs/BACKEND_SESSION_DESIGN.md §1). Never
/// called by the webview/frontend directly — the raw Okta `id_token` never
/// reaches the frontend, matching the existing "no ID token in the
/// frontend" rule.
pub async fn bootstrap(
    State(state): State<AppState>,
    Json(req): Json<BootstrapRequest>,
) -> Result<Json<BootstrapResponse>, ApiError> {
    let claims = state
        .jwks
        .verify(&req.id_token)
        .await
        .map_err(|e| ApiError::TokenVerification(e.to_string()))?;

    let user = state
        .users
        .upsert_by_okta_sub(&claims.sub, claims.email.as_deref(), claims.name.as_deref())
        .await?;

    let raw_token = token::generate();
    let token_hash = token::hash(&raw_token);
    let expires_at = Utc::now() + state.session_ttl;
    state
        .sessions
        .create(user.id, &token_hash, expires_at)
        .await?;

    Ok(Json(BootstrapResponse {
        session_token: raw_token,
        expires_at,
        user: user.into(),
    }))
}

#[derive(Serialize)]
pub struct SessionInfoResponse {
    pub expires_at: DateTime<Utc>,
    pub user: UserView,
}

/// `GET /api/session` — the frontend's own session check, sent with
/// `Authorization: Bearer <session_token>`.
pub async fn get_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SessionInfoResponse>, ApiError> {
    let raw_token = bearer_token(&headers)?;
    let token_hash = token::hash(&raw_token);
    let (session, user) = state
        .sessions
        .find_valid_by_token_hash(&token_hash)
        .await?
        .ok_or(ApiError::SessionInvalid)?;

    Ok(Json(SessionInfoResponse {
        expires_at: session.expires_at,
        user: user.into(),
    }))
}

/// `POST /api/session/logout` — revokes the presented token server-side.
/// Idempotent: revoking an already-revoked/unknown token still returns 200,
/// since the caller's desired end state (no valid session) is already true.
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let raw_token = bearer_token(&headers)?;
    let token_hash = token::hash(&raw_token);
    state.sessions.revoke_by_token_hash(&token_hash).await?;
    Ok(Json(serde_json::json!({ "status": "logged_out" })))
}
