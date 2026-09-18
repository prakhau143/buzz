pub mod channels;
pub mod communities;
pub mod dm;
pub mod invites;
pub mod messages;
pub mod realtime;
pub mod session;

use crate::state::AppState;
use axum::routing::{get, patch, post};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};

/// The frontend (Vite dev server, a different origin — `http://localhost:1420`
/// — from this backend's `http://127.0.0.1:8787`) needs an explicit CORS
/// policy or the browser blocks every request at the preflight stage before
/// this backend's own bearer-token auth ever runs. Permissive-on-origin is
/// acceptable here specifically because auth is a bearer token in the
/// `Authorization` header, not a cookie — this backend never sets
/// `Access-Control-Allow-Credentials`, so a third-party page still can't
/// silently ride an authenticated session the way it could with cookies.
/// Tighten `allow_origin` to the real deployed frontend origin(s) before
/// production use.
fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/session/bootstrap", post(session::bootstrap))
        .route("/api/session", get(session::get_session))
        .route("/api/session/logout", post(session::logout))
        .route("/api/communities", post(communities::create_community))
        .route(
            "/api/communities/{id}/members",
            get(communities::list_members).post(communities::add_member),
        )
        .route(
            "/api/communities/{id}/members/{user_id}",
            patch(communities::change_role).delete(communities::remove_member),
        )
        .route(
            "/api/communities/{id}/invites",
            post(invites::create_invite),
        )
        .route("/api/invites/claim", post(invites::claim_invite))
        .route("/api/invites/{id}/revoke", post(invites::revoke_invite))
        .route("/api/invites/{token}/preview", get(invites::preview_invite))
        .route(
            "/api/communities/{id}/channels",
            get(channels::list_channels).post(channels::create_channel),
        )
        .route(
            "/api/channels/{id}/members",
            get(channels::list_members).post(channels::add_member),
        )
        .route(
            "/api/channels/{id}/members/{user_id}",
            patch(channels::change_role).delete(channels::remove_member),
        )
        .route(
            "/api/channels/{id}/messages",
            get(messages::list_messages).post(messages::send_message),
        )
        .route(
            "/api/messages/thread-summaries",
            get(messages::thread_summaries),
        )
        .route("/api/messages/{root_id}/thread", get(messages::get_thread))
        .route("/api/dm", get(dm::list_conversations))
        .route("/api/dm/open", post(dm::open_dm))
        .route(
            "/api/dm/{id}/messages",
            get(dm::list_dm_messages).post(dm::send_dm_message),
        )
        .route("/ws", get(realtime::upgrade))
        .with_state(state)
        .layer(cors_layer())
}
