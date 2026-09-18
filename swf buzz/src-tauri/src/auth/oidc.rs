//! Okta OIDC Authorization Code + PKCE, via the system browser and a native
//! custom-URL-scheme callback (`com.okta.trial-7050986:/callback`) — this
//! MUST exactly match the "Sign-in redirect URI" configured in the Okta
//! application, and does NOT use a loopback HTTP listener (a prior version
//! of this file did; that cannot work against an Okta app whose only
//! registered redirect URI is a custom scheme, not `http://127.0.0.1:.../`).
//! See docs/OKTA_PKCE_SETUP.md for the full flow and how to change the
//! scheme if a different Okta app is used.
//!
//! Callback delivery uses `tauri-plugin-deep-link` (OS-level scheme
//! registration) plus `tauri-plugin-single-instance` (so the second process
//! instance the OS launches when the browser redirects back is detected and
//! its command-line argument — the callback URL — is forwarded to this,
//! the already-running, instance, rather than opening a second window). See
//! `lib.rs` for how both plugins are wired to the `PendingCallback` state
//! this module manages.
//!
//! ID token signature IS verified against Okta's published JWKS
//! (`{issuer}/v1/keys`) before any claim is trusted — this closes the gap
//! previously tracked as D9 in docs/DECISIONS.md (decode-without-verify).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

/// The custom URL scheme this app registers and that Okta must redirect
/// back to. Must match `plugins.deep-link.desktop.schemes` in
/// `tauri.conf.json` and the exact redirect URIs configured in the Okta
/// application (both "Sign-in redirect URI" and "Sign-out redirect URI").
pub const REDIRECT_SCHEME: &str = "com.okta.trial-7050986";

const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

/// Holds the sender for whichever OIDC flow (login or logout) is currently
/// awaiting a deep-link callback — at most one flow is ever in flight at a
/// time, since both `login()` and `logout()` are synchronous/blocking calls
/// from a single user action. Both the global `on_open_url` handler and the
/// single-instance argv scanner (see `lib.rs`) feed incoming URLs here.
pub type PendingCallback = Mutex<Option<mpsc::Sender<String>>>;

/// The current session's Okta ID token, held ONLY in Rust memory — it is
/// never sent to the frontend/webview (see docs/SECURITY.md's "no ID token
/// in the frontend" rule extended here). Needed at logout time to build the
/// `id_token_hint` Okta's end-session endpoint requires. Cleared (taken) on
/// logout, and never persisted to disk.
pub type OktaSession = Mutex<Option<String>>;

/// Feeds an incoming deep-link URL to whichever flow is currently waiting,
/// if any. A URL arriving with no pending flow (e.g. a stray/duplicate
/// invocation) is silently dropped — there is nothing to correlate it to.
pub fn deliver_incoming_url(app: &tauri::AppHandle, url: &str) {
    // TEMPORARY DIAGNOSTIC LOGGING (Phase 7) — logs structure only, never the
    // full URL (which carries `code`/`state` query params). Remove once the
    // callback-delivery issue is root-caused.
    let scheme_path = url::Url::parse(url)
        .map(|u| format!("{}:{}", u.scheme(), u.path()))
        .unwrap_or_else(|_| "<unparseable>".to_string());
    eprintln!("[oidc diag] deliver_incoming_url: scheme+path={scheme_path}");
    let pending = app.state::<PendingCallback>();
    let guard = pending.lock().expect("pending callback lock poisoned");
    eprintln!(
        "[oidc diag] deliver_incoming_url: pending flow waiting? {}",
        guard.is_some()
    );
    if let Some(tx) = guard.as_ref() {
        let send_result = tx.send(url.to_string());
        eprintln!(
            "[oidc diag] deliver_incoming_url: forwarded to waiting flow, ok={}",
            send_result.is_ok()
        );
    } else {
        eprintln!("[oidc diag] deliver_incoming_url: NO PENDING FLOW — URL dropped");
    }
}

#[derive(Debug, thiserror::Error)]
pub enum OidcError {
    /// Exact string matched by the frontend (`authService.okta.ts`) to show
    /// a "use Development Mode instead" message — do not change this text.
    #[error("okta_not_configured")]
    NotConfigured,
    #[error("timed out waiting for sign-in to complete")]
    Timeout,
    #[error("sign-in could not be verified — please try again")]
    StateMismatch,
    #[error("could not open the system browser: {0}")]
    OpenBrowser(String),
    #[error("token exchange failed: {0}")]
    TokenExchange(String),
    #[error("could not verify the identity token: {0}")]
    TokenVerification(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OktaLoginResult {
    /// Okta's stable subject identifier — the application-level user ID.
    /// Never discard this in favor of `employee_email` alone (email can
    /// change; `sub` does not).
    pub subject: String,
    pub employee_email: Option<String>,
    /// Bearer token for `swf-buzz-backend` (DECISIONS.md D10), present only
    /// if `SWF_BUZZ_BACKEND_URL` is configured and the bootstrap call
    /// succeeded. Unlike the Okta `id_token`, this token IS safe to hand to
    /// the frontend — it was minted specifically for the frontend to use,
    /// carries no Okta-specific claims, and is independently revocable
    /// server-side. Also persisted to the OS keychain (see
    /// `StorageKey::SwfSessionToken`) so a later app launch can reuse it
    /// without repeating the Okta flow.
    pub backend_session_token: Option<String>,
    pub backend_session_expires_at: Option<String>,
}

/// Base URL of the new `swf-buzz-backend` service (DECISIONS.md D10,
/// docs/BACKEND_SESSION_DESIGN.md), e.g. `http://127.0.0.1:8787`. Absent by
/// default — deliberately optional: community/channel/message features that
/// will eventually depend on this backend aren't wired up yet (Phase 3+), so
/// a developer without this backend running can still exercise the existing
/// Okta+Nostr flow unaffected. Set to enable session bootstrap.
fn backend_base_url() -> Option<String> {
    std::env::var("SWF_BUZZ_BACKEND_URL")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty())
}

#[derive(Deserialize)]
struct BackendBootstrapResponse {
    session_token: String,
    expires_at: String,
}

/// Calls the new backend's `POST /api/session/bootstrap` with the
/// already-verified Okta ID token, so the backend can independently verify
/// it (never trusting this process's own verification — see
/// docs/BACKEND_SESSION_DESIGN.md §1/§3) and mint an application session.
/// Best-effort: any failure here is logged and treated as "no backend
/// session yet," never as a login failure — the Okta login itself already
/// succeeded and must not be undone by an unrelated new service being
/// unreachable.
fn bootstrap_backend_session(
    base_url: &str,
    id_token: &str,
) -> Result<BackendBootstrapResponse, String> {
    let http = reqwest::blocking::Client::new();
    let resp = http
        .post(format!("{base_url}/api/session/bootstrap"))
        .json(&serde_json::json!({ "id_token": id_token }))
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!("{status}: {body}"));
    }
    resp.json::<BackendBootstrapResponse>()
        .map_err(|e| e.to_string())
}

struct OktaConfig {
    /// Full authorization-server issuer, e.g.
    /// `https://trial-7050986.okta.com/oauth2/default` — verified against
    /// this tenant's live `/.well-known/openid-configuration` document
    /// during development of this module; see docs/OKTA_PKCE_SETUP.md.
    issuer: String,
    client_id: String,
}

fn load_config() -> Result<OktaConfig, OidcError> {
    let issuer = std::env::var("SWF_BUZZ_OKTA_ISSUER").map_err(|_| OidcError::NotConfigured)?;
    let client_id =
        std::env::var("SWF_BUZZ_OKTA_CLIENT_ID").map_err(|_| OidcError::NotConfigured)?;
    if issuer.trim().is_empty() || client_id.trim().is_empty() {
        return Err(OidcError::NotConfigured);
    }
    Ok(OktaConfig {
        issuer: issuer.trim_end_matches('/').to_string(),
        client_id,
    })
}

fn random_url_safe(byte_len: usize) -> String {
    let mut bytes = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[derive(Deserialize)]
struct TokenResponse {
    id_token: String,
}

#[derive(Deserialize)]
struct IdTokenClaims {
    sub: String,
    email: Option<String>,
    nonce: Option<String>,
}

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Deserialize)]
struct Jwk {
    kid: String,
    n: String,
    e: String,
}

/// Fetches Okta's JWKS and verifies the ID token's RS256 signature, `iss`,
/// `aud`, `exp` (all via `jsonwebtoken`'s built-in checks) and `nonce`
/// (checked manually — the JWT library has no built-in nonce concept, since
/// nonce is an OIDC convention, not a JWT one). Returns the verified claims,
/// or an error if any check fails — a token that merely decodes is never
/// trusted.
fn verify_id_token(
    id_token: &str,
    config: &OktaConfig,
    expected_nonce: &str,
) -> Result<IdTokenClaims, OidcError> {
    let header =
        decode_header(id_token).map_err(|e| OidcError::TokenVerification(e.to_string()))?;
    let kid = header
        .kid
        .ok_or_else(|| OidcError::TokenVerification("id_token is missing a kid".into()))?;

    let jwks_url = format!("{}/v1/keys", config.issuer);
    let jwks: Jwks = reqwest::blocking::get(&jwks_url)
        .map_err(|e| OidcError::TokenVerification(format!("fetching JWKS: {e}")))?
        .error_for_status()
        .map_err(|e| OidcError::TokenVerification(format!("fetching JWKS: {e}")))?
        .json()
        .map_err(|e| OidcError::TokenVerification(format!("parsing JWKS: {e}")))?;

    let jwk = jwks
        .keys
        .into_iter()
        .find(|k| k.kid == kid)
        .ok_or_else(|| OidcError::TokenVerification("no JWKS key matches id_token's kid".into()))?;

    let decoding_key = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
        .map_err(|e| OidcError::TokenVerification(format!("building decoding key: {e}")))?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[&config.client_id]);
    validation.set_issuer(&[&config.issuer]);
    // exp/nbf are validated by default; iat is not required by OIDC core.

    let data = decode::<IdTokenClaims>(id_token, &decoding_key, &validation)
        .map_err(|e| OidcError::TokenVerification(format!("signature/claims check failed: {e}")))?;

    if data.claims.nonce.as_deref() != Some(expected_nonce) {
        return Err(OidcError::TokenVerification("nonce mismatch".into()));
    }

    Ok(data.claims)
}

/// Blocks until a deep-link callback matching `expected_state` and
/// `expected_path` (`"/callback"` for login, `"/"` for logout) arrives via
/// `deliver_incoming_url`, or `CALLBACK_TIMEOUT` elapses. A URL for a
/// different scheme/path is ignored (it isn't ours — could be a stray OS
/// event); a URL with a mismatched `state` is treated as a hard failure
/// (prevents replay/cross-flow confusion), not silently ignored, since a
/// same-scheme same-path URL with the wrong state is exactly what a replay
/// or confused-deputy attempt would look like.
fn wait_for_deep_link(
    rx: &mpsc::Receiver<String>,
    expected_state: &str,
    expected_path: &str,
) -> Result<HashMap<String, String>, OidcError> {
    eprintln!(
        "[oidc diag] wait_for_deep_link: waiting for scheme={REDIRECT_SCHEME} path={expected_path}, timeout={}s",
        CALLBACK_TIMEOUT.as_secs()
    );
    let deadline = Instant::now() + CALLBACK_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            eprintln!("[oidc diag] wait_for_deep_link: TIMED OUT waiting for callback");
            return Err(OidcError::Timeout);
        }
        let raw = match rx.recv_timeout(remaining) {
            Ok(raw) => raw,
            Err(_) => {
                eprintln!("[oidc diag] wait_for_deep_link: TIMED OUT waiting for callback");
                return Err(OidcError::Timeout);
            }
        };

        let Ok(parsed) = url::Url::parse(&raw) else {
            eprintln!("[oidc diag] wait_for_deep_link: received unparseable URL, ignoring");
            continue;
        };
        eprintln!(
            "[oidc diag] wait_for_deep_link: received scheme={} path={} (expected scheme={REDIRECT_SCHEME} path={expected_path})",
            parsed.scheme(),
            parsed.path()
        );
        if parsed.scheme() != REDIRECT_SCHEME || parsed.path() != expected_path {
            eprintln!("[oidc diag] wait_for_deep_link: scheme/path mismatch, ignoring (not ours)");
            continue;
        }

        let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
        eprintln!(
            "[oidc diag] wait_for_deep_link: matched callback — has code={}, has state={}, has error={}",
            params.contains_key("code"),
            params.contains_key("state"),
            params.contains_key("error")
        );
        return match params.get("state") {
            Some(s) if s == expected_state => {
                eprintln!("[oidc diag] wait_for_deep_link: state OK");
                Ok(params)
            }
            Some(_) => {
                eprintln!("[oidc diag] wait_for_deep_link: STATE MISMATCH");
                Err(OidcError::StateMismatch)
            }
            None => {
                eprintln!(
                    "[oidc diag] wait_for_deep_link: no state param in callback — STATE MISMATCH"
                );
                Err(OidcError::StateMismatch)
            }
        };
    }
}

/// Runs the full Authorization Code + PKCE flow synchronously (this is a
/// plain, non-async `#[tauri::command]`, which Tauri automatically runs on
/// its blocking threadpool rather than the async/UI thread — see
/// `commands/auth.rs`). Blocks until the user completes (or abandons)
/// sign-in in the system browser, or `CALLBACK_TIMEOUT` elapses.
pub fn login(app: &tauri::AppHandle) -> Result<OktaLoginResult, OidcError> {
    eprintln!("[oidc diag] login: start_okta_login invoked");
    let config = load_config()?;
    eprintln!(
        "[oidc diag] login: config loaded, issuer={}, client_id={}",
        config.issuer, config.client_id
    );

    let verifier = random_url_safe(32);
    let challenge = pkce_challenge(&verifier);
    let state = random_url_safe(16);
    let nonce = random_url_safe(16);
    let redirect_uri = format!("{REDIRECT_SCHEME}:/callback");

    let auth_url = format!(
        "{issuer}/v1/authorize?{query}",
        issuer = config.issuer,
        query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", &config.client_id)
            .append_pair("response_type", "code")
            .append_pair("scope", "openid email profile")
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("state", &state)
            .append_pair("nonce", &nonce)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .finish(),
    );

    eprintln!(
        "[oidc diag] login: authorize endpoint={}/v1/authorize, redirect_uri={redirect_uri}, code_challenge_method=S256",
        config.issuer
    );

    let (tx, rx) = mpsc::channel::<String>();
    set_pending(app, Some(tx));

    let open_result = app
        .opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| OidcError::OpenBrowser(e.to_string()));
    eprintln!(
        "[oidc diag] login: system browser launch ok={}",
        open_result.is_ok()
    );

    let outcome = open_result.and_then(|()| wait_for_deep_link(&rx, &state, "/callback"));
    set_pending(app, None); // PKCE/state transaction is over either way — never left dangling.

    let params = outcome?;
    let code = match params.get("code") {
        Some(code) => code.clone(),
        None => {
            let desc = params
                .get("error_description")
                .cloned()
                .unwrap_or_else(|| "no authorization code returned".to_string());
            eprintln!("[oidc diag] login: no code in callback, error_description={desc}");
            return Err(OidcError::TokenExchange(desc));
        }
    };
    eprintln!("[oidc diag] login: authorization code received, exchanging at token endpoint");

    let token_url = format!("{}/v1/token", config.issuer);
    let http = reqwest::blocking::Client::new();
    let resp = http
        .post(&token_url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("client_id", config.client_id.as_str()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .map_err(|e| OidcError::TokenExchange(e.to_string()))?;

    eprintln!(
        "[oidc diag] login: token endpoint HTTP status={}",
        resp.status()
    );
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(OidcError::TokenExchange(format!("{status}: {body}")));
    }

    let token: TokenResponse = resp
        .json()
        .map_err(|e| OidcError::TokenExchange(e.to_string()))?;
    let claims = verify_id_token(&token.id_token, &config, &nonce)?;
    eprintln!("[oidc diag] login: ID token verified OK (signature, iss, aud, exp, nonce)");

    let backend_session = backend_base_url().and_then(|base| {
        eprintln!("[oidc diag] login: bootstrapping backend session at {base}");
        match bootstrap_backend_session(&base, &token.id_token) {
            Ok(info) => {
                if let Err(e) = crate::storage::secure_store::set(
                    crate::commands::secure_storage::StorageKey::SwfSessionToken.as_str(),
                    &info.session_token,
                ) {
                    eprintln!("[oidc diag] login: failed to persist backend session token: {e}");
                }
                eprintln!("[oidc diag] login: backend session bootstrap succeeded");
                Some(info)
            }
            Err(e) => {
                eprintln!(
                    "[oidc diag] login: backend session bootstrap failed (non-fatal — Okta \
                     login still succeeds; community/channel features depending on the new \
                     backend will be unavailable until this succeeds): {e}"
                );
                None
            }
        }
    });

    // Held Rust-side only, for logout's id_token_hint — never returned to JS.
    let session = app.state::<OktaSession>();
    *session.lock().expect("okta session lock poisoned") = Some(token.id_token);

    Ok(OktaLoginResult {
        subject: claims.sub,
        employee_email: claims.email,
        backend_session_token: backend_session.as_ref().map(|s| s.session_token.clone()),
        backend_session_expires_at: backend_session.as_ref().map(|s| s.expires_at.clone()),
    })
}

/// Ends the Okta session via the real OIDC end-session (RP-initiated
/// logout) flow: opens the system browser to `{issuer}/v1/logout` with the
/// `id_token_hint` obtained at login (so Okta knows which session to end
/// without prompting again) and waits for the sign-out redirect back to
/// `com.okta.trial-7050986:/`. Best-effort: if there's no stored ID token
/// (e.g. Development Mode, or Okta login never completed), or the browser
/// step fails or times out, this returns `Ok(())` regardless — the caller
/// (`useAuth.ts`) always tears down local application state unconditionally
/// after calling this, so a failed/skipped remote step never leaves the
/// user stuck signed in locally.
pub fn logout(app: &tauri::AppHandle) -> Result<(), OidcError> {
    let config = load_config()?;

    let id_token = {
        let session = app.state::<OktaSession>();
        let mut guard = session.lock().expect("okta session lock poisoned");
        guard.take()
    };
    let Some(id_token) = id_token else {
        return Ok(()); // Nothing to end server-side.
    };

    let state = random_url_safe(16);
    let post_logout_redirect_uri = format!("{REDIRECT_SCHEME}:/");
    let logout_url = format!(
        "{issuer}/v1/logout?{query}",
        issuer = config.issuer,
        query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("id_token_hint", &id_token)
            .append_pair("post_logout_redirect_uri", &post_logout_redirect_uri)
            .append_pair("state", &state)
            .finish(),
    );

    let (tx, rx) = mpsc::channel::<String>();
    set_pending(app, Some(tx));
    if app.opener().open_url(&logout_url, None::<&str>).is_ok() {
        let _ = wait_for_deep_link(&rx, &state, "/"); // best-effort; ignore the outcome
    }
    set_pending(app, None);

    Ok(())
}

fn set_pending(app: &tauri::AppHandle, sender: Option<mpsc::Sender<String>>) {
    let pending = app.state::<PendingCallback>();
    *pending.lock().expect("pending callback lock poisoned") = sender;
}

/// These currently cannot be *run* in this environment — Windows Smart App
/// Control blocks `rustc` from loading freshly-built proc-macro DLLs
/// (`serialize_to_javascript_impl`, confirmed via
/// `Microsoft-Windows-CodeIntegrity/Operational` event 3077/3033/3118),
/// which blocks any `cargo build`/`check`/`test` in this working copy, not
/// just this module — see docs/WEB_LOCAL_DEVELOPMENT.md and this session's
/// build-blocker report. Written now anyway so they run immediately on any
/// environment without that restriction (a CI runner, a different machine,
/// or this one once the policy is no longer in the way), and specifically
/// so a regression of the exact bug this module was just fixed for — the
/// redirect_uri silently drifting back to a loopback address instead of
/// the custom scheme Okta has registered — fails loudly instead of only
/// surfacing as a live "redirect_uri parameter must be a Login redirect
/// URI" error from Okta.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redirect_uri_matches_oktas_registered_sign_in_uri_exactly() {
        let redirect_uri = format!("{REDIRECT_SCHEME}:/callback");
        assert_eq!(redirect_uri, "com.okta.trial-7050986:/callback");
    }

    #[test]
    fn post_logout_redirect_uri_matches_oktas_registered_sign_out_uri_exactly() {
        let post_logout_redirect_uri = format!("{REDIRECT_SCHEME}:/");
        assert_eq!(post_logout_redirect_uri, "com.okta.trial-7050986:/");
    }

    #[test]
    fn pkce_challenge_matches_the_rfc7636_appendix_b_test_vector() {
        // The canonical example from RFC 7636 Appendix B — proves this
        // module's S256 implementation is standards-correct, not just
        // internally self-consistent.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            pkce_challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn random_url_safe_produces_the_requested_entropy_and_is_not_reused() {
        let a = random_url_safe(32);
        let b = random_url_safe(32);
        assert_ne!(
            a, b,
            "state/nonce/verifier must never repeat across attempts"
        );
        // 32 raw bytes, base64url-no-pad-encoded, is 43 characters.
        assert_eq!(a.len(), 43);
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn wait_for_deep_link_accepts_a_matching_callback() {
        let (tx, rx) = mpsc::channel::<String>();
        tx.send(format!(
            "{REDIRECT_SCHEME}:/callback?code=abc123&state=expected-state"
        ))
        .unwrap();
        let params = wait_for_deep_link(&rx, "expected-state", "/callback").unwrap();
        assert_eq!(params.get("code").map(String::as_str), Some("abc123"));
    }

    #[test]
    fn wait_for_deep_link_rejects_a_state_mismatch_instead_of_silently_ignoring_it() {
        let (tx, rx) = mpsc::channel::<String>();
        tx.send(format!(
            "{REDIRECT_SCHEME}:/callback?code=abc123&state=wrong-state"
        ))
        .unwrap();
        let result = wait_for_deep_link(&rx, "expected-state", "/callback");
        assert!(matches!(result, Err(OidcError::StateMismatch)));
    }

    #[test]
    fn wait_for_deep_link_ignores_a_url_for_a_different_scheme_or_path() {
        let (tx, rx) = mpsc::channel::<String>();
        // Not ours (different scheme) — must not be mistaken for the real callback.
        tx.send("some-other-app:/callback?code=abc123&state=expected-state".to_string())
            .unwrap();
        // The real callback, sent second, is what should actually be accepted.
        tx.send(format!(
            "{REDIRECT_SCHEME}:/callback?code=real&state=expected-state"
        ))
        .unwrap();
        let params = wait_for_deep_link(&rx, "expected-state", "/callback").unwrap();
        assert_eq!(params.get("code").map(String::as_str), Some("real"));
    }
}
