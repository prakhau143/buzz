//! Tauri commands for the local identity.
//!
//! None of these returns the private key. The only secret-derived value that
//! ever leaves Rust is a NIP-49 `ncryptsec1…` blob (password-encrypted), and only
//! to the user, who asked for a backup.
//!
//! * `get_identity` — public key + status; never generates
//! * `create_identity` — generates a key **only** if none exists and no recovery
//!   state is active
//! * `import_identity` — nsec / hex / ncryptsec(+password); never replaces a
//!   working identity
//! * `replace_identity` — same input, but for a device that already has one: the
//!   old key is archived first, never deleted
//! * `delete_identity` — SWF sign-out: removes the current identity (and every
//!   archived copy this app made) from this device and proves nothing is left
//! * `create_identity_with_backup` — onboarding: generates a key only if none
//!   exists, encrypts it with the user's backup passphrase and returns, ONCE,
//!   the public key, the `nsec` and the `ncryptsec` for the mandatory backup
//!   screen (the only path that ever returns the secret; it cannot be re-read)
//! * `create_ncryptsec_backup` / `save_ncryptsec_backup` /
//!   `verify_ncryptsec_backup` — NIP-49 backup of the current identity
//! * `sign_event` — signs with the key held in Rust
//!
//! Every state change logs the resulting PUBLIC key to stderr (`swf-buzz:
//! identity <verb> — pubkey=…`) so `tauri dev` output is an audit trail of which
//! identity the device holds. Never the secret.

use nostr::{Event, ToBech32};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::state::{IdentityInfo, IdentityState};
use super::storage::{self, SecureKeyStore};
use super::{backup, data_dir, signing};

/// Public-key audit line for `tauri dev` output. `verb` is past tense.
fn log_identity(verb: &str, info: &IdentityInfo) {
    match &info.pubkey {
        Some(pk) => eprintln!(
            "swf-buzz: identity {verb} — storage={}, pubkey={pk}",
            info.storage
        ),
        None => eprintln!("swf-buzz: identity {verb} — no identity on this device"),
    }
}

#[tauri::command]
pub fn get_identity(state: State<'_, IdentityState>) -> IdentityInfo {
    state.info()
}

#[tauri::command]
pub async fn create_identity(app: AppHandle) -> Result<IdentityInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = data_dir(&app)?;
        let state = app.state::<IdentityState>();
        // Held for the whole check-generate-persist sequence so two concurrent
        // calls cannot both generate a key.
        let mut guard = state.lock()?;
        if guard.keys.is_some() {
            // Idempotent: never replace an existing identity.
            return Ok(guard.info());
        }
        let created = storage::create_identity(&SecureKeyStore, &dir, &guard)?;
        *guard = created;
        let info = guard.info();
        log_identity("created", &info);
        Ok(info)
    })
    .await
    .map_err(|e| format!("create_identity task failed: {e}"))?
}

/// What the onboarding backup screen shows — returned exactly once, by the call
/// that generated the key. `nsec` is the private key: the UI holds it in a
/// component-local value for that screen only and clears it on leaving.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedIdentityReveal {
    pub pubkey: String,
    pub npub: String,
    pub nsec: String,
    pub ncryptsec: String,
}

// Hand-written so a stray `{:?}` never prints the secret.
impl std::fmt::Debug for CreatedIdentityReveal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CreatedIdentityReveal")
            .field("pubkey", &self.pubkey)
            .finish_non_exhaustive()
    }
}

/// Onboarding (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §3c): generate
/// the identity **only if none exists**, persist it, encrypt it with `password`
/// (NIP-49, ≥ 12 chars) and return the one-time reveal for the mandatory backup
/// screen. Same refusal rules as `create_identity` — never replaces a key. The
/// passphrase is checked BEFORE anything is generated so a rejected passphrase
/// leaves the device exactly as it was.
#[tauri::command]
pub async fn create_identity_with_backup(
    password: String,
    app: AppHandle,
) -> Result<CreatedIdentityReveal, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if password.chars().count() < backup::MIN_PASSPHRASE_LEN {
            return Err(format!(
                "the backup passphrase must be at least {} characters",
                backup::MIN_PASSPHRASE_LEN
            ));
        }
        let dir = data_dir(&app)?;
        let state = app.state::<IdentityState>();
        let mut guard = state.lock()?;
        if guard.keys.is_some() {
            return Err("an identity already exists on this device".to_string());
        }
        let created = storage::create_identity(&SecureKeyStore, &dir, &guard)?;
        let keys = created
            .keys
            .clone()
            .ok_or_else(|| "identity was not created".to_string())?;
        let ncryptsec = backup::create_backup_blob(&keys, &password, backup::BACKUP_LOG_N)?;
        let reveal = CreatedIdentityReveal {
            pubkey: keys.public_key().to_hex(),
            npub: keys
                .public_key()
                .to_bech32()
                .map_err(|e| format!("encode npub: {e}"))?,
            nsec: keys
                .secret_key()
                .to_bech32()
                .map_err(|e| format!("encode identity: {e}"))?,
            ncryptsec,
        };
        *guard = created;
        log_identity("created (onboarding, backup shown once)", &guard.info());
        Ok(reveal)
    })
    .await
    .map_err(|e| format!("create_identity_with_backup task failed: {e}"))?
}

/// Which identity an import input would actually produce — **without storing
/// anything**. The import screen shows this for confirmation before committing.
///
/// This exists because of a real, silent failure mode: a 64-character hex value
/// is a *private* key by definition, but a Nostr **public** key is also 64 hex
/// characters. Pasting a public key therefore does not fail — it derives a
/// different, unrelated identity and stores that. (Observed: pasting the
/// operator's public key `0f61e5e4…` produced identity `7e13d4f6…`, which is why
/// sign-in landed on a member view instead of the Operator dashboard.) Nothing
/// can distinguish the two by format, so the app shows the resulting public key
/// and lets the person confirm it is the one they expect.
///
/// Returns public information only.
#[tauri::command]
pub async fn preview_identity_input(
    input: String,
    password: Option<String>,
    allow_raw_hex: Option<bool>,
) -> Result<IdentityPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let keys = backup::recover_keys_from_input(
            &input,
            password.as_deref(),
            allow_raw_hex.unwrap_or(false),
        )?;
        let pubkey = keys.public_key();
        Ok(IdentityPreview {
            pubkey: pubkey.to_hex(),
            npub: pubkey
                .to_bech32()
                .map_err(|e| format!("encode npub: {e}"))?,
            // A bare 64-char hex input is the ambiguous case worth warning about.
            looks_like_bare_hex: is_bare_hex_secret(&input),
        })
    })
    .await
    .map_err(|e| format!("preview_identity_input task failed: {e}"))?
}

/// The identity an import input resolves to. Public information only.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityPreview {
    pub pubkey: String,
    pub npub: String,
    /// The input was a bare 64-char hex value — i.e. indistinguishable in form
    /// from a public key, so the confirmation matters most here.
    pub looks_like_bare_hex: bool,
}

fn is_bare_hex_secret(input: &str) -> bool {
    let t = backup::normalize_key_input(input);
    t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit())
}

/// `input` is an `nsec1…`, a 64-char hex secret, or an `ncryptsec1…` (with
/// `password`). Decoding/decryption happens here, in Rust.
#[tauri::command]
pub async fn import_identity(
    input: String,
    password: Option<String>,
    allow_raw_hex: Option<bool>,
    app: AppHandle,
) -> Result<IdentityInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let keys = backup::recover_keys_from_input(
            &input,
            password.as_deref(),
            allow_raw_hex.unwrap_or(false),
        )?;
        let dir = data_dir(&app)?;
        let state = app.state::<IdentityState>();
        let mut guard = state.lock()?;
        let imported = storage::import_identity(&SecureKeyStore, &dir, &guard, keys)?;
        *guard = imported;
        let info = guard.info();
        log_identity("imported", &info);
        Ok(info)
    })
    .await
    .map_err(|e| format!("import_identity task failed: {e}"))?
}

/// Replaces the identity on this device with an imported one (same input
/// formats as `import_identity`). The old private key is archived first — see
/// `storage::replace_identity` — and the call fails without changing anything if
/// that is not possible.
#[tauri::command]
pub async fn replace_identity(
    input: String,
    password: Option<String>,
    allow_raw_hex: Option<bool>,
    app: AppHandle,
) -> Result<IdentityInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let keys = backup::recover_keys_from_input(
            &input,
            password.as_deref(),
            allow_raw_hex.unwrap_or(false),
        )?;
        let dir = data_dir(&app)?;
        let state = app.state::<IdentityState>();
        let mut guard = state.lock()?;
        let previous: String = guard
            .info()
            .pubkey
            .map(|p| p.chars().take(8).collect())
            .unwrap_or_default();
        let replaced = storage::replace_identity(&SecureKeyStore, &dir, &guard, keys)?;
        *guard = replaced;
        let info = guard.info();
        log_identity(&format!("replaced (previous {previous}… archived)"), &info);
        Ok(info)
    })
    .await
    .map_err(|e| format!("replace_identity task failed: {e}"))?
}

/// SWF shared-device sign-out (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md):
/// removes the current identity from the OS keyring / `identity.key`, every
/// archived copy this app made, and the identity metadata — then re-resolves and
/// only reports success when nothing is left. On failure the identity stays
/// loaded and the error says what could not be removed; the caller must not
/// pretend the identity is gone. Never returns key material.
#[tauri::command]
pub async fn delete_identity(app: AppHandle) -> Result<IdentityInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = data_dir(&app)?;
        let state = app.state::<IdentityState>();
        // Held for the whole remove-verify sequence so a concurrent sign-in
        // cannot observe (or sign with) a half-removed identity.
        let mut guard = state.lock()?;
        let was: String = guard
            .info()
            .pubkey
            .map(|p| p.chars().take(8).collect())
            .unwrap_or_default();
        let removed = storage::delete_identity(&SecureKeyStore, &dir, &guard)?;
        *guard = removed;
        eprintln!("swf-buzz: identity removed from this device — was pubkey={was}…");
        Ok(guard.info())
    })
    .await
    .map_err(|e| format!("delete_identity task failed: {e}"))?
}

/// Encrypts the current identity with `password` (≥ 12 chars) and returns the
/// `ncryptsec1…` blob after verifying it decrypts back to the same identity.
#[tauri::command]
pub async fn create_ncryptsec_backup(password: String, app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let keys = app.state::<IdentityState>().signing_keys()?;
        backup::create_backup_blob(&keys, &password, backup::BACKUP_LOG_N)
    })
    .await
    .map_err(|e| format!("backup task failed: {e}"))?
}

/// Writes a backup blob to a new file in the user's Downloads folder and
/// returns its path. Never overwrites an existing file.
#[tauri::command]
pub async fn save_ncryptsec_backup(ncryptsec: String, app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pubkey = app
            .state::<IdentityState>()
            .signing_keys()?
            .public_key()
            .to_hex();
        let dir = app
            .path()
            .download_dir()
            .or_else(|_| data_dir(&app))
            .map_err(|e| format!("backup folder: {e}"))?;
        let path = backup::write_backup_file(&dir, &ncryptsec, &pubkey)?;
        Ok(path.display().to_string())
    })
    .await
    .map_err(|e| format!("save backup task failed: {e}"))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupVerification {
    pub pubkey: String,
    pub npub: String,
    pub matches_current_identity: bool,
}

/// Decrypts a backup (in Rust) and reports which identity it belongs to — the
/// "test your backup" step. Returns only public information.
#[tauri::command]
pub async fn verify_ncryptsec_backup(
    ncryptsec: String,
    password: String,
    app: AppHandle,
) -> Result<BackupVerification, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let keys = backup::decrypt_ncryptsec(&ncryptsec, &password)?;
        let pubkey = keys.public_key();
        let current = app.state::<IdentityState>().info().pubkey;
        Ok(BackupVerification {
            pubkey: pubkey.to_hex(),
            npub: pubkey
                .to_bech32()
                .map_err(|e| format!("encode npub: {e}"))?,
            matches_current_identity: current.as_deref() == Some(pubkey.to_hex().as_str()),
        })
    })
    .await
    .map_err(|e| format!("verify backup task failed: {e}"))?
}

#[tauri::command]
pub fn sign_event(
    kind: u16,
    content: String,
    created_at: Option<u64>,
    tags: Vec<Vec<String>>,
    state: State<'_, IdentityState>,
) -> Result<Event, String> {
    let keys = state.signing_keys()?;
    signing::sign_event(&keys, kind, content, created_at, tags)
}

/// NIP-44 encrypt with the identity key. Required by NIP-RS read state, whose
/// `kind:30078` content is sealed to the author's own keypair.
#[tauri::command]
pub fn nip44_encrypt(
    recipient_pubkey: String,
    plaintext: String,
    state: State<'_, IdentityState>,
) -> Result<String, String> {
    let keys = state.signing_keys()?;
    signing::nip44_encrypt(&keys, &recipient_pubkey, &plaintext)
}

/// NIP-44 decrypt with the identity key.
#[tauri::command]
pub fn nip44_decrypt(
    sender_pubkey: String,
    ciphertext: String,
    state: State<'_, IdentityState>,
) -> Result<String, String> {
    let keys = state.signing_keys()?;
    signing::nip44_decrypt(&keys, &sender_pubkey, &ciphertext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    /// The onboarding reveal is the ONE value that carries the secret out of
    /// Rust. Its Debug output must never do so (a stray `{:?}` in a log line).
    #[test]
    fn created_identity_reveal_debug_never_prints_the_secret() {
        let keys = Keys::generate();
        let nsec = keys.secret_key().to_bech32().unwrap();
        let reveal = CreatedIdentityReveal {
            pubkey: keys.public_key().to_hex(),
            npub: keys.public_key().to_bech32().unwrap(),
            nsec: nsec.clone(),
            ncryptsec: "ncryptsec1notreal".to_string(),
        };
        let debug = format!("{reveal:?}");
        assert!(debug.contains(&keys.public_key().to_hex()));
        assert!(!debug.contains(&nsec), "nsec leaked into Debug output");
        assert!(
            !debug.contains("ncryptsec1"),
            "backup blob leaked into Debug output"
        );
    }

    /// The reveal's three secret-derived fields describe ONE identity: the
    /// nsec decodes to the stored key, and the ncryptsec decrypts to it with
    /// the passphrase the user chose (the same sequence the command runs).
    #[test]
    fn reveal_fields_all_describe_the_same_generated_identity() {
        let keys = Keys::generate();
        let password = "correct horse battery staple";
        let ncryptsec = backup::create_backup_blob(&keys, password, 12).unwrap();
        let nsec = keys.secret_key().to_bech32().unwrap();
        let from_nsec = Keys::parse(&nsec).unwrap();
        assert_eq!(from_nsec.public_key(), keys.public_key());
        let from_backup = backup::decrypt_ncryptsec(&ncryptsec, password).unwrap();
        assert_eq!(from_backup.public_key(), keys.public_key());
        // and a too-short passphrase is refused before any encryption
        assert!(backup::create_backup_blob(&keys, "short", 12).is_err());
    }

    /// The exact situation reported on this device: the operator's PUBLIC key
    /// pasted into the import box is accepted as a private key and derives a
    /// DIFFERENT identity. Nothing can tell the two apart by format — hence the
    /// preview/confirmation step. (Both values here are public keys.)
    #[test]
    fn a_public_key_pasted_as_hex_derives_a_different_identity() {
        const OPERATOR_PUBKEY: &str =
            "0f61e5e47ca8c4e22c64bab3a1163989a4e3a2d45d014e3d153f1c15b2320029";
        const DERIVED_INSTEAD: &str =
            "7e13d4f6938d2cd7355161d7c973c36dbcf8fd8924201d146cb27d99a9c15702";

        // Parsed as a SECRET key (what a 64-char hex input means), it yields
        // an unrelated public key — silently, with no error to surface.
        let keys = backup::recover_keys_from_input(OPERATOR_PUBKEY, None, true).unwrap();
        assert_eq!(keys.public_key().to_hex(), DERIVED_INSTEAD);
        assert_ne!(keys.public_key().to_hex(), OPERATOR_PUBKEY);

        // Which is exactly what the preview reports, so the UI can show it
        // before anything is stored.
        assert!(is_bare_hex_secret(OPERATOR_PUBKEY));
        assert!(is_bare_hex_secret(&format!("  {OPERATOR_PUBKEY}  ")));
        assert!(!is_bare_hex_secret("nsec1abc"));
        assert!(!is_bare_hex_secret(&"0".repeat(63)));
    }

    #[test]
    fn identity_log_line_carries_the_public_key_only() {
        let keys = Keys::generate();
        let info = super::super::state::Resolved::loaded(
            keys.clone(),
            super::super::state::IdentityStorage::SystemKeyring,
        )
        .info();
        // `log_identity` writes to stderr; what matters is the value it is given.
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains(&keys.public_key().to_hex()));
        assert!(!json.contains(&keys.secret_key().to_secret_hex()));
        log_identity("test", &info);
    }
}
