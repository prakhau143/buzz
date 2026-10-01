//! HTTP bridge for the deployment admin console (`/api/admin/v1/*`).
//!
//! The relay's admin API rejects any request whose `Origin` header is not the
//! admin host itself (`crates/buzz-relay/src/api/admin/auth.rs:221-227`). A
//! webview `fetch` always sends the app's own origin, so every call from the
//! page was a 403 even with a valid NIP-98 signature. Requests made from Rust
//! send no `Origin`, so they reach the NIP-98 check that actually decides.
//!
//! This is deliberately NOT a general proxy: only http(s) URLs whose path is
//! under `/api/admin/v1/` are accepted, only the listed methods, with size
//! caps. Authentication is still the caller's NIP-98 header (signed in Rust by
//! the identity signer); nothing is added here.

use std::time::Duration;

use serde::Serialize;

const MAX_JSON_BYTES: usize = 5 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES: usize = 150 * 1024 * 1024;

fn validate(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|_| "invalid admin URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("the admin URL must be http(s)".into());
    }
    if !parsed.path().contains("/api/admin/v1/") {
        return Err("only /api/admin/v1/ endpoints can be called".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("credentials in the admin URL are not allowed".into());
    }
    Ok(parsed)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct AdminResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub async fn admin_request(
    method: String,
    url: String,
    body: Option<String>,
    authorization: String,
) -> Result<AdminResponse, String> {
    let url = validate(&url)?;
    let method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("unsupported method".into()),
    };
    let mut request = client()?.request(method, url).header("Authorization", authorization);
    if let Some(body) = body {
        request = request.header("Content-Type", "application/json").body(body);
    }
    let response = request.send().await.map_err(|_| "Can't reach the admin server.".to_string())?;
    let status = response.status().as_u16();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_JSON_BYTES {
        return Err("the admin server's answer was too large".into());
    }
    Ok(AdminResponse { status, body: String::from_utf8_lossy(&bytes).into_owned() })
}

/// Raw bytes of a feedback attachment (the route serves them as a download).
#[tauri::command]
pub async fn admin_fetch_bytes(url: String, authorization: String) -> Result<tauri::ipc::Response, String> {
    let url = validate(&url)?;
    if !url.path().contains("/feedback/") || !url.path().contains("/attachments/") {
        return Err("only feedback attachments can be fetched".into());
    }
    let response = client()?
        .get(url)
        .header("Authorization", authorization)
        .send()
        .await
        .map_err(|_| "Can't reach the admin server.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("attachment unavailable (HTTP {})", response.status().as_u16()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err("the attachment is too large to open here".into());
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn only_admin_api_paths_are_accepted() {
        assert!(validate("https://admin.example.com/api/admin/v1/feedback").is_ok());
        assert!(validate("http://127.0.0.1:3000/api/admin/v1/probe").is_ok());
        assert!(validate("https://example.com/api/other").is_err());
        assert!(validate("file:///etc/passwd").is_err());
        assert!(validate("https://user:pw@admin.example.com/api/admin/v1/feedback").is_err());
    }
}
