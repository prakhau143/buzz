//! Software updates (Settings → Updates).
//!
//! OLD BUZZ ships a real signed Tauri-updater pipeline pointed at ITS OWN
//! release feed (block/buzz) — SWF must never use that feed or its keys
//! (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md §14). SWF's feed and signing key
//! are therefore compiled in from SWF's own build environment:
//!
//!   SWF_BUZZ_UPDATER_ENDPOINT   https URL of SWF's `latest.json`
//!   SWF_BUZZ_UPDATER_PUBKEY     SWF's minisign public key (`tauri signer generate`)
//!
//! Without both, `updater_configured()` is false and the UI says so plainly —
//! nothing pretends an update pipeline exists. The plugin itself is always
//! registered with an inert config (tauri.conf.json `plugins.updater`), so the
//! app starts identically either way; signature verification is the plugin's.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

const ENDPOINT: Option<&str> = option_env!("SWF_BUZZ_UPDATER_ENDPOINT");
const PUBKEY: Option<&str> = option_env!("SWF_BUZZ_UPDATER_PUBKEY");

fn configured() -> Option<(&'static str, &'static str)> {
    match (ENDPOINT.map(str::trim), PUBKEY.map(str::trim)) {
        (Some(endpoint), Some(pubkey)) if !endpoint.is_empty() && !pubkey.is_empty() => Some((endpoint, pubkey)),
        _ => None,
    }
}

fn updater<R: Runtime>(app: &AppHandle<R>) -> Result<tauri_plugin_updater::Updater, String> {
    let (endpoint, pubkey) = configured().ok_or_else(|| "updates are not configured for this build".to_string())?;
    let url = endpoint.parse().map_err(|_| "the update endpoint is not a valid URL".to_string())?;
    app.updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize },
    Finished,
}

#[tauri::command]
pub fn updater_configured() -> bool {
    configured().is_some()
}

/// Ask SWF's feed whether a newer, signed version exists.
#[tauri::command]
pub async fn updater_check<R: Runtime>(app: AppHandle<R>) -> Result<Option<UpdateInfo>, String> {
    let update = updater(&app)?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

/// Download (signature-verified by the plugin) and install, reporting progress,
/// then restart into the new version. Only ever triggered by an explicit click.
#[tauri::command]
pub async fn updater_install<R: Runtime>(app: AppHandle<R>, on_event: Channel<DownloadEvent>) -> Result<(), String> {
    let update = updater(&app)?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update is available any more".to_string())?;
    let mut started = false;
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                }
                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
