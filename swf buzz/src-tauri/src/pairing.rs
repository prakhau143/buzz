//! Settings → Mobile: desktop side ("source") of NIP-AB device pairing.
//!
//! The protocol is OLD BUZZ's, used unmodified from `buzz-core` (formally
//! modelled in `crates/buzz-core/src/pairing/NIP-AB.spthy`): ephemeral keys,
//! a `nostrpair://` QR carrying the session secret, NIP-44 v2 between the two
//! ephemeral keys over kind 24134, a 6-digit SAS both people compare, and a
//! transcript hash the phone verifies before accepting anything. Transport
//! mirrors OLD BUZZ `desktop/src-tauri/src/commands/pairing.rs`.
//!
//! **Security decision pending — no private key leaves this device.** OLD BUZZ
//! sends the full nsec to the phone (audit §13). SWF keeps the key in the OS
//! keyring and signs only in Rust, so exporting it is a product/security
//! decision that has not been made. Until it is, after the SAS is confirmed
//! this sends a NON-SECRET `custom` payload (public key + community address)
//! that proves the encrypted channel works end to end, and the UI says plainly
//! that the identity was not transferred. There is no code path here that
//! reads the secret key.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use buzz_core::kind::KIND_PAIRING;
use buzz_core::pairing::qr::encode_qr;
use buzz_core::pairing::session::PairingSession;
use buzz_core::pairing::types::{AbortReason, PayloadType};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use zeroize::Zeroizing;

/// Session lifetime (NIP-AB: 120 s) plus a little transport slack.
const SESSION_SECS: u64 = 120;
const HARD_TIMEOUT_SECS: u64 = 130;
/// Keep-alive while waiting for the phone. Production pairing servers sit
/// behind proxies that close WebSockets after ~60 s of silence, which ended
/// sessions early ("The pairing server closed the connection").
const KEEPALIVE_SECS: u64 = 20;

#[derive(Serialize, Clone)]
struct SasPayload {
    sas: String,
}
#[derive(Serialize, Clone)]
struct MessagePayload {
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingStarted {
    pub qr_uri: String,
    pub pairing_relay: String,
    pub expires_in_secs: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmOutcome {
    /// Always false in this build: the private key is never exported.
    pub identity_transferred: bool,
}

#[derive(Default)]
pub struct PairingHandle {
    session: Arc<tokio::sync::Mutex<Option<PairingSession>>>,
    generation: Arc<AtomicU64>,
    start_lock: tokio::sync::Mutex<()>,
    cancel: std::sync::Mutex<Option<watch::Sender<bool>>>,
    outbound: std::sync::Mutex<Option<mpsc::Sender<String>>>,
    /// Built at start; NO secret material (see module docs).
    payload: std::sync::Mutex<Option<Zeroizing<String>>>,
}

impl PairingHandle {
    fn clear(&self) {
        if let Some(tx) = self.cancel.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = tx.send(true);
        }
        *self.outbound.lock().unwrap_or_else(|e| e.into_inner()) = None;
        *self.payload.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

fn is_current(generation: &AtomicU64, mine: u64) -> bool {
    generation.load(Ordering::SeqCst) == mine
}

/// Only a ws:// or wss:// URL with a host is ever connected to.
pub(crate) fn validate_ws_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|_| "invalid community address".to_string())?;
    if !matches!(parsed.scheme(), "ws" | "wss") || parsed.host_str().is_none() {
        return Err("the community address must be a ws:// or wss:// URL".into());
    }
    Ok(parsed)
}

/// Start a pairing session for the community at `relay_url` (the open one).
#[tauri::command]
pub async fn start_pairing(
    app: AppHandle,
    pairing: State<'_, PairingHandle>,
    identity: State<'_, crate::identity::IdentityState>,
    relay_url: String,
) -> Result<PairingStarted, String> {
    validate_ws_url(&relay_url)?;
    // Public key only — proves which identity is being paired.
    let pubkey_hex = identity.signing_keys()?.public_key().to_hex();

    let _guard = pairing.start_lock.lock().await;
    let generation = pairing.generation.fetch_add(1, Ordering::SeqCst) + 1;
    pairing.clear();
    *pairing.session.lock().await = None;

    let pairing_relay = resolve_pairing_relay_url(&relay_url, probe_pairing_relay(&relay_url).await)?;
    let (session, qr_payload) = PairingSession::new_source(pairing_relay.clone());
    let qr_uri = encode_qr(&qr_payload);

    let payload = serde_json::json!({
        "type": "swf-buzz-pairing-check",
        "pubkey": pubkey_hex,
        "relayUrl": relay_url,
        "identityTransferred": false,
    });
    *pairing.payload.lock().map_err(|e| e.to_string())? = Some(Zeroizing::new(payload.to_string()));
    *pairing.session.lock().await = Some(session);

    let (out_tx, out_rx) = mpsc::channel::<String>(16);
    let (cancel_tx, cancel_rx) = watch::channel(false);
    *pairing.outbound.lock().map_err(|e| e.to_string())? = Some(out_tx);
    *pairing.cancel.lock().map_err(|e| e.to_string())? = Some(cancel_tx);

    let session = Arc::clone(&pairing.session);
    let gen = Arc::clone(&pairing.generation);
    let relay_for_task = pairing_relay.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(message) = ws_task(&relay_for_task, &session, &gen, generation, cancel_rx, out_rx, &app).await {
            if is_current(&gen, generation) {
                let _ = app.emit("pairing-error", MessagePayload { message });
            }
        }
        if is_current(&gen, generation) {
            *session.lock().await = None;
        }
    });

    Ok(PairingStarted { qr_uri, pairing_relay, expires_in_secs: SESSION_SECS })
}

/// The person confirmed both screens show the same 6-digit code.
#[tauri::command]
pub async fn confirm_pairing_sas(pairing: State<'_, PairingHandle>) -> Result<ConfirmOutcome, String> {
    let tx = pairing
        .outbound
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("no active pairing session")?;
    let payload = pairing
        .payload
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("no active pairing session")?;

    let (confirm_json, payload_json) = {
        let mut guard = pairing.session.lock().await;
        let session = guard.as_mut().ok_or("no active pairing session")?;
        let confirm = session.confirm_sas().map_err(|e| e.to_string())?;
        let payload_event = session.send_payload(PayloadType::Custom, payload).map_err(|e| e.to_string())?;
        (event_json(&confirm), event_json(&payload_event))
    };
    tx.send(confirm_json)
        .await
        .map_err(|_| "Pairing code expired. Create a new code and try again.")?;
    tx.send(payload_json).await.map_err(|_| "failed to send to the phone")?;
    Ok(ConfirmOutcome { identity_transferred: false })
}

#[tauri::command]
pub async fn cancel_pairing(pairing: State<'_, PairingHandle>) -> Result<(), String> {
    pairing.generation.fetch_add(1, Ordering::SeqCst);
    let abort = {
        let mut guard = pairing.session.lock().await;
        guard
            .as_mut()
            .and_then(|s| s.abort(AbortReason::UserDenied).ok().flatten())
            .map(|e| event_json(&e))
    };
    if let Some(json) = abort {
        let tx = pairing.outbound.lock().map_err(|e| e.to_string())?.clone();
        if let Some(tx) = tx {
            let _ = tx.send(json).await;
        }
    }
    pairing.clear();
    *pairing.session.lock().await = None;
    Ok(())
}

async fn ws_task(
    relay_url: &str,
    session: &Arc<tokio::sync::Mutex<Option<PairingSession>>>,
    generation: &AtomicU64,
    mine: u64,
    mut cancel: watch::Receiver<bool>,
    mut outbound: mpsc::Receiver<String>,
    app: &AppHandle,
) -> Result<(), String> {
    let (ws, _) = connect_async(relay_url)
        .await
        .map_err(|_| "Couldn't connect to the pairing server.".to_string())?;
    let (mut write, mut read) = ws.split();

    auth_if_challenged(&mut read, &mut write, session, relay_url).await?;

    let our_pk = session.lock().await.as_ref().ok_or("session gone")?.pubkey().to_hex();
    let req = serde_json::json!(["REQ", "pair", { "kinds": [KIND_PAIRING], "#p": [our_pk] }]);
    write
        .send(Message::Text(req.to_string().into()))
        .await
        .map_err(|_| "Couldn't subscribe on the pairing server.".to_string())?;
    wait_for_eose(&mut read, "pair", Duration::from_secs(10)).await?;

    let hard_timeout = tokio::time::sleep(Duration::from_secs(HARD_TIMEOUT_SECS));
    tokio::pin!(hard_timeout);
    let mut keepalive = tokio::time::interval(Duration::from_secs(KEEPALIVE_SECS));
    keepalive.tick().await; // the first tick fires immediately

    loop {
        if !is_current(generation, mine) {
            break;
        }
        tokio::select! {
            _ = cancel.changed() => break,
            _ = &mut hard_timeout => {
                if is_current(generation, mine) {
                    let _ = app.emit("pairing-error", MessagePayload { message: "Session timed out".into() });
                }
                break;
            }
            _ = keepalive.tick() => {
                write.send(Message::Ping(Vec::new().into())).await.map_err(|_| "Lost the connection to the pairing server.".to_string())?;
            }
            Some(json) = outbound.recv() => {
                write.send(Message::Text(json.into())).await.map_err(|_| "Couldn't send to the pairing server.".to_string())?;
            }
            msg = read.next() => {
                let Some(msg) = msg else { return Err("The pairing server closed the connection.".into()) };
                let Ok(Message::Text(text)) = msg else { continue };
                let Some(event) = parse_relay_event(text.as_str(), "pair") else { continue };
                let mut guard = session.lock().await;
                let Some(s) = guard.as_mut() else { break };
                if let Ok(reason) = s.handle_abort(&event) {
                    if is_current(generation, mine) {
                        let _ = app.emit("pairing-aborted", MessagePayload { message: abort_text(reason) });
                    }
                    break;
                }
                if let Ok(sas) = s.handle_offer(&event) {
                    if is_current(generation, mine) {
                        let _ = app.emit("pairing-sas-received", SasPayload { sas });
                    }
                    continue;
                }
                match s.handle_complete(&event) {
                    Ok(()) => {
                        if is_current(generation, mine) {
                            let _ = app.emit("pairing-complete", serde_json::json!({ "identityTransferred": false }));
                        }
                        break;
                    }
                    Err(e) if e.to_string().contains("success=false") => {
                        if is_current(generation, mine) {
                            let _ = app.emit("pairing-error", MessagePayload {
                                message: "The phone completed the secure check but reported it couldn't use what was sent.".into(),
                            });
                        }
                        break;
                    }
                    Err(_) => {}
                }
            }
        }
    }
    Ok(())
}

fn abort_text(reason: AbortReason) -> String {
    match reason {
        AbortReason::SasMismatch => "The codes didn't match on the phone. Pairing was stopped for your safety.".into(),
        AbortReason::UserDenied => "Pairing was cancelled on the phone.".into(),
        AbortReason::Timeout => "The phone reported the session timed out.".into(),
        _ => "The phone stopped the pairing.".into(),
    }
}

async fn auth_if_challenged<R, W>(
    read: &mut R,
    write: &mut W,
    session: &Arc<tokio::sync::Mutex<Option<PairingSession>>>,
    relay_url: &str,
) -> Result<(), String>
where
    R: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
    W: SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    let challenge = tokio::time::timeout(Duration::from_secs(3), async {
        while let Some(Ok(msg)) = read.next().await {
            if let Message::Text(text) = msg {
                if let Some(c) = parse_auth_challenge(text.as_str()) {
                    return Some(c);
                }
            }
        }
        None
    })
    .await
    .ok()
    .flatten();
    let Some(challenge) = challenge else { return Ok(()) };
    let relay = nostr::RelayUrl::parse(relay_url).map_err(|_| "invalid pairing server address".to_string())?;
    // Signed with the EPHEMERAL session key, never the identity key.
    let auth = {
        let guard = session.lock().await;
        let s = guard.as_ref().ok_or("session gone during auth")?;
        s.sign_event(nostr::EventBuilder::auth(challenge, relay)).map_err(|e| e.to_string())?
    };
    write
        .send(Message::Text(format!("[\"AUTH\",{}]", nostr::JsonUtil::as_json(&auth)).into()))
        .await
        .map_err(|_| "Couldn't authenticate with the pairing server.".to_string())?;
    let _ = tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(Ok(msg)) = read.next().await {
            if let Message::Text(text) = msg {
                if text.as_str().starts_with("[\"OK\"") {
                    break;
                }
            }
        }
    })
    .await;
    Ok(())
}

fn event_json(event: &nostr::Event) -> String {
    format!("[\"EVENT\",{}]", nostr::JsonUtil::as_json(event))
}

fn parse_relay_event(text: &str, sub_id: &str) -> Option<nostr::Event> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let arr = value.as_array()?;
    if arr.len() < 3 || arr[0].as_str()? != "EVENT" || arr[1].as_str()? != sub_id {
        return None;
    }
    serde_json::from_value(arr[2].clone()).ok()
}

fn parse_auth_challenge(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let arr = value.as_array()?;
    (arr.len() >= 2 && arr[0].as_str()? == "AUTH").then(|| arr[1].as_str().map(str::to_string)).flatten()
}

async fn wait_for_eose<S>(read: &mut S, sub_id: &str, within: Duration) -> Result<(), String>
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    tokio::time::timeout(within, async {
        while let Some(Ok(msg)) = read.next().await {
            if let Message::Text(text) = msg {
                if let Ok(serde_json::Value::Array(arr)) = serde_json::from_str::<serde_json::Value>(text.as_str()) {
                    if arr.len() >= 2 && arr[0].as_str() == Some("EOSE") && arr[1].as_str() == Some(sub_id) {
                        return Ok(());
                    }
                }
            }
        }
        Err("The pairing server closed the connection.".to_string())
    })
    .await
    .map_err(|_| "Pairing took too long to start. Try again.".to_string())?
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PairingRelay {
    Configured(String),
    LegacyPath,
    MainRelay,
}

/// Same discovery as OLD BUZZ: NIP-11 `pairing_relay_url`, else `/pair` on a
/// NIP-43 relay, else the community relay itself.
async fn probe_pairing_relay(relay_url: &str) -> PairingRelay {
    let http = if let Some(rest) = relay_url.strip_prefix("wss://") {
        format!("https://{rest}")
    } else if let Some(rest) = relay_url.strip_prefix("ws://") {
        format!("http://{rest}")
    } else {
        return PairingRelay::MainRelay;
    };
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(5)).build() else {
        return PairingRelay::MainRelay;
    };
    let Ok(response) = client.get(&http).header("Accept", "application/nostr+json").send().await else {
        return PairingRelay::MainRelay;
    };
    match response.json::<serde_json::Value>().await {
        Ok(json) => pairing_relay_from_nip11(&json),
        Err(_) => PairingRelay::MainRelay,
    }
}

pub(crate) fn pairing_relay_from_nip11(json: &serde_json::Value) -> PairingRelay {
    if let Some(value) = json.get("pairing_relay_url").and_then(|v| v.as_str()) {
        if validate_ws_url(value).is_ok() {
            return PairingRelay::Configured(value.to_string());
        }
    }
    let nip43 = json
        .get("supported_nips")
        .and_then(|v| v.as_array())
        .is_some_and(|nips| nips.iter().any(|n| n.as_u64() == Some(43)));
    if nip43 {
        PairingRelay::LegacyPath
    } else {
        PairingRelay::MainRelay
    }
}

pub(crate) fn resolve_pairing_relay_url(main: &str, relay: PairingRelay) -> Result<String, String> {
    match relay {
        PairingRelay::Configured(url) => Ok(url),
        PairingRelay::LegacyPath => {
            let mut url = validate_ws_url(main)?;
            let path = url.path().trim_end_matches('/').to_string();
            url.set_path(&format!("{path}/pair"));
            Ok(url.to_string())
        }
        PairingRelay::MainRelay => Ok(main.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nip11_prefers_advertised_pairing_relay() {
        let json = serde_json::json!({ "pairing_relay_url": "wss://pair.example.com", "supported_nips": [43] });
        assert_eq!(pairing_relay_from_nip11(&json), PairingRelay::Configured("wss://pair.example.com".into()));
    }

    #[test]
    fn nip11_ignores_non_websocket_pairing_url() {
        let json = serde_json::json!({ "pairing_relay_url": "https://evil.example", "supported_nips": [1] });
        assert_eq!(pairing_relay_from_nip11(&json), PairingRelay::MainRelay);
    }

    #[test]
    fn nip43_relay_uses_pair_path() {
        let json = serde_json::json!({ "supported_nips": [1, 43] });
        let relay = pairing_relay_from_nip11(&json);
        assert_eq!(resolve_pairing_relay_url("ws://localhost:3000", relay).unwrap(), "ws://localhost:3000/pair");
    }

    #[test]
    fn only_websocket_urls_are_accepted() {
        assert!(validate_ws_url("wss://relay.example.com").is_ok());
        assert!(validate_ws_url("https://relay.example.com").is_err());
        assert!(validate_ws_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn qr_carries_ephemeral_key_not_identity() {
        let identity = nostr::Keys::generate();
        let (session, qr) = PairingSession::new_source("wss://pair.example.com".into());
        let uri = encode_qr(&qr);
        assert!(uri.starts_with("nostrpair://"));
        assert!(!uri.contains(&identity.public_key().to_hex()));
        assert_ne!(session.pubkey(), identity.public_key());
    }

    #[test]
    fn full_handshake_with_a_target_never_sends_secret_material() {
        // Drive both sides of NIP-AB in memory (the buzz-core target is what
        // `buzz-pair target` and the mobile app use).
        let (mut source, qr) = PairingSession::new_source("wss://pair.example.com".into());
        let uri = encode_qr(&qr);
        let qr_decoded = buzz_core::pairing::qr::decode_qr(&uri).expect("decode");
        let (mut target, offer) = PairingSession::new_target(&qr_decoded).expect("target");
        let sas_source = source.handle_offer(&offer).expect("offer");
        assert_eq!(sas_source.len(), 6);
        let confirm = source.confirm_sas().expect("confirm");
        target.handle_sas_confirm(&confirm).expect("transcript verified");
        target.confirm_target_sas().expect("target confirms");
        let payload = serde_json::json!({ "type": "swf-buzz-pairing-check", "identityTransferred": false }).to_string();
        let event = source.send_payload(PayloadType::Custom, Zeroizing::new(payload)).expect("payload");
        let (kind, received) = target.handle_payload(&event).expect("received");
        assert_eq!(kind, PayloadType::Custom);
        assert!(!received.contains("nsec1"));
        assert!(received.contains("swf-buzz-pairing-check"));
    }
}
