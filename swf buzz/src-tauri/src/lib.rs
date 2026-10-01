mod admin_http;
mod auth;
mod commands;
mod deeplink;
mod identity;
mod notifications;
mod storage;
mod pairing;
mod updater;

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
                if deeplink::is_swf_link(arg) {
                    // Warm start: a second launch (e.g. clicking a swfbuzz:// link)
                    // is forwarded to this already-running instance.
                    matched_any = true;
                    deeplink::handle_incoming(app, arg);
                } else if is_our_deep_link(arg) {
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
        // Desktop alerts (Settings → Notifications). Permission is requested by
        // the frontend only when the person turns alerts on.
        .plugin(tauri_plugin_notification::init())
        // Updates: registered with an inert config; SWF's own feed/key are
        // compiled in (see updater.rs) and used only when both are set.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(auth::oidc::PendingCallback::default())
        .manage(auth::oidc::OktaSession::default())
        .manage(identity::IdentityState::default())
        .manage(deeplink::PendingDeepLinks::default())
        .manage(pairing::PairingHandle::default())
        .setup(|app| {
            // Load the persisted local identity (OS keyring → identity.key).
            // Never generates a key and never fails startup.
            identity::init(app.handle());

            // Cold start: a swfbuzz:// link launches the app with the URL in argv.
            deeplink::handle_launch_args(app.handle());

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls();
                eprintln!("[oidc diag] on_open_url fired, url count={}", urls.len());
                for url in urls {
                    if deeplink::is_swf_link(url.as_ref()) {
                        deeplink::handle_incoming(&handle, url.as_ref());
                    } else {
                        auth::oidc::deliver_incoming_url(&handle, url.as_ref());
                    }
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
            // Native notifications + Windows taskbar unread overlay.
            notifications::show_notification,
            notifications::set_unread_indicator,
            notifications::notification_permission,
            // Local Nostr identity (primary login path).
            identity::commands::get_identity,
            identity::commands::create_identity,
            identity::commands::create_identity_with_backup,
            identity::commands::preview_identity_input,
            identity::commands::import_identity,
            identity::commands::replace_identity,
            identity::commands::delete_identity,
            identity::commands::create_ncryptsec_backup,
            identity::commands::save_ncryptsec_backup,
            identity::commands::verify_ncryptsec_backup,
            identity::commands::sign_event,
            identity::commands::nip44_encrypt,
            identity::commands::nip44_decrypt,
            // swfbuzz:// deep links (the frontend drains the queue).
            deeplink::take_pending_deep_links,
            // TODO(identity-migration): legacy Okta commands — kept until the
            // local-identity path is verified, then removed (see migration plan §26).
            commands::auth::start_okta_login,
            commands::auth::okta_logout,
            commands::secure_storage::secure_storage_get,
            commands::secure_storage::secure_storage_set,
            commands::secure_storage::secure_storage_delete,
            // Settings → Updates (SWF's own feed only; inert when not configured).
            updater::updater_configured,
            updater::updater_check,
            updater::updater_install,
            // Settings → Mobile (NIP-AB; no private key is ever sent — see pairing.rs).
            pairing::start_pairing,
            pairing::confirm_pairing_sas,
            pairing::cancel_pairing,
            // Deployment admin console (feedback) — scoped to /api/admin/v1/ only.
            admin_http::admin_request,
            admin_http::admin_fetch_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
