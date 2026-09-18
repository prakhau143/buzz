//! Phase 4 (DECISIONS.md D10): community invites. Master prompt §6-§14.
//! Create/revoke are owner/admin-gated the same way as `communities.rs`;
//! `claim` derives the claiming user from the session, never the request
//! body (master prompt §11, §25); `preview` is the one deliberately public,
//! unauthenticated endpoint in this backend (master prompt §9) -- see
//! docs/INVITE_DESIGN.md for its information-leak decision.

use crate::auth::AuthUser;
use crate::community_authz;
use crate::error::ApiError;
use crate::invite_authz::InviteState;
use crate::repo::ClaimOutcome;
use crate::routes::communities::require_community_and_caller_role;
use crate::state::AppState;
use crate::token;
use axum::extract::{Path, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 1 hour to 30 days -- the master prompt gives no exact bound, only a UI
/// example ("72 hours ▾" / "Unlimited ▾"); these are this backend's own
/// call, documented in docs/INVITE_DESIGN.md.
const MIN_TTL_SECS: i64 = 3600;
const MAX_TTL_SECS: i64 = 30 * 24 * 3600;
const DEFAULT_TTL_SECS: i64 = 72 * 3600;

#[derive(Deserialize)]
pub struct CreateInviteRequest {
    pub ttl_secs: Option<i64>,
    pub max_uses: Option<i32>,
}

#[derive(Serialize)]
pub struct CreateInviteResponse {
    pub id: Uuid,
    pub code: String,
    pub url: String,
    pub expires_at: DateTime<Utc>,
    pub max_uses: Option<i32>,
    pub uses_remaining: Option<i32>,
}

/// `POST /api/communities/:id/invites` — owner/admin only. `code`/`url` are
/// only ever present in this one response; only `token_hash` is persisted.
pub async fn create_invite(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(community_id): Path<Uuid>,
    Json(req): Json<CreateInviteRequest>,
) -> Result<Json<CreateInviteResponse>, ApiError> {
    let caller_role = require_community_and_caller_role(&state, community_id, caller.id).await?;
    if !community_authz::can_manage_invites(caller_role) {
        return Err(ApiError::Forbidden);
    }

    let ttl_secs = req.ttl_secs.unwrap_or(DEFAULT_TTL_SECS);
    if !(MIN_TTL_SECS..=MAX_TTL_SECS).contains(&ttl_secs) {
        return Err(ApiError::Validation(
            "ttl_secs must be between 1 hour and 30 days",
        ));
    }
    if let Some(max_uses) = req.max_uses {
        if max_uses < 1 {
            return Err(ApiError::Validation(
                "max_uses must be at least 1 when provided",
            ));
        }
    }

    let raw_code = token::generate();
    let token_hash = token::hash(&raw_code);
    let expires_at = Utc::now() + chrono::Duration::seconds(ttl_secs);

    let invite = state
        .invites
        .create_invite(
            community_id,
            &token_hash,
            caller.id,
            expires_at,
            req.max_uses,
        )
        .await?;

    Ok(Json(CreateInviteResponse {
        id: invite.id,
        code: raw_code.clone(),
        url: format!("{}/invite/{}", state.invite_base_url, raw_code),
        expires_at: invite.expires_at,
        max_uses: invite.max_uses,
        uses_remaining: invite.max_uses,
    }))
}

/// `POST /api/invites/:id/revoke` — owner/admin only. A genuine SWF-only
/// addition, not old-Buzz parity: no revoke endpoint was ever confirmed to
/// exist in old Buzz's source (see OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md row on
/// invite revocation).
pub async fn revoke_invite(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(invite_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let invite = state
        .invites
        .find_by_id(invite_id)
        .await?
        .ok_or(ApiError::NotFound("invite not found"))?;

    let caller_role = state
        .communities
        .find_role(invite.community_id, caller.id)
        .await?;
    if !community_authz::can_manage_invites(caller_role) {
        return Err(ApiError::Forbidden);
    }

    state.invites.revoke(invite_id, invite.community_id).await?;
    Ok(Json(serde_json::json!({ "status": "revoked" })))
}

#[derive(Deserialize)]
pub struct ClaimRequest {
    pub code: String,
}

/// `POST /api/invites/claim` — session-authenticated; `claiming_user_id`
/// always comes from the session, never `req` (master prompt §11). Status
/// codes per master prompt §14: unknown token -> 404, revoked/expired ->
/// 410, usage limit reached -> 409, already a member -> 200 `already_member`
/// (idempotent, not an error), success -> 200 `joined`.
pub async fn claim_invite(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Json(req): Json<ClaimRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token_hash = token::hash(&req.code);
    let outcome = state
        .invites
        .claim(&token_hash, caller.id, Utc::now())
        .await?;

    match outcome {
        ClaimOutcome::NotFound => Err(ApiError::NotFound("invite not found")),
        ClaimOutcome::Invalid(InviteState::Revoked) => {
            Err(ApiError::Gone("this invite has been revoked"))
        }
        ClaimOutcome::Invalid(InviteState::Expired) => {
            Err(ApiError::Gone("this invite has expired"))
        }
        ClaimOutcome::Invalid(InviteState::Exhausted) => Err(ApiError::Conflict(
            "this invite has reached its usage limit",
        )),
        ClaimOutcome::Invalid(InviteState::Valid) => Err(ApiError::Internal(
            "claim reported Invalid(Valid), which should be unreachable".to_string(),
        )),
        ClaimOutcome::AlreadyMember { .. } => {
            Ok(Json(serde_json::json!({ "status": "already_member" })))
        }
        ClaimOutcome::Joined {
            community,
            membership,
        } => Ok(Json(serde_json::json!({
            "status": "joined",
            "community": { "id": community.id, "name": community.name },
            "membership": { "user_id": membership.user_id, "role": membership.role },
        }))),
    }
}

#[derive(Serialize)]
pub struct InvitePreviewResponse {
    pub community_name: String,
}

/// `GET /api/invites/:token/preview` — public, unauthenticated, for the
/// invite landing page shown before Okta login. Returns only
/// `community_name`, never `community_id`/`invite_id`/anything else.
/// Follows the master prompt's own general error-code convention (§14)
/// rather than a `200 {valid:false}` wrapper — see docs/INVITE_DESIGN.md §1
/// for why that's an acceptable tradeoff for high-entropy, unguessable
/// tokens.
pub async fn preview_invite(
    State(state): State<AppState>,
    Path(raw_token): Path<String>,
) -> Result<Json<InvitePreviewResponse>, ApiError> {
    let token_hash = token::hash(&raw_token);
    let result = state
        .invites
        .preview_by_token_hash(&token_hash, Utc::now())
        .await?;

    match result {
        None => Err(ApiError::NotFound("invite not found")),
        Some((InviteState::Revoked, _)) => Err(ApiError::Gone("this invite has been revoked")),
        Some((InviteState::Expired, _)) => Err(ApiError::Gone("this invite has expired")),
        Some((InviteState::Exhausted, _)) => Err(ApiError::Conflict(
            "this invite has reached its usage limit",
        )),
        Some((InviteState::Valid, community_name)) => {
            Ok(Json(InvitePreviewResponse { community_name }))
        }
    }
}
