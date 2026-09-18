use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("missing or malformed Authorization header")]
    Unauthenticated,
    #[error("session expired or revoked")]
    SessionInvalid,
    #[error("identity token could not be verified: {0}")]
    TokenVerification(String),
    #[error("you do not have permission to perform this action")]
    Forbidden,
    #[error("{0}")]
    NotFound(&'static str),
    #[error("{0}")]
    Conflict(&'static str),
    /// The resource existed but is no longer usable (an expired or revoked
    /// invite) -- distinct from `NotFound` (never existed) and `Conflict`
    /// (exists, usable, but this specific request can't proceed, e.g. an
    /// exhausted invite). Master prompt §14: expired/revoked -> 410.
    #[error("{0}")]
    Gone(&'static str),
    #[error("{0}")]
    Validation(&'static str),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("internal error: {0}")]
    Internal(String),
}

impl From<crate::repo::CreateMessageError> for ApiError {
    fn from(err: crate::repo::CreateMessageError) -> Self {
        use crate::repo::CreateMessageError as E;
        match err {
            E::Database(e) => ApiError::Database(e),
            E::ParentNotFound => ApiError::NotFound("parent message not found"),
            E::CrossChannelParent => {
                ApiError::Validation("parent message belongs to a different channel")
            }
            E::DepthLimitExceeded => ApiError::Validation("thread depth limit exceeded"),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ApiError::Unauthenticated => (StatusCode::UNAUTHORIZED, self.to_string()),
            ApiError::SessionInvalid => (StatusCode::UNAUTHORIZED, self.to_string()),
            ApiError::TokenVerification(_) => (StatusCode::UNAUTHORIZED, self.to_string()),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, self.to_string()),
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            ApiError::Conflict(_) => (StatusCode::CONFLICT, self.to_string()),
            ApiError::Gone(_) => (StatusCode::GONE, self.to_string()),
            ApiError::Validation(_) => (StatusCode::UNPROCESSABLE_ENTITY, self.to_string()),
            ApiError::Database(_) | ApiError::Internal(_) => {
                // Never leak internal error detail (e.g. SQL text, connection
                // strings) to the client — log server-side, return a generic
                // message, matching the existing project's error-sanitization
                // discipline (see project memory: "consistent error-message
                // sanitization" was a prior security-review finding to
                // preserve, not regress).
                tracing::error!(error = %self, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal error".to_string(),
                )
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}
