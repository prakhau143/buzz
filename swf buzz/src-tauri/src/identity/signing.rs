//! Rust-side event signing. The secret key is used here and never returned.

use nostr::nips::nip44;
use nostr::{Event, EventBuilder, Keys, Kind, PublicKey, Tag, Timestamp, ToBech32};

const BECH32_CHARSET: &str = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/// True if `text` contains a bech32-looking private key (`nsec1…`) or key
/// backup (`ncryptsec1…`) — i.e. the HRP followed by a long run of bech32
/// characters, which avoids tripping on someone merely *mentioning* the prefix.
fn contains_key_shaped_secret(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    ["ncryptsec1", "nsec1"].iter().any(|hrp| {
        lower.match_indices(hrp).any(|(at, _)| {
            lower[at + hrp.len()..]
                .chars()
                .take_while(|c| BECH32_CHARSET.contains(*c))
                .count()
                >= 40
        })
    })
}

/// Egress guard: an event may be published to a relay, so it must never carry
/// this identity's own secret (hex or bech32) or any key-shaped secret / NIP-49
/// backup. Mirrors the reference desktop's guard that keeps `ncryptsec` off relays.
fn ensure_no_key_material(keys: &Keys, content: &str, tags: &[Vec<String>]) -> Result<(), String> {
    let secret_hex = keys.secret_key().to_secret_hex();
    let own_nsec = keys
        .secret_key()
        .to_bech32()
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let leaks = |text: &str| {
        let lower = text.to_ascii_lowercase();
        lower.contains(&secret_hex)
            || (!own_nsec.is_empty() && lower.contains(&own_nsec))
            || contains_key_shaped_secret(text)
    };
    if leaks(content) || tags.iter().flatten().any(|part| leaks(part)) {
        return Err("refusing to sign: the event contains private key material".to_string());
    }
    Ok(())
}

/// Build and sign a Nostr event (NIP-01 id + BIP-340 signature) with `keys`.
///
/// `tags` is the usual array-of-string-arrays; an invalid tag is an error
/// rather than being silently dropped, so a caller can never sign something
/// other than what it asked for. Events containing key material are refused.
pub fn sign_event(
    keys: &Keys,
    kind: u16,
    content: String,
    created_at: Option<u64>,
    tags: Vec<Vec<String>>,
) -> Result<Event, String> {
    ensure_no_key_material(keys, &content, &tags)?;
    let tags = tags
        .into_iter()
        .map(|tag| Tag::parse(tag).map_err(|e| format!("invalid tag: {e}")))
        .collect::<Result<Vec<_>, _>>()?;

    let mut builder = EventBuilder::new(Kind::Custom(kind), content).tags(tags);
    if let Some(ts) = created_at {
        builder = builder.custom_created_at(Timestamp::from(ts));
    }
    builder
        .sign_with_keys(keys)
        .map_err(|e| format!("sign failed: {e}"))
}

/// NIP-44 v2 encrypt with the key held in Rust. The secret never leaves here.
///
/// The same egress guard as `sign_event` applies to the *plaintext*: a NIP-44
/// payload is published to a relay like any other content, and a ciphertext
/// cannot be scanned after the fact, so anything key-shaped is refused before
/// it is sealed.
///
/// Self-encryption (NIP-RS read state) is the case where `recipient_pubkey`
/// equals this identity's own public key; nothing here special-cases it,
/// matching `nip44_conversation_key(user_privkey, user_pubkey)` in NIP-RS.
pub fn nip44_encrypt(
    keys: &Keys,
    recipient_pubkey: &str,
    plaintext: &str,
) -> Result<String, String> {
    ensure_no_key_material(keys, plaintext, &[])?;
    let recipient =
        PublicKey::parse(recipient_pubkey).map_err(|e| format!("invalid pubkey: {e}"))?;
    nip44::encrypt(keys.secret_key(), &recipient, plaintext, nip44::Version::V2)
        .map_err(|e| format!("encrypt failed: {e}"))
}

/// NIP-44 v2 decrypt with the key held in Rust.
///
/// Returns a plain error rather than the offending payload: a decrypt failure
/// is routine (an event not addressed to us, or a foreign `kind:30078` sharing
/// the same kind number), and echoing attacker-supplied bytes into a log or a
/// UI string would be a needless disclosure channel.
pub fn nip44_decrypt(keys: &Keys, sender_pubkey: &str, ciphertext: &str) -> Result<String, String> {
    let sender = PublicKey::parse(sender_pubkey).map_err(|e| format!("invalid pubkey: {e}"))?;
    nip44::decrypt(keys.secret_key(), &sender, ciphertext).map_err(|_| "decrypt failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn nip44_self_encryption_round_trips() {
        // Exactly the NIP-RS shape: conversation key is (own secret, own pubkey).
        let keys = Keys::generate();
        let own = keys.public_key().to_hex();
        let blob = r#"{"v":1,"client_id":"abc","contexts":{"chan-1":1700000000}}"#;

        let ciphertext = nip44_encrypt(&keys, &own, blob).unwrap();
        assert_ne!(ciphertext, blob, "must not be stored in the clear");
        assert!(!ciphertext.contains("client_id"));

        let plaintext = nip44_decrypt(&keys, &own, &ciphertext).unwrap();
        assert_eq!(plaintext, blob);
    }

    #[test]
    fn nip44_ciphertext_is_not_deterministic_but_still_decrypts() {
        // NIP-44 uses a random nonce, so two seals of the same plaintext differ.
        // Pinned because a deterministic ciphertext would leak equality of
        // successive read-state blobs to the relay.
        let keys = Keys::generate();
        let own = keys.public_key().to_hex();
        let a = nip44_encrypt(&keys, &own, "same").unwrap();
        let b = nip44_encrypt(&keys, &own, "same").unwrap();
        assert_ne!(a, b);
        assert_eq!(nip44_decrypt(&keys, &own, &a).unwrap(), "same");
        assert_eq!(nip44_decrypt(&keys, &own, &b).unwrap(), "same");
    }

    #[test]
    fn nip44_refuses_to_seal_key_material() {
        // A sealed nsec is still an exfiltrated nsec once published.
        let keys = Keys::generate();
        let own = keys.public_key().to_hex();
        let own_nsec = keys.secret_key().to_bech32().unwrap();
        for plaintext in [
            keys.secret_key().to_secret_hex(),
            own_nsec.clone(),
            format!("backup: {own_nsec}"),
        ] {
            let err = nip44_encrypt(&keys, &own, &plaintext).unwrap_err();
            assert!(err.contains("private key material"), "{err}");
        }
    }

    #[test]
    fn nip44_decrypt_rejects_foreign_and_malformed_payloads() {
        let keys = Keys::generate();
        let own = keys.public_key().to_hex();
        let stranger = Keys::generate();
        // Sealed to someone else entirely.
        let foreign =
            nip44_encrypt(&stranger, &stranger.public_key().to_hex(), "not yours").unwrap();

        for payload in [foreign.as_str(), "not-base64-at-all", ""] {
            let err = nip44_decrypt(&keys, &own, payload).unwrap_err();
            // Never echoes the payload back.
            assert_eq!(err, "decrypt failed", "must not disclose the payload");
        }
    }

    #[test]
    fn nip44_rejects_an_invalid_pubkey() {
        let keys = Keys::generate();
        assert!(nip44_encrypt(&keys, "nope", "x")
            .unwrap_err()
            .contains("invalid pubkey"));
        assert!(nip44_decrypt(&keys, "nope", "x")
            .unwrap_err()
            .contains("invalid pubkey"));
    }

    #[test]
    fn signed_event_is_valid_and_carries_the_public_key() {
        let keys = Keys::generate();
        let event = sign_event(
            &keys,
            9,
            "hello".into(),
            Some(1_700_000_000),
            vec![tag(&["h", "channel-1"])],
        )
        .unwrap();

        assert!(event.verify().is_ok(), "id/signature must verify");
        assert_eq!(event.pubkey, keys.public_key());
        assert_eq!(event.kind, Kind::Custom(9));
        assert_eq!(event.content, "hello");
        assert_eq!(event.created_at.as_secs(), 1_700_000_000);
        assert_eq!(event.tags.len(), 1);
    }

    #[test]
    fn nip42_auth_event_shape_round_trips() {
        // Exactly what RelayConnectionService signs for the relay AUTH challenge.
        let keys = Keys::generate();
        let event = sign_event(
            &keys,
            22242,
            String::new(),
            None,
            vec![
                tag(&["relay", "ws://localhost:3000"]),
                tag(&["challenge", "abc123"]),
            ],
        )
        .unwrap();

        assert!(event.verify().is_ok());
        assert_eq!(event.kind, Kind::Custom(22242));
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(
            json["tags"][0],
            serde_json::json!(["relay", "ws://localhost:3000"])
        );
        assert_eq!(json["tags"][1], serde_json::json!(["challenge", "abc123"]));
        // Serialised event exposes exactly the NIP-01 fields and no secret.
        let mut fields: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        fields.sort();
        assert_eq!(
            fields,
            [
                "content",
                "created_at",
                "id",
                "kind",
                "pubkey",
                "sig",
                "tags"
            ]
        );
    }

    #[test]
    fn empty_tag_is_rejected_not_dropped() {
        let keys = Keys::generate();
        let err = sign_event(&keys, 1, String::new(), None, vec![vec![]]).unwrap_err();
        assert!(err.contains("invalid tag"));
    }

    #[test]
    fn events_carrying_key_material_are_refused() {
        let keys = Keys::generate();
        let own_hex = keys.secret_key().to_secret_hex();
        let own_nsec = keys.secret_key().to_bech32().unwrap();
        let other_nsec = Keys::generate().secret_key().to_bech32().unwrap();
        let backup =
            crate::identity::backup::create_backup_blob(&keys, "correct horse battery", 4).unwrap();

        // In content, in a tag, uppercased, and buried in prose.
        for (content, tags) in [
            (own_hex.clone(), vec![]),
            (own_nsec.clone(), vec![]),
            (other_nsec, vec![]),
            (backup.clone(), vec![]),
            (backup.to_uppercase(), vec![]),
            (format!("please keep this safe: {own_nsec} thanks"), vec![]),
            (String::new(), vec![tag(&["note", &own_hex])]),
            (String::new(), vec![tag(&["x", &backup])]),
        ] {
            let err = sign_event(&keys, 1, content, None, tags).unwrap_err();
            assert!(err.contains("private key material"), "{err}");
        }
    }

    #[test]
    fn ordinary_events_and_public_identifiers_are_still_signed() {
        let keys = Keys::generate();
        let pubkey_hex = keys.public_key().to_hex(); // 64 hex chars, like a secret — but public
        let npub = keys.public_key().to_bech32().unwrap();
        for content in [
            "hello".to_string(),
            "the prefix nsec1 or ncryptsec1 is how keys look".to_string(),
            format!("hi {npub}"),
            pubkey_hex.clone(),
        ] {
            assert!(sign_event(&keys, 1, content, None, vec![tag(&["p", &pubkey_hex])]).is_ok());
        }
    }

    #[test]
    fn same_input_and_timestamp_gives_the_same_event_id() {
        let keys = Keys::generate();
        let a = sign_event(&keys, 1, "x".into(), Some(5), vec![]).unwrap();
        let b = sign_event(&keys, 1, "x".into(), Some(5), vec![]).unwrap();
        assert_eq!(a.id, b.id);
    }
}
