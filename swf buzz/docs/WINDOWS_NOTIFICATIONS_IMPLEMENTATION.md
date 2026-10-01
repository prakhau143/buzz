# Windows Notifications — Implementation

**Date:** 2026-09-29 · **Scope:** native OS alerts, the taskbar unread overlay, click routing,
and notification settings. No protocol changes, no new event kinds, no relay writes.

## Before → after

| Area | Before | After |
|---|---|---|
| Where the pipeline ran | `AppSidebar.vue`, so it **stopped in Settings** (full-screen, no sidebar). Unread counting stopped there too | `useNotificationService()` in `app/SessionServices.vue`, mounted for the whole signed-in session |
| Delivery | `tauri-plugin-notification` `sendNotification` (no click handling on desktop) | Native command `show_notification` (Rust, `tauri-winrt-notification`): a real Windows toast with an **activation callback** |
| Click | Nothing | Focuses the window and routes to the exact channel/DM, message and thread (or Inbox row) |
| Sound | OS toast sound **plus** the synthesized chime (double) | **One** sound: the Windows toast sound. The chime is used only in the browser build |
| Dedup | Only a needs-action seen set | A per-identity + per-community ledger (one toast per event), plus a 120 s freshness window, so a reconnect replay stays silent |
| Names | Profile cache, else short key | Canonical profile (`profileFor`), fetched once through `ProfileService` if unknown (1.5 s cap), else short key |
| Preview | `content.slice(0,180)` (raw markdown, wave marker, keys) | `safePreview`: wave sentence, markdown/HTML flattened, `nostr:` mentions → names, links → host, images → `[image]`, **nsec/ncryptsec → `[hidden]`**, one line, ≤ 140 |
| Permission | Tauri always said "granted"/"default"; "denied" was never detected | Real OS state from `ToastNotifier.Setting`: "denied" when Windows blocks the app, the user or policy |
| Taskbar | None | Red-dot overlay (`set_overlay_icon`), with a Settings toggle |

## Architecture

```text
relay live subscription (useUnreadTracking, one per community session)
  └─ onIncoming(message, {viewing})
       └─ useNotificationService  (app/SessionServices.vue, whole session)
            CLASSIFY  classifyMessage → dm | mention | thread_reply | null
            POLICY    isFresh (≤120 s) → ledger.claim(identity|community|eventId)
                      → shouldAlert(settings, viewing, window focus)  [in alertIfAllowed]
                      → OS permission
            SURFACE   pickSurface: SWF window focused → IN-APP toast (+ chime)
                      otherwise → WINDOWS toast (system sound). Never both.
            ACTION    in-app: pushInAppToast(...)  |  native: invoke("show_notification", …)
                         └─ Rust: Toast(app_id).on_activated → focus main window
                                  → emit "swf-notification-activated"(target)
            ROUTE     listen("swf-notification-activated") → parseNotificationTarget
                      → same identity? → switchCommunity if needed → router.push(targetRoute)

Inbox feed (needs_action / reminder) → same POLICY/ACTION, kind "inbox"
readState + DM list + Inbox → needsAttention → invoke("set_unread_indicator") on change only
```

### Files

| File | Role |
|---|---|
| `src-tauri/src/notifications.rs` (new) | `show_notification`, `set_unread_indicator`, `notification_permission`; input bounds; target validation; red-dot RGBA |
| `src-tauri/src/lib.rs` | Registers the three commands |
| `src-tauri/Cargo.toml` | Windows-only deps: `tauri-winrt-notification 0.8`, `windows 0.62` (`UI_Notifications`). The same versions and features the notification plugin already builds, so no new crates |
| `src/features/notifications/notificationEngine.ts` (new) | Pure: classify, freshness, ledger, titles, `safePreview`, targets, `targetRoute`, `needsAttention` |
| `src/features/notifications/useNotificationService.ts` (new) | Session-wide service; `useReportActiveConversation` |
| `src/features/notifications/desktopNotifier.ts` | Native delivery, real permission, single sound, `setTaskbarIndicator` |
| `src/features/notifications/notificationSettings.ts` | Adds `taskbarIndicator` (default on, sanitized) |
| `src/app/SessionServices.vue` | Mounts the service |
| `src/layouts/AppSidebar.vue` | Pipeline removed; only reports the conversation on screen |
| `src/features/settings/ui/sections/NotificationsSection.vue` | Windows wording for "denied", re-reads permission on focus, **Taskbar indicator** toggle, sound description; the chime preview is hidden in the desktop app |

## Rules

- **Types:**
  - **dm**: any message from someone else in one of my DM conversations.
  - **mention**: a top-level channel message that p-tags me.
  - **thread_reply**: a thread reply that p-tags me. NIP-10 replies tag the parent's author, so a reply to me qualifies. This is the same rule as unread counting (`unreadPolicy.ts`).
  - **needs_action**: new Inbox requests and reminders after the feed's first load.
- **Never alerts:**
  - my own messages;
  - system messages;
  - plain channel chatter;
  - history.
- **"Notify while viewing"** (off by default) suppresses only the conversation on screen **while the window is focused**. "Viewing" is reported by the channel/DM sidebar and is `null` in Settings and the Inbox, so alerts there are never suppressed as "viewing".
- **Category switches and the master switch** apply exactly as in Settings (`shouldAlert`).
- **Dedup:** the ledger key is `pubkey|community|eventId` (bounded to 1000). It is cleared on identity change. Each community's needs-action feed is re-seeded after a switch.
- **Reconnect:** events older than 120 s never alert. That covers a resubscribe replay, and the ledger covers duplicate delivery.
- **Test alert** (Settings) goes through the same delivery path and touches no read state.

## Click routing

- **The target** is a flat JSON of strings: `{v, identity, community, kind, channelId, messageId, threadRootId?}`, or `{…, kind:"inbox", item}`.
  - `identity` is a 16-hex **public-key fingerprint**, not a key.
- **Validation:**
  - Rust rejects anything that isn't a small flat object of strings.
  - The webview re-validates it with `parseNotificationTarget`: version, the kinds allowed, a `ws(s)://` community, and id charset.
- **Routing:**
  - A toast from a different identity is ignored.
  - If the community differs, `switchCommunity` runs first. That is the normal NIP-42 plus membership path, so membership is **not bypassed**; if the switch fails, nothing is routed.
  - Channels and DMs use the existing `?messageId=&threadRootId=` reveal: the message is highlighted and the thread opens. The Inbox uses `?item=`.

## Taskbar overlay

- **Lit** while there is an unread DM, a channel with an unread @mention, or an unread needs-action/reminder. Ordinary chatter doesn't light it.
- **Gated** by `readState.isReady`, so nothing lights before hydration.
- **Updated only on change.** Cleared on identity change and when the service unmounts: sign-out, or the session ending.
- **The overlay** is a 16×16 transparent canvas (Windows' recommended overlay size), with a ~9px red dot in its lower-right corner and a 1px deeper-red rim for contrast.
  - No number, no white halo, no animation.
  - Generated in code, so there's no asset.
  - The first version was a 32px dot with a white ring, which Windows scaled into the overlay slot and made look as big as the app icon.
- Windows-only; a no-op elsewhere.

## In-app toasts (foreground)

- **Surface rule (`pickSurface`):**
  - **SWF window focused and visible:** an **in-app toast**, plus the chime if Sound is on.
  - **Background, minimized or another app in front:** the **Windows toast**, which plays the system sound.
  - Exactly one surface per event. The one ledger still de-duplicates, and the taskbar dot follows unread attention on both paths.
- **Same policy for both surfaces:** the master switch, the categories and "Notify while viewing" (off means the conversation on screen stays quiet while focused).
- **Settings → Test** always uses the real Windows path.
- **Card** (`features/notifications/ui/InAppToastStack.vue`, mounted in `App.vue`):
  - top-right, below the 48px header (20px in full-screen Settings);
  - width `min(380px, 100vw − 32px)`, 14px radius, translucent blurred surface, subtle border and shadow;
  - shows the sender avatar, title, a 2-line safe preview, and a context line (`#channel · Mentioned you` / `Thread reply` / `Direct message` / `Needs your action`) with the relative time.
- **Behaviour:**
  - newest on top, **max 3** (older ones are dropped);
  - auto-dismiss after **6s**, paused while hovered or focused;
  - **×** and **Esc** dismiss (Esc is stopped at the card, so it doesn't also close a thread);
  - a click routes through the same guarded opener as a Windows-toast click: identity check, community switch, exact message / thread / DM / Inbox row;
  - 200ms slide-and-fade, instant with reduced motion.
- **It never blocks the app:** the stack container is `pointer-events: none` and only the cards take clicks, so the conversation and the composer stay usable.
- **Cleared** on identity change and at the end of the session.

## Titles

| Type | Title | Body |
|---|---|---|
| DM | `Devankit` | safe preview |
| Mention | `Devankit · #SWF Project` | safe preview |
| Thread reply | `Devankit · #SWF Project` | safe preview |
| Needs action | `SWF Buzz` | `Devankit needs your action: …` / `Reminder: …` |

Windows shows the app name ("SWF Buzz") as the toast header.

## Security

- **No private material** in any notification: no private key, nsec, token or auth data in titles, bodies, targets or events. Previews redact nsec/ncryptsec strings, since Action Center persists toast text.
- **No logging** of payloads. The service and notifier contain no console logging (source-guarded by tests), and Rust logs nothing.
- **The existing security guard** (`identitySecurity.spec.ts`: only identity commands may carry secret-shaped arguments) still passes.

## App identity (AUMID): dev vs installed

- **DEV (`tauri dev`, or running `target\debug|release\swf-buzz.exe` directly):** Windows attributes native toasts to **Windows PowerShell**. There is no Start-menu shortcut carrying SWF Buzz's AppUserModelID, so Windows can't name the app. This is a development limitation, not a production bug, and there is deliberately no workaround (a fake identity would be wrong).
- **INSTALLED:** both Tauri installer templates put `System.AppUserModel.ID = com.swfbuzz.desktop` (the bundle identifier) on the Start-menu shortcut. NSIS uses `SetLnkAppUserModelId`; MSI uses `ShortcutProperty System.AppUserModel.ID`. The toast is created with that same id, so it shows under **SWF Buzz**.

- **The same rule as the plugin.**
  - Installed builds toast as `com.swfbuzz.desktop`; the Tauri NSIS/MSI installer registers the shortcut's AppUserModelID.
  - A dev exe running from `target\debug|release` has no registered AUMID, so its toasts appear under **Windows PowerShell**. This is expected in dev.
- **Permission when the AUMID isn't registered:** `ToastNotifier.Setting` returns "Element not found". That is treated as *unknown* (not "denied"), so dev isn't falsely blocked.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (0 warnings) |
| `npm run build` | PASS |
| New tests: `notificationEngine.spec.ts` (26), `notificationService.spec.ts` (8) | 34 / 34 PASS |
| Full unit suite | **1303 / 1303 PASS** (128 files). An earlier run caught `identitySecurity` flagging `input.title` in an `invoke`; that was a false positive, fixed by destructuring rather than by loosening the guard |
| `cargo check` / `cargo test` | PASS: 88 / 88, including 3 new tests (target validation, bounds, red dot) |
| Native toast on this Windows 10 machine | **Delivered.** A scratch probe using the same crate and calls returned `show = ok` |
| `ToastNotifier.Setting` on an unregistered AUMID | "Element not found" → handled as unknown |

**Not yet verified live:**
- The in-app path: clicking a real toast → routing, and the taskbar dot in the running app. The already-running dev instance predates the new Rust commands and was not restarted during this work.
- **An installed build.** No SWF Buzz installer is installed on this machine, so the `com.swfbuzz.desktop` attribution and the "denied" state under a registered AUMID are untested.

Manual steps, after restarting the app:
1. Settings → Notifications → **Test**: a toast appears.
2. From another account, DM this identity with SWF in the background: a toast titled with their name appears; clicking it opens the DM at that message; the taskbar dot appears and clears after reading.
3. Repeat the DM check while in Settings.
4. Windows Settings → Notifications → turn SWF Buzz off (installed build): Settings shows the "blocked" note.

## Installed-build QA (2026-09-29/30)

**Build and install:**
- Built with `npm run tauri build`. The target dir was on E:, because C: had run out of space.
- It produced `SWF Buzz_0.1.0_x64_en-US.msi` and `SWF Buzz_0.1.0_x64-setup.exe`.
- The NSIS installer was run silently, per user, into `%LOCALAPPDATA%\SWF Buzz`.
- The installed app was launched through its registered app id (`shell:AppsFolder\com.swfbuzz.desktop`), not from `target\`.

| Check | Result |
|---|---|
| AUMID registered | **PASS.** `Get-StartApps` lists **SWF Buzz → AppID `com.swfbuzz.desktop`**, and the Start-menu shortcut points at the installed exe |
| Permission (real `ToastNotifier.Setting`) | **PASS: `granted`**, with no "blocked" note in Settings |
| Settings → Notifications → **Test** | **PASS.** The status reads "Sent". Windows' notification store (`wpndatabase.db`, read from a copy that was deleted afterwards) records the toast under handler **`com.swfbuzz.desktop`**, not PowerShell. Title "SWF Buzz", body "This is how alerts will look." |
| Taskbar command `set_unread_indicator` | **PASS** (returns OK). The attention rule was true: 1 unread DM from Devankit |
| Toast click → exact thread reply | **PASS.** Starting in Settings, the `swf-notification-activated` event with a real target (channel + reply + thread root) routed to the channel, opened thread `787f715f…` and revealed reply `2e56fd0f…` |
| Settings copy and toggles | **PASS.** Desktop notifications, Notify while viewing, the 4 categories, Sound ("Windows notification sound"), and the Taskbar indicator all show correctly |

**How the QA was done:**
- The PC was **locked** throughout, so there was no visible desktop.
- The UI was driven by UI Automation, then by WebView2 DevTools on `127.0.0.1:9222`. That was for this QA run only; the app was relaunched normally afterwards, with the port closed.
- A click on a *real* toast banner can't be done on a locked screen. The Rust `on_activated` → emit step is the only part not exercised live; the frontend half after the emit was.

**Not verified, and why:**
- **The dot's look on the taskbar:** the screen was locked. The pixels are unit-tested (16×16, transparent, ~9px, no white).
- **A real incoming DM or mention toast:** that needs a message from another person. I did not send messages as anyone.
- **DM toast routing:** opening the DM would have marked the person's real unread message as read (and published that read state). It uses the same code path as the channel route, which is unit-tested.
- **The in-app toast in the installed app:** it needs a live incoming message while the app is focused. It is covered by unit tests and a rendered harness screenshot.

**A release-build note found during QA (not a notification issue):**
- The installed build uses origin `http://tauri.localhost`. Its local storage is therefore separate from the dev build's `http://localhost:1420`, so it starts with no saved community and falls back to `VITE_RELAY_URL` (`ws://localhost:3000` in this `.env.local`).
- The release CSP allows `https:`/`wss:` only, so NIP-98 HTTP to `http://localhost:3000` is blocked. That shows as "Can't reach your community server".
- Real communities (`https`/`wss`) are unaffected. `swfbuzz://connect?relay=wss://buzz.lmdconsulting.com` connected at once.
- For shipped builds, set `VITE_RELAY_URL` to the production community at build time.
