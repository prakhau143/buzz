use crate::auth::oidc;

/// `async fn` + an explicit `spawn_blocking` — observed empirically (this
/// session) that leaving this as a plain synchronous command let the
/// multi-minute `wait_for_deep_link` recv block the app's main/event-loop
/// thread: the window reported "Not Responding" in Windows for the whole
/// wait, and a second process instance launched by the OS for the deep-link
/// redirect (see `tauri_plugin_single_instance` in `lib.rs`) hung trying to
/// hand off its argv to that same blocked thread, only succeeding once the
/// in-flight attempt finally timed out. Running the actual blocking work on
/// a dedicated thread via `tauri::async_runtime::spawn_blocking` and
/// `.await`ing the `JoinHandle` here keeps the async command dispatcher (and
/// therefore the window's event loop) free the entire time, so the app stays
/// responsive and the single-instance callback can be delivered immediately.
#[tauri::command]
pub async fn start_okta_login(app: tauri::AppHandle) -> Result<oidc::OktaLoginResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || oidc::login(&app))
        .await
        .map_err(|e| format!("login task panicked: {e}"))
        .and_then(|inner| inner.map_err(|e| e.to_string()));
    eprintln!(
        "[oidc diag] start_okta_login command returning: ok={}",
        result.is_ok()
    );
    result
}

/// Same reasoning as `start_okta_login` above — `oidc::logout` also blocks
/// on a deep-link wait and must not run on the main/event-loop thread.
#[tauri::command]
pub async fn okta_logout(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || oidc::logout(&app))
        .await
        .map_err(|e| format!("logout task panicked: {e}"))
        .and_then(|inner| inner.map_err(|e| e.to_string()))
}
