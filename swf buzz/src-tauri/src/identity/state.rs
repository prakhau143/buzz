//! In-memory identity state — the only place the private key lives at runtime.
//!
//! The `nostr::Keys` value never crosses the Tauri IPC boundary: the only thing
//! serialised to the webview is [`IdentityInfo`], which carries the *public*
//! key plus two status strings.

use std::fmt;
use std::sync::{Mutex, MutexGuard};

use nostr::{Keys, ToBech32};
use serde::Serialize;

/// Where the active identity is persisted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityStorage {
    /// No identity is loaded (first launch, or recovery is required).
    None,
    /// OS keyring (service `swf-buzz`) — the primary store.
    SystemKeyring,
    /// `identity.key` in the app data dir — only used when the keyring is unusable.
    LocalFile,
    /// Debug-build-only `SWF_BUZZ_PRIVATE_KEY` override (never persisted).
    Environment,
}

impl IdentityStorage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::SystemKeyring => "system-keyring",
            Self::LocalFile => "local-file",
            Self::Environment => "environment",
        }
    }
}

/// Why no identity is loaded even though one may exist. While any state other
/// than `None` is active, `create_identity` refuses: generating a fresh key
/// there could orphan (or overwrite) the user's real identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryState {
    None,
    /// Keyring unreachable, but a marker shows the key was stored there before.
    KeyringLocked,
    /// Keyring reachable and empty, but a marker shows a key was stored before.
    Lost,
    /// A stored value exists but cannot be parsed. Left untouched.
    Corrupt,
}

impl RecoveryState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::KeyringLocked => "keyring-locked",
            Self::Lost => "lost",
            Self::Corrupt => "corrupt",
        }
    }
}

/// What the webview is allowed to know. Never contains secret material.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IdentityInfo {
    /// Hex public key, or `None` when no identity is loaded.
    pub pubkey: Option<String>,
    /// Bech32 `npub1…` form of the same public key (for sharing/display).
    pub npub: Option<String>,
    pub storage: &'static str,
    pub recovery: &'static str,
}

/// Result of resolving (or creating) the identity.
pub struct Resolved {
    pub keys: Option<Keys>,
    pub storage: IdentityStorage,
    pub recovery: RecoveryState,
}

impl Resolved {
    pub fn empty(recovery: RecoveryState) -> Self {
        Self {
            keys: None,
            storage: IdentityStorage::None,
            recovery,
        }
    }

    pub fn loaded(keys: Keys, storage: IdentityStorage) -> Self {
        Self {
            keys: Some(keys),
            storage,
            recovery: RecoveryState::None,
        }
    }

    pub fn info(&self) -> IdentityInfo {
        IdentityInfo {
            pubkey: self.keys.as_ref().map(|k| k.public_key().to_hex()),
            npub: self
                .keys
                .as_ref()
                .and_then(|k| k.public_key().to_bech32().ok()),
            storage: self.storage.as_str(),
            recovery: self.recovery.as_str(),
        }
    }
}

impl Default for Resolved {
    fn default() -> Self {
        Self::empty(RecoveryState::None)
    }
}

// Hand-written so a stray `{:?}` can never print the secret key.
impl fmt::Debug for Resolved {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Resolved")
            .field(
                "pubkey",
                &self.keys.as_ref().map(|k| k.public_key().to_hex()),
            )
            .field("storage", &self.storage)
            .field("recovery", &self.recovery)
            .finish()
    }
}

/// Tauri-managed identity state.
#[derive(Default)]
pub struct IdentityState(Mutex<Resolved>);

impl IdentityState {
    /// Lock for a read-modify-write sequence (used by `create_identity` so two
    /// concurrent calls cannot both generate a key).
    pub fn lock(&self) -> Result<MutexGuard<'_, Resolved>, String> {
        self.0
            .lock()
            .map_err(|_| "identity state lock poisoned".to_string())
    }

    pub fn replace(&self, resolved: Resolved) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = resolved;
        }
    }

    pub fn info(&self) -> IdentityInfo {
        self.0
            .lock()
            .map(|guard| guard.info())
            .unwrap_or_else(|_| Resolved::default().info())
    }

    /// Clone of the signing keys, or an error when no identity is loaded.
    pub fn signing_keys(&self) -> Result<Keys, String> {
        let guard = self.lock()?;
        guard
            .keys
            .clone()
            .ok_or_else(|| "no identity is loaded".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_carries_public_key_only() {
        let keys = Keys::generate();
        let secret_hex = keys.secret_key().to_secret_hex();
        let resolved = Resolved::loaded(keys.clone(), IdentityStorage::SystemKeyring);

        let json = serde_json::to_string(&resolved.info()).unwrap();
        assert!(json.contains(&keys.public_key().to_hex()));
        assert!(
            !json.contains(&secret_hex),
            "secret hex leaked into IdentityInfo"
        );
        assert!(!json.contains("nsec"), "nsec leaked into IdentityInfo");
        assert!(json.contains("\"storage\":\"system-keyring\""));
        assert!(json.contains("\"recovery\":\"none\""));
    }

    #[test]
    fn debug_output_never_contains_the_secret() {
        let keys = Keys::generate();
        let secret_hex = keys.secret_key().to_secret_hex();
        let resolved = Resolved::loaded(keys, IdentityStorage::LocalFile);
        assert!(!format!("{resolved:?}").contains(&secret_hex));
    }

    #[test]
    fn empty_state_has_no_pubkey_and_no_signing_keys() {
        let state = IdentityState::default();
        assert_eq!(state.info().pubkey, None);
        assert_eq!(state.info().storage, "none");
        assert!(state.signing_keys().is_err());
    }

    #[test]
    fn replace_makes_signing_keys_available() {
        let state = IdentityState::default();
        let keys = Keys::generate();
        state.replace(Resolved::loaded(
            keys.clone(),
            IdentityStorage::SystemKeyring,
        ));
        assert_eq!(
            state.signing_keys().unwrap().public_key(),
            keys.public_key()
        );
    }
}
