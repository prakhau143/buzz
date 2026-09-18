//! Opaque bearer session tokens — generated with a CSPRNG, hashed with
//! SHA-256 before storage, raw value returned exactly once. Same convention
//! the master prompt specifies for community invite tokens (DECISIONS.md
//! D10) — one rule for every bearer secret this backend issues.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};

pub fn generate() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash(raw: &str) -> String {
    let digest = Sha256::digest(raw.as_bytes());
    hex::encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_produces_high_entropy_unique_tokens() {
        let a = generate();
        let b = generate();
        assert_ne!(a, b);
        assert_eq!(a.len(), 43); // 32 raw bytes, base64url-no-pad
    }

    #[test]
    fn hash_is_deterministic_and_never_equals_the_input() {
        let raw = "some-raw-token-value";
        assert_eq!(hash(raw), hash(raw));
        assert_ne!(hash(raw), raw);
    }

    #[test]
    fn different_tokens_hash_differently() {
        assert_ne!(hash(&generate()), hash(&generate()));
    }
}
