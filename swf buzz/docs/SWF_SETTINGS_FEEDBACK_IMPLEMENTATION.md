# SWF Settings + Send Feedback — Implementation Report

Date: 2026-09-29 · Behavioural reference: `docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md` (OLD BUZZ is a reference, not a spec — known OLD BUZZ bugs are not reproduced).

---

## 1. Architecture

```
Profile popover ──► Send feedback (modal) ──► kind 42000 ──► open community relay ──► product_feedback (Postgres)
               └──► Settings  ──► /settings?section=…&from=…   (full-screen route, meta.fullscreen)
                                   SettingsView (allowlist nav, search, version) ─► 9 section pages
App.vue ─► SessionServices (presence, profile sync, global shortcuts)   ─► mounted whenever a session is ready
        ─► useShortcutDispatcher (one keydown listener, driven by shortcutRegistry)
Control plane: /platform-admin ─► FeedbackInbox ─► Rust admin_request/admin_fetch_bytes ─► /api/admin/v1/feedback*
```

- **Settings is a real route.** `/settings` has `meta.fullscreen`. `App.vue` then hides the app header; the Settings view renders no AppShell or AppSidebar. "Back to app" returns to the in-app path in `?from=` (only a same-origin path is accepted). Escape closes Settings unless a dialog or menu already consumed it.
- **Presence moved** out of `AppHeader` into `app/SessionServices.vue`, so hiding the header on Settings never stops presence.
- **Allowlist, not a filter.** `settingsRegistry.ts` lists exactly nine sections. Nothing can reappear through a feature flag (OLD BUZZ's gates fail open).

## 2. Files changed

**New (frontend)**
- `src/features/settings/settingsRegistry.ts`
- `src/features/settings/ui/SettingsView.vue`
- `src/features/settings/ui/primitives/`: `SettingsPage`, `SettingsCard`, `SettingsRow`, `ToggleSwitch`, `SegmentedControl`, `SaveIndicator`
- `src/features/settings/ui/sections/`: `Profile`, `Appearance`, `Notifications`, `Shortcuts`, `CustomEmoji`, `Community`, `Invites`, `Mobile`, `Updates` (each `*Section.vue`)
- `src/features/shortcuts/shortcutRegistry.ts`, `useShortcuts.ts`
- `src/features/appearance/appearance.ts`, `src/app/theme/appearance.css`
- `src/features/profile/profileStore.ts`, `myProfile.ts`, `profileSync.ts`
- `src/features/feedback/feedbackModel.ts`, `feedbackService.ts`, `ui/SendFeedbackDialog.vue`
- `src/features/platform-admin/feedbackInsights.ts`, `ui/FeedbackInbox.vue`
- `src/features/notifications/notificationSettings.ts`, `desktopNotifier.ts`
- `src/features/customEmoji/customEmoji.ts`
- `src/features/communities/communityIcon.ts`
- `src/features/mobilePairing/pairing.ts`
- `src/features/updates/updates.ts`
- `src/app/SessionServices.vue`, `src/app/appVersion.ts`

**New (Rust)**
- `src-tauri/src/pairing.rs` (NIP-AB source, using `buzz-core`)
- `src-tauri/src/updater.rs`
- `src-tauri/src/admin_http.rs`

**Changed**

| File | Change |
|---|---|
| `src/App.vue` | services, dispatcher, full-screen header rule |
| `src/app/router/index.ts` | `/settings` route |
| `src/main.ts` | appearance init |
| `vite.config.ts` | `__APP_VERSION__` |
| `src/layouts/AppHeader.vue` | presence moved out; hints from registry |
| `src/layouts/SidebarUserCard.vue` | menu: Send feedback, Settings route, no diagnostics |
| `src/layouts/AppSidebar.vue` | registry shortcuts, feedback dialog, alerts, badge setting |
| `src/features/navigation/useAppNavigation.ts` | Alt+←/→ via registry |
| `src/composables/useProfile.ts`, `src/services/ProfileService.ts`, `src/features/profile/identityProfile.ts`, `src/features/agents/useMentionCandidates.ts` | canonical profile |
| `src/features/auth/identitySession.ts` | clear the profile registry when the identity changes |
| `src/features/readState/useUnreadTracking.ts` | incoming-message hook |
| `src/composables/useEscapeKey.ts` | marks Escape handled |
| `src/services/MediaService.ts` | upload purpose and auth-TTL options |
| `src/features/platform-admin/AdminConsoleService.ts`, `PlatformAdminView.vue` | body-signed NIP-98, Rust transport, detail/attachments, FeedbackInbox |
| `src/protocol/kinds.ts`, `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` §12 | kinds 9033 / 42000 / 30030 with citations |
| `src/app/providers/queryKeys.ts` | `customEmoji` |
| `src/types/domain.ts` | `AdminFeedbackDetail` |
| `src/components/AppIcon.vue` | 20 icons, still pure ASCII |
| `src-tauri/src/lib.rs`, `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json` | plugins, commands, CSP `media-src 'self' blob:`, inert updater config |

**Dependencies added**
- npm: `@tauri-apps/plugin-notification`, `qrcode` (+ `@types/qrcode`)
- cargo: `tauri-plugin-notification`, `tauri-plugin-updater`, `buzz-core` (path, same repo), `tokio`, `tokio-tungstenite` 0.29, `futures-util`, `zeroize`
- `cargo add` also refreshed `Cargo.lock` within Tauri 2.12. Tauri itself is unchanged (JS API 2.12.0).

**Tests (new or updated)**
- New:
  - `tests/unit/features/settings/settingsRegistry.spec.ts`
  - `tests/unit/features/settings/settingsModels.spec.ts`
  - `tests/unit/features/shortcuts/shortcutRegistry.spec.ts`
  - `tests/unit/features/profile/profileConsistency.spec.ts`
  - `tests/unit/features/feedback/feedback.spec.ts`
  - `tests/unit/features/feedback/feedbackInsights.spec.ts`
  - 6 Rust tests in `pairing.rs`, 1 in `admin_http.rs`
- Updated for new requirements, not weakened:
  - `tests/unit/features/bottomLeft/userCard.spec.ts`: Settings is now a page; the Send feedback menu order is asserted.
  - `tests/unit/features/profile.spec.ts`: a save needs a signed-in identity.
  - `tests/unit/services/profileBatching.spec.ts`: starts from an empty profile registry, as a new sign-in does.

## 3. Settings inventory

| Group | Section | What it does |
|---|---|---|
| Personal | Profile | Photo, display name, title, about; public key (npub + hex), NIP-05, each with copy. No private key shown. |
| | Appearance | Color mode System/Light/Dark; light themes SWF Light, Paper, Sky; dark themes SWF Dark, Midnight, Graphite, Ocean; 7 accents; text size; conversation density; zoom; restore defaults. |
| | Notifications | Desktop alerts (asks OS permission only when you turn it on), notify while viewing, test alert, alerts for direct messages / mentions / thread replies / needs action, sound, inbox badge. |
| | Shortcuts | Read-only, rendered from the registry the handlers use. |
| | Custom emoji | Upload, preview, shortcode validation, replace warning, save, remove your own; community emoji shown read-only. |
| Community | Community | Icon (owner/admin, kind 9033), device-local name, address (copy), members and roles, moderation (owner/admin), leave (not for the owner). |
| | Invites (owner/admin) | Create a link on click only. No list or revoke — the relay has no such endpoint. |
| App | Mobile | NIP-AB pairing: QR → 6-digit code → confirm → verified. See §10. |
| | Updates | Current version; check, install and restart when this build is configured (§11). |

- The sidebar has a search box and shows the app version at the bottom.
- Below 860 px the sidebar becomes a compact back button plus a section picker.

## 4. Excluded features removed

| Feature | Status |
|---|---|
| Agents, Compute, Experiments, Hosted Communities, Channel Templates, Voice, Local Archive | Absent from the registry. `settingsRegistry.spec.ts` asserts they are not valid sections and that no section component exists for them. |
| Identity diagnostics | Removed from the profile menu and the sidebar. It remains only on the sign-in screens, dev builds only. |
| Link previews, thread "focus" layout, window glass | Not offered: SWF has no such features, and the controls would do nothing. |
| Agent notification slots, huddle / terminal shortcuts | Not carried over. The existing product-boundary test (no `AudioContext`) still passes; the notification chime is a generated WAV played through an `<audio>` element. |

## 5. Profile synchronization design

**Why names were inconsistent (root causes found)**
1. **Each community's relay holds its own kind:0, and display read only the open one.** So switching communities could show an older name.
2. **Replication had never worked.** The client posted to `/event`, but the relay route is `/events`, and the response was never checked.
3. **Nothing updated the cache after a save, and nothing subscribed to kind:0.** On top of that, separate single and batch caches drifted apart.
4. **Saving rebuilt kind:0 from scratch.** Every field SWF doesn't edit was lost.

**Design**
- **Canonical registry.** `profileStore.ts` is one identity-level registry keyed by pubkey. Every kind:0 seen — from any community, the local cache, a live event or a save — is absorbed with the NIP-01 rule: newest `created_at` wins, ties go to the lower id. A stale copy can never overwrite a newer one.
- **One source for every surface.** `useProfile`, `useDisplayName`, `useProfileMap` and mentions all render from the registry. That covers the sidebar, profile menu, direct messages, messages, threads, member lists, search, inbox, command palette and moderation. Queries only fetch.
- **Save (`myProfile.saveMyProfile`):**
  1. Merge into the newest event (unknown fields kept; cleared fields removed).
  2. Set `created_at` strictly after the previous version.
  3. Publish to the open community; the save succeeds only when the relay accepts it.
  4. The saved event becomes canonical, so every surface updates immediately.
  5. Keep it in local storage.
  6. Replicate the same signed event to every other confirmed membership (`POST /events`, NIP-98). Each community's outcome is shown; nothing is assumed.
- **Per community session (`profileSync.ts`):**
  - Seed from the local cache.
  - Fetch my kind:0 from the open relay. If that relay's copy is older, or missing, republish the newest one there verbatim.
  - Keep one live kind:0 subscription.
- **The contract.** A profile is universal across the SWF communities this identity belongs to. It is not claimed for arbitrary external Nostr relays.

## 6. Feedback transport

This is OLD BUZZ's verified path, unchanged on the wire:
- The Send feedback dialog uploads attachments only when you press Send (Blossom `PUT /upload` on the same community), so a cancelled dialog leaves no orphaned files.
- It then publishes a signed **kind 42000**: `content` = message plus attachment lines; tags = optional `category` and one `imeta` per attachment.
- It goes over the **open community's** relay socket and is accepted only after NIP-42 auth.
- Categories: Bug, Praise, Needs work.
- The message is required and checked against the relay's 32 KiB limit.
- **Diagnostics** are opt-in and hold exactly five fields: capture time, app version, platform, user agent, language. Anything key-like is redacted; no logs are attached.

## 7. Feedback storage / control-plane destination

- **Storage:** the relay's `product_feedback` table, which covers the whole deployment. Each row holds the submitter's pubkey, the community (taken from the connection host), category, body, tags, times and status (new / reviewed / archived).
- **Reader:** SWF's **Platform Admin → Feedback** (`FeedbackInbox.vue`). It has search, filters by community, role, category and status, and a detail pane with sender, derived role, community, category, message, attachments, diagnostics, time and a status control.
- **Two defects fixed in the admin client:**
  1. Mutations were signed without the body hash the relay requires, so they always returned 401.
  2. Webview requests always carry an `Origin` header, which the relay rejects. Admin calls now go through the Rust commands `admin_request` / `admin_fetch_bytes`, which only accept `/api/admin/v1/` URLs.
- **Who can read:** deployment operators and moderators only, exactly as OLD BUZZ. Community members never see feedback.
- **Server cap:** the list shows the newest 100 (a relay limit).

## 8. Feedback attachment support

- **Images** (JPEG / PNG / GIF / WebP): re-encoded and stripped of metadata as the relay requires, at most 20 MB before processing.
- **Video: MP4 only**, at most 100 MB, with a longer upload-auth lifetime for large files.
  - The relay accepts only fast-start H.264/AAC MP4 (at most 10 minutes, 4K, no metadata boxes). SWF has no transcoder.
  - WebM, MOV and QuickTime are refused in the dialog with a clear reason. The relay's own validation stays authoritative, and its refusal is shown if a file fails there.
- **Rendering in the control plane** is decided by **sniffing the bytes**, never by the sender's claimed type. Raster images and MP4 play inline (through blob URLs — CSP `media-src 'self' blob:`); diagnostics show as plain text; anything else is a download. Attachments are read only through the feedback-scoped admin route.

## 9. Role derivation

- The client sends **no role**.
- The reader derives it from the community's **relay-signed NIP-43 membership snapshot** (kind 13534), fetched with NIP-98 from that community's `/query` (`feedbackInsights.deriveSubmitterInsight`). It is shown as "Admin — verified from the community's membership list".
- If the reviewer isn't a member of that community (or it publishes no list), the UI says **"Role not verifiable"** and gives the reason. It never guesses.
- This approach needs no relay change. OLD BUZZ's relay is out of scope; the relay-side alternative (a `LEFT JOIN relay_members` in the admin API) is noted in the audit §23.

## 10. Mobile pairing status

**Implemented:** the desktop "source" side of NIP-AB (`src-tauri/src/pairing.rs`), using OLD BUZZ's formally modelled `buzz-core` protocol unmodified (by path dependency — same repo, nothing copied).

**How it works**
- The pairing server is discovered through NIP-11, in this order: `pairing_relay_url`, then `<relay>/pair`, then the relay itself.
- **QR:** `nostrpair://…`, containing an ephemeral key and a session secret. It expires after 120 s.
- **Codes:** a 6-digit SAS shown on both devices.
- **Protection:** transcript hash, replay protection, cancel, expiry, and pairing is cancelled when you leave the page.

**Security decision pending — the identity is NOT transferred.** OLD BUZZ sends the full nsec to the phone. SWF keeps the key in the OS keyring and never reads it here. After the codes match, the desktop sends a non-secret check payload `{type, pubkey, relayUrl, identityTransferred:false}`, and the UI states plainly that the identity was not transferred. There is no code path in `pairing.rs` that reads the secret key.

**Verified for real (local), 2026-09-29**, with SWF desktop plus OLD BUZZ's `buzz-pair target` acting as the phone, over the real `buzz-pair-relay`:

| Scenario | Result |
|---|---|
| Codes matched, phone confirmed | Full handshake completed on both sides |
| Phone answered "no" | Desktop showed "The codes didn't match on the phone…" and stopped |
| `--show-secret` | The phone received only public data (0 lines containing `nsec`) |

**Not possible yet:** a real SWF mobile app. None exists, so "same identity on the phone" cannot be claimed.

## 11. Updater status

- **Pipeline implemented:** Tauri updater plus `updater_check` / `updater_install` (the downloaded package is signature-verified by the plugin, installed on click, then the app restarts).
- **SWF's own feed and key** are compiled in from `SWF_BUZZ_UPDATER_ENDPOINT` and `SWF_BUZZ_UPDATER_PUBKEY`. Nothing points at `block/buzz`.
- **Not configured on this machine.** The Updates page shows the current version and says so plainly; it never pretends a pipeline exists.
- **To enable:**
  1. `npx tauri signer generate`.
  2. Build with both env values set.
  3. Publish `latest.json` plus the signed artifacts at the endpoint, with `createUpdaterArtifacts` in release builds.

## 12. Tests

| Check | Result |
|---|---|
| Typecheck, lint, build | See §12a |
| `cargo test` | See §12a |
| Full unit suite, 3 consecutive runs | See §12a |
| Real relay (local), QA identity | Feedback → `product_feedback` row (bug, 3 tags); control plane list/detail/role "Admin (verified)"; image and diagnostics render; status → reviewed persisted; profile save replicated to 2 communities; custom emoji 30030 round trip; community icon 9033 → NIP-11; invite minted only on click (6 → 6 on open, → 7 on click); Ctrl+, opens Settings; Back to app; name consistent after a community switch |
| Responsive | 1440/1280/1024/768/430/390/375 px: no element overflows horizontally on Profile, Appearance, Notifications, Community, Invites, Mobile, Updates; compact picker at ≤ 860 px |

### 12a. Final validation run (2026-09-29)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings 0`) | clean |
| `npm run build` | built |
| `cargo check` / `cargo test` | 85 passed, 0 failed (78 before + 6 pairing + 1 admin proxy) |
| Full unit suite, 3 consecutive runs | 126 files / 1269 tests passed, each run |

The real-relay E2E suite (`tests/integration/*.e2e.spec.ts`) was not run: it needs `SWF_E2E_*` test keys that are not configured. The real-relay checks were done in the running app instead (§12).

## 13. Security audit

Searched every new file and the new Rust for:
- key literals (`nsec1…`, `ncryptsec1…`);
- secret-key reads (`secret_key`, `to_bech32`, `get_nsec`);
- logging (`console.log`/`debug`/`info`, `println!`, `eprintln!`);
- `localStorage` writes;
- secrets in URL query strings;
- logged auth headers.

Result:
- **No key material**, and no logging of keys, auth objects or pairing secrets.
- **Only use of the identity key in new Rust:** `signing_keys()?.public_key()` in `pairing.rs`.
- **localStorage** holds only preferences and the already-public signed kind:0.
- **Feedback diagnostics** are limited to five fields and pass through `redactSecrets`.
- **Pairing:** the QR is shown as an image; "Copy pairing code" warns that it contains a one-time secret.
- **Admin proxy** is limited to `/api/admin/v1/` and refuses credentials in URLs and redirects.
- **CSP:** only `media-src 'self' blob:` was added.

## 14. Known limitations

1. **Mobile:** the identity is not transferred (security decision pending), and no SWF mobile app exists.
2. **Updates:** not configured. Needs SWF's signing key, endpoint and release pipeline.
3. **Video:** MP4 (H.264/AAC, fast-start) only; there is no transcoder. A relay-valid MP4 could not be produced on this machine (no ffmpeg), so the video path is verified by unit tests and the relay's documented rules, not a live upload.
4. **Role** is verifiable only for communities the reviewer belongs to.
5. **Feedback list** is capped at the newest 100 by the relay.
6. **Avatars** are hosted on the community where they were uploaded. A viewer who isn't a member of that community may not be able to load the image (the name still syncs). Not yet verified across communities.
7. **Custom emoji** are managed in Settings, but not yet rendered inside messages or offered in the composer.
8. **Notifications** fire only for the open community. Clicking an alert focuses the app; it doesn't jump to the message.
9. **While Settings is open** the sidebar is unmounted, so live unread counting pauses. Startup catch-up runs again on return.
10. **Admin console** needs `VITE_ADMIN_URL=<scheme>://<BUZZ_ADMIN_HOST>/api/admin/v1` and a relay started with `BUZZ_ADMIN_HOST`.
11. **Prettier** was not run on the new files (to avoid reformatting shared files that another session was editing).

## 15. Manual QA checklist

- [ ] Profile menu order: status, community ›, **Send feedback**, **Settings (Ctrl+,)**, Sign out. No diagnostics entry.
- [ ] Ctrl+, opens Settings full screen (no header); Escape and "Back to app" return where you were.
- [ ] Only the 9 sections exist; Invites only as owner/admin; the settings search finds "theme", "qr", "npub".
- [ ] Profile: change name → "Saved" → "Updated in N other communities" → name identical in the sidebar, messages, members and DMs, and after switching community.
- [ ] Appearance: System/Light/Dark and themes apply instantly; text size, density and zoom work; Restore defaults.
- [ ] Notifications: turning alerts on asks the OS; "Test" shows an alert; a denied permission shows the banner.
- [ ] Shortcuts: every listed key works (Ctrl+K, Shift+Ctrl+N, Shift+Ctrl+A, Alt+←/→, Ctrl+B, Ctrl+±/0).
- [ ] Custom emoji: add, replace warning, remove own.
- [ ] Community: icon (admin/owner), name, copy address, members, leave (not for the owner).
- [ ] Invites: nothing is created until "Create invite".
- [ ] Mobile: follow §16.
- [ ] Updates: "not set up for this build" plus the version.
- [ ] Send feedback: category, message, image, WebM refused, diagnostics → "Thanks — we got it."; the row appears in Platform Admin → Feedback with the derived role.

---

## 16. How to test mobile pairing in local development

You don't need a phone. OLD BUZZ ships a command-line "phone": `buzz-pair target`, built on the same `buzz-core` code as the mobile app.

**One-time build** (Git Bash, in `buzz/buzz`):

```bash
cargo build -p buzz-pairing-cli      # → target/debug/buzz-pair.exe
```

**1. Start the pairing server.** In production a reverse proxy routes `/pair` to it; locally you run it yourself. It listens on 127.0.0.1:5000.

```bash
cd buzz/buzz && cargo run -p buzz-pair-relay
```

**2. Start the relay** so it advertises that pairing server:

```bash
cd buzz/buzz && BUZZ_PAIRING_RELAY_URL=ws://127.0.0.1:5000 just relay
```

Check it:

```bash
curl -s -H "Accept: application/nostr+json" http://localhost:3000/ | grep pairing_relay_url
```

**3. Start SWF Buzz:**

```bash
cd "swf buzz" && npm run tauri dev
```

Sign in to a community on that relay (e.g. `localhost:3000`, if your identity is a member there).

**4. Start pairing on the desktop:** Settings → **Mobile** → **Start pairing**. A QR appears. Click **Copy pairing code** — that copies the `nostrpair://…` text the phone would scan.

**5. Be the phone** (second terminal):

```bash
cd buzz/buzz && ./target/debug/buzz-pair.exe target
# Paste the QR URI:   ← paste the copied text, press Enter
```

The CLI prints `SAS code: 123456`.

**6. Compare and confirm.**
- The desktop shows the same 6 digits. Click **Codes match**.
- The CLI asks `Does your source device show 123456? [y/n]`. Type `y`.

**7. Result.**
- CLI: `Received custom payload!` … `Transfer complete! ✓`.
- Desktop: **Secure connection verified**.
- Add `--show-secret` to the CLI command to see exactly what was sent: `{"type":"swf-buzz-pairing-check","pubkey":"…","relayUrl":"…","identityTransferred":false}`. It contains no private key.

**Negative tests worth doing**

| Action | Expected |
|---|---|
| Answer `n` on the CLI | Desktop: "The codes didn't match on the phone. Pairing was stopped for your safety." |
| Wait more than 2 minutes on the QR | Desktop: "Pairing code expired" → **Generate a new code**. |
| Click **Cancel** on the desktop while the CLI waits | The CLI reports the abort. |
| Leave the Mobile page mid-pairing | The session is cancelled. |

**What this proves, and what it doesn't.** It proves the desktop side of NIP-AB interoperates with the reference implementation over a real pairing relay: discovery, QR, ephemeral auth, encrypted messages, SAS, transcript check, completion. It does **not** prove "my identity is now on my phone". That needs (a) a decision to allow transferring the key and (b) an SWF mobile app, and neither exists yet.

**Windows PowerShell notes (found while you tested):**
- PowerShell 5.1 has no `&&`. Run commands one per line, or use Git Bash.
- `just` only works from Git Bash. From PowerShell, run the relay with `cargo run -p buzz-relay` inside `buzzuzz`, after `$env:BUZZ_PAIRING_RELAY_URL="ws://127.0.0.1:5000"`.
- `fatal: failed to bind 127.0.0.1:5000 … os error 10048` just means a pairing server is **already running**. Keep using it.
- The CLI "phone" panics on `wss://` (production) addresses. That's a TLS-provider setup bug in OLD BUZZ's test CLI, not in SWF. Test against the local `ws://` servers.

**Fixed after live testing on production (2026-09-29):** the production pairing server sits behind a proxy that closed silent WebSockets after about 60 s, so a waiting QR failed with "The pairing server closed the connection". The desktop now sends a WebSocket ping every 20 s. Verified on `buzz.lmdconsulting.com`: the QR stayed live for the full 120 s and then showed "Pairing code expired".

**SWF's own test phone (works with production `wss://`).** `src-tauri/examples/pair_target.rs` uses the same `buzz-core` protocol as the OLD BUZZ CLI, but is built with SWF's TLS setup:

```powershell
cd "C:\Users\lenovo\New folder (2)\buzz\swf buzz\src-tauri"
cargo run --example pair_target -- --show-payload
```

Paste the pairing code, compare the digits, click **Codes match** on the desktop, type `y`. Verified on 2026-09-29 against `wss://buzz.lmdconsulting.com/pair`: both sides showed the same code, the phone received only `{identityTransferred:false, pubkey, relayUrl}`, and both sides reported complete. It's an `examples/` binary; it is not shipped in the app.

**Other ways to test:**
- **OLD BUZZ Flutter app:** it can act as the phone (it scans the QR), but it expects an `nsec` payload, so with SWF's non-secret payload it will report that it couldn't use what was sent.
- **Automated, no network:** `cd "swf buzz/src-tauri" && cargo test pairing` runs a full in-memory handshake against `buzz-core`'s target side and asserts no secret is sent.
