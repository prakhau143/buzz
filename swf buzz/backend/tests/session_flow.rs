//! End-to-end test of the HTTP session flow (bootstrap -> get_session ->
//! logout -> get_session fails) against the real Axum router and a real
//! (in-process, synthetic-key) JWKS server — using `InMemoryRepo`, since no
//! live Postgres is available in this environment (see
//! docs/BACKEND_SESSION_DESIGN.md). This proves the routing/handler wiring
//! and JWKS verification end-to-end; it does NOT prove the Postgres
//! repository implementation, which remains unverified against real
//! infrastructure — see the final report.

use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;
use swf_buzz_backend::jwks::JwksVerifier;
use swf_buzz_backend::repo::memory::InMemoryRepo;
use swf_buzz_backend::routes;
use swf_buzz_backend::state::AppState;

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

#[derive(Serialize)]
struct Claims {
    sub: String,
    email: Option<String>,
    name: Option<String>,
    iss: String,
    aud: String,
    exp: i64,
    iat: i64,
}

async fn spawn_fake_jwks_server() -> String {
    let app = Router::new().route(
        "/v1/keys",
        get(|| async {
            Json(json!({
                "keys": [{ "kid": TEST_KID, "kty": "RSA", "n": TEST_N, "e": TEST_E, "alg": "RS256", "use": "sig" }]
            }))
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

async fn spawn_app(issuer: String, audience: String) -> String {
    let repo = Arc::new(InMemoryRepo::new());
    let state = AppState {
        users: repo.clone(),
        sessions: repo.clone(),
        communities: repo.clone(),
        invites: repo.clone(),
        channels: repo.clone(),
        messages: repo.clone(),
        dms: repo,
        jwks: Arc::new(JwksVerifier::new(issuer, audience)),
        session_ttl: chrono::Duration::hours(12),
        invite_base_url: "http://localhost:5173".to_string(),
        realtime: swf_buzz_backend::realtime::Broadcaster::new(),
    };
    let app = routes::router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

fn sign_id_token(issuer: &str, audience: &str, sub: &str) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(TEST_KID.to_string());
    let key = EncodingKey::from_rsa_pem(TEST_PRIVATE_KEY_PEM.as_bytes()).unwrap();
    let now = Utc::now().timestamp();
    let claims = Claims {
        sub: sub.to_string(),
        email: Some("person@example.com".to_string()),
        name: Some("Person Name".to_string()),
        iss: issuer.to_string(),
        aud: audience.to_string(),
        exp: now + 300,
        iat: now,
    };
    encode(&header, &claims, &key).unwrap()
}

#[tokio::test]
async fn bootstrap_then_get_session_then_logout_then_rejected() {
    let audience = "test-client-id".to_string();
    let issuer = spawn_fake_jwks_server().await;
    let base = spawn_app(issuer.clone(), audience.clone()).await;
    let http = reqwest::Client::new();

    let id_token = sign_id_token(&issuer, &audience, "okta-sub-e2e-1");

    let bootstrap_resp: serde_json::Value = http
        .post(format!("{base}/api/session/bootstrap"))
        .json(&json!({ "id_token": id_token }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let session_token = bootstrap_resp["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        bootstrap_resp["user"]["okta_sub"].as_str(),
        Some("okta-sub-e2e-1")
    );

    // Logging in again with the same sub must reuse the same user id.
    let id_token_2 = sign_id_token(&issuer, &audience, "okta-sub-e2e-1");
    let bootstrap_resp_2: serde_json::Value = http
        .post(format!("{base}/api/session/bootstrap"))
        .json(&json!({ "id_token": id_token_2 }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        bootstrap_resp["user"]["id"], bootstrap_resp_2["user"]["id"],
        "same okta_sub must reuse the same users.id across logins"
    );

    let session_check = http
        .get(format!("{base}/api/session"))
        .bearer_auth(&session_token)
        .send()
        .await
        .unwrap();
    assert_eq!(session_check.status(), 200);

    let logout_resp = http
        .post(format!("{base}/api/session/logout"))
        .bearer_auth(&session_token)
        .send()
        .await
        .unwrap();
    assert_eq!(logout_resp.status(), 200);

    let session_check_after_logout = http
        .get(format!("{base}/api/session"))
        .bearer_auth(&session_token)
        .send()
        .await
        .unwrap();
    assert_eq!(
        session_check_after_logout.status(),
        401,
        "a revoked session token must be rejected"
    );
}

#[tokio::test]
async fn get_session_without_a_token_is_rejected() {
    let issuer = spawn_fake_jwks_server().await;
    let base = spawn_app(issuer, "aud".to_string()).await;
    let resp = reqwest::Client::new()
        .get(format!("{base}/api/session"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn bootstrap_with_wrong_audience_token_is_rejected() {
    let audience = "the-real-audience".to_string();
    let issuer = spawn_fake_jwks_server().await;
    let base = spawn_app(issuer.clone(), audience).await;
    let wrong_aud_token = sign_id_token(&issuer, "some-other-audience", "sub-x");

    let resp = reqwest::Client::new()
        .post(format!("{base}/api/session/bootstrap"))
        .json(&json!({ "id_token": wrong_aud_token }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}
