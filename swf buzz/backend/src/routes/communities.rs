//! Phase 3 (DECISIONS.md D10): community membership + role management.
//! Every mutating handler independently re-derives the caller's role from
//! `community_members` via their authenticated session — never from
//! anything the request body/path claims about the caller (master prompt
//! §25). The actual allow/deny decisions live in `community_authz.rs`; this
//! module is wiring (extract → look up → decide → persist → respond) only.

use crate::auth::AuthUser;
use crate::community_authz;
use crate::error::ApiError;
use crate::models::{CommunityMember, Role};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize)]
pub struct CommunityView {
    pub id: Uuid,
    pub name: String,
}

#[derive(Deserialize)]
pub struct CreateCommunityRequest {
    pub name: String,
}

/// `POST /api/communities` — not one of the master prompt's Phase 3
/// endpoints, but membership can't be created, tested, or used without some
/// community to belong to; see docs/COMMUNITY_MEMBERSHIP_DESIGN.md §1. Any
/// authenticated user may create one; the creator becomes its owner.
pub async fn create_community(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Json(req): Json<CreateCommunityRequest>,
) -> Result<Json<CommunityView>, ApiError> {
    let community = state
        .communities
        .create_community(&req.name, caller.id)
        .await?;
    Ok(Json(CommunityView {
        id: community.id,
        name: community.name,
    }))
}

#[derive(Serialize)]
pub struct MemberView {
    pub user_id: Uuid,
    pub role: Role,
    pub joined_at: DateTime<Utc>,
}

impl From<CommunityMember> for MemberView {
    fn from(m: CommunityMember) -> Self {
        MemberView {
            user_id: m.user_id,
            role: m.role,
            joined_at: m.joined_at,
        }
    }
}

/// Resolves the community-must-exist + caller-must-be-a-member checks
/// shared by every handler below. Viewing the roster isn't explicitly
/// gated in `permissions.ts` (only *managing* members is, via
/// `canManageCommunityMembers`) — this backend's own deliberate call:
/// membership itself is the minimum bar to see who else is in a community,
/// same as old Buzz's own community-scoped visibility model. Documented in
/// docs/COMMUNITY_MEMBERSHIP_DESIGN.md §2.
pub(crate) async fn require_community_and_caller_role(
    state: &AppState,
    community_id: Uuid,
    caller_id: Uuid,
) -> Result<Option<Role>, ApiError> {
    if !state.communities.community_exists(community_id).await? {
        return Err(ApiError::NotFound("community not found"));
    }
    state
        .communities
        .find_role(community_id, caller_id)
        .await
        .map_err(ApiError::from)
}

/// `GET /api/communities/:id/members` — any current member may view the
/// roster; a non-member gets 403 rather than 404, so the endpoint doesn't
/// leak whether a community exists to strangers (consistent with treating
/// membership, not mere authentication, as the visibility boundary).
pub async fn list_members(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(community_id): Path<Uuid>,
) -> Result<Json<Vec<MemberView>>, ApiError> {
    let caller_role = require_community_and_caller_role(&state, community_id, caller.id).await?;
    if caller_role.is_none() {
        return Err(ApiError::Forbidden);
    }
    let members = state.communities.list_members(community_id).await?;
    Ok(Json(members.into_iter().map(MemberView::from).collect()))
}

#[derive(Deserialize)]
pub struct AddMemberRequest {
    pub user_id: Uuid,
    pub role: Role,
}

/// `POST /api/communities/:id/members` — role-gated by `can_add_member`.
pub async fn add_member(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(community_id): Path<Uuid>,
    Json(req): Json<AddMemberRequest>,
) -> Result<Json<MemberView>, ApiError> {
    let caller_role = require_community_and_caller_role(&state, community_id, caller.id).await?;
    if !community_authz::can_add_member(caller_role, req.role) {
        return Err(ApiError::Forbidden);
    }
    if state.users.find_by_id(req.user_id).await?.is_none() {
        return Err(ApiError::NotFound("user not found"));
    }
    if state
        .communities
        .find_role(community_id, req.user_id)
        .await?
        .is_some()
    {
        return Err(ApiError::Conflict(
            "user is already a member of this community",
        ));
    }
    let member = state
        .communities
        .add_member(community_id, req.user_id, req.role)
        .await?;
    Ok(Json(member.into()))
}

#[derive(Deserialize)]
pub struct ChangeRoleRequest {
    pub role: Role,
}

/// `PATCH /api/communities/:id/members/:userId` — role-gated by
/// `can_change_role`, owner-only.
pub async fn change_role(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path((community_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<ChangeRoleRequest>,
) -> Result<Json<MemberView>, ApiError> {
    let caller_role = require_community_and_caller_role(&state, community_id, caller.id).await?;
    let target_role = state
        .communities
        .find_role(community_id, target_user_id)
        .await?
        .ok_or(ApiError::NotFound(
            "target is not a member of this community",
        ))?;
    let is_self = caller.id == target_user_id;
    if !community_authz::can_change_role(caller_role, target_role, is_self, req.role) {
        return Err(ApiError::Forbidden);
    }
    let member = state
        .communities
        .update_role(community_id, target_user_id, req.role)
        .await?
        .ok_or(ApiError::NotFound(
            "target is not a member of this community",
        ))?;
    Ok(Json(member.into()))
}

/// `DELETE /api/communities/:id/members/:userId` — role-gated by
/// `can_remove_member`.
pub async fn remove_member(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path((community_id, target_user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let caller_role = require_community_and_caller_role(&state, community_id, caller.id).await?;
    let target_role = state
        .communities
        .find_role(community_id, target_user_id)
        .await?
        .ok_or(ApiError::NotFound(
            "target is not a member of this community",
        ))?;
    let is_self = caller.id == target_user_id;
    if !community_authz::can_remove_member(caller_role, target_role, is_self) {
        return Err(ApiError::Forbidden);
    }
    let removed = state
        .communities
        .remove_member(community_id, target_user_id)
        .await?;
    if !removed {
        return Err(ApiError::NotFound(
            "target is not a member of this community",
        ));
    }
    Ok(Json(serde_json::json!({ "status": "removed" })))
}
