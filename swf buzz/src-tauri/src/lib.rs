mod auth;
mod commands;
mod storage;

use tauri_plugin_deep_link::DeepLinkExt;

/// Any single-instance-forwarded argv entry starting with this is treated
/// as our Okta callback URL. Kept in sync with `auth::oidc::REDIRECT_SCHEME`.
fn is_our_deep_link(arg: &str) -> bool {
    arg.starts_with(auth::oidc::REDIRECT_SCHEME)
        && arg[auth::oidc::REDIRECT_SCHEME.len()..].starts_with(':')
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    eprintln!(
        "[oidc diag] run(): starting, exe={}",
        std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "<unknown>".to_string())
    );
    let mut builder = tauri::Builder::default();

    // MUST be the first plugin registered: when the OS launches a second
    // process instance because the user's browser was redirected to our
    // custom URL scheme, this detects the already-running instance and
    // forwards that new process's command-line args (which include the
    // callback URL) to it via the closure below, then the second process
    // exits — so the callback is always delivered to the one running
    // window, never a second one. See docs/OKTA_PKCE_SETUP.md.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            eprintln!(
                "[oidc diag] single-instance handler invoked, argv count={}",
                argv.len()
            );
            let mut matched_any = false;
            for arg in &argv {
                if is_our_deep_link(arg) {
                    matched_any = true;
                    auth::oidc::deliver_incoming_url(app, arg);
                }
            }
            if !matched_any {
                eprintln!(
                    "[oidc diag] single-instance handler: no argv matched our deep-link scheme"
                );
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(auth::oidc::PendingCallback::default())
        .manage(auth::oidc::OktaSession::default())
        .setup(|app| {
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls();
                eprintln!("[oidc diag] on_open_url fired, url count={}", urls.len());
                for url in urls {
                    auth::oidc::deliver_incoming_url(&handle, url.as_ref());
                }
            });

            // Registers the custom URL scheme with the OS at runtime — needed
            // for `tauri dev`/unbundled builds, which have no installer to do
            // this at install time. A packaged release build's installer
            // registers it too (via tauri.conf.json's `plugins.deep-link`
            // config), so this call is a no-op there, not a duplicate.
            #[cfg(any(windows, target_os = "linux"))]
            {
                app.deep_link().register_all()?;
                eprintln!("[oidc diag] deep_link().register_all() succeeded");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::start_okta_login,
            commands::auth::okta_logout,
            commands::secure_storage::secure_storage_get,
            commands::secure_storage::secure_storage_set,
            commands::secure_storage::secure_storage_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
