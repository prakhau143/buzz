//! Independent JWKS fetch + verification of an Okta ID token, at the
//! backend's own trust boundary — see docs/BACKEND_SESSION_DESIGN.md §1/§3
//! for why this duplicates (deliberately) the verification `src-tauri`
//! already does. Mirrors the verification checks in
//! `src-tauri/src/auth/oidc.rs::verify_id_token` (signature, `iss`, `aud`,
//! `exp`) but does NOT check `nonce` — the nonce is generated and known only
//! to the Rust desktop process for a single login attempt; this backend has
//! no way to independently know it, so nonce replay protection for THIS
//! layer relies on the token's own short `exp` plus the fact that a stolen
//! valid ID token still requires calling this backend within the token's
//! validity window. This is a known, narrower trust model than the Tauri
//! side's and is acceptable because the Tauri side already checked nonce
//! before ever presenting the token here.

use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::sync::RwLock;
use std::time::{Duration, Instant};

#[derive(Debug, thiserror::Error)]
pub enum JwksError {
    #[error("fetching JWKS: {0}")]
    Fetch(String),
    #[error("id_token is malformed: {0}")]
    Malformed(String),
    #[error("no JWKS key matches id_token's kid")]
    NoMatchingKey,
    #[error("signature/claims check failed: {0}")]
    Invalid(String),
}

#[derive(Debug, Deserialize, Clone)]
pub struct IdTokenClaims {
    pub sub: String,
    pub email: Option<String>,
    pub name: Option<String>,
}

#[derive(Deserialize, Clone)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Deserialize, Clone)]
struct Jwk {
    kid: String,
    n: String,
    e: String,
}

const CACHE_TTL: Duration = Duration::from_secs(60 * 60);

struct CachedJwks {
    fetched_at: Instant,
    jwks: Jwks,
}

/// Fetches and caches an issuer's JWKS in-process (TTL below). One cache
/// entry per `JwksVerifier` instance — the backend holds exactly one, keyed
/// to the single configured Okta issuer, so no per-issuer keying is needed.
pub struct JwksVerifier {
    issuer: String,
    audience: String,
    http: reqwest::Client,
    cache: RwLock<Option<CachedJwks>>,
}

impl JwksVerifier {
    pub fn new(issuer: String, audience: String) -> Self {
        Self {
            issuer,
            audience,
            http: reqwest::Client::new(),
            cache: RwLock::new(None),
        }
    }

    async fn jwks(&self) -> Result<Jwks, JwksError> {
        if let Some(cached) = self
            .cache
            .read()
            .expect("jwks cache lock poisoned")
            .as_ref()
        {
            if cached.fetched_at.elapsed() < CACHE_TTL {
                return Ok(cached.jwks.clone());
            }
        }

        let url = format!("{}/v1/keys", self.issuer);
        let jwks: Jwks = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| JwksError::Fetch(e.to_string()))?
            .error_for_status()
            .map_err(|e| JwksError::Fetch(e.to_string()))?
            .json()
            .await
            .map_err(|e| JwksError::Fetch(e.to_string()))?;

        *self.cache.write().expect("jwks cache lock poisoned") = Some(CachedJwks {
            fetched_at: Instant::now(),
            jwks: jwks.clone(),
        });
        Ok(jwks)
    }

    /// Fetches (or reuses the cached) JWKS and verifies `id_token` against
    /// it. Returns the verified claims, or an error if any check fails — a
    /// token that merely decodes is never trusted.
    pub async fn verify(&self, id_token: &str) -> Result<IdTokenClaims, JwksError> {
        let jwks = self.jwks().await?;
        verify_with_jwks(id_token, &jwks, &self.issuer, &self.audience)
    }
}

fn verify_with_jwks(
    id_token: &str,
    jwks: &Jwks,
    issuer: &str,
    audience: &str,
) -> Result<IdTokenClaims, JwksError> {
    let header = decode_header(id_token).map_err(|e| JwksError::Malformed(e.to_string()))?;
    let kid = header
        .kid
        .ok_or_else(|| JwksError::Malformed("id_token is missing a kid".into()))?;

    let jwk = jwks
        .keys
        .iter()
        .find(|k| k.kid == kid)
        .ok_or(JwksError::NoMatchingKey)?;

    let decoding_key = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
        .map_err(|e| JwksError::Invalid(format!("building decoding key: {e}")))?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[audience]);
    validation.set_issuer(&[issuer]);
    // exp/nbf are validated by default via jsonwebtoken.

    let data = decode::<IdTokenClaims>(id_token, &decoding_key, &validation)
        .map_err(|e| JwksError::Invalid(e.to_string()))?;

    Ok(data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde::Serialize;

    // Test-only RSA keypair, generated once via OpenSSL for these unit
    // tests only — never used outside this test module, not a real secret.
    const TEST_PRIVATE_KEY_PEM: &str = "-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5MTXJSAcxaFxd
vgcoh3hlZb5mPwnMB0XjCFAgtvzMtyZKDUJ7RILCB74y1rFDOJexQYoa1gP/NuVJ
zqKZbYYWFxwEvUJLOvL3lDTuovHuHVrXjz/pv37pcy45AZqddZw5eOacTau9sb7V
w14SUYfFnaVTwNPU0N4d7cU8WqVZ4AYpxHkHq/ExufmF4VTez96wkKxgaosYXVw6
s3OplDAvPk1XcsHLOFjwY/F8MdeBkYAb5DvbgYvK81Qz4L9rKTBwcrox4kLgSNaY
etwwNAcyZCqEJCBe0ONvnohQk5Zq+zmsxqE9m4LKGmdqppNsL4z6h7XlSxTImg5W
0Ok2tswFAgMBAAECggEAJZo7XJpWc47IKnSaSX1wUc5d4a7tE1NqulWGx43AOOT7
Tk/w7syTbEhcM0Bqj8ae7mvrWdWYzCpeViUx2MtnTXb1xnSTUGkwylp6gPXu/7VQ
K7K3fIPYhhhQC10rAsvNo9HLqXMP6x17LTZVFI0fb126Iw5lNLIQV61evgl9x4if
gIJGklksFjIGkoAtJAlKtFfzUSvz6Iiwz/RErK4lPfnO7XVT0BFhYNVXOmaQssIR
QI9+FhKqsycGKRGqX0Nfnk/bCpKtEi8/Qyg1djRFlxqTypYafsXuP6tPCTIRyYQn
hiCyxG/kxm89USPTQtORc9rKupKR18LMZz9IUfavQQKBgQDv+ey1VdumJ7wNzHwo
vFUrn6aXp/tdohzyK0z4rSDwIV6dJMhXMf+eFwairf3g9g5QNT2qq0OHgHkwJnY/
4MmzAbwj5XarBUFWIttq5MrdZLqLnw+WzHTcfo8becFPNM7uTRgXYKm8uXKU5lvz
xrseDXKN7UUw8K232T84qoZUlQKBgQDFjtM5A95d8WJi1fMAddkzlTiAZKXK704H
M/NxwL0qAU92f39RbXh+yLDHwn2zTU0gzmpqrq3aAmDgFTEGnKJ/iRRTuhAkgdrm
R0T5PdV6JztBG0GmH47kVxZ9vVkn9TUayto19qwSAqZnS85WpRLGn72/JzowrHPF
KnKg6+/NsQKBgQDBy4YyJsT8GKiQSCuYRgdN9F73qCuhwPI5S2ichkvMQFaE9xhm
+jSguZ2dMH+O9YY3lddYBXjCa6jyjoz+Jw0b53HFV2CO2e6angmt+FgvlFHlwS04
raJOElKFcL0AtvfJkC69ak2I4AY9Yw6s/jdMHLX/EbbHwAW6K9IXc/aJRQKBgQCy
p4B4NPlotxukCZrhNbGgJjecVGhh5psHhIGIwyXN0LWNkasPdhHbhZ3oaAfImAVB
v6kYpLLvTetReZiGRCvnbY2GUeK7QPs1+Al14+cjukqpi/6IPk24TNE4EH2J1wOZ
IQzIdDQTbXYSP8lvLYSXPmoXbWAAGFPxX3ud7v9DYQKBgCf5hYhB2zFYnib6gLlO
QChAjh3zoCLuDyFMYIyRHgleaL+ncwvoFgJ7rfGmoN73D3zRK/VY4+czyzqhqikr
x/PkJA/ZD151kkFk/N06KYQrxiAi9CtqRH462h2VN0sK6MgFi0FRG6e4C9DS+Maf
pwkmMJk13ZWf1Qa0AVo4iZmK
-----END PRIVATE KEY-----";

    const TEST_KID: &str = "test-key-1";
    const TEST_N: &str = "uTE1yUgHMWhcXb4HKId4ZWW-Zj8JzAdF4whQILb8zLcmSg1Ce0SCwge-MtaxQziXsUGKGtYD_zblSc6imW2GFhccBL1CSzry95Q07qLx7h1a148_6b9-6XMuOQGanXWcOXjmnE2rvbG-1cNeElGHxZ2lU8DT1NDeHe3FPFqlWeAGKcR5B6vxMbn5heFU3s_esJCsYGqLGF1cOrNzqZQwLz5NV3LByzhY8GPxfDHXgZGAG-Q724GLyvNUM-C_aykwcHK6MeJC4EjWmHrcMDQHMmQqhCQgXtDjb56IUJOWavs5rMahPZuCyhpnaqaTbC-M-oe15UsUyJoOVtDpNrbMBQ";
    const TEST_E: &str = "AQAB";

    const ISSUER: &str = "https://test.okta.example/oauth2/default";
    const AUDIENCE: &str = "test-client-id";

    fn test_jwks() -> Jwks {
        Jwks {
            keys: vec![Jwk {
                kid: TEST_KID.to_string(),
                n: TEST_N.to_string(),
                e: TEST_E.to_string(),
            }],
        }
    }

    #[derive(Serialize)]
    struct TestClaims {
        sub: String,
        email: Option<String>,
        name: Option<String>,
        iss: String,
        aud: String,
        exp: i64,
        iat: i64,
    }

    fn now() -> i64 {
        chrono::Utc::now().timestamp()
    }

    fn sign(claims: &TestClaims, kid: &str) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(kid.to_string());
        let key = EncodingKey::from_rsa_pem(TEST_PRIVATE_KEY_PEM.as_bytes()).unwrap();
        encode(&header, claims, &key).unwrap()
    }

    fn valid_claims() -> TestClaims {
        TestClaims {
            sub: "okta-sub-abc123".to_string(),
            email: Some("person@example.com".to_string()),
            name: Some("Person Name".to_string()),
            iss: ISSUER.to_string(),
            aud: AUDIENCE.to_string(),
            exp: now() + 300,
            iat: now(),
        }
    }

    #[test]
    fn accepts_a_validly_signed_unexpired_token() {
        let token = sign(&valid_claims(), TEST_KID);
        let claims = verify_with_jwks(&token, &test_jwks(), ISSUER, AUDIENCE).unwrap();
        assert_eq!(claims.sub, "okta-sub-abc123");
        assert_eq!(claims.email.as_deref(), Some("person@example.com"));
    }

    #[test]
    fn rejects_an_expired_token() {
        let mut claims = valid_claims();
        // Well beyond jsonwebtoken's default 60s leeway, so this can't pass
        // by accident of clock-skew tolerance.
        claims.exp = now() - 3600;
        let token = sign(&claims, TEST_KID);
        let result = verify_with_jwks(&token, &test_jwks(), ISSUER, AUDIENCE);
        assert!(result.is_err(), "expired token must be rejected");
    }

    #[test]
    fn rejects_a_wrong_issuer() {
        let mut claims = valid_claims();
        claims.iss = "https://not-our-okta.example/oauth2/default".to_string();
        let token = sign(&claims, TEST_KID);
        let result = verify_with_jwks(&token, &test_jwks(), ISSUER, AUDIENCE);
        assert!(result.is_err(), "wrong issuer must be rejected");
    }

    #[test]
    fn rejects_a_wrong_audience() {
        let mut claims = valid_claims();
        claims.aud = "some-other-client-id".to_string();
        let token = sign(&claims, TEST_KID);
        let result = verify_with_jwks(&token, &test_jwks(), ISSUER, AUDIENCE);
        assert!(result.is_err(), "wrong audience must be rejected");
    }

    #[test]
    fn rejects_a_tampered_signature() {
        let token = sign(&valid_claims(), TEST_KID);
        // Flip a character deep inside the signature segment.
        let mut parts: Vec<&str> = token.split('.').collect();
        let mut sig: Vec<char> = parts[2].chars().collect();
        let last = sig.len() - 1;
        sig[last] = if sig[last] == 'A' { 'B' } else { 'A' };
        let tampered_sig: String = sig.into_iter().collect();
        parts[2] = &tampered_sig;
        let tampered = parts.join(".");
        let result = verify_with_jwks(&tampered, &test_jwks(), ISSUER, AUDIENCE);
        assert!(result.is_err(), "tampered signature must be rejected");
    }

    #[test]
    fn rejects_an_unknown_kid() {
        let token = sign(&valid_claims(), "some-other-kid-not-in-jwks");
        let result = verify_with_jwks(&token, &test_jwks(), ISSUER, AUDIENCE);
        assert!(matches!(result, Err(JwksError::NoMatchingKey)));
    }
}
