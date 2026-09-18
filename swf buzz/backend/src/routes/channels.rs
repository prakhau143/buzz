//! Phase 5 (DECISIONS.md D10): channels and channel membership. A separate
//! permission plane from community roles (`channel_authz.rs`, not
//! `community_authz.rs`) -- a community owner is NOT automatically a
//! channel owner/member of any given channel; only an actual
//! `channel_members` row governs channel authorization here. Every handler
//! first confirms the caller is at least a community member (any role) of
//! the channel's parent community -- channels are scoped inside a
//! community, not globally visible -- see docs/CHANNEL_MEMBERSHIP_DESIGN.md.

use crate::auth::AuthUser;
use crate::channel_authz;
use crate::error::ApiError;
use crate::models::{Channel, ChannelMember, ChannelVisibility, Role};
use crate::routes::communities::require_community_and_caller_role;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize)]
pub struct ChannelView {
    pub id: Uuid,
    pub community_id: Uuid,
    pub name: String,
    pub visibility: ChannelVisibility,
    pub description: Option<String>,
}

impl From<Channel> for ChannelView {
    fn from(c: Channel) -> Self {
        ChannelView {
            id: c.id,
            community_id: c.community_id,
            name: c.name,
            visibility: c.visibility,
            description: c.description,
        }
    }
}

#[derive(Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub visibility: ChannelVisibility,
    pub description: Option<String>,
}

/// `POST /api/communities/:id/channels` — ungated: any community member,
/// no role gate (master prompt §18; OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md row
/// "Channel creation": "ungated ... any member"). The creator is
/// auto-inserted as channel `owner`.
pub async fn create_channel(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(community_id): Path<Uuid>,
    Json(req): Json<CreateChannelRequest>,
) -> Result<Json<ChannelView>, ApiError> {
    let caller_role = require_community_and_caller_role(&state, community_id, caller.id).await?;
    if caller_role.is_none() {
        return Err(ApiError::Forbidden);
    }
    let channel = state
        .channels
        .create_channel(
            community_id,
            &req.name,
            req.visibility,
            req.description.as_deref(),
            caller.id,
        )
        .await?;
    Ok(Json(channel.into()))
}

/// `GET /api/communities/:id/channels` — every `open` channel in the
/// community plus any `private` one the caller already belongs to.
/// Requires community membership (any role); channels aren't visible to
/// strangers outside the community at all.
pub async fn list_channels(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(community_id): Path<Uuid>,
) -> Result<Json<Vec<ChannelView>>, ApiError> {
    let caller_role = require_community_and_caller_role(&state, community_id, caller.id).await?;
    if caller_role.is_none() {
        return Err(ApiError::Forbidden);
    }
    let channels = state
        .channels
        .list_visible_channels(community_id, caller.id)
        .await?;
    Ok(Json(channels.into_iter().map(ChannelView::from).collect()))
}

async fn load_channel(state: &AppState, channel_id: Uuid) -> Result<Channel, ApiError> {
    state
        .channels
        .find_channel(channel_id)
        .await?
        .ok_or(ApiError::NotFound("channel not found"))
}

/// Every mutating channel handler needs this: confirm the channel exists,
/// confirm the caller is at least a community member of its parent
/// community (channels are not visible/actionable by strangers outside the
/// community even for an `open` channel), and return the loaded channel.
pub(crate) async fn require_channel_and_community_membership(
    state: &AppState,
    channel_id: Uuid,
    caller_id: Uuid,
) -> Result<Channel, ApiError> {
    let channel = load_channel(state, channel_id).await?;
    let community_role =
        require_community_and_caller_role(state, channel.community_id, caller_id).await?;
    if community_role.is_none() {
        return Err(ApiError::Forbidden);
    }
    Ok(channel)
}

#[derive(Serialize)]
pub struct ChannelMemberView {
    pub user_id: Uuid,
    pub role: Role,
    pub joined_at: DateTime<Utc>,
}

impl From<ChannelMember> for ChannelMemberView {
    fn from(m: ChannelMember) -> Self {
        ChannelMemberView {
            user_id: m.user_id,
            role: m.role,
            joined_at: m.joined_at,
        }
    }
}

/// `GET /api/channels/:id/members` — requires the caller to already be a
/// channel member (same "membership is the minimum bar to view" precedent
/// as `communities::list_members`), regardless of channel visibility.
pub async fn list_members(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Vec<ChannelMemberView>>, ApiError> {
    require_channel_and_community_membership(&state, channel_id, caller.id).await?;
    let caller_channel_role = state
        .channels
        .find_channel_role(channel_id, caller.id)
        .await?;
    if caller_channel_role.is_none() {
        return Err(ApiError::Forbidden);
    }
    let members = state.channels.list_channel_members(channel_id).await?;
    Ok(Json(
        members.into_iter().map(ChannelMemberView::from).collect(),
    ))
}

#[derive(Deserialize)]
pub struct AddChannelMemberRequest {
    pub user_id: Uuid,
    pub role: Role,
}

/// `POST /api/channels/:id/members` — open channel: any community member
/// may open the add flow (including self-add); private channel: the actor
/// must already be a channel member. Granting an elevated role
/// (admin/owner) requires the actor to already be elevated — channel
/// admins may grant channel-owner too (intentional asymmetry vs. the
/// community plane, see docs/CHANNEL_MEMBERSHIP_DESIGN.md).
pub async fn add_member(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<AddChannelMemberRequest>,
) -> Result<Json<ChannelMemberView>, ApiError> {
    let channel = require_channel_and_community_membership(&state, channel_id, caller.id).await?;

    // The target must themselves be a member of the parent community --
    // channel membership is a subset of community membership, never wider.
    if state
        .communities
        .find_role(channel.community_id, req.user_id)
        .await?
        .is_none()
    {
        return Err(ApiError::NotFound(
            "target is not a member of this community",
        ));
    }

    let actor_channel_role = state
        .channels
        .find_channel_role(channel_id, caller.id)
        .await?;
    if !channel_authz::can_open_add_flow(actor_channel_role, channel.visibility)
        || !channel_authz::can_grant_channel_role(actor_channel_role, req.role)
    {
        return Err(ApiError::Forbidden);
    }
    if state
        .channels
        .find_channel_role(channel_id, req.user_id)
        .await?
        .is_some()
    {
        return Err(ApiError::Conflict(
            "user is already a member of this channel",
        ));
    }
    let member = state
        .channels
        .add_channel_member(channel_id, req.user_id, req.role)
        .await?;
    Ok(Json(member.into()))
}

/// Loads the channel roster and decides whether acting on `target_user_id`
/// with `becomes_non_owner` would orphan the channel (mirrors
/// `channel_authz::would_orphan_channel`, resolving `target_is_sole_owner`
/// from the actual roster rather than trusting anything client-supplied).
async fn target_member_and_orphan_check(
    state: &AppState,
    channel_id: Uuid,
    target_user_id: Uuid,
    becomes_non_owner: bool,
) -> Result<ChannelMember, ApiError> {
    let members = state.channels.list_channel_members(channel_id).await?;
    let target = members
        .iter()
        .find(|m| m.user_id == target_user_id)
        .cloned()
        .ok_or(ApiError::NotFound("target is not a member of this channel"))?;
    let is_sole_owner =
        target.role == Role::Owner && members.iter().filter(|m| m.role == Role::Owner).count() == 1;
    if channel_authz::would_orphan_channel(is_sole_owner, becomes_non_owner) {
        return Err(ApiError::Forbidden);
    }
    Ok(target)
}

#[derive(Deserialize)]
pub struct ChangeChannelRoleRequest {
    pub role: Role,
}

/// `PATCH /api/channels/:id/members/:userId` — owner/admin only
/// (`can_manage_channel_member`), blocked if it would demote the channel's
/// sole owner to a non-owner role. No self-role-change immunity, unlike
/// the community plane — mirrors `channelPermissions.ts` exactly.
pub async fn change_role(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path((channel_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<ChangeChannelRoleRequest>,
) -> Result<Json<ChannelMemberView>, ApiError> {
    require_channel_and_community_membership(&state, channel_id, caller.id).await?;
    let actor_channel_role = state
        .channels
        .find_channel_role(channel_id, caller.id)
        .await?;
    if !channel_authz::can_manage_channel_member(actor_channel_role)
        || !channel_authz::can_grant_channel_role(actor_channel_role, req.role)
    {
        return Err(ApiError::Forbidden);
    }
    target_member_and_orphan_check(&state, channel_id, target_user_id, req.role != Role::Owner)
        .await?;
    let updated = state
        .channels
        .update_channel_role(channel_id, target_user_id, req.role)
        .await?
        .ok_or(ApiError::NotFound("target is not a member of this channel"))?;
    Ok(Json(updated.into()))
}

/// `DELETE /api/channels/:id/members/:userId` — owner/admin only, blocked
/// if the target is the channel's sole owner (would orphan it). No
/// self-removal immunity, unlike the community plane.
pub async fn remove_member(
    State(state): State<AppState>,
    AuthUser(caller): AuthUser,
    Path((channel_id, target_user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_channel_and_community_membership(&state, channel_id, caller.id).await?;
    let actor_channel_role = state
        .channels
        .find_channel_role(channel_id, caller.id)
        .await?;
    if !channel_authz::can_manage_channel_member(actor_channel_role) {
        return Err(ApiError::Forbidden);
    }
    target_member_and_orphan_check(&state, channel_id, target_user_id, true).await?;
    let removed = state
        .channels
        .remove_channel_member(channel_id, target_user_id)
        .await?;
    if !removed {
        return Err(ApiError::NotFound("target is not a member of this channel"));
    }
    Ok(Json(serde_json::json!({ "status": "removed" })))
}
