//! `swfbuzz://` deep links — the SWF-owned scheme (never the reference app's
//! `buzz://`, which belongs to the separately installed OLD Buzz).
//!
//! ```text
//! swfbuzz://join/<invite code>?relay=<ws(s)://host[:port]>[&name=<label>][&by=<pubkey hex>]
//! swfbuzz://join?relay=<ws(s)://host[:port]>&code=<invite code>[&policy_receipt=<r>]
//! swfbuzz://connect?relay=<ws(s)://host[:port]>[&name=<label>]
//! ```
//!
//! `name` (a display label for the community) and `by` (the inviter's public key)
//! are optional **hints written by whoever made the link**: the relay does not
//! verify them, so the UI must present them as "named in the link", never as fact.
//! A malformed hint is dropped rather than failing the link.
//!
//! `relay` is required for `join` because the relay resolves the community from
//! the request host: an invite code on its own cannot be claimed. A link is only
//! ever *parsed* here — it authenticates nothing and grants nothing; the UI asks
//! the user to confirm before anything is signed.
//!
//! Links are queued so one that arrives before the webview is ready (cold start)
//! is not lost; the frontend drains the queue and also listens for
//! [`EVENT`] (warm start).

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;

pub const SCHEME: &str = "swfbuzz";
/// Emitted to the webview whenever a link is queued.
pub const EVENT: &str = "swf-deep-link";

const MAX_CODE_LEN: usize = 256;
const MAX_RECEIPT_LEN: usize = 2048;
const MAX_NAME_LEN: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DeepLink {
    Join {
        relay: String,
        code: String,
        policy_receipt: Option<String>,
        /// Unverified label from the link (see module docs).
        community_name: Option<String>,
        /// Unverified inviter public key (64-char lowercase hex) from the link.
        invited_by: Option<String>,
    },
    Connect {
        relay: String,
        /// Unverified label from the link (see module docs).
        community_name: Option<String>,
    },
    /// Malformed or unsupported — carries a user-safe reason so the UI can say so.
    Invalid { reason: String },
}

fn invalid(reason: &str) -> DeepLink {
    DeepLink::Invalid {
        reason: reason.to_string(),
    }
}

/// True for any argument that is (or starts like) a `swfbuzz:` URL.
pub fn is_swf_link(arg: &str) -> bool {
    arg.get(..SCHEME.len())
        .is_some_and(|p| p.eq_ignore_ascii_case(SCHEME))
        && arg[SCHEME.len()..].starts_with(':')
}

/// Normalises a relay URL to `ws(s)://host[:port]`, or explains why not.
pub fn parse_relay(value: &str) -> Result<String, String> {
    let url = Url::parse(value.trim()).map_err(|_| "the relay address is not a valid URL")?;
    if !matches!(url.scheme(), "ws" | "wss") {
        return Err("the relay address must start with ws:// or wss://".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(
            "the relay address must be a plain host (no credentials, path or query)".into(),
        );
    }
    let host = url.host_str().ok_or("the relay address has no host")?;
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Ok(format!("{}://{host}{port}", url.scheme()))
}

fn valid_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= MAX_CODE_LEN
        && code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '~'))
}

/// A display label: 1..=80 chars, no control characters. Anything else is dropped.
fn clean_name(name: &str) -> Option<String> {
    let name = name.trim();
    (!name.is_empty()
        && name.chars().count() <= MAX_NAME_LEN
        && !name.chars().any(char::is_control))
    .then(|| name.to_string())
}

fn clean_pubkey(value: &str) -> Option<String> {
    (value.len() == 64 && value.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')))
        .then(|| value.to_string())
}

fn valid_receipt(receipt: &str) -> bool {
    !receipt.is_empty()
        && receipt.len() <= MAX_RECEIPT_LEN
        && receipt
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '='))
}

/// Parse a raw `swfbuzz://…` string. Never fails: problems become
/// [`DeepLink::Invalid`].
pub fn parse(raw: &str) -> DeepLink {
    let Ok(url) = Url::parse(raw.trim()) else {
        return invalid("That is not a valid SWF Buzz link.");
    };
    if !url.scheme().eq_ignore_ascii_case(SCHEME) {
        return invalid("That is not a SWF Buzz link.");
    }
    let query = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    let relay = match query("relay") {
        Some(value) => match parse_relay(&value) {
            Ok(relay) => relay,
            Err(reason) => return invalid(&format!("Invalid link: {reason}.")),
        },
        None => return invalid("Invalid link: it does not say which community server to use."),
    };

    match url.host_str().map(str::to_ascii_lowercase).as_deref() {
        Some("connect") => DeepLink::Connect {
            relay,
            community_name: query("name").as_deref().and_then(clean_name),
        },
        Some("join") => {
            let from_path = url
                .path_segments()
                .and_then(|mut segments| segments.find(|s| !s.is_empty()).map(str::to_owned));
            let Some(code) = query("code").or(from_path) else {
                return invalid("Invalid link: it has no invite code.");
            };
            if !valid_code(&code) {
                return invalid("Invalid link: the invite code is malformed.");
            }
            let policy_receipt = match query("policy_receipt") {
                Some(r) if valid_receipt(&r) => Some(r),
                Some(_) => return invalid("Invalid link: the terms receipt is malformed."),
                None => None,
            };
            DeepLink::Join {
                relay,
                code,
                policy_receipt,
                community_name: query("name").as_deref().and_then(clean_name),
                invited_by: query("by").as_deref().and_then(clean_pubkey),
            }
        }
        _ => invalid("Unsupported link. Expected swfbuzz://join or swfbuzz://connect."),
    }
}

/// Links waiting for the webview to pick them up.
#[derive(Default)]
pub struct PendingDeepLinks(Mutex<Vec<DeepLink>>);

impl PendingDeepLinks {
    fn push(&self, link: DeepLink) {
        if let Ok(mut queue) = self.0.lock() {
            // Cold start can deliver the same URL twice (launch args + OS event).
            if queue.last() != Some(&link) {
                queue.push(link);
            }
        }
    }

    fn drain(&self) -> Vec<DeepLink> {
        self.0
            .lock()
            .map(|mut queue| std::mem::take(&mut *queue))
            .unwrap_or_default()
    }
}

/// Parse `raw`, queue it, tell the webview, and bring the window forward.
pub fn handle_incoming(app: &AppHandle, raw: &str) {
    let link = parse(raw);
    app.state::<PendingDeepLinks>().push(link);
    let _ = app.emit(EVENT, ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Cold start: Windows/Linux launch the app with the URL as a command-line argument.
pub fn handle_launch_args(app: &AppHandle) {
    for arg in std::env::args().skip(1) {
        if is_swf_link(&arg) {
            handle_incoming(app, &arg);
        }
    }
}

/// Drains the queue. The frontend calls this on startup and after each [`EVENT`].
#[tauri::command]
pub fn take_pending_deep_links(state: State<'_, PendingDeepLinks>) -> Vec<DeepLink> {
    state.drain()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn join(relay: &str, code: &str) -> DeepLink {
        DeepLink::Join {
            relay: relay.into(),
            code: code.into(),
            policy_receipt: None,
            community_name: None,
            invited_by: None,
        }
    }

    #[test]
    fn parses_the_query_form() {
        assert_eq!(
            parse("swfbuzz://join?relay=ws%3A%2F%2Flocalhost%3A3000&code=v2.abc_DEF-123"),
            join("ws://localhost:3000", "v2.abc_DEF-123")
        );
        assert_eq!(
            parse("swfbuzz://join?relay=wss://acme.example.com&code=v2.x"),
            join("wss://acme.example.com", "v2.x")
        );
    }

    #[test]
    fn parses_the_path_form_and_a_trailing_slash() {
        assert_eq!(
            parse("swfbuzz://join/v2.token123?relay=ws://localhost:3000"),
            join("ws://localhost:3000", "v2.token123")
        );
        assert_eq!(
            parse("swfbuzz://join/?relay=ws://localhost:3000&code=v2.t"),
            join("ws://localhost:3000", "v2.t")
        );
    }

    #[test]
    fn scheme_and_action_are_case_insensitive() {
        assert_eq!(
            parse("SWFBuzz://JOIN?relay=ws://localhost:3000&code=v2.t"),
            join("ws://localhost:3000", "v2.t")
        );
    }

    #[test]
    fn parses_connect_and_the_optional_receipt() {
        assert_eq!(
            parse("swfbuzz://connect?relay=ws://acme.localhost:3000"),
            DeepLink::Connect {
                relay: "ws://acme.localhost:3000".into(),
                community_name: None,
            }
        );
        assert_eq!(
            parse("swfbuzz://connect?relay=ws://acme.localhost:3000&name=Acme%20HQ"),
            DeepLink::Connect {
                relay: "ws://acme.localhost:3000".into(),
                community_name: Some("Acme HQ".into()),
            }
        );
        assert_eq!(
            parse("swfbuzz://join?relay=ws://localhost:3000&code=v2.t&policy_receipt=abc.def_-="),
            DeepLink::Join {
                relay: "ws://localhost:3000".into(),
                code: "v2.t".into(),
                policy_receipt: Some("abc.def_-=".into()),
                community_name: None,
                invited_by: None,
            }
        );
    }

    #[test]
    fn carries_the_optional_name_and_inviter_hints_and_drops_bad_ones() {
        let by = "ab".repeat(32);
        let good = parse(&format!(
            "swfbuzz://join/v2.t?relay=ws://localhost:3000&name=SWF%20Developers&by={by}"
        ));
        assert_eq!(
            good,
            DeepLink::Join {
                relay: "ws://localhost:3000".into(),
                code: "v2.t".into(),
                policy_receipt: None,
                community_name: Some("SWF Developers".into()),
                invited_by: Some(by),
            }
        );

        // Hints never make a link invalid: bad ones are just ignored.
        let long_name = "n".repeat(200);
        for raw in [
            format!("swfbuzz://join/v2.t?relay=ws://localhost:3000&name={long_name}&by=nothex"),
            "swfbuzz://join/v2.t?relay=ws://localhost:3000&name=ba%0Ad&by=ABCDEF".to_string(),
            "swfbuzz://join/v2.t?relay=ws://localhost:3000&name=%20%20".to_string(),
        ] {
            assert_eq!(parse(&raw), join("ws://localhost:3000", "v2.t"), "{raw}");
        }
    }

    #[test]
    fn a_link_without_a_relay_or_code_is_invalid_not_guessed() {
        for raw in [
            "swfbuzz://join?code=v2.t",
            "swfbuzz://join?relay=ws://localhost:3000",
            "swfbuzz://connect",
        ] {
            assert!(matches!(parse(raw), DeepLink::Invalid { .. }), "{raw}");
        }
    }

    #[test]
    fn hostile_or_malformed_links_are_rejected() {
        for raw in [
            "swfbuzz://join?relay=http://localhost:3000&code=v2.t", // not ws(s)
            "swfbuzz://join?relay=ws://user:pw@localhost:3000&code=v2.t", // credentials
            "swfbuzz://join?relay=ws://localhost:3000/path&code=v2.t", // path
            "swfbuzz://join?relay=ws://localhost:3000?x=1&code=v2.t",
            "swfbuzz://join?relay=javascript:alert(1)&code=v2.t",
            "swfbuzz://join?relay=ws://localhost:3000&code=v2.t%20extra",
            "swfbuzz://join?relay=ws://localhost:3000&code=..%2F..%2Fetc",
            "swfbuzz://join?relay=ws://localhost:3000&code=v2.t&policy_receipt=<script>",
            "swfbuzz://steal?relay=ws://localhost:3000",
            // `connect` goes through the same relay validation as `join`.
            "swfbuzz://connect?relay=javascript:alert(1)",
            "swfbuzz://connect?relay=file:///C:/Windows/System32",
            "swfbuzz://connect?relay=https://buzz.lmdconsulting.com",
            "swfbuzz://connect?relay=wss://attacker@buzz.lmdconsulting.com",
            "swfbuzz://connect?relay=wss://buzz.lmdconsulting.com/%2e%2e/admin",
            "swfbuzz://connect?relay=wss://buzz.lmdconsulting.com%23frag", // fragment inside the relay value
            "swfbuzz://connect?relay=data:text/html,x",
            "swfbuzz://connect",
            "https://example.com/join?relay=ws://localhost:3000&code=v2.t",
            "not a url",
            "",
        ] {
            assert!(
                matches!(parse(raw), DeepLink::Invalid { .. }),
                "accepted: {raw}"
            );
        }
        // A fragment on the OUTER link is not part of the relay value: the relay
        // that comes out is the clean address, never "…#frag".
        assert_eq!(
            parse("swfbuzz://connect?relay=wss://buzz.lmdconsulting.com#frag"),
            DeepLink::Connect {
                relay: "wss://buzz.lmdconsulting.com".into(),
                community_name: None
            }
        );
        let long = format!(
            "swfbuzz://join?relay=ws://localhost:3000&code={}",
            "a".repeat(300)
        );
        assert!(matches!(parse(&long), DeepLink::Invalid { .. }));
    }

    #[test]
    fn recognises_swf_links_only() {
        assert!(is_swf_link("swfbuzz://join?relay=x"));
        assert!(is_swf_link("SWFBUZZ:join"));
        assert!(
            !is_swf_link("buzz://join?relay=x"),
            "the OLD Buzz scheme is not ours"
        );
        assert!(!is_swf_link("swfbuzzer://x"));
        assert!(!is_swf_link("com.okta.trial-7050986:/callback"));
        assert!(!is_swf_link(""));
    }

    #[test]
    fn the_queue_drains_once_and_drops_a_duplicate_cold_start_delivery() {
        let pending = PendingDeepLinks::default();
        let link = join("ws://localhost:3000", "v2.t");
        pending.push(link.clone());
        pending.push(link.clone()); // launch-arg + OS event for the same URL
        pending.push(join("ws://localhost:3000", "v2.other"));

        assert_eq!(pending.drain().len(), 2);
        assert!(pending.drain().is_empty(), "draining empties the queue");
    }

    #[test]
    fn serialises_with_camel_case_fields_for_the_webview() {
        let json = serde_json::to_value(DeepLink::Join {
            relay: "ws://localhost:3000".into(),
            code: "v2.t".into(),
            policy_receipt: Some("r".into()),
            community_name: Some("Acme".into()),
            invited_by: None,
        })
        .unwrap();
        assert_eq!(json["kind"], "join");
        assert_eq!(json["policyReceipt"], "r");
        assert_eq!(json["communityName"], "Acme");
        assert_eq!(
            serde_json::to_value(invalid("x")).unwrap()["kind"],
            "invalid"
        );
    }
}
