//! NIP-49 password-encrypted key backup (`ncryptsec1…`) — a behavioural port of
//! the reference desktop's `key_backup.rs`.
//!
//! All encryption and decryption happens here, in Rust. A backup blob is
//! password-protected, but it is still key material: it is written to a local
//! file or handed to the user, and the egress guard in `signing.rs` refuses to
//! sign any event that contains one, so it can never be published to a relay.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use nostr::nips::nip49::{EncryptedSecretKey, KeySecurity};
use nostr::{FromBech32, Keys, PublicKey, ToBech32};

/// scrypt cost for new backups (2^18, ~256 MiB) — the reference desktop's value.
pub const BACKUP_LOG_N: u8 = 18;

/// Highest cost accepted when *decrypting* an untrusted backup. NIP-49 leaves
/// `log_n` to the encryptor, so an unbounded value would let a crafted blob
/// demand unbounded memory before the password is even checked.
pub const MAX_IMPORT_LOG_N: u8 = BACKUP_LOG_N;

/// Minimum backup passphrase length (characters).
pub const MIN_PASSPHRASE_LEN: usize = 12;

const NCRYPTSEC_HRP: &str = "ncryptsec1";
const NPUB_HRP: &str = "npub1";

/// The exact wording the UI shows too (`IdentityImportForm.vue`): a public key
/// identifies, it can never authenticate, and nothing is derived from it.
pub const NPUB_REJECTED: &str = "This is a public identity key. A public key cannot be used to sign in. Import the matching nsec private key or ncryptsec encrypted backup.";

/// Encrypt `keys` into an `ncryptsec1…` blob and verify it decrypts back to the
/// same identity before returning it.
pub fn create_backup_blob(keys: &Keys, password: &str, log_n: u8) -> Result<String, String> {
    if password.chars().count() < MIN_PASSPHRASE_LEN {
        return Err(format!(
            "the backup passphrase must be at least {MIN_PASSPHRASE_LEN} characters"
        ));
    }
    let encrypted =
        EncryptedSecretKey::new(keys.secret_key(), password, log_n, KeySecurity::Unknown)
            .map_err(|e| format!("encrypt key backup: {e}"))?;
    let ncryptsec = encrypted
        .to_bech32()
        .map_err(|e| format!("encode key backup: {e}"))?;
    verify_backup_blob(&ncryptsec, password, &keys.public_key())?;
    Ok(ncryptsec)
}

/// Decrypt `ncryptsec` with `password` and confirm it is `expected`'s key.
pub fn verify_backup_blob(
    ncryptsec: &str,
    password: &str,
    expected: &PublicKey,
) -> Result<(), String> {
    let recovered = decrypt_ncryptsec(ncryptsec, password)?;
    if recovered.public_key() != *expected {
        return Err("the decrypted backup does not match this identity".to_string());
    }
    Ok(())
}

pub fn parse_ncryptsec(input: &str) -> Result<EncryptedSecretKey, String> {
    EncryptedSecretKey::from_bech32(input.trim()).map_err(|e| format!("invalid key backup: {e}"))
}

/// Refuse a backup whose scrypt cost is above [`MAX_IMPORT_LOG_N`] *before* any
/// key derivation runs (a crafted blob could otherwise demand huge memory).
fn ensure_supported_cost(log_n: u8) -> Result<(), String> {
    if log_n > MAX_IMPORT_LOG_N {
        return Err(format!(
            "unsupported backup strength (log_n {log_n} exceeds {MAX_IMPORT_LOG_N})"
        ));
    }
    Ok(())
}

pub fn decrypt_ncryptsec(input: &str, password: &str) -> Result<Keys, String> {
    let encrypted = parse_ncryptsec(input)?;
    ensure_supported_cost(encrypted.log_n())?;
    let secret = encrypted
        .decrypt(password)
        .map_err(|_| "wrong backup password, or the backup is damaged".to_string())?;
    Ok(Keys::new(secret))
}

/// A bare 64-character hex value. A private key is 64 hex characters — and so is
/// a Nostr PUBLIC key, so the two are indistinguishable by format. Nothing may
/// guess which one it is.
pub fn is_bare_hex(input: &str) -> bool {
    let t = input.trim();
    t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit())
}

/// Why raw hex is refused on the normal import path. The mistake this prevents
/// actually happened twice on this project: an operator's PUBLIC key pasted
/// here was parsed as a private scalar and silently produced a different,
/// unrelated identity (docs/DEV_RESET_2026_09_22.md).
pub const RAW_HEX_REJECTED: &str = "Raw 64-character hex is ambiguous — a public key is the same length as a private key, so SWF Buzz cannot tell them apart. Import an nsec private key or an ncryptsec encrypted backup instead. (If you meant to paste a public key: public keys identify an identity, they can never sign in.)";

/// Undo what copy/paste does to a key: a `nostr:` URI prefix (NIP-21, added by
/// many Nostr apps' "copy" buttons), wrapping quotes, and whitespace or invisible
/// characters anywhere (line-wrapped keys, zero-width spaces from chat apps/PDFs,
/// a BOM). None of these can occur inside bech32 or hex, so removing them can
/// never turn one key into another — a real typo still fails the bech32 checksum.
pub fn normalize_key_input(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .filter(|c| {
            !c.is_whitespace() && !matches!(c, '\u{200B}'..='\u{200D}' | '\u{2060}' | '\u{FEFF}')
        })
        .collect();
    let unquoted = cleaned.trim_matches(|c| matches!(c, '"' | '\'' | '`'));
    match unquoted.get(..6) {
        Some(prefix) if prefix.eq_ignore_ascii_case("nostr:") => unquoted[6..].to_string(),
        _ => unquoted.to_string(),
    }
}

/// Accepts `nsec1…` or `ncryptsec1…` (+ password) — the two unambiguous forms.
///
/// An `npub1…` is refused with [`NPUB_REJECTED`], and a bare 64-char hex value
/// with [`RAW_HEX_REJECTED`], before anything is decoded. `allow_raw_hex` opts
/// into the developer-only path that still accepts a raw private hex key; it is
/// never set from the normal import screen.
pub fn recover_keys_from_input(
    input: &str,
    password: Option<&str>,
    allow_raw_hex: bool,
) -> Result<Keys, String> {
    let normalized = normalize_key_input(input);
    let trimmed = normalized.as_str();
    if trimmed
        .get(..NPUB_HRP.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(NPUB_HRP))
    {
        return Err(NPUB_REJECTED.to_string());
    }
    if is_bare_hex(trimmed) && !allow_raw_hex {
        return Err(RAW_HEX_REJECTED.to_string());
    }
    let is_backup = trimmed
        .get(..NCRYPTSEC_HRP.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(NCRYPTSEC_HRP));
    if is_backup {
        let password = password
            .filter(|p| !p.is_empty())
            .ok_or_else(|| "this key backup needs its password".to_string())?;
        decrypt_ncryptsec(trimmed, password)
    } else {
        Keys::parse(trimmed).map_err(|_| "that is not a valid private key".to_string())
    }
}

/// Writes the backup to a new file in `dir` (never overwriting one) and returns
/// its path. The name carries the first 8 hex chars of the public key.
pub fn write_backup_file(dir: &Path, ncryptsec: &str, pubkey_hex: &str) -> Result<PathBuf, String> {
    parse_ncryptsec(ncryptsec)?;
    fs::create_dir_all(dir).map_err(|e| format!("create backup folder: {e}"))?;
    let stem = format!(
        "swf-buzz-identity-{}",
        &pubkey_hex[..8.min(pubkey_hex.len())]
    );
    for attempt in 0..100 {
        let name = if attempt == 0 {
            format!("{stem}.ncryptsec")
        } else {
            format!("{stem}-{attempt}.ncryptsec")
        };
        let path = dir.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(ncryptsec.trim().as_bytes())
                    .map_err(|e| format!("write backup: {e}"))?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("create backup file: {e}")),
        }
    }
    Err("could not find a free backup file name".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Low scrypt cost keeps the tests fast; production uses BACKUP_LOG_N.
    const TEST_LOG_N: u8 = 4;
    const PASSWORD: &str = "correct horse battery";

    /// The normal import path must never accept a bare 64-char hex value: a
    /// public key is the same length as a private key, and guessing produced a
    /// silently wrong identity twice on this project.
    #[test]
    fn raw_hex_is_refused_on_the_normal_path_and_allowed_only_for_developers() {
        let keys = Keys::generate();
        let secret_hex = keys.secret_key().to_secret_hex();
        let public_hex = keys.public_key().to_hex();

        // Even a genuine PRIVATE hex key is refused when raw hex is not opted into.
        assert_eq!(
            recover_keys_from_input(&secret_hex, None, false).unwrap_err(),
            RAW_HEX_REJECTED
        );
        // …and so, crucially, is a PUBLIC key that would otherwise have been
        // parsed as a secret and derived an unrelated identity.
        assert_eq!(
            recover_keys_from_input(&public_hex, None, false).unwrap_err(),
            RAW_HEX_REJECTED
        );

        // The developer-only path still works, and only for the real secret.
        let recovered = recover_keys_from_input(&secret_hex, None, true).unwrap();
        assert_eq!(recovered.public_key(), keys.public_key());
        let from_public = recover_keys_from_input(&public_hex, None, true).unwrap();
        assert_ne!(
            from_public.public_key(),
            keys.public_key(),
            "a public key parsed as a secret derives a DIFFERENT identity — the reason raw hex is refused"
        );

        assert!(is_bare_hex(&secret_hex));
        assert!(is_bare_hex(&format!("  {public_hex}  ")));
        assert!(!is_bare_hex("nsec1abc"));
        assert!(!is_bare_hex(&"a".repeat(63)));
    }

    /// nsec and ncryptsec stay accepted on the normal path — they are
    /// unambiguous, so there is nothing to guess.
    #[test]
    fn nsec_and_ncryptsec_remain_accepted_without_the_developer_flag() {
        let keys = Keys::generate();
        let nsec = keys.secret_key().to_bech32().unwrap();
        assert_eq!(
            recover_keys_from_input(&nsec, None, false)
                .unwrap()
                .public_key(),
            keys.public_key()
        );
        let blob = create_backup_blob(&keys, PASSWORD, TEST_LOG_N).unwrap();
        assert_eq!(
            recover_keys_from_input(&blob, Some(PASSWORD), false)
                .unwrap()
                .public_key(),
            keys.public_key()
        );
    }

    #[test]
    fn an_npub_is_refused_as_a_public_identity() {
        let npub = Keys::generate().public_key().to_bech32().unwrap();
        assert_eq!(
            recover_keys_from_input(&npub, None, false).unwrap_err(),
            NPUB_REJECTED
        );
        // and the developer flag does not make a public key usable either
        assert_eq!(
            recover_keys_from_input(&npub, None, true).unwrap_err(),
            NPUB_REJECTED
        );
    }

    #[test]
    fn backup_round_trips_to_the_same_identity() {
        let keys = Keys::generate();
        let blob = create_backup_blob(&keys, PASSWORD, TEST_LOG_N).unwrap();
        assert!(blob.starts_with("ncryptsec1"));
        let back = decrypt_ncryptsec(&blob, PASSWORD).unwrap();
        assert_eq!(back.public_key(), keys.public_key());
        assert!(verify_backup_blob(&blob, PASSWORD, &keys.public_key()).is_ok());
    }

    #[test]
    fn a_short_passphrase_is_refused() {
        let err = create_backup_blob(&Keys::generate(), "short", TEST_LOG_N).unwrap_err();
        assert!(err.contains("at least 12"));
    }

    #[test]
    fn wrong_password_is_rejected_without_revealing_detail() {
        let blob = create_backup_blob(&Keys::generate(), PASSWORD, TEST_LOG_N).unwrap();
        let err = decrypt_ncryptsec(&blob, "totally different pass").unwrap_err();
        assert_eq!(err, "wrong backup password, or the backup is damaged");
    }

    #[test]
    fn verify_rejects_a_backup_of_a_different_identity() {
        let blob = create_backup_blob(&Keys::generate(), PASSWORD, TEST_LOG_N).unwrap();
        let other = Keys::generate().public_key();
        assert!(verify_backup_blob(&blob, PASSWORD, &other).is_err());
    }

    #[test]
    fn oversized_kdf_cost_is_refused_before_any_work() {
        // Tested on the pure check: building a real log_n 19 blob would itself
        // cost ~512 MiB and minutes of scrypt in a debug build.
        assert!(ensure_supported_cost(MAX_IMPORT_LOG_N).is_ok());
        assert!(ensure_supported_cost(4).is_ok());
        for too_big in [MAX_IMPORT_LOG_N + 1, 30, 255] {
            let err = ensure_supported_cost(too_big).unwrap_err();
            assert!(err.contains("unsupported backup strength"), "{err}");
        }
    }

    /// Copy/paste damage around a real nsec must not make a valid key "invalid",
    /// and must still resolve to exactly the same identity. Real typos still fail.
    #[test]
    fn pasted_nsec_variants_resolve_to_the_same_identity() {
        let keys = Keys::generate();
        let nsec = keys.secret_key().to_bech32().unwrap();
        let (head, tail) = nsec.split_at(30);
        for input in [
            format!("nostr:{nsec}"),
            format!("\"{nsec}\""),
            format!("{head}\n{tail}"),
            format!("{head} {tail}"),
            format!("{nsec}\u{200B}"),
            format!("\u{FEFF}{nsec}"),
        ] {
            let got = recover_keys_from_input(&input, None, false).unwrap();
            assert_eq!(got.public_key(), keys.public_key());
        }
        let mut typo = nsec.clone();
        let last = if typo.ends_with('q') { "p" } else { "q" };
        typo.replace_range(typo.len() - 1.., last);
        assert!(recover_keys_from_input(&typo, None, false).is_err());
        assert!(recover_keys_from_input(&nsec[..nsec.len() - 1], None, false).is_err());
        // A `nostr:npub…` is still refused as a public key, never parsed.
        let npub = keys.public_key().to_bech32().unwrap();
        assert_eq!(
            recover_keys_from_input(&format!("nostr:{npub}"), None, false).unwrap_err(),
            NPUB_REJECTED
        );
    }

    #[test]
    fn recovers_from_nsec_hex_and_ncryptsec() {
        let keys = Keys::generate();
        let nsec = keys.secret_key().to_bech32().unwrap();
        let hex = keys.secret_key().to_secret_hex();
        let blob = create_backup_blob(&keys, PASSWORD, TEST_LOG_N).unwrap();

        // nsec and ncryptsec are unambiguous and need no opt-in; raw hex is the
        // developer-only path (see `raw_hex_is_refused_on_the_normal_path…`).
        for (input, password, allow_raw_hex) in [
            (&nsec, None, false),
            (&hex, None, true),
            (&blob, Some(PASSWORD), false),
        ] {
            let got = recover_keys_from_input(input, password, allow_raw_hex).unwrap();
            assert_eq!(got.public_key(), keys.public_key());
        }
        // Uppercase bech32 is valid and must work too.
        assert!(recover_keys_from_input(&blob.to_uppercase(), Some(PASSWORD), false).is_ok());
    }

    #[test]
    fn an_npub_is_refused_with_the_exact_message_and_nothing_is_derived() {
        let npub = Keys::generate().public_key().to_bech32().unwrap();
        for input in [npub.clone(), npub.to_uppercase(), format!("  {npub}  ")] {
            let err = recover_keys_from_input(&input, None, true).unwrap_err();
            assert_eq!(err, NPUB_REJECTED);
        }
        // With a password too: still a public key.
        assert_eq!(
            recover_keys_from_input(&npub, Some("pw"), false).unwrap_err(),
            NPUB_REJECTED
        );
    }

    #[test]
    fn a_backup_without_a_password_and_garbage_input_are_refused() {
        let blob = create_backup_blob(&Keys::generate(), PASSWORD, TEST_LOG_N).unwrap();
        assert!(recover_keys_from_input(&blob, None, false)
            .unwrap_err()
            .contains("needs its password"));
        assert!(recover_keys_from_input(&blob, Some(""), false).is_err());
        assert!(recover_keys_from_input("not a key", None, false).is_err());
        assert!(recover_keys_from_input("", None, false).is_err());
    }

    #[test]
    fn backup_files_never_overwrite_each_other() {
        let dir = std::env::temp_dir().join(format!("swf-backup-test-{}", rand::random::<u64>()));
        let keys = Keys::generate();
        let blob = create_backup_blob(&keys, PASSWORD, TEST_LOG_N).unwrap();
        let hex = keys.public_key().to_hex();

        let first = write_backup_file(&dir, &blob, &hex).unwrap();
        let second = write_backup_file(&dir, &blob, &hex).unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read_to_string(&first).unwrap(), blob);
        assert!(write_backup_file(&dir, "not-a-backup", &hex).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
