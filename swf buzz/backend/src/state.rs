use crate::jwks::JwksVerifier;
use crate::realtime::Broadcaster;
use crate::repo::{
    ChannelRepo, CommunityRepo, DmRepo, InviteRepo, MessageRepo, SessionRepo, UserRepo,
};
use chrono::Duration;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub users: Arc<dyn UserRepo>,
    pub sessions: Arc<dyn SessionRepo>,
    pub communities: Arc<dyn CommunityRepo>,
    pub invites: Arc<dyn InviteRepo>,
    pub channels: Arc<dyn ChannelRepo>,
    pub messages: Arc<dyn MessageRepo>,
    pub dms: Arc<dyn DmRepo>,
    pub jwks: Arc<JwksVerifier>,
    pub session_ttl: Duration,
    pub invite_base_url: String,
    /// Realtime message fan-out (Phase 6) -- process-local, not shared
    /// across multiple backend instances. Fine for this phase's single-node
    /// scope; a multi-instance deployment would need a shared pub/sub
    /// backend instead (e.g. Postgres LISTEN/NOTIFY or Redis) -- noted as a
    /// known limitation, not built here.
    pub realtime: Broadcaster,
}
