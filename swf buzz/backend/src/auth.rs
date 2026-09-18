//! Shared bearer-token session resolution, used by every authenticated
//! route (Phase 2's session endpoints and Phase 3's community-member
//! endpoints alike). The session token is the only thing any route accepts
//! as proof of who the caller is -- never a client-supplied user id in the
//! body/path (master prompt §25).

use crate::error::ApiError;
use crate::models::User;
use crate::state::AppState;
use crate::token;
use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use axum::http::HeaderMap;

pub fn bearer_token(headers: &HeaderMap) -> Result<String, ApiError> {
    let value = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or(ApiError::Unauthenticated)?;
    value
        .strip_prefix("Bearer ")
        .map(str::to_string)
        .ok_or(ApiError::Unauthenticated)
}

/// The authenticated caller, resolved from a valid `swf_session` bearer
/// token. An axum extractor so every handler that needs the caller's
/// identity just adds `caller: AuthUser` to its signature instead of
/// re-deriving it.
pub struct AuthUser(pub User);

impl<S> FromRequestParts<S> for AuthUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = AppState::from_ref(state);
        let raw_token = bearer_token(&parts.headers)?;
        let token_hash = token::hash(&raw_token);
        let (_session, user) = state
            .sessions
            .find_valid_by_token_hash(&token_hash)
            .await?
            .ok_or(ApiError::SessionInvalid)?;
        Ok(AuthUser(user))
    }
}
