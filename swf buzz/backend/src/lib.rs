//! SWF Buzz backend — no-Nostr-human-identity migration (DECISIONS.md D10).
//! Phase 2: Okta-verified session issuance. Phase 3: community membership
//! and roles. Phase 4: community invites. Phase 5: channels and channel
//! membership. Phase 6: channel messages (HTTP write/read + WebSocket
//! realtime fan-out). Phase 7: threaded replies. Phase 8: direct messages.
//! This is the last backend phase of the migration (see
//! docs/OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md §3) — frontend rewiring across the
//! existing Nostr-based UI is what remains.

pub mod auth;
pub mod channel_authz;
pub mod community_authz;
pub mod config;
pub mod error;
pub mod invite_authz;
pub mod jwks;
pub mod models;
pub mod realtime;
pub mod repo;
pub mod routes;
pub mod state;
pub mod token;

use crate::config::Config;
use crate::jwks::JwksVerifier;
use crate::repo::postgres::PostgresRepo;
use crate::state::AppState;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

pub async fn build_state(config: &Config) -> Result<AppState, anyhow::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let repo = Arc::new(PostgresRepo::new(pool));
    Ok(AppState {
        users: repo.clone(),
        sessions: repo.clone(),
        communities: repo.clone(),
        invites: repo.clone(),
        channels: repo.clone(),
        messages: repo.clone(),
        dms: repo,
        jwks: Arc::new(JwksVerifier::new(
            config.okta_issuer.clone(),
            config.okta_client_id.clone(),
        )),
        session_ttl: chrono::Duration::hours(config.session_ttl_hours),
        invite_base_url: config.invite_base_url.clone(),
        realtime: crate::realtime::Broadcaster::new(),
    })
}
