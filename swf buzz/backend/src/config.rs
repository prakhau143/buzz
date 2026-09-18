/// Reuses the exact env var names `src-tauri/src/auth/oidc.rs` already
/// defines (`SWF_BUZZ_OKTA_ISSUER`/`SWF_BUZZ_OKTA_CLIENT_ID`) — this backend
/// verifies the same Okta application's tokens, so it is the same
/// issuer/audience, not a second configuration surface to keep in sync by
/// hand.
pub struct Config {
    pub okta_issuer: String,
    pub okta_client_id: String,
    pub database_url: String,
    pub bind_addr: String,
    pub session_ttl_hours: i64,
    /// Origin used to build invite URLs (`{invite_base_url}/invite/{code}`).
    /// Defaults to the frontend's own local dev origin -- must be set to
    /// the real deployed frontend origin in any other environment.
    pub invite_base_url: String,
}

#[derive(Debug, thiserror::Error)]
#[error("missing or empty required env var: {0}")]
pub struct ConfigError(pub &'static str);

fn require_env(name: &'static str) -> Result<String, ConfigError> {
    let value = std::env::var(name).map_err(|_| ConfigError(name))?;
    if value.trim().is_empty() {
        return Err(ConfigError(name));
    }
    Ok(value)
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Ok(Config {
            okta_issuer: require_env("SWF_BUZZ_OKTA_ISSUER")?
                .trim_end_matches('/')
                .to_string(),
            okta_client_id: require_env("SWF_BUZZ_OKTA_CLIENT_ID")?,
            database_url: require_env("DATABASE_URL")?,
            bind_addr: std::env::var("SWF_BACKEND_BIND_ADDR")
                .unwrap_or_else(|_| "127.0.0.1:8787".to_string()),
            session_ttl_hours: std::env::var("SWF_BACKEND_SESSION_TTL_HOURS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(12),
            invite_base_url: std::env::var("SWF_BACKEND_INVITE_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:5173".to_string())
                .trim_end_matches('/')
                .to_string(),
        })
    }
}
