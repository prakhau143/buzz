# OLD BUZZ Settings & Feedback Audit

Date: 2026-09-29 · Scope: read-only reverse engineering of OLD BUZZ (`buzz/buzz`) · No source was modified.

**Conventions**

- Every path is relative to the OLD BUZZ repo root `buzz/buzz/`. `D/` = `desktop/src/`, `T/` = `desktop/src-tauri/src/`, `C/` = `crates/`, `M/` = `migrations/`.
- **V** = verified in code, **I** = inferred from code (not directly proven), **UNKNOWN** = could not be determined from the source.
- No private keys, nsecs, signing keys or tokens appear in this report. Where a secret exists in CI it is written as "present, redacted".
- Related earlier SWF audits, which this report agrees with where they overlap: `OLD_BUZZ_SETTINGS_REPORT.md`, `OLD_BUZZ_COMMUNITY_SETTINGS_REPORT.md`, `ADMIN_PANEL_REVERSE_ENGINEERING_REPORT.md`.

---

## 1. Executive Summary

**Send Feedback — where the data ends up (V).** If Prakhar sends feedback, the desktop app signs a **Nostr event of kind 42000** with his own key and sends it as `["EVENT", …]` over the **active community's relay WebSocket**. The relay does not store or broadcast it as a normal event. It writes one row into a **deployment-wide Postgres table, `product_feedback`**, with his pubkey, the community (from the connection's host), the category, the text and attachment references. The only readers are:

- the **deployment admin web app** (`admin-web`, pages `/feedback` and `/feedback/:id`, API `/api/admin/v1/feedback*`), for relay operators and moderators only;
- the `buzz-admin product-feedback list` command-line tool.

Other facts about the destination:

- **Community owners and admins cannot see feedback** through their community role.
- **The user's role is not recorded.**
- No email, webhook or notification is generated.

Full chain in §15.

**Settings as it really exists (V):** a full-screen route `/settings?section=<id>` with three nav groups:

- **Personal:** Profile, Appearance, Notifications, Voice, Shortcuts, Custom emoji, Local archive, Channel templates
- **Communities:** Hosted communities, Invites
- **App:** Agents, Compute, Experiments, Mobile, Updates

There is also a **Moderation** section that is registered but has **no nav entry**; it is reachable only by URL.

**Findings that matter for SWF Buzz:**

| # | Finding | Evidence |
|---|---|---|
| 1 | **Mobile pairing sends the desktop's full private key (nsec) to the phone.** Transport is NIP-AB (ECDH + HKDF + NIP-44, 6-digit comparison code, 120 s). There is no delegated key. | `T/commands/pairing.rs:139-152` (V) |
| 2 | **Updates** use the Tauri updater, which is compiled in only when `BUZZ_UPDATER_PUBLIC_KEY` and `BUZZ_UPDATER_ENDPOINT` are set at build time. Updates download automatically; installing needs a user click. The manifest is GitHub `latest.json` for `block/buzz`. | `desktop/src-tauri/build.rs:128-139`, `T/lib.rs:209-215` (V) |
| 3 | **Local archive** is a plaintext SQLite file (`~/.buzz/archive/archive.db`). It is on by default for **agent kinds only**, has no working pruning, and nothing in the UI reads channel archives. **Recommendation: REMOVE.** | §8 |
| 4 | **Community name, relay URL, "API token" and repos dir are device-local.** The API token is saved but **never used**: the Rust command drops it. Only the **icon** is server-side (kind 9033). | `D/shared/api/tauriWorkspace.ts:11-18` vs `T/commands/workspace.rs:153-160` (V) |
| 5 | **Invites:** there is only mint (`POST /api/invites`, owner/admin, NIP-98) and claim (`POST /api/invites/claim`). **No list, no revoke.** Every time the invite dialog opens it mints a **new** invite. | `C/buzz-relay/src/router.rs:107-124`; `D/features/community-members/ui/InviteLinkSection.tsx:96-133` (V) |
| 6 | **Profile (kind 0) is per community.** It is published only to the active relay, and a save **drops unknown kind:0 fields**: only `display_name`, `name`, `picture`, `about` and `nip05` are written. | `T/events.rs:428-453` (V) |
| 7 | **Notifications** are per identity per device (localStorage). There is **no per-community on/off**, and OS alerts fire only for the active community. | §5 |
| 8 | **The Shortcuts card does not match what is bound.** ⌘⇧X and ⌘Enter have no handler. ⌘R, ⌘W, ⌘J, ⌘⇧V and others are bound but not listed. | §6 |
| 9 | The feature gates `managed-agents`, `channel-templates` and `custom-emoji` **fail open**: their ids are not in `preview-features.json`, so those sections always show. | `D/features/settings/ui/SettingsView.tsx:133-154` (V) |

**Classification (details in §22):**

| Classification | Features |
|---|---|
| KEEP | Send Feedback, Custom emoji |
| KEEP WITH ADAPTATION | Profile, Appearance, Notifications, Shortcuts, Community settings, Invites, Updates |
| OPTIONAL | Mobile pairing (because of nsec transfer), Moderation, Encrypted key backup |
| REMOVE | Agents, Compute, Experiments, Hosted Communities, Channel Templates, Voice, Local Archive |

---

## 2. Complete Settings Inventory

### 2.1 Registration and shell (V)

**Route**

- Registered at `D/app/routes.ts:8` and defined in `D/app/routes/settings.tsx:24-27`.
- An invalid section becomes `undefined`; the legacy `doctor` redirects to `agents` (`:15-21`).
- The route component returns `null`. The Settings UI is rendered by `D/app/AppShell.tsx:175-182, 786-825`, which **replaces** the app sidebar, top chrome and outlet with a lazy `SettingsScreen` (`D/app/LazySettingsScreen.tsx:3-6`).
- History uses hash URLs (`tests/e2e/navigation.spec.ts:336`).

**History behaviour**

- `goSettings` pushes a history entry (`D/app/navigation/useAppNavigation.ts:391-401`).
- Switching sections uses `replace` (`AppShell.tsx:649-656`).
- Closing goes back, or `goHome` if there is no history (`useAppNavigation.ts:403-410`).
- The default section is `profile` (`D/features/settings/ui/SettingsPanels.tsx:102`).
- A hidden section falls back to the first visible one (`SettingsView.tsx:168-172`).

**Opening Settings**

| Entry point | Section | Evidence |
|---|---|---|
| ⌘, / Ctrl+, (toggles open and closed; disabled in huddle windows) | default | `D/app/useSettingsShortcuts.ts:19-44`, `AppShell.tsx:688-692` |
| Profile popover → Settings | default | `D/features/profile/ui/ProfilePopover.tsx:275-290` |
| Profile card / switcher / rail → Invite | `community-members` | `D/features/sidebar/ui/SidebarProfileCard.tsx:176-179`, `CommunityRail.tsx:399` |
| Toast from the link-preview style control | `appearance` | `D/shared/ui/link-preview-controls.tsx:54-66` |
| Encrypted-backup toast | `profile` | `D/app/App.tsx:338-345` |

- There is no macOS app-menu or tray entry (`T/app_menu.rs:65-103`).

**Closing Settings**

- "Back to app" (`SettingsView.tsx:232-244`).
- Escape, skipped if the event is already `defaultPrevented` (`:180-190`).
- ⌘, again.

### 2.2 Real hierarchy (V)

Group order comes from `SettingsView.tsx:51-76`. Labels and icons come from `SettingsPanels.tsx:153-237` (lucide-react icons).

| Group | id | Label | Icon | Gate | Component |
|---|---|---|---|---|---|
| Personal | `profile` | Profile | UserRound | – | `D/features/settings/ui/ProfileSettingsCard.tsx` |
| | `appearance` | Appearance | MonitorCog | – | `ThemeSettingsCard` in `SettingsPanels.tsx:421-800` plus `AppearanceSettingsControls.tsx` |
| | `notifications` | Notifications | BellRing | – | `NotificationSettingsCard.tsx` |
| | `voice` | Voice | Volume2 | – | `VoiceSettingsCard.tsx` |
| | `shortcuts` | Shortcuts | Keyboard | – | `KeyboardShortcutsCard.tsx` |
| | `custom-emoji` | Custom emoji | Smile | `custom-emoji` (fails open) | `D/features/custom-emoji/ui/CustomEmojiSettingsCard.tsx` |
| | `local-archive` | Local archive | Archive | – | `D/features/local-archive/ui/LocalArchiveSettingsCard.tsx` |
| | `channel-templates` | Channel templates | LayoutTemplate | `channel-templates` (fails open) | `ChannelTemplatesSettingsCard.tsx` |
| Communities | `hosted-communities` | Hosted communities | MessagesSquare | – | `HostedCommunitiesSettingsCard.tsx` |
| | `community-members` | Invites | Ticket | role owner/admin | `D/features/community-members/ui/CommunityMembersSettingsCard.tsx` |
| App | `agents` | Agents | Bot | `managed-agents` (fails open) | `AgentsSettingsPanel.tsx` |
| | `compute` | Compute | Cpu | – | `D/features/mesh-compute/ui/MeshComputeSettingsCard.tsx` |
| | `experimental` | Experiments | FlaskConical | – | `ExperimentalFeaturesCard.tsx` |
| | `mobile` | Mobile | Smartphone | – | `MobilePairingCard.tsx` |
| | `updates` | Updates | Download | – | `D/features/settings/UpdateChecker.tsx` |
| *(none)* | `moderation` | Moderation | ShieldAlert | card self-gates | `ModerationQueueCard.tsx` — URL-only (`SettingsPanels.tsx:211-215`) |

**Gates (V)**

- A feature gate hides a section only if `getFeature(gate)` exists **and** resolves to disabled. The ids above are absent from `preview-features.json:4-39`, and `D/protectedFeatures/public.ts:7` is empty, so those sections always show.
- The role gate for Invites is `canManageCommunityMembers` (owner/admin) (`D/shared/api/relayMembers.ts:41-46`; `SettingsView.tsx:147-151`).
- Sidebar states for the membership lookup (`SettingsView.tsx:248-285`):
  - pending: "Checking invite permissions…"
  - error: "Invite settings could not be checked." with "Try again"
  - missing snapshot: an amber warning.
- The footer shows the app version from `getVersion()` (`:164-166, 305-315`).

### 2.3 Per-section controls

The controls of each section in scope are described in §§3–14. The excluded sections are summarised in §22. In every section the page starts with a `SettingsSectionHeader`, a single `h1` plus a description (`SettingsSectionHeader.tsx:16-27`).

---

## 3. Profile

### 3.1 Fields (V)

| Field | Editable | Evidence |
|---|---|---|
| Display name | yes (trimmed) | `ProfileSettingsCard.tsx:697-718, 249` |
| About / description | yes; can be cleared | `:730-756, 251` |
| Avatar | yes: image upload or URL, emoji, or animated | `D/features/profile/ui/ProfileAvatarEditor.tsx:95, 601-735` |
| Public key | read-only, with copy | `ProfileSettingsCard.tsx:788-795` |
| NIP-05 | read-only ("Not set" when empty), with copy | `:306, 796-801` |
| Private key | reveal and backup row | `:802` → `PrivateKeyBackupRow.tsx` |

- Clearing the name or avatar is **not supported**. The UI says so (`:279-285, 848-857`).
- Other kind:0 fields (lud16, banner, website) have no UI.

### 3.2 Flow (V)

**Edit, save and cancel**

- A single **Edit/Done** toggle (`:96-132, 416-442`). There is no Cancel and no Save button.
- The payload includes only changed, non-empty name and avatar, plus `about` whenever it changed (`:252-277`).
- No length or format validation in the client. The server stores `display_name` as `VARCHAR(255)` (`M/0001_initial_schema.sql:158`).
- Success toast: "Profile saved" (`:405`). Errors appear as inline red banners (`:493-503`).

**Path from click to database**

- Client: `useUpdateProfileMutation` → `invoke("update_profile")` (`D/features/profile/hooks.ts:529-535`).
- Rust `update_profile` reads the current kind:0, merges the change and writes it back (`T/commands/profile.rs:39-99`). But `build_profile` serializes **only** `display_name`, `name`, `picture`, `about` and `nip05`, so any other existing kind:0 keys are **lost on every save** (`T/events.rs:428-453`).
- Transport is HTTP `POST /events` to the **active community's relay only** (`T/relay/submit.rs:71-78`; `C/buzz-relay/src/router.rs:73`).
- The relay checks `UsersWrite` scope and that the content is JSON (`C/buzz-relay/src/handlers/ingest.rs:439, 3013-3020`).
- The side effect `handle_kind0_profile` treats kind:0 as absolute state and syncs the `users` row, which is keyed by `(community_id, pubkey)` (`C/buzz-relay/src/handlers/side_effects.rs:1201-1290`; `M/0001:154-179`).

**Caching**

- The mutation is not optimistic. The cache is set from the server's answer on success, dependent queries are invalidated, and a localStorage copy is kept under `buzz-self-profile.v1:<relay>:<pubkey>` (`D/features/profile/hooks.ts:536-578`; `lib/selfProfileStorage.ts:17, 70-71`).

### 3.3 Avatar (V)

- **Upload:** only gif, jpeg, png and webp are accepted (`D/features/profile/useAvatarUpload.ts:6-11, 52-55`). Bytes go to `upload_media_bytes`.
- **Processing in Rust:** a MIME deny-list (SVG, scripts and executables are refused) and metadata stripping. There is **no resize** (`T/commands/media.rs:125-139, 200-295`).
- **Upload endpoint:** Blossom `PUT {relay}/upload` (falls back to `/media/upload`), authorised by a kind 24242 event (`media.rs:362-382, 408-473`).
- **Relay limits:** 50 MB for images, 10 MB for GIFs (`C/buzz-relay/src/config.rs:850-857`).
- **Emoji avatar:** an inline `data:image/svg+xml` URL (`ProfileAvatarEditor.utils.ts:256-263`).
- **Animated avatar:** stored as `<poster>#buzz-anim=<url>` (`D/shared/lib/animatedAvatar.ts:7-28`).

### 3.4 Scope and permissions

- **Community-scoped (V):** the profile is published only to the active relay, the database row is per community, and each community's onboarding asks for a profile again. No code republishes the profile to other communities (I).
- Only the key holder can edit, because the event is signed by the local key (V).

### 3.5 Key backup (mechanism only, V)

- **Reveal:** `get_nsec` returns the secret over IPC to the webview, which shows it masked (`PrivateKeyBackupRow.tsx:86-111`; `T/commands/identity.rs:190-196`).
- **Encrypted backup:** NIP-49 `ncryptsec`, scrypt `log_n = 18`, 12-character minimum passphrase, file written with owner-only permissions (`T/key_backup.rs:18-60`; `identity.rs:219-334`).
- **Sign out / Delete my data:** clears all local and session storage (`SignOutSection.tsx:112-113`).

---

## 4. Appearance

**Where it lives:** the Theme and Preferences groups in `SettingsPanels.tsx:421-800` and `AppearanceSettingsControls.tsx`. The provider is `ThemeProvider` with `defaultTheme="buzz"` (`D/main.tsx:91`).

| Setting | Control | Default | Storage key | Scope | Mechanism |
|---|---|---|---|---|---|
| Color mode System / Light / Dark | SegmentedControl (`SettingsPanels.tsx:669-692`) | System (fresh install) | `buzz-follow-system` (`ThemeProvider.tsx:37, 647-650`) | **per community** (below) | `matchMedia` plus Tauri `onThemeChanged` (`ThemeProvider.tsx:586-626`) |
| Theme style (62 Shiki themes) | preview button plus expandable tile grid (`SettingsPanels.tsx:561-750`) | `buzz` | `buzz-theme`, plus FOUC cache `buzz-theme-cache` (`ThemeProvider.tsx:26-27, 467-472, 636-640`) | per community | inline CSS vars on `:root`; `light`/`dark` class; `data-buzz-theme` and `data-buzz-sidebar` (`:262-275, 437-450`); `D/shared/styles/globals/theme.css:196-635`; pre-React script in `desktop/index.html` |
| Accent color | 10 swatches; hidden for Buzz themes (`AppearanceSettingsControls.tsx:654-717`) | `#3b82f6` | `buzz-accent-color` | per community | `--primary`, `--sidebar-*` and related vars (`ThemeProvider.tsx:198-259`) |
| Glass background | Switch; hidden on Linux, disabled on non-Mac (`AppearanceSettingsControls.tsx:396-468`) | off | `buzz-glass-background` | device | Tauri `set_window_vibrancy` (`T/commands/window_vibrancy.rs:38`); `data-glass-background` (`theme.css:651-714`) |
| Glass opacity | slider with reset | 65 (range 30–90) | `buzz-glass-opacity` | device | `--glass-background-opacity` |
| Prominent active tab | Switch; only shown for Buzz themes (`AppearanceSettingsControls.tsx:48-75`) | false | `buzz-prominent-active-tab` | device | `data-prominent-active-tab` (`theme.css:447-462`) |
| Font size Smaller / Default / Larger | SegmentedControl (`:112-128, 209-229`) | default | `buzz.appearance.fontSize` (`D/shared/lib/fontSizePreference.ts:6-7`) | device | `data-font-size` → `--buzz-type-scale` (`typography.css:16-27, 46-52`); applied before React (`main.tsx:130`) |
| Conversation density Compact / Comfy / Spacious | SegmentedControl (`:94-110, 230-251`) | comfortable | `buzz.appearance.conversationDensity` | device | `data-conversation-density` → `--conversation-*` vars (`typography.css:34-66`) |
| Link previews Compact / Rich | SegmentedControl (`:340-376`) | compact | `buzz.appearance.linkPreviewStyle` | device | read in JS by the link-preview components |
| Thread layout Focus / Split | SegmentedControl (`:605-651`) | split | `buzz.channels.threadViewMode` | device ("all communities") | `ChannelPane`, `FocusThreadDrawer` |
| Zoom (shortcuts only) | ⌘+ / ⌘- / ⌘0 | 1.0 (0.75–1.5) | `buzz:text-scale` | device | root `font-size` (`D/app/useWebviewZoomShortcuts.ts:11-98`) |

**Per-community theme (V).** `CommunityThemeController` (`D/app/App.tsx:637`) scopes theme, accent and follow-system per identity and relay:

- **Storage keys** (`D/shared/theme/communityThemePreference.ts:5-63`):
  - value: `buzz-community-theme.v1:<pubkey>:<encoded relay>`
  - pending publishes: outbox key `buzz-community-theme-outbox.v1:…`
  - first-run marker: `buzz-community-theme-migrated.v1:<pubkey>`
- **Schema:** `{version: 1, theme, accent, followSystem}`.
- **Relay sync:** it is also synced to the relay as a kind **30078** event, d-tag `community-theme`, content NIP-44 encrypted to self, published with a 2 s debounce (`communityThemeSync.ts:15-18, 101-136, 216-231`).
- **On switch:** it applies the stored values by writing the global keys (`ThemeProvider.tsx:652-675`).

**Other behaviour (V)**

- **Migrations:** a legacy `buzz-theme` of `light` becomes `catppuccin-latte`; `dark` or `system` become `houston` (`ThemeProvider.tsx:96-109`).
- **Reset:** there is no reset-appearance action, apart from the glass opacity reset button.
- **Preview:** dragging on a segmented control previews without saving; the value is committed on click (`D/shared/ui/segmented-control.tsx:35-41, 196-212`).

---

## 5. Notifications

### 5.1 Settings (V)

- **Storage:** localStorage `buzz-notification-settings.v2:<lowercase pubkey>`, sanitized when read (`D/features/notifications/hooks.ts:38, 93-157, 198-200`).
- **Controls:** `NotificationSettingsCard.tsx:84-302`.

| Setting | Default |
|---|---|
| Desktop alerts | **on**; forced off if OS permission is denied or unsupported (`hooks.ts:57, 236-243`) |
| Notify while viewing | off; disabled unless desktop alerts are on (`:59`) |
| Home badge | on (`:58`) |
| Sound (master switch) | derived from the slots (`card:56-60`, `hooks.ts:314-345`) |
| Per-slot alerts: dm, mention, thread_reply, needs_action | on (`lib/sound.ts:95-104`) |
| Agent job slots (job_*) | "Coming soon", disabled |
| Per-slot sound | `flutter` (12 sounds available) |

- **Scope:** per identity, per device. **No per-community switch** — community A cannot be on while B is off. The only per-community lever is channel mutes (V for the key; I for the absence of a per-community UI).

### 5.2 Event sources and decision logic (V)

1. **Feed (mentions and needs-action)**
   - Polled every 30 s through `get_feed` (`D/features/home/hooks.ts:8-38`; `T/commands/messages.rs:49-104`).
   - The first load only seeds a "seen" set, so there is no backlog burst.
   - Mentions still notify in muted channels; other items do not.
   - There is no active-channel suppression on this path.
   - Seen set: `buzz-home-feed-seen.v1:<pubkey>` (`use-feed-desktop-notifications.ts:29-222`).
2. **Live per-channel WebSocket, for DMs and thread replies** (`useLiveChannelUpdates.ts:195-323`)
   - Skipped: backlog events, your own messages, and the active channel unless Notify while viewing is on.
   - `shouldNotifyForEvent` (`lib/shouldNotify.ts:28-76`) applies mute, thread-follow and mention rules.
3. **Reminders and community join alerts** (join alerts are owner/admin only) (`useReminderNotifications.ts:79-115`; `useCommunityJoinAlerts.ts:367`).
4. **Background communities:** unread counts only, **no OS alerts** (`communityUnreadObserver.ts:281-292`) (I).

### 5.3 OS integration (V)

- **Plugin:** `@tauri-apps/plugin-notification` with capability `notification:default`.
- **Permission:** macOS uses custom commands (`T/macos_notifications.rs:161-210`); other platforms use the plugin (`D/features/notifications/lib/desktop.ts:130-192`).
- **Showing a notification:**
  - Linux: `show_native_notification` via notify_rust (`T/commands/notifications.rs:23-80`).
  - macOS: `UNUserNotificationCenter`.
  - Windows: `new window.Notification(…, {silent: true})` (`desktop.ts:418-474`).
- **Sound:** played by the app through HTMLAudio `/sounds/<name>.mp3` after the notification is shown (`lib/sound.ts:160-185`).
- **Dock attention:** `requestUserAttention` when the window is unfocused.

**Click handling**

- Payload: `{channelId, channelName, content, createdAt, eventId, kind, pubkey, threadRootId}`, with **no community id** (`lib/target.ts:11-44`).
- Routing:
  - no channel → Home;
  - has an eventId → `openSearchHit`;
  - otherwise → `goChannel` (`D/app/AppShell.helpers.ts:124-215`).
- Whether Windows delivers click events is **UNKNOWN**.

**Badges**

- Home badge = mentions + needs-action + unread activity (`hooks.ts:461-521`).
- Dock badge = unread channel notifications + home badge (`D/app/useAppShellLifecycleEffects.ts:73-90`).
- Dock badge on Windows is **UNKNOWN**.

---

## 6. Keyboard Shortcuts

**Registry (V)**

- `KEYBOARD_SHORTCUTS` in `D/shared/lib/keyboard-shortcuts.ts:24-257` (categories: Navigation, Messages, Formatting, Zoom).
- Displayed **read-only** by `KeyboardShortcutsCard.tsx` ("Shortcuts are read-only", `:42`).
- Not customizable and not persisted.
- Mac vs Windows keys are chosen by `isMacPlatform()` (`D/shared/lib/platform.ts:6-42`).

| Shortcut (Mac / Win) | Action | Real handler | Status |
|---|---|---|---|
| ⌘K / Ctrl+K | Quick search (or insert link when text is selected in the composer) | `D/app/useAppShellKeyboardShortcuts.ts:73-77`; `useRichTextEditor.ts:482-504` | bound; the composer takes it first |
| ⇧⌘O | Browse channels | `useAppShellKeyboardShortcuts.ts:91-95` | bound |
| ⇧⌘K | New DM | `:79-83` | bound |
| ⇧⌘N | New channel | `:85-89` | bound |
| ⌘, / Ctrl+, | Toggle Settings | `D/app/useSettingsShortcuts.ts:19-44` (capture phase) | bound |
| ⌘[ ⌘] / Alt+← Alt+→ | Back / forward | `D/app/navigation/backForwardChords.ts:18-51` | bound; also mouse X1/X2 |
| ⌘F | Find in channel | `useAppShellKeyboardShortcuts.ts:67-71` | only in a channel |
| ⇧⌘A | Home | `:97-100` | bound |
| ⌘S / Ctrl+S | Toggle sidebar | `D/shared/ui/sidebar.tsx:206-219` | no visible effect inside Settings (I) |
| Esc / ⇧Esc | Mark current as read / mark all as read | `D/app/useMarkAsReadShortcuts.ts:22-57` | ⇧Esc inside Settings stops Esc from closing it (I) |
| Esc | Close dialog | Radix; `SettingsView.tsx:180-190` | listed twice on the card |
| ⌘+ ⌘- ⌘0 | Zoom | `D/app/useWebviewZoomShortcuts.ts:24-146` | bound |
| Enter / Shift+Enter | Send / new line | `useRichTextEditor.ts:281-328` | bound |
| ⇧⌘M | Always address agent | `useAlwaysAddressShortcut.ts:27-50` | bound (agent feature) |
| ⌘Enter | Publish note | **no handler found** | **mismatch** (I) |
| Ctrl+Shift+Space | Toggle huddle | `useAppShellKeyboardShortcuts.ts:39-54` | bound (voice feature) |
| Ctrl+Space | Push-to-talk (global) | `T/ptt_shortcut.rs:119-146` | bound only during a huddle |
| ⌘B ⌘I ⌘E | Bold / italic / code | TipTap defaults | **UNKNOWN** (node_modules absent) |
| ⌘⇧X | Strikethrough | **no handler found** | **mismatch** (I); TipTap's default is Mod-Shift-S |

**Bound but not listed on the card (V)**

- ⌘R: reload (`D/app/useReloadShortcut.ts:9-34`)
- ⌘W: hide window, Mac only (`useCloseWindowShortcut.ts:19-55`)
- ⌘J / Ctrl+J: terminal panel (`D/features/terminal/TerminalBootstrap.tsx:147-167`)
- ⌘⇧V: paste as plain text (`useRichTextEditor.ts:456-480`)
- ArrowUp in an empty composer: edit your last message (`:506-520`)
- Mac Emacs keys Ctrl-A/E/B/F/K (`macEmacsTextShortcuts.ts:37-70`)

**Conflict handling (V):** handlers skip events that are `defaultPrevented` or repeats; Settings uses capture phase plus `stopImmediatePropagation`; Esc defers to any open "escape surface" (`D/shared/hooks/escapeSurfaces`).

---

## 7. Custom Emoji

**Model (V)**

- NIP-30. Each member publishes **their own** kind **30030** set with `d = "buzz:custom-emoji"` and tags `["emoji", shortcode, url]` (`D/shared/api/customEmoji.ts:1-29, 171-186`).
- The community palette is the **client-side union** of every member's set on the active relay.
- On a shortcode conflict, the newest `created_at` wins; on a tie, the smaller URL wins (`:118-155`).

**Flow (V)**

1. **Upload:** `pick_and_upload_media`, a multi-select dialog with **no file filter**; only the first blob is used (`T/commands/media.rs:623-652`; `CustomEmojiSettingsCard.tsx:56-84`).
   - A non-image is rejected **after** upload, so it still reaches the media server (I).
2. **Processing:** same MIME deny-list and metadata strip as avatars; HEIC is converted to JPEG; **no resize** (`media.rs:560-581`).
3. **Storage:** Blossom `/upload` with a kind 24242 auth event (`media.rs:408-473`). Relay caps: 50 MB for images, 10 MB for GIFs.
4. **Naming**
   - Client: `[a-z0-9_-]`, at most 64 characters, lowercased, surrounding colons stripped; a name is suggested from the filename (`customEmoji.ts:45-77`).
   - Relay: checks only the shortcode (`C/buzz-relay/src/handlers/ingest.rs:145-158, 3023-3025`; `C/buzz-sdk/src/builders.rs:124-155`). **The URL is not validated.**
5. **Add / remove:** read-modify-write of your own set, then sign and publish (`customEmoji.ts:157-225`).
   - A duplicate in your own set replaces the old image, and the UI warns first (`CustomEmojiSettingsCard.tsx:47-49, 237-244`).
   - Only the author can remove an emoji; other members' emoji are read-only.
   - No blob is deleted (I).
6. **Caching**
   - Palette: polled every 20 min while the window is focused; stale after 5 min (`D/features/custom-emoji/hooks.ts:31-60`).
   - A live subscription to kind 30030 invalidates the palette (`:80-120`).
   - The palette is per community because the query client is per community (`D/app/App.tsx:236, 630`).
7. **Picker:** an emoji-mart "Custom" category (`EmojiPicker.tsx:85-128`).
8. **Composer:** sending a message adds `["emoji", sc, url]` tags (`D/shared/lib/customEmojiTags.ts:22-46`).
9. **Rendering:** uses **the event's own emoji tags**, so old messages survive a later removal (`useMessageEmoji.ts:13-26`; `remarkCustomEmoji.ts:47-140`).
10. **Reactions:** kind 7 with `:sc:` content plus an emoji tag; the URL must be http(s) and at most 2048 bytes (`T/commands/messages.rs:815-833`; `builders.rs:157-175`).

**Errors (V):** add, remove and upload errors show toasts. Live-subscription errors are only logged to the console.

---

## 8. Local Archive

**What it is (V)**

- **Purpose:** keep copies of relay events in local SQLite, re-verified against the relay (`LocalArchiveSettingsCard.tsx:527-528`).
- **Storage:** rusqlite with **no SQLCipher**, at `~/.buzz/archive/archive.db` (`T/archive/archive_db.rs:79-86`; `T/managed_agents/nest.rs:64-121`). WAL mode.
- **Tables:** `archived_events` (with `raw_json`), `archived_event_scopes`, `save_subscriptions`, `observer_channel_index`, `agent_metric_index`, `archive_meta` and `archive_migrations` (`T/archive/store.rs:20-141`).
- **Default on:** agent observer frames (kind 24200) and agent metrics (kind 44200). Metrics are **decrypted and stored in plaintext** (`T/archive/mod.rs:11-18`; `T/commands/observer_archive.rs:3,16`; `D/app/AppShell.tsx:207-223`).
  - Opt-out flag: `buzz:observer-archive-default-seeded:<pk>`.
- **Opt-in:** per-channel subscriptions for chosen kinds (`localArchiveKinds.ts:26-82`).
- **Sync:** a Rust task with one live subscription per config, batched 25 events or 2 s (`T/archive/sync.rs:1-50`).
- **Retention:** one setting (observer frames, 30 days by default). The prune worker is **not implemented** ("lands in Phase 2", `T/archive/retention.rs:1-32`). Deleting a subscription does not purge its data (`mod.rs:526-529`).
- **Readers:** only the agent observer feed. `readArchivedEvents` has **no consumer** in the UI.
- **Size:** about 5.3k Rust lines (plus about 7k test lines) and about 1.4k frontend lines.
- **Dependencies:** the agent nest directory and agent kinds.

**Privacy (V/I):** full plaintext copies of channel messages and agent metrics sit on disk, with no working retention and no purge.

**Classification: REMOVE.**

1. Its always-on part archives agent data only.
2. Nothing in the UI reads archived channel messages.
3. It is plaintext, with no pruning.
4. It is coupled to agents.

If offline history is wanted later, build a purpose-made encrypted cache instead.

---

## 9. Community Settings

**Where the controls are (V)**

- Name, relay URL, token, repos dir and icon are edited in **`EditCommunityDialog`**, opened from the switcher's "Community settings" item or the rail (`CommunitySwitcher.tsx:312-323, 418-462`; `CommunityRail.tsx:431-438`).
- Members are managed in Settings → Invites. Moderation is URL-only.

**How the role is computed (V)**

1. NIP-11 `/info` — does the relay list NIP 43? (`T/commands/relay_members.rs:19-43`)
2. If so, fetch the kind 13534 membership snapshot and find my pubkey (`D/shared/api/relayMembers.ts:348-384`).
3. On an open relay there is no snapshot, so the role is null.

The client gate is advisory only; the relay re-checks everything.

| Item | Who can see / edit | Transport and storage | Validation and audit | Level |
|---|---|---|---|---|
| Community name | anyone / anyone | localStorage `buzz-communities` (`D/features/communities/communityStorage.ts:6, 102-111`); **never sent to the relay** | non-empty | **DEVICE-LOCAL** |
| Icon | everyone (NIP-11 `icon`) / owner/admin (closed relay; open relay with a steward); any user on an open relay without owner or admin | signed kind **9033** `["icon", dataURL]` (`D/shared/api/communityProfile.ts:473-484`) → `communities.icon` (`M/0003_community_icon.sql:57`; `C/buzz-relay/src/handlers/relay_admin.rs:115-301`) | data URL at most 98,304 bytes, or http(s) URL at most 2,048 chars; ±120 s; banned senders refused; **tracing log only, no DB audit** | **COMMUNITY-LEVEL** |
| Relay URL | local | localStorage; `wss://` added automatically; a duplicate is rejected **but the dialog drops that result and closes anyway** (`EditCommunityDialog.tsx:112-116`) | WebSocket probe | DEVICE-LOCAL |
| API token | local | saved in plain text in localStorage; **dropped by Rust** (`workspace.rs:153-160`) | none | DEVICE-LOCAL, unused |
| Repos dir | local | nest dotfile (`workspace.rs:125-137, 252-260`) | path validation | DEVICE-LOCAL (agent-related) |
| Members and roles | owner/admin | kinds 9030 add, 9031 remove, 9032 change role (`relayMembers.ts:390-433`) → `relay_members` (`M/0001:574-582`) | only an owner grants admin; owner cannot be removed; ownership moves only through operator transfer (`relay_admin.rs:312-476`); relay emits kinds 8000, 8001 and 13534 | COMMUNITY-LEVEL |
| Moderation | owner/admin | reads: NIP-98 `/moderation/*`; writes: kinds 9040–9044 (`D/shared/api/moderation.ts:129-375`) | `moderation_authz.rs:1-47`; `moderation_actions` table | COMMUNITY (and CHANNEL for delete/kick) |
| Leave community | members; the owner cannot leave | kind **28936** `["-"]` (`leaveCommunity.ts:7-87`) → deletes the `relay_members` row (`ingest.rs:2584-2658`) | local cleanup happens only after the relay accepts | COMMUNITY + DEVICE |
| Remove community (local) | anyone | clears local caches and picks a fallback community (`useCommunities.tsx:226-271`) | icon cache is not cleared | DEVICE-LOCAL |

**Operator role:** no desktop surface. Operators are a deployment-wide roster (`M/0035_relay_operators.sql`; `C/buzz-relay/src/api/admin/mod.rs:60-62`).

---

## 10. Invites

### 10.1 Creating an invite (owner/admin) (V)

- **Where:** Settings → Invites → "Invite to community" opens `InviteLinkSection` (`CommunityMembersSettingsCard.tsx:307-386`).
- **Options:** expiry 1, 3, 7 or 30 days (default 3); max uses unlimited, 1, 3, 5, 10 or 25.
- **Minting is automatic:** a link is minted when the dialog opens and again whenever an option changes (`InviteLinkSection.tsx:19-35, 96-133`).
- **Request:** `POST /api/invites`, NIP-98 kind 27235 with a payload hash, body `{ttl_secs?, max_uses?}` (`D/shared/api/invites.ts:17-104, 194-217`).
- **Server checks** (`C/buzz-relay/src/api/invites.rs:230-353`):
  - host-bound tenant; NIP-98 required and replay-checked;
  - role must be owner or admin, else **403**;
  - TTL 60 s to 30 days (default 72 h); `max_uses` 1 to 10,000;
  - 503 while the community is quiescing.
- **Code:** `v2.` + base64url of 32 random bytes. **Only SHA-256(code) is stored** (`C/buzz-db/src/store/relay_invite.rs:99-151`; `C/buzz-core/src/invite.rs:34-57`).
- **Response:** `{code, expires_at, max_uses, uses_remaining, url}`, where `url = https://<host>/invite/<code>`.
- **Table:** `relay_invites(community_id, id, token_hash, role='member', max_uses, use_count, expires_at, created_by, created_at)` (`M/0025_relay_invites.sql:18-33`).
- **Cleanup:** a job deletes invites more than 30 days past expiry (`C/buzz-relay/src/main.rs:1727-1740`).
- **List and revoke: NOT PRESENT.** Legacy v1 HMAC codes are still accepted on claim and can only be revoked by rotating the relay key.
- **Sharing:** copy to clipboard.

### 10.2 Using an invite (recipient) (V)

1. `https://host/invite/<code>` opens the web `InvitePage` (`web/src/features/invite/ui/InvitePage.tsx:82-134`).
2. That page reads `/api/join-policy`, optionally calls `/api/invites/accept-policy` (no auth; returns an HMAC receipt), then redirects to `buzz://join?relay&code&policy_receipt`.
3. The desktop deep link is parsed; relay must be ws or wss (`T/deep_link.rs:340-365, 603-657`).
4. If identity setup isn't finished, the invite waits behind `PendingInviteGate` (`D/app/App.tsx:775-796`).
5. Onboarding transaction: `buzz-community-onboarding-transaction.v1`, stage `claiming` (`D/features/onboarding/communityOnboarding.tsx:8, 149-193`).
6. **Claim request:** `POST /api/invites/claim`, NIP-98, body `{code, policy_receipt}` (`D/shared/api/invites.ts:223-242`).
7. **Claim handling on the relay** (`invites.rs:361-457`; `relay_invite.rs:203-397`):
   - Exempt from the membership gate.
   - Rate limit: 10 per minute per (community, pubkey).
   - One transaction with `SELECT … FOR UPDATE` returns Invalid, Expired, AlreadyMember, Exhausted or Joined.
   - On Joined it inserts `relay_members(role 'member', added_by 'invite')`, then emits kinds 8000 and 13534.
8. **Client:** friendly messages for `invite_expired` and `invite_exhausted`, then add and switch to the community; NIP-42 now passes.

### 10.3 Invite URL vs relay URL (V)

- `parseInviteInput` accepts `http(s)://host/invite/<code>`, `buzz://join?…` and a bare code. It rejects ws/wss URLs and URLs containing credentials or fragments (`D/shared/api/inviteHelpers.ts:26-77`).
- **Bug:** in Add-community mode a bare code is treated as a relay host (`InviteRedeemForm.tsx`).
- The web invite page hard-codes `buzz://`, but demo builds register `buzz-demo-{slug}` (I).

---

## 11. Add Community

**Supported inputs (V):** relay URL; invite URL or code; key import (only on the membership-denied screen). There is no discovery or directory (I: none found).

**Steps (V)**

1. `AddCommunityDialog` offers Create (Builderlab-hosted) or Join (`AddCommunityDialog.tsx:133-193`).
2. Validation: `normalizeRelayUrl` (`relayProbe.ts:6-54`), join-policy fetch, age and terms checkboxes.
3. `addCommunity` saves to localStorage `buzz-communities`, de-duplicated by relay (`useCommunities.tsx:191-217`).
4. `switchCommunity` saves `buzz-active-community-id`, and `apply_workspace` sets the Rust relay override (`workspace.rs:215-218`).
5. NIP-42 auth runs; the relay's membership gate answers "restricted: not a relay member" to non-members (`C/buzz-relay/src/handlers/auth.rs:218-240`).
6. A profile check follows (10 s).

**If you are NOT a member (V)**

- The community is already in the local list (`App.tsx:466`).
- `MembershipDenied` offers retry, change community, import key, or redeem an invite.
- Cancel removes the community (if newly added) or switches back.

---

## 12. Community Switching

**How it works (V)**

- **Transition** (`D/app/useCommunityNavigationTransitions.ts:48-72`): save the current destination (`buzz-community-destinations`), go Home as a barrier, mark the pending restore, then `switchCommunity`.
- **Isolation by remount:**
  - `communityKey = id-reinitKey-pubkey-signerEpoch` (`App.tsx:407`).
  - A **new React Query client per community**, and `AppReady` is keyed by it (`App.tsx:218-242, 620-662`).
  - `CommunitySwitchGate` is shown until the switch is applied.
- **Sockets:**
  - One active `relayClient` singleton (`D/shared/api/relayClient.ts:3`).
  - Inactive communities are polled every 30 s with a throwaway `ReadOnlyRelayClient` (`useCommunityUnread.ts:9, 50`).
  - Rust keeps one relay override, with a generation counter (`workspace.rs:13-37, 166-170`).
- **Singleton reset:** `resetCommunityState()` (`D/features/communities/useCommunityInit.ts:59-99`) disconnects the relay and resets: deep-link queue, rate-limit gate, drafts, agent state, tray, avatars, media caches, toasts, search and markdown caches. The contract is written down in `AGENTS.md:612-634`.

**Relevance to SWF (I):** OLD BUZZ gets its isolation mainly by **remounting a whole per-community tree with a fresh query client**. SWF Buzz keeps one query client and instead uses community-scoped keys plus a session generation (`swf buzz/docs/COMMUNITY_SWITCH_RUNTIME_CLOSURE.md`). Both approaches are valid. OLD BUZZ's reset list is a useful checklist of singletons to cover.

---

## 13. Mobile Pairing

**Protocol: NIP-AB** (spec `C/buzz-core/src/pairing/NIP-AB.md`; Tamarin model `NIP-AB.spthy`) (V)

1. **Start:** "Start pairing" → Tauri `start_pairing` (`MobilePairingCard.tsx:265-288`; `T/commands/pairing.rs:116-152`).
   - Starts are serialized with a generation counter.
2. **Pairing relay:** chosen via NIP-11 `pairing_relay_url`, else `<relay>/pair`, else the main relay (`pairing.rs:677-747`).
   - The relay advertises it from `BUZZ_PAIRING_RELAY_URL`.
3. **Session:** a fresh ephemeral keypair, a 32-byte random `session_secret`, and `session_id = HKDF(secret, "nostr-pair-session-id")` (`C/buzz-core/src/pairing/session.rs:112-141`; `crypto.rs:54-56`).
4. **Payload for SendIdentity mode:** `{relayUrl, pubkey, nsec}` — **the full long-term secret key**, held in `Zeroizing` (`pairing.rs:139-152`).
5. **QR:** `nostrpair://<ephemeral_pubkey_hex>?secret=<hex>&relay=<ws(s)…>&v=1`, plus `&mode=recover` for recovery (`C/buzz-core/src/pairing/qr.rs:14-220`).
   - "Copy pairing code" puts this URI, **including the session secret**, on the clipboard (I).
6. **Transport:**
   - Kind **24134** (ephemeral), NIP-44 v2 between the two ephemeral keys, one `p` tag, `created_at` jittered 0–30 s (`session.rs:603-628`; `C/buzz-core/src/kind.rs:455-465`).
   - Message types: `offer`, `sas-confirm`, `payload`, `complete`, `abort` (`types.rs:20-58`).
   - Optional NIP-42 auth with the ephemeral key.
7. **Pair-relay sidecar** `C/buzz-pair-relay`: stateless, no auth. Enforces kind and `p`-tag rules, signature, ±120 s, 300 s dedup, 4 KiB frames, and rate limits (`lib.rs:59-89, 418-500`).
8. **SAS code:** `HKDF(ecdh, salt=secret, "nostr-pair-sas-v1")` → first 4 bytes mod 10⁶ = 6 digits (`crypto.rs:70-118`).
   - The desktop shows it; the user taps "Codes match".
   - The desktop then sends `sas-confirm` (transcript hash) followed by the payload (`pairing.rs:183-226`).
   - The mobile checks the transcript hash; a mismatch aborts with "possible attack" (`mobile/lib/features/pairing/pairing_provider.dart:558-586`).
9. **Mobile import:**
   - SSRF guard (https only in release; private IPs blocked).
   - NIP-42 check against the relay.
   - Saves to `flutter_secure_storage` key `buzz_communities`.
   - Sends `complete{true}` (`pairing_provider.dart:694-960`).
10. **Expiry and replay:**
    - Session times out after 120 s (the desktop enforces 130 s).
    - Processed event ids are tracked, and a state machine rejects out-of-order steps.
    - New secret on every start; secrets are zeroized (`session.rs:42-43, 490-760`).
11. **Paired devices:** **no record is kept.** Each pairing is a new session.
12. **Recovery mode:** the phone sends its nsec to a fresh desktop (`pairing.rs:99-108, 462-532`).
13. **Legacy format:** the mobile app still accepts `buzz://<base64 JSON {relayUrl, pubkey, nsec}>`, i.e. an **unencrypted nsec in a QR** (`pairing_provider.dart:130-135, 894-921`).

**Security implication for SWF (I):** SWF keeps the private key in the OS keyring and signs only in Rust. OLD BUZZ pairing deliberately exports that key to another device. Adopting it is a **security and product decision** (§22, §23).

---

## 14. Software Updates

**How it works (V)**

- **Build gate:** `cfg(buzz_updater_enabled)` is set only when **both** `BUZZ_UPDATER_PUBLIC_KEY` and `BUZZ_UPDATER_ENDPOINT` exist at build time (`desktop/src-tauri/build.rs:128-139`). The plugin registers only then, and only in non-debug builds (`T/lib.rs:209-215`).
  - The base config has `endpoints: []` and no pubkey (`desktop/src-tauri/tauri.conf.json:43-45`).
  - The release overlay is written by `desktop/scripts/build-release-config.mjs:27-53`.
- **Endpoint:** `https://github.com/block/buzz/releases/download/buzz-desktop-latest/latest.json` (`.github/workflows/release.yml`).
- **Keys:** updater public key and signing private key are in CI secrets (present, redacted).
- **Manifest:** `{version, notes, pub_date, platforms: {<key>: {signature, url}}}`, platforms `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `windows-x86_64` (`desktop/scripts/generate-oss-latest-json.sh:39-44`).
- **Hook states:** idle, checking, up-to-date, unavailable, available, downloading, installing, ready, error, manual-required (`D/features/settings/hooks/use-updater.ts:6-21`).
- **Schedule:** checks on mount and every **6 h**.
- **Download is automatic, install is a click:**
  - After a successful check it **downloads automatically** (`use-updater.ts:79-99, 154-162`).
  - **Install requires a click**, then `relaunch()` (`:101-122`). The click can come from `UpdateChecker.tsx:142-152`, `SidebarUpdateCard.tsx:39-63` or `UpdateIndicator.tsx:82-88`.
- **Platforms:** auto-update on macOS and Windows; on Linux only for AppImage. Otherwise the state is `manual-required` with a GitHub link (`T/commands/updater.rs:11-24`; `use-updater.ts:163-173`).
- **Missing plugin:** reported as `unavailable`. Background-check errors are silent (`use-updater.ts:39-44, 177-195`).
- **Signature and version checks:** done by the Tauri plugin (standard behaviour; no custom code) (I).
- **Versions:** tags `desktop-v<semver>`; current version is 0.5.23.
- **Channels:** effectively one stable channel. Prereleases are never promoted; promotion is manual through `scripts/promote-oss-desktop-release.sh`, which refuses downgrades.
- **Sidebar card:** shown for ready, installing and manual-required. Dismissing it is not persisted (`sidebarUpdateCardVisibility.ts:1-7`).

**Answer:** OLD BUZZ has a **real, signed auto-update pipeline**: automatic download plus a user-confirmed install. It is not just an informational check, but only in release builds that were given the two updater env values.

---

## 15. Send Feedback — Complete E2E Flow

### 15.1 UI (V)

- **Only entry point:** profile popover → **"Send feedback"**, between the community switcher and Settings (`D/features/profile/ui/ProfilePopover.tsx:257-272`).
  - No Settings entry, no Help entry, no shortcut.
  - Not present in the web client or in mobile.
- **Component chain:** `AppShell.tsx:142` (state) → `AppSidebar` → `SidebarProfileCard` → `ProfilePopover` → `AppShell.tsx:988` → `SendFeedbackController.tsx:11-25` → **modal** `SendFeedbackDialog.tsx`.

| Field | Rules |
|---|---|
| Category | optional single choice: `bug`, `praise`, `needs-work` (`SendFeedbackDialog.tsx:26-39, 109-119`) |
| Message | **required**; trimmed; **no client maximum** (`:135-141, 234-244`) |
| Image attachment | one optional image; **uploaded as soon as it is picked**; a cancelled attachment is not deleted (I) (`useSendFeedback.ts:57-87`; `T/commands/media.rs:664-690`) |
| Attach diagnostics | off by default; a text file with capture time, app version, `navigator.platform`, user agent and language; **no logs** (`useSendFeedback.ts:13-29, 106-115`) |
| Email | **none** |

- **Disclosure shown to the user:** "sent privately to this Buzz deployment" (`SendFeedbackDialog.tsx:170-171`).

### 15.2 Transport (V)

- A **Nostr event of kind 42000** (`D/shared/constants/kinds.ts:12`; `C/buzz-core/src/kind.rs:329-331`), with this shape:

```json
{
  "kind": 42000,
  "content": "<trimmed message + markdown media lines>",
  "tags": [["category", "bug|praise|needs-work"], ["imeta", "url …", "m …", "x <sha256>", "size …"]],
  "pubkey": "<user>", "created_at": 0, "id": "…", "sig": "…"
}
```

- **Signing:** by Rust `sign_event` (`T/commands/identity.rs:107-136`).
- **Sending:** `["EVENT", ev]` over the active community's WebSocket (`D/shared/api/relayEventPublisher.ts:39`).
- **Community:** **no community id is sent** — only the category and attachment tags (`useSendFeedback.ts:30-46`).
- **Response:** NIP-01 `["OK", id, true|false, reason]`.
- **Alternative path:** the relay would also accept it through `POST /events` with NIP-98, but the desktop does not use that.

### 15.3 Authentication and checks (V)

- A NIP-42 authenticated socket is required, and the event's pubkey must equal the authenticated pubkey (`C/buzz-relay/src/handlers/event.rs:634-668`).
- Banned users and non-members are blocked at auth (`handlers/auth.rs:161, 218-241`).
- Ingest also requires:
  - `MessagesWrite` scope, the community write fence, a valid signature and a ±15 min timestamp (`handlers/ingest.rs:451, 2186-2284`).
  - Category allowlist, at most one category tag, body non-empty and at most **32 KiB**, tags at most 64 KiB (`handlers/product_feedback.rs:11-97`).
  - `imeta` URLs must be on the tenant's own media host and the blobs must exist (`:23-34`).

### 15.4 Backend and storage (V)

- **Path:** `connection.rs:569-598` → `handlers/event.rs:608` → `ingest.rs:2110/2170` → **`ingest.rs:2290-2307`**: kind 42000 is sent to `product_feedback::handle` and returns **before** normal storage and broadcast.
- **Insert:** `Db::insert_product_feedback` (`C/buzz-db/src/store/product_feedback.rs:60-87, 124-130`), with `ON CONFLICT (event_id)` so a replay is idempotent.
- **Table** `product_feedback` (`M/0017_product_feedback.sql:5-21`; `M/0030:31-47`; `M/0035:48-51`; `schema/schema.sql:827-846`):

| Column | Meaning |
|---|---|
| `id` UUID | row id |
| `community_id` UUID, nullable | community from the **connection host**; set to NULL when the community is deleted |
| `event_id` BYTEA(32), UNIQUE | signed event id |
| `submitter_pubkey` BYTEA(32) | author |
| `category` TEXT | bug / praise / needs-work / NULL |
| `body` TEXT | message |
| `tags` JSONB | category and `imeta` tags |
| `event_created_at`, `received_at` | client-signed and server times |
| `status` TEXT | `new` / `reviewed` / `archived` (default `new`) |

- **Indexes:** `(received_at DESC, id)` and `(community_id, received_at DESC, id)`. The table is registered as deployment-global.
- **Retention:** no TTL (I). Rows **survive community deletion**; that community's attachment blobs are deleted (`C/buzz-db/src/store/deletion.rs:1736-1750`).
- **Rate limiting:** generic per-user WebSocket limits only; nothing specific to feedback (`rejection.rs:49-106`).
- **Duplicates:** idempotent per event id. Re-sending the same text makes a **new row** (I).
- **Notifications, email, webhooks: NONE** (`product_feedback.rs`).
- **Audit rows:** none, for submission or for status changes (`ingest.rs:2302`; `relay_admin_actions.rs:1596-1604`). An admin reading an attachment produces only a `tracing` log line.

### 15.5 Control-plane destination (V)

**admin-web**

- Served **only** when the request's Host equals `BUZZ_ADMIN_HOST` (`C/buzz-relay/src/router.rs:152-229`; `api/admin/auth.rs:99-107`; `config.rs:1040-1077`).
- Pages: `/feedback` (list with client-side search and community, time and status filters) and `/feedback/:id` (detail with attachments) (`admin-web/src/App.tsx:221-379, 516-777`).

**API** under `/api/admin/v1` (`api/admin/mod.rs:53-58`)

| Method + path | Handler | Notes |
|---|---|---|
| `GET /feedback` | `mod.rs:281-315` → `admin_moderation.rs:356-373` | **latest 100 only**, no paging |
| `GET /feedback/{id}` | `mod.rs:317-338` | |
| `GET /feedback/{id}/attachments/{sha256}` | `mod.rs:340-407` | hash must match an `imeta` tag |
| `PATCH /feedback/{id}` `{status}` | `mod.rs:838-883` | operator or moderator |

**Who can read and change it** (`api/admin/auth.rs:188-323`)

- In **nip98** mode, requests are signed through a NIP-07 browser extension. The signer must be one of:
  - a pubkey in `RELAY_OPERATOR_PUBKEYS`;
  - `RELAY_OWNER_PUBKEY`, only when no operators are configured;
  - a `relay_operators` row with role operator or moderator.
- In **disabled** mode, **reads need no credential**, only the right Host/Origin; writes return 403.
- **Community owners and admins cannot see feedback** through their role.
- **CLI:** `buzz-admin product-feedback list --limit N` (`C/buzz-admin/src/main.rs:266-271`).

### 15.6 The complete chain: "If Prakhar sends feedback, where does it end up?"

1. `ProfilePopover.tsx:257-266` — Prakhar clicks "Send feedback".
2. `AppShell.tsx:988` → `SendFeedbackController.tsx:11-25` → `SendFeedbackDialog.tsx:135-141` — he submits the dialog.
3. `useSendFeedback.ts:100-128` — an optional image or diagnostics file is uploaded to `{relay}/upload`, Blossom kind 24242 (`T/commands/media.rs:408-473`).
4. `T/commands/identity.rs:107-136` — Rust signs the kind 42000 event with his key.
5. `relayClientSession.ts:720-742` → `relayEventPublisher.ts:39` — `["EVENT", …]` goes over the **active community's relay WebSocket**.
6. `C/buzz-relay/src/connection.rs:569-598` → `handlers/event.rs:608-761` (NIP-42 pubkey check; community taken from the host) → `handlers/ingest.rs:2290-2307`.
7. `handlers/product_feedback.rs:16-58` → `C/buzz-db/src/store/product_feedback.rs:60-87` writes the row.
8. **Postgres `product_feedback`** now holds his pubkey, the community id, category, body, tags and times, with status `new`.
9. `admin_moderation.rs:356-391` → `api/admin/mod.rs:281-338` (operator/moderator NIP-98 gate) serves it to **admin-web** `/feedback` (`admin-web/src/App.tsx:221-379`), or to the `buzz-admin` CLI.

### 15.7 Role context (V)

| Field | Recorded? |
|---|---|
| owner/admin/member/operator role | **No** — not sent and not derived |
| pubkey | **Yes** (`submitter_pubkey`) |
| community id | **Yes** (from the connection host; NULL after the community is deleted) |
| relay URL | No (the host is joined at read time) |
| device | No |
| timestamp | Yes (`event_created_at`, `received_at`) |
| app version / OS | only inside the optional diagnostics blob, not in the database |

**Can an owner or admin see and resolve feedback?** **No.** Only deployment operators and moderators can, and "resolve" means setting the status to `reviewed` or `archived`, without attribution or an audit trail.

**Gap against the SWF requirement (I).** The requirement is that "the SWF control plane gets the feedback with identity and role". OLD BUZZ delivers identity (pubkey) and community, but **not role**. The role is recoverable at read time by joining `relay_members(community_id, pubkey)`, which the admin API does not do today (see §23).

### 15.8 States (V)

- **Success:** the dialog closes; there is no toast.
- **Failure:** an inline error; the text and attachment are kept so the user can press Send again.
- **Retry:** one automatic reconnect-and-resend; overall timeout 25 s (`relayClientTimings.ts:11`).
- **Offline:** no queue and no saved draft; closing the dialog loses the text.

### 15.9 Privacy (V/I)

- **Operators and moderators** can read feedback from **every** community, including the submitter's pubkey.
- In **disabled** admin-auth mode, anyone who reaches the admin host can read all feedback.
- Attachments are ordinary tenant blobs.
- Uploads made before cancelling are left orphaned.
- There is no TTL.
- Status changes by staff are not audited.

---

## 16. Authentication & Authorization Matrix

| Action | Member | Admin | Owner | Operator/Moderator | Mechanism |
|---|---|---|---|---|---|
| Edit own profile (kind 0) | ✓ | ✓ | ✓ | – | own signature, `UsersWrite` |
| Custom emoji: add / remove own | ✓ | ✓ | ✓ | – | own 30030 set |
| Community name / relay / token (local) | ✓ | ✓ | ✓ | – | device only |
| Community icon (9033) | ✗ (✓ on open relays with no owner/admin) | ✓ | ✓ | – | `relay_admin.rs:115-279` |
| Mint invite | ✗ | ✓ | ✓ | – | `invites.rs:291-304` |
| Claim invite | any authenticated key | | | | exempt from the membership gate |
| Add member (9030) | ✗ | ✓ (member role only) | ✓ (admin or member) | – | `relay_admin.rs:312-476` |
| Remove member (9031) | ✗ | members only | ✓ (not the owner) | – | same |
| Change role (9032) | ✗ | ✗ | ✓ (not to owner) | ownership transfer only | same |
| Moderation reads / actions | ✗ | ✓ | ✓ | – | `moderation_authz.rs` |
| Leave community (28936) | ✓ | ✓ | ✗ | – | `ingest.rs:2626-2640` |
| Send feedback (42000) | ✓ | ✓ | ✓ | ✓ | NIP-42 + `MessagesWrite` |
| Read feedback | ✗ | ✗ | ✗ | ✓ (+ `RELAY_OWNER_PUBKEY` fallback) | `api/admin/auth.rs:188-312` |
| Change feedback status | ✗ | ✗ | ✗ | ✓ | `require_mutation_principal` |
| Mobile pairing / updates / appearance / notifications / shortcuts | device-local, any signed-in user | | | | – |

---

## 17. Identity vs Community vs Device Scope

| Scope | Items |
|---|---|
| **IDENTITY-LEVEL** (follows the key) | keypair and NIP-05 display; notification settings (per pubkey, but saved per device); home-feed seen set; key backup |
| **COMMUNITY-LEVEL** (relay state) | profile kind 0 (per relay); icon 9033; members and roles; invites; moderation; custom-emoji palette (union of 30030 sets per relay); community theme sync (30078, encrypted to self); product feedback (tagged with the community) |
| **CHANNEL-LEVEL** | channel mutes; moderation delete/kick by channel owner/admin |
| **DEVICE-LOCAL** | community list (name, relay, token, repos dir); font size; density; link previews; thread layout; glass; prominent tab; zoom; sidebar width; feature overrides; local archive; update state; per-community theme cache |

---

## 18. UI/UX Reference

### 18.1 Structure (keep this information architecture)

- **Full-screen route.** Left: a Settings sidebar (shadcn `Sidebar`, offcanvas) with "Back to app", status banners, grouped nav (`aria-label="<Group> settings sections"`) and a version footer. Right: an inset content panel (`SettingsView.tsx:213-365`).
- **Page pattern:** `SettingsSectionHeader` (one `h1` plus a description) → `SettingsOptionGroupList` (`space-y-12`) → `SettingsOptionGroup` (optional `h2`, description, action, then a card) → `SettingsOptionRow` (label and sub-copy on the left, control on the right) (`SettingsOptionGroup.tsx:24-81`).
- **Nav buttons:** `aria-pressed`, `isActive` and a tooltip. Switching sections replaces the history entry. Escape closes.
- **Responsive:**
  - Below 768 px the sidebar becomes a 288 px `Sheet`, but **no trigger is rendered**, so section navigation is only reachable with ⌘S (I).
  - Rows stack vertically when their container is at most 34rem (container query).
- **Scrolling:** only the content pane scrolls. The theme grid has its own scroll area (`max-h-[430px]`).
- **Motion:** a fade on entry; reveals respect reduced motion.

### 18.2 Visual implementation (reference, not to copy 1:1)

| Element | OLD BUZZ value | Evidence |
|---|---|---|
| Component library | shadcn "new-york", zinc base, CSS vars; lucide icons; Sonner toasts | `desktop/components.json`; `D/shared/ui/*` |
| Sidebar width | 300 px default, 420 max, draggable | `D/shared/ui/sidebar.tsx:30-107` |
| Content surface | `rounded-2xl bg-background shadow-content-edge` inside `bg-sidebar`; inner `max-w-4xl`, `px-5 sm:px-6 pt-6 pb-12` | `SettingsView.tsx:320-346` |
| Page title | `text-2xl font-semibold tracking-tight`; description `text-base text-muted-foreground/70`, `mb-12` | `PageHeader.tsx:28`; `SettingsSectionHeader.tsx:16-27` |
| Group title | `text-sm font-semibold text-muted-foreground/70` | `SettingsOptionGroup.tsx:24-38` |
| Card | `rounded-xl border border-border/70 bg-background/70 divide-y divide-border/55` | `:46-52` |
| Row | `min-h-16 px-4 py-3 text-sm`; label `font-medium`; sub-copy `text-muted-foreground/70` | `:81` |
| Switch | `h-5 w-9`, checked `bg-primary`, focus ring | `switch.tsx:12-21` |
| Button | `rounded-lg text-sm font-medium`, `focus-visible:ring-1`, disabled `opacity-50` | `button.tsx:8` |
| Segmented control | `h-8 rounded-md bg-muted/45 p-0.5`; widths 48 / 60 / 72; sliding indicator | `segmented-control.tsx:11-215` |
| Nav item | `h-8 rounded-md text-sm`; active `bg-sidebar-active font-semibold shadow-xs`; `focus-visible:ring-2` | `sidebar.tsx:761-780` |
| kbd chips | `h-6 min-w-6 rounded border bg-muted/60 font-mono text-xs` | `KeyboardShortcutsCard.tsx:24-31` |
| Error banner | `rounded-xl border-destructive/30 bg-destructive/10 text-destructive` | `NotificationSettingsCard.tsx:291` |
| Type scale | everything derives from `--buzz-type-rem`; fonts Inter Variable and JetBrains Mono | `typography.css:16-27`; `main.tsx:6-9` |

**Premium SWF adaptation (recommendation):**

- Keep: the groups, the page → group → card → row rhythm, and the read-only shortcut list.
- Fix: the missing narrow-screen trigger; the duplicate Escape row; the shortcuts that are shown but not bound.
- Unify all spacing and radius on SWF's own tokens.

---

## 19. Error / Loading / Empty States

| Surface | Loading | Empty | Error |
|---|---|---|---|
| Settings sidebar (invites gate) | "Checking invite permissions…" | – | "Invite settings could not be checked." + Try again; amber "unavailable" when the snapshot is missing |
| Profile | – | NIP-05 "Not set" | inline red banners (query / save); avatar editor reopens after a failure |
| Notifications | toggle shows "Requesting…" | – | destructive banner when permission is blocked or unsupported |
| Custom emoji | "Saving…" | "My emoji" empty state | toasts |
| Invites | "Checking invite permissions…" | members empty / no match | toasts; `invite_expired` / `invite_exhausted` messages |
| Mobile | "Starting…", "Pairing…" | – | expired → "Generate new pairing code"; error → "Try again"; mapped relay/timeout messages |
| Updates | checking / downloading / installing | up-to-date | error only for manual checks; unavailable; manual-required with a link |
| Send feedback | Send disabled while the message is empty or an upload is pending | – | inline error, input kept; "Timed out while sending feedback." / "Failed to send feedback." / relay reason |

---

## 20. Existing Tests

| Feature | Tests (what they prove) |
|---|---|
| Settings navigation | `desktop/tests/e2e/navigation.spec.ts:317` (route; section survives reload; switching uses replace; Back to app restores); `:352` (⌘, after ⌘K); `settings-section-layout.spec.ts:6, 83` (spacing and alignment). Gate hiding and URL-only moderation: **NO TEST FOUND** |
| Appearance | `buzz-theme-screenshots.spec.ts` (mode picker, prominent tab, accent, glass, live system switching); `appearance-previews.spec.ts:76-190`; unit `fontSizePreference.test.mjs`, `conversationDensityPreference.test.mjs`, `linkPreviewStylePreference.test.mjs`, `threadViewModePreference.test.mjs`, `communityThemePreference.test.mjs`, `communityThemeSync.test.mjs`. Legacy theme migration: **NO TEST FOUND** |
| Shortcuts | `backForwardChords.test.mjs`, `useCloseWindowShortcut.test.mjs`, `escapeSurfaces.test.mjs`, `composer-link-shortcut.spec.ts`, `top-chrome-zoom-clearance.spec.ts`. That the registry matches the real bindings: **NO TEST FOUND** |
| Profile | `profile.spec.ts:430-967` (mock bridge: edit, Done, toast, upload, emoji avatar); `profile-nsec-reveal.spec.ts`; `profile-backup-settings.spec.ts`; `avatarProfileSync.test.mjs`; `selfProfileStorage.test.mjs`; Rust `profile.rs:420-482`, `key_backup_tests.rs`. Merge-write field loss and relay users-table sync: **NO TEST FOUND** |
| Notifications | `profile.spec.ts:2228, 2366`; `dm-double-notification.spec.ts:70` (**real relay**, one notification per DM); `badge.spec.ts`; unit `shouldNotify*.test.mjs`, `feed.test.mjs`, `sound.test.mjs`, `target.test.mjs`, `desktop*.test.mjs`; Rust `macos_notifications.rs:346-419`. Settings persistence and notify-while-viewing: **NO TEST FOUND** |
| Custom emoji | `custom-emoji-ui.spec.ts`, `custom-emoji.spec.ts:76-711`; unit `customEmoji.test.mjs`, `customEmojiTags.test.mjs`; Rust `ingest.rs:~3400-3411`, `builders.rs:2934-2970`. Real-relay upload flow: **NO TEST FOUND** |
| Community settings | `relayMembers.test.mjs`, `leaveCommunity.test.mjs`, `resolveCommunityUpdateResult.test.mjs`, `communityStorage.test.mjs`; Rust `relay_admin.rs:497-848`, `regression_relay_admin_ban_gate.rs`. Edit dialog, member UI and icon UI: **NO TEST FOUND** |
| Invites | `invites.test.mjs`, `inviteHelpers.test.mjs`, `parseInviteInput.test.mjs`, `communityOnboarding.test.mjs`; Rust `api/invites.rs:594-1756`, `relay_invite.rs:536-921` (concurrent last-slot claim, expiry, retention), `e2e_relay.rs:263-354`, `deep_link_tests.rs:223-464`; Playwright `deep-link-invite.spec.ts`, `invite-link-copy.spec.ts`, `invites-settings-screenshots.spec.ts`. Web InvitePage and revoke/list: **NO TEST FOUND** |
| Switching | `community-rail.spec.ts:60-1479`; `workspace.rs:382-428`; `communityNavigationStorage.test.mjs`. Completeness of `resetCommunityState`: **NO TEST FOUND** |
| Mobile pairing | `C/buzz-core/src/pairing/session.rs:804-1379` (20 tests), `crypto.rs` (14), `qr.rs` (27), `types.rs` (10); `C/buzz-pair-relay/tests/integration.rs` (49); `pairing_generation_tests.rs`, `pairing_relay_tests.rs`; `mobile-pairing-qr.spec.ts` (mock, UI only); mobile Dart tests. `buzz-pairing-cli`: **NO TEST FOUND** |
| Updates | `sidebarUpdateCardVisibility.test.mjs`; `sidebar.spec.ts:680, 775, 824` (mocked plugin); `scripts/test-oss-desktop-promotion*.sh`. `use-updater.ts` logic and `is_auto_update_supported`: **NO TEST FOUND** |
| Local archive | Rust `T/archive/*_tests.rs` (about 217 tests); `useObserverArchiveSeed.test.mjs`, `useArchiveSync.test.mjs`, `localArchiveKinds.test.mjs`; `observer-archive-policy.spec.ts`. Pruning and encryption: **NO TEST FOUND** (not implemented) |
| Send feedback | `useSendFeedback.helpers.test.mjs:6-34` (event build); `profile.spec.ts:1014-1095` (entry point, disclosure, stale attachment, media proxy); `community-rail.spec.ts:288-297` (menu order); Rust `product_feedback.rs:116-160` (validation), `ingest.rs:3624-3657, 3775-3885`, `product_feedback.rs:143-206` (ignored, needs Postgres), `admin_moderation.rs:821-900`, `api/admin/mod.rs:1340-3200`; `admin-web/tests/feedback.spec.ts`. Real publish-to-row end to end and `collectDiagnostics`: **NO TEST FOUND** |

---

## 21. Exact Source Map

| Feature | Frontend | Backend | API / transport | Event kind | Storage | Tests |
|---|---|---|---|---|---|---|
| Settings shell | `D/app/routes/settings.tsx`, `D/features/settings/ui/SettingsView.tsx`, `SettingsPanels.tsx`, `D/app/useSettingsShortcuts.ts` | – | route `/settings?section=` | – | – | `navigation.spec.ts`, `settings-section-layout.spec.ts` |
| Profile | `ProfileSettingsCard.tsx`, `D/features/profile/hooks.ts`, `ProfileAvatarEditor.tsx`, `useAvatarUpload.ts` | `T/commands/profile.rs`, `T/events.rs:428-453`, `C/buzz-relay/src/handlers/side_effects.rs:1201-1290` | HTTP `POST /events`, Blossom `/upload` | 0, 24242 | relay `users` table; localStorage `buzz-self-profile.v1:*` | `profile.spec.ts`, `avatarProfileSync.test.mjs` |
| Key backup | `PrivateKeyBackupRow.tsx`, `EncryptedBackupProvider.tsx`, `lib/encryptedBackup.ts` | `T/commands/identity.rs:190-334`, `T/key_backup.rs` | Tauri | – | `.ncryptsec` file | `profile-backup-settings.spec.ts`, `key_backup_tests.rs` |
| Appearance | `SettingsPanels.tsx:421-800`, `AppearanceSettingsControls.tsx`, `ThemeProvider.tsx`, `D/shared/theme/*` | `T/commands/window_vibrancy.rs` | relay (theme sync) | 30078 | localStorage `buzz-theme*`, `buzz.appearance.*`, `buzz-community-theme.v1:*` | `buzz-theme-screenshots.spec.ts`, preference unit tests |
| Notifications | `NotificationSettingsCard.tsx`, `D/features/notifications/*` | `T/commands/notifications.rs`, `T/macos_notifications.rs`, `T/commands/messages.rs:49-104` | WebSocket + `get_feed` | 9, 40002, 45001, 45003, 46010-46012 … | localStorage `buzz-notification-settings.v2:<pk>` | `shouldNotify*.test.mjs`, `dm-double-notification.spec.ts` |
| Shortcuts | `D/shared/lib/keyboard-shortcuts.ts`, `KeyboardShortcutsCard.tsx`, the handler files in §6 | `T/ptt_shortcut.rs` | – | – | none | `backForwardChords.test.mjs` |
| Custom emoji | `CustomEmojiSettingsCard.tsx`, `D/shared/api/customEmoji.ts`, `D/features/custom-emoji/*` | `T/commands/media.rs`, `C/buzz-relay/src/handlers/ingest.rs:145-192`, `C/buzz-sdk/src/builders.rs` | WebSocket, Blossom | 30030, 7, 24242 | relay events + media | `custom-emoji*.spec.ts`, `customEmoji.test.mjs` |
| Local archive | `D/features/local-archive/*` | `T/archive/*` | relay `/query` | 24200, 44200, chosen | `~/.buzz/archive/archive.db` | `T/archive/*_tests.rs` |
| Community settings | `EditCommunityDialog.tsx`, `CommunityIconSettingsCard.tsx`, `CommunityMembersSettingsCard.tsx`, `communityStorage.ts` | `C/buzz-relay/src/handlers/relay_admin.rs`, `T/commands/workspace.rs` | WebSocket | 9030-9033, 8000, 8001, 13534, 28936 | localStorage `buzz-communities`; `relay_members`; `communities.icon` | `relayMembers.test.mjs`, `relay_admin.rs` tests |
| Invites | `InviteLinkSection.tsx`, `D/shared/api/invites.ts`, `inviteHelpers.ts`, `useClaimInvite.ts`, `web/src/features/invite/ui/InvitePage.tsx` | `C/buzz-relay/src/api/invites.rs`, `C/buzz-db/src/store/relay_invite.rs` | `POST /api/invites`, `/api/invites/claim`, `/api/invites/accept-policy`, `GET /api/join-policy` (NIP-98) | 27235, 8000, 13534 | `relay_invites`, `join_policy_acceptances` | `api/invites.rs` tests, `deep-link-invite.spec.ts` |
| Add / switch community | `AddCommunityDialog.tsx`, `InviteRedeemForm.tsx`, `useCommunities.tsx`, `useCommunityInit.ts`, `useCommunityNavigationTransitions.ts` | `T/commands/workspace.rs`, `T/deep_link.rs` | WebSocket NIP-42 | 22242 | localStorage `buzz-communities`, `buzz-active-community-id` | `community-rail.spec.ts` |
| Mobile pairing | `MobilePairingCard.tsx` | `T/commands/pairing.rs`, `C/buzz-core/src/pairing/*`, `C/buzz-pair-relay`, `mobile/lib/features/pairing/*` | pairing relay WebSocket | 24134 | none on desktop; mobile secure storage | `session.rs` tests, `buzz-pair-relay/tests/integration.rs` |
| Updates | `use-updater.ts`, `UpdaterProvider.tsx`, `UpdateChecker.tsx`, `SidebarUpdateCard.tsx` | `desktop/src-tauri/build.rs`, `T/commands/updater.rs`, `.github/workflows/release.yml` | GitHub `latest.json` | – | – | `sidebarUpdateCardVisibility.test.mjs` |
| Send feedback | `ProfilePopover.tsx:257-272`, `SendFeedbackController.tsx`, `SendFeedbackDialog.tsx`, `useSendFeedback.ts` | `C/buzz-relay/src/handlers/product_feedback.rs`, `ingest.rs:2290-2307`, `C/buzz-db/src/store/product_feedback.rs`, `api/admin/mod.rs`, `admin-web/src/App.tsx` | WebSocket `EVENT`; admin `GET/PATCH /api/admin/v1/feedback*` | 42000 (+ 24242 attachments) | Postgres `product_feedback` | `useSendFeedback.helpers.test.mjs`, `product_feedback.rs` tests, `admin-web/tests/feedback.spec.ts` |

---

## 22. SWF Buzz KEEP / ADAPT / OPTIONAL / REMOVE Matrix

| Feature | Class | Reason / adaptation |
|---|---|---|
| **Send Feedback** | **KEEP** | A complete, working flow exists end to end, and SWF already talks to the same relay, so kind 42000 needs **no backend work**. To meet "identity **and role** at the control plane", add a server-side role lookup (`relay_members` join) or an SWF control-plane consumer (§23). Carry over: required message, 32 KiB cap, optional category, opt-in diagnostics. Fix: upload attachments on send (not on pick); show a success toast. |
| **Custom emoji** | **KEEP** | NIP-30 kind 30030, relay-agnostic. Add a client-side image filter and size limit before upload. |
| **Profile** | **KEEP WITH ADAPTATION** | SWF treats the profile as identity-level (`identityProfile.ts`). Don't copy the lossy merge-write: preserve unknown kind:0 fields. Decide whether to publish to every community. Avoid sending the nsec over IPC to reveal it (SWF keeps the key in Rust). |
| **Appearance** | **KEEP WITH ADAPTATION** | Keep: color mode, theme, font size, density (+ link preview, thread layout). Glass and prominent tab are optional (glass is macOS only). Per-community theme with 30078 relay sync is **OPTIONAL**; SWF can start device-local. |
| **Notifications** | **KEEP WITH ADAPTATION** | Keep desktop alerts, notify while viewing, home badge and the dm/mention/thread/needs-action slots. Drop the agent job slots. Decide whether per-community settings are wanted (OLD BUZZ has none). |
| **Shortcuts** | **KEEP WITH ADAPTATION** | Build the card **from the same registry the handlers use**, so they can't drift. Drop the agent, huddle and terminal shortcuts. |
| **Community settings** | **KEEP WITH ADAPTATION** | Keep: local name, icon (kind 9033, owner/admin), members and roles, leave. **Drop** the unused API token and the agent-only repos dir. Surface the duplicate-relay error. |
| **Invites** | **KEEP WITH ADAPTATION** | Reuse `POST /api/invites` and `/api/invites/claim` (SWF already has `RelayInviteService.ts`). Mint on an explicit click, not on dialog open. List and revoke need **new backend work**; OLD BUZZ has none. |
| **Updates** | **KEEP WITH ADAPTATION** | Reuse the pattern: Tauri updater, auto-download, click to install, 6 h checks. It needs **SWF's own signing keypair and manifest endpoint**; never point at `block/buzz`. |
| **Mobile pairing** | **OPTIONAL** | The protocol is solid (NIP-AB, formally modelled), but **it exports the full nsec**, which conflicts with SWF keeping keys in the OS keyring. Also requires a pairing relay and a mobile app. Needs a product and security decision. |
| **Encrypted key backup** | **OPTIONAL** | Identity recovery value (NIP-49). Needs a decision given SWF's shared-device sign-out model, which removes the key. |
| **Moderation** (URL-only in OLD BUZZ) | **OPTIONAL** | Community-level, same `/moderation/*` backend. Not in the approved Settings list. |
| **Local Archive** | **REMOVE** | §8: agent-only by default, plaintext, no pruning, no reader. |
| Agents | **REMOVE** | Excluded. Harness catalog, agent defaults, prevent-sleep (`AgentsSettingsPanel.tsx`; `T/managed_agents/`). |
| Compute | **REMOVE** | Excluded. Mesh-LLM machine sharing over iroh (`D/features/mesh-compute/`; `T/mesh_llm/`). |
| Experiments | **REMOVE** | Excluded. `preview-features.json` toggles in localStorage `buzz-feature-overrides-v1`. |
| Hosted Communities | **REMOVE** | Excluded. Builderlab-hosted relays via `https://app.builderlab.xyz/api/goose` (`T/builderlab.rs`). |
| Channel Templates | **REMOVE** | Excluded. Agent-coupled templates in `<app_data>/templates/channel-templates.json`. |
| Voice | **REMOVE** | Excluded. Agent TTS in huddles (`crates/buzz-voice`, `tts-settings.json`). |

**Dependencies on excluded features (V/I)**

- `AppShell` mounts `PreventSleepProvider` and the archive hooks unconditionally.
- Notifications carry agent job slots.
- Shortcuts include agent and huddle keys.

Build the SWF Settings sidebar from an **allowlist** — `profile`, `appearance`, `notifications`, `shortcuts`, `custom-emoji`, `community`, `invites`, `mobile`, `updates` — rather than importing OLD BUZZ's list and hiding sections. OLD BUZZ's gates fail open.

---

## 23. Open Questions / Unknowns

1. **Feedback destination for SWF.** Is the "SWF control plane" the existing `product_feedback` table plus admin-web, or a separate SWF service? OLD BUZZ stores **no role**. Options: join `relay_members` at read time, add a role column filled in at ingest, or run an SWF consumer.
2. **Who at SWF reads feedback?** OLD BUZZ allows only deployment operators and moderators; community owners and admins cannot. Is that the desired rule?
3. **Mobile pairing:** is exporting the full nsec to a phone acceptable for SWF? If not, a delegated key or session scheme would be new protocol work.
4. **Profile scope:** identity-wide (republish to every joined community) or per community as in OLD BUZZ?
5. **Per-community appearance and notification settings:** wanted or not?
6. **UNKNOWN:** Windows notification click delivery and dock badge support.
7. **UNKNOWN:** TipTap default formatting shortcuts (node_modules absent), so ⌘B/⌘I/⌘E behaviour is not proven.
8. **UNKNOWN:** feedback retention policy (no TTL was found).
9. **UNKNOWN:** Windows updater install mode (Tauri default assumed).
10. Invite **list and revoke** would need new backend routes; OLD BUZZ has none.
11. Should the orphaned feedback-attachment upload (picked, then cancelled) be fixed in SWF?

---

## 24. Recommended Implementation Order

1. **Settings shell** — allowlist-based nav, route, ⌘, shortcut, SWF visual tokens. Unblocks everything else.
2. **Send Feedback** — highest business priority. The relay path already exists (kind 42000), so the client can ship first; resolve the role and control-plane question (§23.1) in parallel.
3. **Profile** — identity display, edit without field loss, avatar upload.
4. **Appearance** — color mode, theme, font size, density (device-local).
5. **Notifications** — desktop alerts, notify while viewing, badge, sound slots.
6. **Community settings + Invites** — icon, members and roles, leave; explicit-click invite mint.
7. **Shortcuts** — a registry-driven read-only card.
8. **Custom emoji** — NIP-30 sets with client-side validation.
9. **Updates** — needs SWF signing keys and an endpoint first.
10. **Mobile pairing** — only after the security decision (§23.3).

No SWF Buzz or OLD BUZZ application source was modified by this audit.
