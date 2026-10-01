//! Local Nostr identity for SWF Buzz humans (OLD BUZZ model — no Okta).
//!
//! First launch creates a secp256k1 keypair **in Rust**; the private key is
//! stored in the OS keyring (service `swf-buzz`) and never enters the webview.
//! The public key is the user's identity. See
//! `docs/SWF_BUZZ_OLD_BUZZ_IDENTITY_MIGRATION_PLAN.md` §7-§8.

pub mod backup;
pub mod commands;
pub mod signing;
pub mod state;
pub mod storage;

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

pub use state::IdentityState;

/// Debug-build-only identity override (handy for running two identities on one
/// machine). Release builds ignore it entirely.
const ENV_OVERRIDE: &str = "SWF_BUZZ_PRIVATE_KEY";

/// Debug-build-only profile name (`SWF_BUZZ_PROFILE=alice`). It gives a run its own
/// keyring entry and data directory, so several *different* identities can be
/// exercised on one machine (one app instance at a time) without ever touching
/// the real identity. Release builds ignore it entirely.
const ENV_PROFILE: &str = "SWF_BUZZ_PROFILE";

/// The validated profile name, or `None` (always `None` in release builds).
pub(crate) fn profile() -> Option<&'static str> {
    static PROFILE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    PROFILE
        .get_or_init(|| {
            if !cfg!(debug_assertions) {
                return None;
            }
            std::env::var(ENV_PROFILE).ok().filter(|name| {
                !name.is_empty()
                    && name.len() <= 32
                    && name
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            })
        })
        .as_deref()
}

pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    Ok(match profile() {
        Some(name) => base.join("profiles").join(name),
        None => base,
    })
}

/// Load the persisted identity into managed state. Called once from `setup()`.
/// Never generates a key and never fails startup: on any problem the state is
/// left empty and the login screen reports it.
pub fn init(app: &AppHandle) {
    let dir = match data_dir(app) {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("swf-buzz: identity not loaded: {e}");
            return;
        }
    };

    let env_key = if cfg!(debug_assertions) {
        std::env::var(ENV_OVERRIDE).ok()
    } else {
        None
    };

    let resolved = storage::resolve_identity(&storage::SecureKeyStore, &dir, env_key.as_deref());
    eprintln!(
        "swf-buzz: identity resolved — storage={}, recovery={}, pubkey={}",
        resolved.storage.as_str(),
        resolved.recovery.as_str(),
        resolved.info().pubkey.as_deref().unwrap_or("<none>")
    );
    app.state::<IdentityState>().replace(resolved);
}
