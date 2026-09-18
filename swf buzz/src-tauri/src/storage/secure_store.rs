//! Thin wrapper around the OS keychain via the `keyring` crate.
//!
//! What this stores: non-secret session material and the NIP-46 transport
//! keypair used to talk to a remote signer (bunker). It NEVER stores a Nostr
//! account private key — signing happens remotely via the bunker; see
//! docs/SECURITY.md. Values are stored as individual keychain entries scoped
//! under one service name, one entry per logical key, so a single compromised
//! key does not require re-authenticating the whole blob.

use keyring::Entry;
use thiserror::Error;

const SERVICE_NAME: &str = "swf-buzz";

#[derive(Debug, Error)]
pub enum SecureStoreError {
    #[error("keychain unavailable: {0}")]
    Backend(String),
    #[error("no value stored for this key")]
    NotFound,
}

fn entry_for(key: &str) -> Result<Entry, SecureStoreError> {
    Entry::new(SERVICE_NAME, key).map_err(|e| SecureStoreError::Backend(e.to_string()))
}

pub fn get(key: &str) -> Result<Option<String>, SecureStoreError> {
    match entry_for(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(SecureStoreError::Backend(e.to_string())),
    }
}

pub fn set(key: &str, value: &str) -> Result<(), SecureStoreError> {
    entry_for(key)?
        .set_password(value)
        .map_err(|e| SecureStoreError::Backend(e.to_string()))
}

pub fn delete(key: &str) -> Result<(), SecureStoreError> {
    match entry_for(key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(SecureStoreError::Backend(e.to_string())),
    }
}

#[allow(dead_code)]
pub fn require(key: &str) -> Result<String, SecureStoreError> {
    get(key)?.ok_or(SecureStoreError::NotFound)
}
