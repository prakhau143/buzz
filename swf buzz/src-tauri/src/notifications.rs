//! Native desktop notifications and the taskbar unread indicator.
//!
//! * `show_notification` — a real OS toast. On Windows it is built directly
//!   with `tauri-winrt-notification` (the library `tauri-plugin-notification`
//!   itself uses) so a CLICK can be handled: the plugin exposes no activation
//!   callback on desktop. On click the main window is shown/focused and the
//!   toast's opaque `target` (an internal JSON route: ids only, never a URL,
//!   token or key) is emitted to the webview as `swf-notification-activated`.
//!   Other platforms fall back to the plugin (no click routing there).
//! * `set_unread_indicator` — Windows taskbar overlay icon (a small red dot).
//!   Tauri's `setBadgeCount` is not supported on Windows; the overlay icon is
//!   the Windows mechanism. No-op elsewhere.
//!
//! Inputs are bounded and nothing here logs notification content.

use tauri::{AppHandle, Emitter, Manager};

/// Emitted to the webview when a toast is clicked; payload = the toast's target JSON.
pub const ACTIVATED_EVENT: &str = "swf-notification-activated";

const MAX_TITLE: usize = 120;
const MAX_BODY: usize = 400;
const MAX_TARGET: usize = 1024;

fn clip(value: &str, max: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// A target must be a small JSON object of plain string ids — nothing executable.
fn valid_target(target: &str) -> bool {
    target.len() <= MAX_TARGET
        && serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(target)
            .map(|m| m.values().all(|v| v.is_string() || v.is_null()))
            .unwrap_or(false)
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub async fn show_notification(
    app: AppHandle,
    title: String,
    body: String,
    target: Option<String>,
    sound: bool,
) -> Result<(), String> {
    let title = clip(&title, MAX_TITLE);
    let body = clip(&body, MAX_BODY);
    let target = target.filter(|t| valid_target(t));
    tauri::async_runtime::spawn_blocking(move || show_native(&app, &title, &body, target, sound))
        .await
        .map_err(|e| format!("notification task failed: {e}"))?
}

/// The toast AppUserModelID. Same attribution rule as tauri-plugin-notification:
/// the installed app uses its own identifier (registered by the installer); a
/// dev build running from target\debug|release has none, so Windows attributes
/// its toasts to PowerShell.
#[cfg(windows)]
fn toast_app_id(app: &AppHandle) -> String {
    let exe_dir = tauri::utils::platform::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.display().to_string()))
        .unwrap_or_default();
    let sep = std::path::MAIN_SEPARATOR;
    let dev = exe_dir.ends_with(&format!("{sep}target{sep}debug"))
        || exe_dir.ends_with(&format!("{sep}target{sep}release"));
    if dev {
        tauri_winrt_notification::Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    }
}

/// The real OS state: "granted", or "denied" when Windows has notifications
/// turned off for this app / for the user / by policy. Other platforms:
/// "granted" (the plugin reports the same on desktop).
#[tauri::command]
pub fn notification_permission(app: AppHandle) -> String {
    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::UI::Notifications::{NotificationSetting, ToastNotificationManager};
        let setting = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(toast_app_id(&app)))
            .and_then(|notifier| notifier.Setting());
        match setting {
            Ok(NotificationSetting::Enabled) => "granted".into(),
            Ok(_) => "denied".into(),
            // Unknown (e.g. the id isn't registered yet): don't claim "denied".
            Err(_) => "granted".into(),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        "granted".into()
    }
}

#[cfg(windows)]
fn show_native(app: &AppHandle, title: &str, body: &str, target: Option<String>, sound: bool) -> Result<(), String> {
    use tauri_winrt_notification::{Duration, Sound, Toast};

    let app_id = toast_app_id(app);

    let handle = app.clone();
    Toast::new(&app_id)
        .title(title)
        .text1(body)
        .duration(Duration::Short)
        .sound(if sound { Some(Sound::Default) } else { None })
        .on_activated(move |_action| {
            focus_main(&handle);
            if let Some(target) = &target {
                let _ = handle.emit(ACTIVATED_EVENT, target.clone());
            }
            Ok(())
        })
        .show()
        .map_err(|e| format!("could not show notification: {e}"))
}

#[cfg(not(windows))]
fn show_native(app: &AppHandle, title: &str, body: &str, _target: Option<String>, _sound: bool) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("could not show notification: {e}"))
}

/// Taskbar overlay canvas: Windows draws the overlay over the lower-right of
/// the app icon and recommends 16x16 (at 96 DPI) — larger art just gets scaled
/// down into the same slot and dominates the icon.
pub const OVERLAY_SIZE: u32 = 16;
/// The visible dot's diameter inside that canvas (~9px): an attention mark,
/// not a badge. No number, no ring, no animation.
pub const DOT_DIAMETER: f32 = 9.0;

/// A small anti-aliased red dot on a transparent `size`x`size` canvas, sitting
/// in the canvas's lower-right so it lands on the icon's corner. A 1px darker
/// rim keeps it readable on light and dark taskbars without a white halo.
pub fn red_dot_rgba(size: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let r = DOT_DIAMETER / 2.0;
    // Lower-right with a 1px inset.
    let c = size as f32 - 1.0 - r;
    for y in 0..size {
        for x in 0..size {
            let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
            let d = ((px - c).powi(2) + (py - c).powi(2)).sqrt();
            let alpha = (r + 0.5 - d).clamp(0.0, 1.0);
            if alpha <= 0.0 {
                continue;
            }
            // Outer 1px: a slightly deeper red rim; inside: #E5484D-ish red.
            let rim = (d - (r - 1.0)).clamp(0.0, 1.0);
            let (red, green, blue) = (
                (229.0 - 50.0 * rim) as u8,
                (72.0 - 40.0 * rim) as u8,
                (77.0 - 40.0 * rim) as u8,
            );
            let i = ((y * size + x) * 4) as usize;
            rgba[i..i + 4].copy_from_slice(&[red, green, blue, (alpha * 255.0) as u8]);
        }
    }
    rgba
}

#[tauri::command]
pub fn set_unread_indicator(app: AppHandle, show: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let window = app.get_webview_window("main").ok_or("main window not found")?;
        let icon = if show {
            Some(tauri::image::Image::new_owned(red_dot_rgba(OVERLAY_SIZE), OVERLAY_SIZE, OVERLAY_SIZE))
        } else {
            None
        };
        window.set_overlay_icon(icon).map_err(|e| format!("could not set taskbar indicator: {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = (app, show);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_must_be_flat_json_of_string_ids() {
        assert!(valid_target(r#"{"type":"dm","conversationId":"abc","messageId":"m1"}"#));
        assert!(valid_target(r#"{"type":"channel","threadRootId":null}"#));
        assert!(!valid_target("javascript:alert(1)"));
        assert!(!valid_target(r#"{"nested":{"a":1}}"#));
        assert!(!valid_target(r#"["not","an","object"]"#));
        assert!(!valid_target(&format!(r#"{{"x":"{}"}}"#, "a".repeat(2000))));
    }

    #[test]
    fn title_and_body_are_bounded() {
        let long = "x".repeat(1000);
        assert_eq!(clip(&long, MAX_BODY).chars().count(), MAX_BODY);
        assert_eq!(clip("  hi  ", MAX_BODY), "hi");
    }

    #[test]
    fn overlay_is_a_small_dot_on_a_transparent_16px_canvas() {
        let size = OVERLAY_SIZE;
        assert_eq!(size, 16);
        let px = red_dot_rgba(size);
        assert_eq!(px.len(), (size * size * 4) as usize);
        let at = |x: u32, y: u32| px[((y * size + x) * 4) as usize..((y * size + x) * 4 + 4) as usize].to_vec();
        // Transparent background (upper-left is empty).
        assert_eq!(at(0, 0)[3], 0);
        assert_eq!(at(3, 3)[3], 0);
        // Opaque red at the dot's centre, lower-right.
        let centre = at(10, 10);
        assert_eq!(centre[3], 255);
        assert!(centre[0] > 200 && centre[1] < 100 && centre[2] < 100, "red: {centre:?}");
        // No white halo anywhere.
        for p in px.chunks(4) {
            assert!(!(p[0] > 200 && p[1] > 200 && p[2] > 200 && p[3] > 0), "white pixel {p:?}");
        }
        // Visible diameter ~9px: count opaque pixels on the centre row.
        let row: usize = (0..size).filter(|&x| at(x, 10)[3] > 127).count();
        assert!((8..=10).contains(&row), "diameter {row}");
    }
}
