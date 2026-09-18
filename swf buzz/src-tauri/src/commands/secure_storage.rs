//! Narrow, whitelisted secure-storage commands. Deliberately NOT a generic
//! key-value store exposed to arbitrary frontend keys — only the specific
//! logical items this app needs are representable, so a compromised renderer
//! can't repurpose this into an arbitrary secrets store.

use crate::storage::secure_store;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageKey {
    /// Ephemeral local transport keypair used to encrypt the NIP-46 RPC
    /// channel to a bunker. This is NOT the user's Nostr identity key.
    Nip46TransportSecretKey,
    /// The bunker connection pointer (relays + remote pubkey) from pairing.
    Nip46BunkerPointer,
    /// Opaque bearer session token for the new `swf-buzz-backend` service
    /// (DECISIONS.md D10) — minted by `POST /api/session/bootstrap` right
    /// after Okta login, sent as `Authorization: Bearer <token>` on every
    /// subsequent frontend→backend call. Not a Nostr-related secret; kept in
    /// the same OS-keychain store because it is the same class of thing
    /// (a bearer credential this app must not lose across restarts but must
    /// never leak to a compromised renderer's arbitrary read). See
    /// docs/BACKEND_SESSION_DESIGN.md.
    SwfSessionToken,
}

impl StorageKey {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            StorageKey::Nip46TransportSecretKey => "nip46_transport_secret_key",
            StorageKey::Nip46BunkerPointer => "nip46_bunker_pointer",
            StorageKey::SwfSessionToken => "swf_session_token",
        }
    }
}

#[tauri::command]
pub fn secure_storage_get(key: StorageKey) -> Result<Option<String>, String> {
    secure_store::get(key.as_str()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_storage_set(key: StorageKey, value: String) -> Result<(), String> {
    secure_store::set(key.as_str(), &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_storage_delete(key: StorageKey) -> Result<(), String> {
    secure_store::delete(key.as_str()).map_err(|e| e.to_string())
}
