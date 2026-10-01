//! Identity persistence and resolution — a behavioural port of the reference
//! Buzz desktop's `app_state.rs`, reduced to what login needs.
//!
//! Resolution order (first hit wins):
//!
//! 1. debug-build-only `SWF_BUZZ_PRIVATE_KEY` override
//! 2. OS keyring, service `swf-buzz`, entry [`IDENTITY_KEY_NAME`]
//! 3. `identity.key` in the app data dir (fallback when the keyring is unusable)
//! 4. nothing → the caller may call [`create_identity`] (first launch)
//!
//! **A key is generated only from `create_identity`, and only when nothing was
//! found and no recovery state is active.** Resolution itself never generates.
//! The two marker/recovery rules below exist so a temporarily locked or wiped
//! keyring is never mistaken for "first launch" (which would silently mint a
//! second identity).
//!
//! **Sign-out removes the identity from the device** ([`delete_identity`]).
//! This is a deliberate SWF shared-device policy, *not* OLD BUZZ parity (OLD
//! BUZZ keeps the key on sign-out). Every place a secret can live is covered:
//!
//! | location                                   | deleted by `delete_identity` |
//! |--------------------------------------------|------------------------------|
//! | keyring `identity_nsec[.<profile>]`        | yes                          |
//! | `identity.key` (fallback file)             | yes, if it holds this key    |
//! | keyring `identity_previous_<pubkey8>`      | yes — this key's, and every  |
//! |                                            | one recorded in the manifest |
//! | `identity.previous-<pubkey8>.key`          | yes, all of them             |
//! | `identity.keyring` marker                  | yes (else "lost" would show) |
//! | `identity.archives` manifest               | yes                          |
//! | `SWF_BUZZ_PRIVATE_KEY` (debug env)         | cannot — refused             |
//! | `identity.key.corrupt-<ts>` (unreadable)   | left alone (not a usable key)|

use std::fs;
use std::io::Write;
use std::path::Path;

use nostr::{Keys, ToBech32};

use super::state::{IdentityStorage, RecoveryState, Resolved};

/// Keyring entry name. Deliberately **not** a variant of
/// `commands::secure_storage::StorageKey`, so the JS-callable
/// `secure_storage_*` commands can never read or overwrite the identity.
pub const IDENTITY_KEY_NAME: &str = "identity_nsec";

const IDENTITY_FILE: &str = "identity.key";

/// Written after the key has been stored in the keyring at least once. Lets us
/// tell "first launch" apart from "keyring is locked / was cleared".
const KEYRING_MARKER: &str = "identity.keyring";

/// Labels (`<pubkey8>`) of every keyring archive this app created through
/// `replace_identity`, one per line. The OS keyring cannot be enumerated, so
/// this is how sign-out knows which archived copies to remove. Holds no key
/// material — only the first 8 hex chars of *public* keys.
const ARCHIVE_MANIFEST: &str = "identity.archives";

const FILE_ARCHIVE_PREFIX: &str = "identity.previous-";
const FILE_ARCHIVE_SUFFIX: &str = ".key";

/// Minimal key-value surface over the OS keyring; a trait so resolution can be
/// unit-tested against a fake without touching the real keyring.
pub trait KeyStore {
    fn load(&self) -> Result<Option<String>, String>;
    fn save(&self, nsec: &str) -> Result<(), String>;
    /// Keep a copy of an identity that is about to be replaced, under a separate
    /// entry named after `label`. Never overwrites the live identity entry.
    fn archive(&self, label: &str, nsec: &str) -> Result<(), String>;
    /// Remove the live identity entry. An absent entry is success.
    fn delete(&self) -> Result<(), String>;
    /// Remove an archived copy made by [`KeyStore::archive`]. Absent is success.
    fn delete_archive(&self, label: &str) -> Result<(), String>;
}

/// The keyring entry for the live identity (`identity_nsec`, plus the debug
/// profile suffix when one is active).
fn live_entry() -> String {
    match super::profile() {
        Some(name) => format!("{IDENTITY_KEY_NAME}.{name}"),
        None => IDENTITY_KEY_NAME.to_string(),
    }
}

/// The keyring entry for an archived identity (`identity_previous_<label>`,
/// plus the debug profile suffix when one is active).
fn archive_entry(label: &str) -> String {
    let entry = format!("identity_previous_{label}");
    match super::profile() {
        Some(name) => format!("{entry}.{name}"),
        None => entry,
    }
}

/// The real store: reuses the existing `swf-buzz` keyring wrapper.
pub struct SecureKeyStore;

impl KeyStore for SecureKeyStore {
    fn load(&self) -> Result<Option<String>, String> {
        crate::storage::secure_store::get(&live_entry()).map_err(|e| e.to_string())
    }

    fn save(&self, nsec: &str) -> Result<(), String> {
        crate::storage::secure_store::set(&live_entry(), nsec).map_err(|e| e.to_string())
    }

    fn archive(&self, label: &str, nsec: &str) -> Result<(), String> {
        let entry = archive_entry(label);
        crate::storage::secure_store::set(&entry, nsec).map_err(|e| e.to_string())?;
        // Prove the copy is readable before the caller is allowed to replace anything.
        match crate::storage::secure_store::get(&entry) {
            Ok(Some(back)) if back.trim() == nsec => Ok(()),
            _ => Err("the archived copy could not be read back".to_string()),
        }
    }

    fn delete(&self) -> Result<(), String> {
        crate::storage::secure_store::delete(&live_entry()).map_err(|e| e.to_string())
    }

    fn delete_archive(&self, label: &str) -> Result<(), String> {
        crate::storage::secure_store::delete(&archive_entry(label)).map_err(|e| e.to_string())
    }
}

enum FileState {
    Missing,
    Valid(Keys),
    Corrupt,
}

fn read_file(path: &Path) -> FileState {
    match fs::read_to_string(path) {
        Ok(text) => match Keys::parse(text.trim()) {
            Ok(keys) => FileState::Valid(keys),
            Err(_) => FileState::Corrupt,
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => FileState::Missing,
        // Unreadable (permissions etc.) — treat like corrupt: never overwrite.
        Err(_) => FileState::Corrupt,
    }
}

/// `create_new` guarantees an existing file is never overwritten.
fn write_file(path: &Path, nsec: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create identity dir: {e}"))?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("create identity.key: {e}"))?;
    file.write_all(nsec.as_bytes())
        .map_err(|e| format!("write identity.key: {e}"))
}

/// Resolve the identity. Never generates a key.
///
/// `env_key` is the raw `SWF_BUZZ_PRIVATE_KEY` value; the caller passes it only
/// in debug builds.
pub fn resolve_identity(store: &dyn KeyStore, data_dir: &Path, env_key: Option<&str>) -> Resolved {
    if let Some(raw) = env_key {
        match Keys::parse(raw.trim()) {
            Ok(keys) => return Resolved::loaded(keys, IdentityStorage::Environment),
            Err(_) => eprintln!("swf-buzz: SWF_BUZZ_PRIVATE_KEY is set but invalid — ignoring it"),
        }
    }

    let file_path = data_dir.join(IDENTITY_FILE);
    let marker_present = data_dir.join(KEYRING_MARKER).exists();

    match store.load() {
        Ok(Some(nsec)) => match Keys::parse(nsec.trim()) {
            Ok(keys) => {
                if !marker_present {
                    // Best effort: keeps lost/locked detection working after a
                    // marker was deleted. Failure is harmless.
                    let _ = fs::create_dir_all(data_dir)
                        .and_then(|_| fs::write(data_dir.join(KEYRING_MARKER), b"1"));
                }
                Resolved::loaded(keys, IdentityStorage::SystemKeyring)
            }
            // Leave the unreadable entry exactly as it is.
            Err(_) => Resolved::empty(RecoveryState::Corrupt),
        },
        Ok(None) => match read_file(&file_path) {
            FileState::Valid(keys) => Resolved::loaded(keys, IdentityStorage::LocalFile),
            FileState::Corrupt => Resolved::empty(RecoveryState::Corrupt),
            FileState::Missing if marker_present => Resolved::empty(RecoveryState::Lost),
            FileState::Missing => Resolved::default(),
        },
        Err(e) => {
            eprintln!("swf-buzz: keyring unavailable: {e}");
            match read_file(&file_path) {
                FileState::Valid(keys) => Resolved::loaded(keys, IdentityStorage::LocalFile),
                FileState::Corrupt => Resolved::empty(RecoveryState::Corrupt),
                FileState::Missing if marker_present => {
                    Resolved::empty(RecoveryState::KeyringLocked)
                }
                // Keyring unusable and nothing was ever stored: a legitimate
                // first launch — `create_identity` will fall back to the file.
                FileState::Missing => Resolved::default(),
            }
        }
    }
}

/// Generate and persist a new identity. Refuses unless `current` says there is
/// nothing to protect (no loaded key, no recovery state).
///
/// Persists to the keyring and verifies the round trip; if that fails, falls
/// back to `identity.key`. Never returns the secret.
pub fn create_identity(
    store: &dyn KeyStore,
    data_dir: &Path,
    current: &Resolved,
) -> Result<Resolved, String> {
    if current.keys.is_some() {
        return Err("an identity already exists".to_string());
    }
    match current.recovery {
        RecoveryState::KeyringLocked => return Err(
            "secure storage is locked — unlock it and restart the app; not creating a new identity"
                .to_string(),
        ),
        RecoveryState::Corrupt => {
            return Err(
                "the stored identity could not be read — not overwriting it with a new one"
                    .to_string(),
            )
        }
        RecoveryState::None | RecoveryState::Lost => {}
    }

    persist_keys(store, data_dir, Keys::generate())
}

/// Import an existing identity (already decoded from nsec / hex / ncryptsec).
///
/// Allowed only when there is nothing to lose: no identity loaded, and the
/// keyring is not merely locked. It never *replaces* a working identity — the
/// user would have to back that one up first. A *corrupt* stored entry is
/// exactly what an import is for: an unreadable identity file is moved aside
/// (never deleted) and the keyring entry is overwritten.
pub fn import_identity(
    store: &dyn KeyStore,
    data_dir: &Path,
    current: &Resolved,
    keys: Keys,
) -> Result<Resolved, String> {
    if current.keys.is_some() {
        return Err(
            "an identity already exists on this device — importing would replace it".to_string(),
        );
    }
    if current.recovery == RecoveryState::KeyringLocked {
        return Err(
            "secure storage is locked — unlock it and restart the app before importing".to_string(),
        );
    }
    if current.recovery == RecoveryState::Corrupt {
        let file = data_dir.join(IDENTITY_FILE);
        if file.exists() {
            let aside = data_dir.join(format!("{IDENTITY_FILE}.corrupt-{}", unix_seconds()));
            fs::rename(&file, &aside)
                .map_err(|e| format!("move the unreadable identity aside: {e}"))?;
        }
    }
    persist_keys(store, data_dir, keys)
}

/// Replace the working identity with `keys` — only after the current one has been
/// kept somewhere safe.
///
/// The old private key is **archived, never deleted**: as a separate keyring
/// entry (`identity_previous_<pubkey8>`) or, when the identity lives in
/// `identity.key`, by renaming that file to `identity.previous-<pubkey8>.key`. If
/// no safe copy can be made, nothing is replaced. An identity supplied by the
/// debug environment override is never replaced.
pub fn replace_identity(
    store: &dyn KeyStore,
    data_dir: &Path,
    current: &Resolved,
    keys: Keys,
) -> Result<Resolved, String> {
    let Some(old) = current.keys.as_ref() else {
        return Err("there is no identity on this device to replace".to_string());
    };
    if current.storage == IdentityStorage::Environment {
        return Err("this identity comes from the environment and can't be replaced".to_string());
    }
    if old.public_key() == keys.public_key() {
        return Err("that is already the identity on this device".to_string());
    }

    let label: String = old.public_key().to_hex().chars().take(8).collect();
    match current.storage {
        IdentityStorage::LocalFile => {
            let from = data_dir.join(IDENTITY_FILE);
            let to = data_dir.join(format!("identity.previous-{label}.key"));
            if to.exists() {
                return Err("an archived copy of this identity already exists".to_string());
            }
            fs::rename(&from, &to)
                .map_err(|e| format!("couldn't safely keep your current identity: {e}"))?;
        }
        _ => {
            let nsec = old
                .secret_key()
                .to_bech32()
                .map_err(|e| format!("encode identity: {e}"))?;
            store.archive(&label, &nsec).map_err(|e| {
                format!("couldn't safely keep your current identity, so nothing was replaced: {e}")
            })?;
            // Remembered so a later sign-out can remove this copy too (the
            // keyring cannot be listed). Best effort: a lost manifest only
            // means the archive outlives sign-out, never that a key is lost.
            let _ = record_archive_label(data_dir, &label);
        }
    }
    persist_keys(store, data_dir, keys)
}

/// Append `label` to the archive manifest (deduplicated).
fn record_archive_label(data_dir: &Path, label: &str) -> Result<(), String> {
    let mut labels = read_archive_labels(data_dir);
    if !labels.contains(&label.to_string()) {
        labels.push(label.to_string());
    }
    fs::create_dir_all(data_dir).map_err(|e| format!("create identity dir: {e}"))?;
    fs::write(data_dir.join(ARCHIVE_MANIFEST), labels.join("\n"))
        .map_err(|e| format!("write archive manifest: {e}"))
}

/// Every archive label recorded by `replace_identity` on this device.
fn read_archive_labels(data_dir: &Path) -> Vec<String> {
    fs::read_to_string(data_dir.join(ARCHIVE_MANIFEST))
        .map(|text| {
            text.lines()
                .map(str::trim)
                .filter(|l| {
                    !l.is_empty() && l.len() <= 16 && l.chars().all(|c| c.is_ascii_hexdigit())
                })
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Overwrite a secret-bearing file with zeros before unlinking it, so the key
/// is not left recoverable in the freed blocks. Best effort on the overwrite;
/// the unlink is what is verified. A missing file is success.
fn shred_file(path: &Path) -> Result<(), String> {
    match fs::metadata(path) {
        Ok(meta) => {
            if let Ok(mut file) = fs::OpenOptions::new().write(true).open(path) {
                let zeros = vec![0u8; meta.len() as usize];
                let _ = file.write_all(&zeros);
                let _ = file.sync_all();
            }
            fs::remove_file(path).map_err(|e| format!("remove {}: {e}", path.display()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("inspect {}: {e}", path.display())),
    }
}

/// SWF shared-device sign-out: remove the current identity — and every archived
/// copy this app made — from this device, then prove nothing is left.
///
/// Refuses for an identity supplied by the debug environment (it cannot be
/// deleted from here) and when nothing is loaded (there is nothing to remove;
/// recovery states are left for the login screen to explain, never wiped
/// blindly). On success the device is back to first-launch: `resolve_identity`
/// returns no key and no recovery state. On any failure the error names what
/// could not be removed and the caller must NOT report the identity as gone.
pub fn delete_identity(
    store: &dyn KeyStore,
    data_dir: &Path,
    current: &Resolved,
) -> Result<Resolved, String> {
    let Some(keys) = current.keys.as_ref() else {
        return Err("there is no identity on this device to remove".to_string());
    };
    if current.storage == IdentityStorage::Environment {
        return Err(
            "this identity comes from the environment (SWF_BUZZ_PRIVATE_KEY) and can't be removed from here"
                .to_string(),
        );
    }
    let pubkey = keys.public_key();
    let label: String = pubkey.to_hex().chars().take(8).collect();

    // 1. The live keyring entry. When the identity lives in the fallback file
    //    the keyring is (or was) unusable; a delete error there is not fatal —
    //    the verification at the end decides.
    let keyring_delete = store.delete();
    if current.storage == IdentityStorage::SystemKeyring {
        keyring_delete
            .map_err(|e| format!("couldn't remove the identity from secure storage: {e}"))?;
    }

    // 2. The fallback file — only if it holds THIS key. A different, valid key
    //    in it would be someone else's identity: it is left and reported below.
    let file_path = data_dir.join(IDENTITY_FILE);
    match read_file(&file_path) {
        FileState::Valid(in_file) if in_file.public_key() == pubkey => shred_file(&file_path)?,
        // Unreadable now but it was ours a moment ago: still remove it.
        FileState::Corrupt if current.storage == IdentityStorage::LocalFile => {
            shred_file(&file_path)?
        }
        _ => {}
    }

    // 3. Archived copies: this key's, plus every archive recorded by
    //    `replace_identity` (shared device: a previous user's switched-away key
    //    must not outlive the sign-out either), plus every file archive.
    let mut labels = read_archive_labels(data_dir);
    if !labels.contains(&label) {
        labels.push(label.clone());
    }
    for l in &labels {
        store
            .delete_archive(l)
            .map_err(|e| format!("couldn't remove an archived copy of an identity: {e}"))?;
    }
    if let Ok(entries) = fs::read_dir(data_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(FILE_ARCHIVE_PREFIX) && name.ends_with(FILE_ARCHIVE_SUFFIX) {
                shred_file(&entry.path())?;
            }
        }
    }

    // 4. Metadata: the marker (else the next launch reports "lost") and the manifest.
    for meta in [KEYRING_MARKER, ARCHIVE_MANIFEST] {
        let path = data_dir.join(meta);
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("remove {meta}: {e}"))?;
        }
    }

    // 5. Prove it: resolving again must find nothing — no key, no recovery state.
    let after = resolve_identity(store, data_dir, None);
    if after.keys.is_some() {
        return Err(format!(
            "the identity is still present after removal (in {})",
            after.storage.as_str()
        ));
    }
    if after.recovery != RecoveryState::None {
        return Err(format!(
            "removal could not be verified (secure storage reports {})",
            after.recovery.as_str()
        ));
    }
    Ok(Resolved::default())
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Store `keys` in the keyring (verifying the round trip), else in `identity.key`.
fn persist_keys(store: &dyn KeyStore, data_dir: &Path, keys: Keys) -> Result<Resolved, String> {
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| format!("encode identity: {e}"))?;

    let stored_in_keyring =
        store.save(&nsec).is_ok() && matches!(store.load(), Ok(Some(back)) if back.trim() == nsec);

    if stored_in_keyring {
        let _ = fs::create_dir_all(data_dir)
            .and_then(|_| fs::write(data_dir.join(KEYRING_MARKER), b"1"));
        return Ok(Resolved::loaded(keys, IdentityStorage::SystemKeyring));
    }

    eprintln!("swf-buzz: keyring write failed — falling back to identity.key");
    write_file(&data_dir.join(IDENTITY_FILE), &nsec)?;
    Ok(Resolved::loaded(keys, IdentityStorage::LocalFile))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeStore {
        value: Mutex<Option<String>>,
        archived: Mutex<Vec<(String, String)>>,
        fail_load: bool,
        fail_save: bool,
        fail_archive: bool,
        fail_delete: bool,
    }

    impl FakeStore {
        fn with(value: &str) -> Self {
            Self {
                value: Mutex::new(Some(value.to_string())),
                ..Default::default()
            }
        }
    }

    impl KeyStore for FakeStore {
        fn load(&self) -> Result<Option<String>, String> {
            if self.fail_load {
                return Err("keyring locked".into());
            }
            Ok(self.value.lock().unwrap().clone())
        }
        fn save(&self, nsec: &str) -> Result<(), String> {
            if self.fail_save {
                return Err("keyring write denied".into());
            }
            *self.value.lock().unwrap() = Some(nsec.to_string());
            Ok(())
        }
        fn archive(&self, label: &str, nsec: &str) -> Result<(), String> {
            if self.fail_archive {
                return Err("archive denied".into());
            }
            self.archived
                .lock()
                .unwrap()
                .push((label.to_string(), nsec.to_string()));
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            if self.fail_delete {
                return Err("keyring delete denied".into());
            }
            *self.value.lock().unwrap() = None;
            Ok(())
        }
        fn delete_archive(&self, label: &str) -> Result<(), String> {
            if self.fail_delete {
                return Err("keyring delete denied".into());
            }
            self.archived.lock().unwrap().retain(|(l, _)| l != label);
            Ok(())
        }
    }

    /// Unique temp dir, removed on drop.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("swf-identity-test-{}", rand::random::<u64>()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn pubkey(r: &Resolved) -> String {
        r.keys.as_ref().expect("keys loaded").public_key().to_hex()
    }

    #[test]
    fn first_launch_resolves_to_nothing_and_never_generates() {
        let dir = TempDir::new();
        let store = FakeStore::default();
        let r = resolve_identity(&store, dir.path(), None);
        assert!(r.keys.is_none());
        assert_eq!(r.storage, IdentityStorage::None);
        assert_eq!(r.recovery, RecoveryState::None);
        assert!(
            store.value.lock().unwrap().is_none(),
            "resolve must not write"
        );
    }

    #[test]
    fn create_generates_once_and_restart_loads_the_same_key() {
        let dir = TempDir::new();
        let store = FakeStore::default();

        let first = resolve_identity(&store, dir.path(), None);
        let created = create_identity(&store, dir.path(), &first).unwrap();
        assert_eq!(created.storage, IdentityStorage::SystemKeyring);
        let created_pubkey = pubkey(&created);

        // "Restart": resolve again from the same stores.
        let after_restart = resolve_identity(&store, dir.path(), None);
        assert_eq!(after_restart.storage, IdentityStorage::SystemKeyring);
        assert_eq!(pubkey(&after_restart), created_pubkey);

        // A second create is refused and does not change the key.
        assert!(create_identity(&store, dir.path(), &after_restart).is_err());
        assert_eq!(
            pubkey(&resolve_identity(&store, dir.path(), None)),
            created_pubkey
        );
    }

    #[test]
    fn stored_secret_is_an_nsec_and_never_in_the_public_info() {
        let dir = TempDir::new();
        let store = FakeStore::default();
        let created = create_identity(&store, dir.path(), &Resolved::default()).unwrap();
        let stored = store.value.lock().unwrap().clone().unwrap();
        assert!(stored.starts_with("nsec1"));
        assert!(!serde_json::to_string(&created.info())
            .unwrap()
            .contains(&stored));
    }

    #[test]
    fn env_override_wins_over_the_keyring() {
        let dir = TempDir::new();
        let keyring_keys = Keys::generate();
        let store = FakeStore::with(&keyring_keys.secret_key().to_bech32().unwrap());
        let env_keys = Keys::generate();
        let env_nsec = env_keys.secret_key().to_bech32().unwrap();

        let r = resolve_identity(&store, dir.path(), Some(&env_nsec));
        assert_eq!(r.storage, IdentityStorage::Environment);
        assert_eq!(pubkey(&r), env_keys.public_key().to_hex());
    }

    #[test]
    fn invalid_env_override_is_ignored() {
        let dir = TempDir::new();
        let keyring_keys = Keys::generate();
        let store = FakeStore::with(&keyring_keys.secret_key().to_bech32().unwrap());
        let r = resolve_identity(&store, dir.path(), Some("not-a-key"));
        assert_eq!(r.storage, IdentityStorage::SystemKeyring);
        assert_eq!(pubkey(&r), keyring_keys.public_key().to_hex());
    }

    #[test]
    fn unusable_keyring_on_first_launch_falls_back_to_the_file_and_reloads_it() {
        let dir = TempDir::new();
        let store = FakeStore {
            fail_load: true,
            fail_save: true,
            ..Default::default()
        };

        let first = resolve_identity(&store, dir.path(), None);
        assert_eq!(
            first.recovery,
            RecoveryState::None,
            "no marker ⇒ first launch"
        );
        let created = create_identity(&store, dir.path(), &first).unwrap();
        assert_eq!(created.storage, IdentityStorage::LocalFile);
        assert!(dir.path().join(IDENTITY_FILE).exists());

        let reloaded = resolve_identity(&store, dir.path(), None);
        assert_eq!(reloaded.storage, IdentityStorage::LocalFile);
        assert_eq!(pubkey(&reloaded), pubkey(&created));
    }

    #[test]
    fn marker_plus_unreachable_keyring_is_keyring_locked_and_refuses_create() {
        let dir = TempDir::new();
        fs::write(dir.path().join(KEYRING_MARKER), b"1").unwrap();
        let store = FakeStore {
            fail_load: true,
            ..Default::default()
        };

        let r = resolve_identity(&store, dir.path(), None);
        assert_eq!(r.recovery, RecoveryState::KeyringLocked);
        assert!(r.keys.is_none());
        let err = create_identity(&store, dir.path(), &r).unwrap_err();
        assert!(err.contains("locked"));
        assert!(
            !dir.path().join(IDENTITY_FILE).exists(),
            "must not write a new key"
        );
    }

    #[test]
    fn marker_plus_empty_keyring_is_lost_and_an_explicit_create_is_allowed() {
        let dir = TempDir::new();
        fs::write(dir.path().join(KEYRING_MARKER), b"1").unwrap();
        let store = FakeStore::default();

        let r = resolve_identity(&store, dir.path(), None);
        assert_eq!(r.recovery, RecoveryState::Lost);
        assert!(r.keys.is_none());

        let created = create_identity(&store, dir.path(), &r).unwrap();
        assert_eq!(created.recovery, RecoveryState::None);
        assert_eq!(created.storage, IdentityStorage::SystemKeyring);
    }

    #[test]
    fn unparseable_keyring_value_is_corrupt_untouched_and_refuses_create() {
        let dir = TempDir::new();
        let store = FakeStore::with("garbage-not-a-key");

        let r = resolve_identity(&store, dir.path(), None);
        assert_eq!(r.recovery, RecoveryState::Corrupt);
        assert!(create_identity(&store, dir.path(), &r).is_err());
        assert_eq!(
            store.value.lock().unwrap().as_deref(),
            Some("garbage-not-a-key"),
            "the unreadable entry must be left exactly as it was"
        );
    }

    #[test]
    fn corrupt_identity_file_is_never_overwritten() {
        let dir = TempDir::new();
        fs::write(dir.path().join(IDENTITY_FILE), "garbage").unwrap();
        let store = FakeStore {
            fail_load: true,
            fail_save: true,
            ..Default::default()
        };

        let r = resolve_identity(&store, dir.path(), None);
        assert_eq!(r.recovery, RecoveryState::Corrupt);
        assert!(create_identity(&store, dir.path(), &r).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join(IDENTITY_FILE)).unwrap(),
            "garbage"
        );
    }

    #[test]
    fn keyring_write_that_does_not_round_trip_falls_back_to_the_file() {
        // save() "succeeds" but load() returns a different value.
        struct LossyStore;
        impl KeyStore for LossyStore {
            fn load(&self) -> Result<Option<String>, String> {
                Ok(None)
            }
            fn save(&self, _nsec: &str) -> Result<(), String> {
                Ok(())
            }
            fn archive(&self, _label: &str, _nsec: &str) -> Result<(), String> {
                Ok(())
            }
            fn delete(&self) -> Result<(), String> {
                Ok(())
            }
            fn delete_archive(&self, _label: &str) -> Result<(), String> {
                Ok(())
            }
        }
        let dir = TempDir::new();
        let created = create_identity(&LossyStore, dir.path(), &Resolved::default()).unwrap();
        assert_eq!(created.storage, IdentityStorage::LocalFile);
    }

    #[test]
    fn create_refuses_when_an_identity_is_already_loaded() {
        let dir = TempDir::new();
        let loaded = Resolved::loaded(Keys::generate(), IdentityStorage::SystemKeyring);
        assert!(create_identity(&FakeStore::default(), dir.path(), &loaded).is_err());
    }

    // ── replace ───────────────────────────────────────────────────────────

    fn nsec_of(keys: &Keys) -> String {
        keys.secret_key().to_bech32().unwrap()
    }

    #[test]
    fn replace_archives_the_old_key_then_stores_the_new_one() {
        let dir = TempDir::new();
        let old = Keys::generate();
        let store = FakeStore::with(&nsec_of(&old));
        let current = Resolved::loaded(old.clone(), IdentityStorage::SystemKeyring);
        let new = Keys::generate();

        let replaced = replace_identity(&store, dir.path(), &current, new.clone()).unwrap();

        assert_eq!(replaced.keys.unwrap().public_key(), new.public_key());
        assert_eq!(store.load().unwrap().unwrap(), nsec_of(&new));
        let archived = store.archived.lock().unwrap();
        assert_eq!(archived.len(), 1, "the old key must be kept");
        assert_eq!(archived[0].1, nsec_of(&old));
        assert_eq!(archived[0].0, old.public_key().to_hex()[..8]);
    }

    #[test]
    fn replace_does_nothing_when_the_old_key_cannot_be_kept_safe() {
        let dir = TempDir::new();
        let old = Keys::generate();
        let store = FakeStore {
            fail_archive: true,
            ..FakeStore::with(&nsec_of(&old))
        };
        let current = Resolved::loaded(old.clone(), IdentityStorage::SystemKeyring);

        let err = replace_identity(&store, dir.path(), &current, Keys::generate()).unwrap_err();

        assert!(err.contains("nothing was replaced"), "{err}");
        assert_eq!(
            store.load().unwrap().unwrap(),
            nsec_of(&old),
            "old key must remain live"
        );
    }

    #[test]
    fn replace_moves_an_identity_file_aside_instead_of_deleting_it() {
        let dir = TempDir::new();
        let old = Keys::generate();
        fs::write(dir.path().join(IDENTITY_FILE), nsec_of(&old)).unwrap();
        let current = Resolved::loaded(old.clone(), IdentityStorage::LocalFile);

        let replaced = replace_identity(
            &FakeStore::default(),
            dir.path(),
            &current,
            Keys::generate(),
        )
        .unwrap();

        assert!(replaced.keys.is_some());
        let kept = dir.path().join(format!(
            "identity.previous-{}.key",
            &old.public_key().to_hex()[..8]
        ));
        assert_eq!(fs::read_to_string(kept).unwrap(), nsec_of(&old));
    }

    #[test]
    fn replace_refuses_without_an_identity_the_same_key_or_an_env_identity() {
        let dir = TempDir::new();
        let store = FakeStore::default();
        let key = Keys::generate();

        assert!(replace_identity(&store, dir.path(), &Resolved::default(), key.clone()).is_err());

        let loaded = Resolved::loaded(key.clone(), IdentityStorage::SystemKeyring);
        assert!(replace_identity(&store, dir.path(), &loaded, key.clone()).is_err());

        let env = Resolved::loaded(key, IdentityStorage::Environment);
        assert!(replace_identity(&store, dir.path(), &env, Keys::generate()).is_err());
        assert!(store.archived.lock().unwrap().is_empty());
    }

    // ── import ────────────────────────────────────────────────────────────

    #[test]
    fn import_stores_the_given_key_and_a_restart_loads_it() {
        let dir = TempDir::new();
        let store = FakeStore::default();
        let wanted = Keys::generate();

        let imported =
            import_identity(&store, dir.path(), &Resolved::default(), wanted.clone()).unwrap();
        assert_eq!(imported.storage, IdentityStorage::SystemKeyring);
        assert_eq!(pubkey(&imported), wanted.public_key().to_hex());

        let after_restart = resolve_identity(&store, dir.path(), None);
        assert_eq!(pubkey(&after_restart), wanted.public_key().to_hex());
    }

    #[test]
    fn import_never_replaces_a_working_identity() {
        let dir = TempDir::new();
        let store = FakeStore::default();
        let current = create_identity(&store, dir.path(), &Resolved::default()).unwrap();
        let before = pubkey(&current);

        let err = import_identity(&store, dir.path(), &current, Keys::generate()).unwrap_err();
        assert!(err.contains("already exists"));
        assert_eq!(pubkey(&resolve_identity(&store, dir.path(), None)), before);
    }

    #[test]
    fn import_is_refused_while_the_keyring_is_locked() {
        let dir = TempDir::new();
        fs::write(dir.path().join(KEYRING_MARKER), b"1").unwrap();
        let store = FakeStore {
            fail_load: true,
            fail_save: true,
            ..Default::default()
        };
        let locked = resolve_identity(&store, dir.path(), None);
        assert_eq!(locked.recovery, RecoveryState::KeyringLocked);

        assert!(import_identity(&store, dir.path(), &locked, Keys::generate()).is_err());
        assert!(!dir.path().join(IDENTITY_FILE).exists());
    }

    #[test]
    fn import_recovers_from_a_lost_identity() {
        let dir = TempDir::new();
        fs::write(dir.path().join(KEYRING_MARKER), b"1").unwrap();
        let store = FakeStore::default();
        let lost = resolve_identity(&store, dir.path(), None);
        assert_eq!(lost.recovery, RecoveryState::Lost);

        let wanted = Keys::generate();
        let imported = import_identity(&store, dir.path(), &lost, wanted.clone()).unwrap();
        assert_eq!(imported.recovery, RecoveryState::None);
        assert_eq!(pubkey(&imported), wanted.public_key().to_hex());
    }

    #[test]
    fn import_over_a_corrupt_keyring_entry_overwrites_it() {
        let dir = TempDir::new();
        let store = FakeStore::with("garbage-not-a-key");
        let corrupt = resolve_identity(&store, dir.path(), None);
        assert_eq!(corrupt.recovery, RecoveryState::Corrupt);

        let wanted = Keys::generate();
        let imported = import_identity(&store, dir.path(), &corrupt, wanted.clone()).unwrap();
        assert_eq!(pubkey(&imported), wanted.public_key().to_hex());
        assert_eq!(
            pubkey(&resolve_identity(&store, dir.path(), None)),
            wanted.public_key().to_hex()
        );
    }

    #[test]
    fn import_over_a_corrupt_identity_file_moves_it_aside_instead_of_deleting_it() {
        let dir = TempDir::new();
        fs::write(dir.path().join(IDENTITY_FILE), "garbage").unwrap();
        let store = FakeStore {
            fail_load: true,
            fail_save: true,
            ..Default::default()
        };
        let corrupt = resolve_identity(&store, dir.path(), None);
        assert_eq!(corrupt.recovery, RecoveryState::Corrupt);

        let wanted = Keys::generate();
        let imported = import_identity(&store, dir.path(), &corrupt, wanted.clone()).unwrap();
        assert_eq!(imported.storage, IdentityStorage::LocalFile);

        let entries: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            entries
                .iter()
                .any(|n| n.starts_with("identity.key.corrupt-")),
            "the unreadable file must be kept: {entries:?}"
        );
    }

    // ── delete (SWF shared-device sign-out) ───────────────────────────────

    fn dir_names(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn delete_removes_a_keyring_identity_and_a_relaunch_finds_nothing() {
        let dir = TempDir::new();
        let store = FakeStore::default();
        let created = create_identity(&store, dir.path(), &Resolved::default()).unwrap();
        assert!(dir.path().join(KEYRING_MARKER).exists());

        let after = delete_identity(&store, dir.path(), &created).unwrap();

        assert!(after.keys.is_none());
        assert_eq!(after.storage, IdentityStorage::None);
        assert_eq!(after.recovery, RecoveryState::None);
        assert!(store.value.lock().unwrap().is_none(), "keyring entry gone");
        assert!(
            !dir.path().join(KEYRING_MARKER).exists(),
            "marker gone, else 'lost' would show"
        );

        // "Relaunch": first-launch state, not "lost", not "corrupt".
        let relaunch = resolve_identity(&store, dir.path(), None);
        assert!(relaunch.keys.is_none());
        assert_eq!(relaunch.recovery, RecoveryState::None);
        // And a new identity may be created/imported afterwards.
        assert!(import_identity(&store, dir.path(), &relaunch, Keys::generate()).is_ok());
    }

    #[test]
    fn delete_removes_the_fallback_file_identity() {
        let dir = TempDir::new();
        let store = FakeStore {
            fail_load: true,
            fail_save: true,
            ..Default::default()
        };
        let created = create_identity(&store, dir.path(), &Resolved::default()).unwrap();
        assert_eq!(created.storage, IdentityStorage::LocalFile);
        let file = dir.path().join(IDENTITY_FILE);
        assert!(file.exists());

        let after = delete_identity(&store, dir.path(), &created).unwrap();

        assert!(after.keys.is_none());
        assert!(!file.exists(), "identity.key removed");
        let relaunch = resolve_identity(&store, dir.path(), None);
        assert!(relaunch.keys.is_none());
        assert_eq!(relaunch.recovery, RecoveryState::None);
    }

    #[test]
    fn delete_also_removes_the_archived_copies_made_by_replace() {
        let dir = TempDir::new();
        let a = Keys::generate();
        let store = FakeStore::with(&nsec_of(&a));
        let current_a = Resolved::loaded(a.clone(), IdentityStorage::SystemKeyring);
        let b = Keys::generate();
        // A → B via "Switch / Import another identity": A is archived.
        let current_b = replace_identity(&store, dir.path(), &current_a, b.clone()).unwrap();
        assert_eq!(store.archived.lock().unwrap().len(), 1);
        assert!(
            dir.path().join(ARCHIVE_MANIFEST).exists(),
            "manifest records the archive"
        );
        // A file archive too (as the LocalFile branch of replace would leave).
        fs::write(
            dir.path().join("identity.previous-deadbeef.key"),
            nsec_of(&Keys::generate()),
        )
        .unwrap();

        // B signs out on this shared device.
        let after = delete_identity(&store, dir.path(), &current_b).unwrap();

        assert!(after.keys.is_none());
        assert!(store.value.lock().unwrap().is_none(), "B's live key gone");
        assert!(
            store.archived.lock().unwrap().is_empty(),
            "A's archived key gone too"
        );
        assert!(
            !dir_names(dir.path())
                .iter()
                .any(|n| n.starts_with(FILE_ARCHIVE_PREFIX)),
            "file archives gone: {:?}",
            dir_names(dir.path())
        );
        assert!(!dir.path().join(ARCHIVE_MANIFEST).exists());
        assert_eq!(
            resolve_identity(&store, dir.path(), None).recovery,
            RecoveryState::None
        );
    }

    #[test]
    fn delete_refuses_an_environment_identity_and_when_nothing_is_loaded() {
        let dir = TempDir::new();
        let store = FakeStore::default();
        let env = Resolved::loaded(Keys::generate(), IdentityStorage::Environment);
        let err = delete_identity(&store, dir.path(), &env).unwrap_err();
        assert!(err.contains("environment"), "{err}");

        let err = delete_identity(&store, dir.path(), &Resolved::default()).unwrap_err();
        assert!(err.contains("no identity"), "{err}");

        // A recovery state is not silently wiped either: nothing is loaded.
        let store = FakeStore::with("garbage-not-a-key");
        let corrupt = resolve_identity(&store, dir.path(), None);
        assert!(delete_identity(&store, dir.path(), &corrupt).is_err());
        assert_eq!(
            store.value.lock().unwrap().as_deref(),
            Some("garbage-not-a-key")
        );
    }

    #[test]
    fn delete_that_cannot_remove_the_keyring_entry_fails_and_the_key_remains_loaded() {
        let dir = TempDir::new();
        let keys = Keys::generate();
        let store = FakeStore {
            fail_delete: true,
            ..FakeStore::with(&nsec_of(&keys))
        };
        let current = Resolved::loaded(keys.clone(), IdentityStorage::SystemKeyring);

        let err = delete_identity(&store, dir.path(), &current).unwrap_err();

        assert!(err.contains("couldn't remove"), "{err}");
        assert_eq!(
            store.load().unwrap().unwrap(),
            nsec_of(&keys),
            "nothing was half-deleted"
        );
        assert_eq!(
            pubkey(&resolve_identity(&store, dir.path(), None)),
            keys.public_key().to_hex()
        );
    }

    #[test]
    fn delete_is_verified_a_lingering_copy_is_an_error_not_a_silent_success() {
        // The keyring "deletes" but a copy of the SAME key still sits in identity.key
        // (e.g. an older fallback) — it is removed too. A DIFFERENT valid key in
        // that file is someone else's: it is left alone and the call fails loudly.
        let dir = TempDir::new();
        let keys = Keys::generate();
        let store = FakeStore::with(&nsec_of(&keys));
        fs::write(dir.path().join(IDENTITY_FILE), nsec_of(&keys)).unwrap();
        let current = Resolved::loaded(keys.clone(), IdentityStorage::SystemKeyring);
        assert!(delete_identity(&store, dir.path(), &current).is_ok());
        assert!(!dir.path().join(IDENTITY_FILE).exists());

        let other = Keys::generate();
        let store = FakeStore::with(&nsec_of(&keys));
        fs::write(dir.path().join(IDENTITY_FILE), nsec_of(&other)).unwrap();
        let err = delete_identity(&store, dir.path(), &current).unwrap_err();
        assert!(err.contains("still present"), "{err}");
        assert_eq!(
            fs::read_to_string(dir.path().join(IDENTITY_FILE)).unwrap(),
            nsec_of(&other)
        );
    }

    #[test]
    fn deleted_files_are_overwritten_before_removal() {
        let dir = TempDir::new();
        let path = dir.path().join("identity.previous-abcdef01.key");
        fs::write(&path, "nsec1secretsecretsecret").unwrap();
        shred_file(&path).unwrap();
        assert!(!path.exists());
        assert!(shred_file(&path).is_ok(), "absent is success");
    }
}
