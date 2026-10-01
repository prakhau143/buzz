//! Dev-only test "phone" for Settings → Mobile (NIP-AB target side).
//!
//! Same protocol library (`buzz-core`) as OLD BUZZ's `buzz-pair target` and
//! mobile app, but built inside SWF's dependency graph — so it works over
//! secure `wss://` pairing servers (production), where OLD BUZZ's CLI panics
//! on a missing rustls crypto provider.
//!
//!   cd "swf buzz/src-tauri"
//!   cargo run --example pair_target               (then paste the pairing code)
//!   cargo run --example pair_target -- --show-payload
//!
//! Not shipped in the app; it is an `examples/` binary.

use std::io::{self, BufRead, Write};
use std::time::Duration;

use buzz_core::kind::KIND_PAIRING;
use buzz_core::pairing::qr::decode_qr;
use buzz_core::pairing::session::PairingSession;
use buzz_core::pairing::types::AbortReason;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message};

type Res<T> = Result<T, String>;

fn read_line(prompt: &str) -> Res<String> {
    print!("{prompt}");
    io::stdout().flush().map_err(|e| e.to_string())?;
    let mut line = String::new();
    io::stdin().lock().read_line(&mut line).map_err(|e| e.to_string())?;
    Ok(line.trim().to_string())
}

fn event_json(event: &nostr::Event) -> String {
    format!("[\"EVENT\",{}]", nostr::JsonUtil::as_json(event))
}

fn relay_event(text: &str) -> Option<nostr::Event> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let a = v.as_array()?;
    (a.len() >= 3 && a[0] == "EVENT" && a[1] == "pair").then(|| serde_json::from_value(a[2].clone()).ok()).flatten()
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Res<()> {
    let show_payload = std::env::args().any(|a| a == "--show-payload");
    let uri = read_line("Paste the pairing code (nostrpair://…): ")?;
    let qr = decode_qr(&uri).map_err(|e| format!("not a valid pairing code: {e}"))?;
    let relay = qr.relays.first().cloned().ok_or("the pairing code has no relay")?;
    println!("Connecting to {relay}...");

    let (mut session, offer) = PairingSession::new_target(&qr).map_err(|e| e.to_string())?;
    let (ws, _) = connect_async(&relay).await.map_err(|e| format!("connect failed: {e}"))?;
    let (mut write, mut read) = ws.split();

    // Answer a NIP-42 challenge (if any) with the EPHEMERAL session key.
    if let Ok(Some(Ok(Message::Text(text)))) = tokio::time::timeout(Duration::from_secs(3), read.next()).await {
        let v: serde_json::Value = serde_json::from_str(text.as_str()).unwrap_or_default();
        if v.get(0).and_then(|x| x.as_str()) == Some("AUTH") {
            if let Some(challenge) = v.get(1).and_then(|x| x.as_str()) {
                let url = nostr::RelayUrl::parse(&relay).map_err(|e| e.to_string())?;
                let auth = session
                    .sign_event(nostr::EventBuilder::auth(challenge, url))
                    .map_err(|e| e.to_string())?;
                write
                    .send(Message::Text(format!("[\"AUTH\",{}]", nostr::JsonUtil::as_json(&auth)).into()))
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    let req = serde_json::json!(["REQ", "pair", { "kinds": [KIND_PAIRING], "#p": [session.pubkey().to_hex()] }]);
    write.send(Message::Text(req.to_string().into())).await.map_err(|e| e.to_string())?;
    // Wait for EOSE so the subscription is live before the offer goes out.
    tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(Ok(Message::Text(t))) = read.next().await {
            if t.as_str().starts_with("[\"EOSE\"") {
                break;
            }
        }
    })
    .await
    .map_err(|_| "pairing server did not confirm the subscription")?;
    write.send(Message::Text(event_json(&offer).into())).await.map_err(|e| e.to_string())?;

    let sas = session.sas_code().ok_or("no code")?;
    println!("Code on this 'phone': {} {}", &sas[..3], &sas[3..]);
    println!("Now compare with the desktop and click \"Codes match\" there...");

    // Wait for the desktop's sas-confirm (the transcript hash is verified here).
    loop {
        let event = next_event(&mut read, 120).await?;
        if let Ok(reason) = session.handle_abort(&event) {
            return Err(format!("desktop aborted: {reason:?}"));
        }
        match session.handle_sas_confirm(&event) {
            Ok(_) => break,
            Err(buzz_core::pairing::PairingError::TranscriptMismatch) => {
                if let Ok(Some(abort)) = session.abort(AbortReason::SasMismatch) {
                    let _ = write.send(Message::Text(event_json(&abort).into())).await;
                }
                return Err("SECURITY: transcript mismatch — aborted".into());
            }
            Err(_) => continue,
        }
    }

    let answer = read_line(&format!("Does the desktop show {sas}? [y/n]: "))?;
    if !answer.eq_ignore_ascii_case("y") {
        if let Ok(Some(abort)) = session.abort(AbortReason::SasMismatch) {
            let _ = write.send(Message::Text(event_json(&abort).into())).await;
        }
        return Err("you said the codes don't match — pairing aborted".into());
    }
    session.confirm_target_sas().map_err(|e| e.to_string())?;
    println!("Confirmed. Waiting for the desktop's encrypted payload...");

    let (kind, payload) = loop {
        let event = next_event(&mut read, 60).await?;
        if let Ok(reason) = session.handle_abort(&event) {
            return Err(format!("desktop aborted: {reason:?}"));
        }
        if let Ok(result) = session.handle_payload(&event) {
            break result;
        }
    };
    println!("Received {kind:?} payload ({} bytes).", payload.len());
    if show_payload {
        println!("payload: {}", &*payload);
    }
    let complete = session.send_complete().map_err(|e| e.to_string())?;
    write.send(Message::Text(event_json(&complete).into())).await.map_err(|e| e.to_string())?;
    println!("Pairing complete ✓");
    Ok(())
}

async fn next_event<S>(read: &mut S, secs: u64) -> Res<nostr::Event>
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    tokio::time::timeout(Duration::from_secs(secs), async {
        while let Some(msg) = read.next().await {
            if let Ok(Message::Text(t)) = msg {
                if let Some(e) = relay_event(t.as_str()) {
                    return Ok(e);
                }
            }
        }
        Err("pairing server closed the connection".to_string())
    })
    .await
    .map_err(|_| "timed out waiting for the desktop".to_string())?
}
