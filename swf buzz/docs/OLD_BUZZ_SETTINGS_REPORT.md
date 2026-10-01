# Old Buzz Settings Audit

This audit covers the **application and personal Settings** screen of the OLD BUZZ desktop client. The source was read only.

Path prefixes:
- **D** = `buzz/buzz/desktop/src`
- **T** = `buzz/buzz/desktop/src-tauri/src`
- **C** = `buzz/buzz/crates`

All line numbers refer to those trees. Community (workspace) settings are covered in `OLD_BUZZ_COMMUNITY_SETTINGS_REPORT.md`.

---

## 1. Entry point

| Way in | Detail | Citation |
|---|---|---|
| Profile menu | In the bottom-left profile popover, the **last** item is "Settings" with a `⌘,` / `Ctrl+,` hint. It opens the default section. | D/features/profile/ui/ProfilePopover.tsx:274-291 |
| Keyboard | `⌘,` / `Ctrl+,` (primary modifier, no Alt, no Shift) **toggles** Settings. It is not registered in the huddle window. | D/app/useSettingsShortcuts.ts:19-38; D/app/AppShell.tsx:688-692 |
| Route | `/settings?section=<id>`. An invalid section becomes `undefined`, and the legacy `doctor` section maps to `agents`. | D/app/routes/settings.tsx:12-27 |
| Deep links from features | For example, "Invite to community" opens `community-members` (SidebarProfileCard.tsx:176-179). | D/features/sidebar/ui/SidebarProfileCard.tsx:176-179 |
| Close | "Back to app" button, `Esc`, or the shortcut again | D/features/settings/ui/SettingsView.tsx:180-190, 228-243 |

- `handleOpenSettings(section = DEFAULT_SETTINGS_SECTION)` navigates with `goSettings` (D/app/AppShell.tsx:638-643).
- Switching sections **replaces** the history entry, so Back leaves Settings in one step (:648-655).
- The default section is `"profile"` (D/features/settings/ui/SettingsPanels.tsx:102).
- If the requested section is hidden, the view falls back to the first visible section, or `appearance` if none are visible (SettingsView.tsx:167-171).

**Structure: a full-screen page, not a modal.** When the route is `/settings`, AppShell replaces the sidebar, top chrome and outlet with the lazily loaded `SettingsScreen` (D/app/AppShell.tsx:175, 786-826; D/app/LazySettingsScreen.tsx). `SettingsScreen` passes its props straight to `SettingsView` (SettingsScreen.tsx:42-60).

---

## 2. Sections and navigation

The navigation is a left sidebar with three labelled groups (SettingsView.tsx:50-76). The footer shows `v{appVersion}` (:300-311).

| Group | Section id → label (icon) | Feature gate | Visibility rule |
|---|---|---|---|
| Personal | `profile` → Profile | — | always |
| | `appearance` → Appearance | — | always |
| | `notifications` → Notifications | — | always |
| | `voice` → Voice | — | always |
| | `shortcuts` → Shortcuts | — | always |
| | `custom-emoji` → Custom emoji | `custom-emoji` | always (the gate is not in the manifest, so it fails open) |
| | `local-archive` → Local archive | — | always |
| | `channel-templates` → Channel templates | `channel-templates` | always (fails open) |
| Communities | `hosted-communities` → Hosted communities | — | always |
| | `community-members` → **Invites** | — | **only owner/admin** (`canManageCommunityMembers`) (SettingsView.tsx:145-148; D/shared/api/relayMembers.ts:41-46) |
| App | `agents` → Agents | `managed-agents` | always (fails open) |
| | `compute` → Compute | — | always |
| | `experimental` → Experiments | — | always |
| | `mobile` → Mobile | — | always |
| | `updates` → Updates | — | always |
| (none) | `moderation` → Moderation | — | **Not in any nav group.** Reachable only through `/settings?section=moderation`, and the card itself is limited to owner/admin (see 3.10) |

Section descriptors are at SettingsPanels.tsx:153-237 and the renderer at :802-866.

**How gates are evaluated** (SettingsView.tsx:133-144):
- A section is hidden only if its gate id is in the manifest **and** the gate resolves to disabled.
- The manifest is `buzz/preview-features.json` merged with `@protected-features`. It does not contain `managed-agents`, `channel-templates` or `custom-emoji`, so those gates fail open.

Sidebar notices for the membership lookup (SettingsView.tsx:247-282):
- "Checking invite permissions…"
- "Invite settings could not be checked." with a "Try again" button
- "Invite settings are unavailable. Relay recovery may still be in progress."

---

## 3. Options per section

### 3.1 Appearance
Header: "Appearance" / "Choose how Buzz looks and feels." (SettingsPanels.tsx:639-642). The **Theme** group is labelled "(per community)" and shows a community badge when the user is in more than one community (:437, 647-666).

| Option | UI | Purpose | Behavior on change | Persistence / protocol | Permissions |
|---|---|---|---|---|---|
| Color mode | Segmented control: System / Light / Dark | Follow the OS setting or force light/dark | System sets `followSystem=true` and switches to a paired theme if needed. Light/Dark sets `followSystem=false` and switches to the counterpart theme (SettingsPanels.tsx:480-515) | localStorage `buzz-follow-system` (D/shared/theme/ThemeProvider.tsx:37, 647-650). Default is System on a fresh profile (:524-531) | anyone |
| Theme style | Expandable tile grid with previews | Choose the colour theme (62 themes; 18 light/dark pairs) | `setTheme(name)` (:517-524) | localStorage `buzz-theme`, default `buzz` (ThemeProvider.tsx:26, 482, 636-640). A CSS cache is kept in `buzz-theme-cache` | anyone |
| Accent color | 10 swatches: Neutral, Blue #3b82f6, Cyan, Green, Orange, Red, Pink, Lilac, Purple, Indigo | Highlight colour | Rewrites the `--primary` and sidebar CSS variables | localStorage `buzz-accent-color`, default `#3b82f6` (ThemeProvider.tsx:28, 44-57, 642-645) | Hidden while a Buzz theme is active (SettingsPanels.tsx:443-444) |
| Glass background | Switch | macOS window vibrancy | Tauri `set_window_vibrancy {enabled, material}` | localStorage `buzz-glass-background`, default off (ThemeProvider.tsx:29, 380-383, 504-512) | Not shown on Linux; enabled only in Tauri on macOS |
| Glass opacity | Slider (30–90%) plus reset | Blur opacity | Sets `--glass-background-opacity` | localStorage `buzz-glass-opacity`, default 65 (ThemeProvider.tsx:30, 34) | Only when glass is enabled |
| Prominent active tab | Switch | Higher-contrast selected nav item | Sets the `data-prominent-active-tab` attribute | localStorage `buzz-prominent-active-tab`, default false (ThemeProvider.tsx:31, 35) | Only while a Buzz theme is selected (SettingsPanels.tsx:786) |
| Font size (Preferences group) | Segmented control: Smaller / Default / Larger | Text size | Sets the `data-font-size` attribute | localStorage `buzz.appearance.fontSize`, default Default (AppearanceSettingsControls.tsx:112-128, 209-229) | anyone |
| Conversation density | Segmented control: Compact / Comfy / Spacious | Message spacing | — | localStorage `buzz.appearance.conversationDensity`, default `comfortable` (AppearanceSettingsControls.tsx:94-110, 230-250) | anyone |
| Link previews | Segmented control: Compact / Rich | Preview card style | — | localStorage `buzz.appearance.linkPreviewStyle`, default compact (:77-92, 340-376) | anyone |
| Thread layout | Segmented control: Focus / Split | Threads open over the channel or in a side panel | — | localStorage `buzz.channels.threadViewMode`, default split (:378-393, 605-651) | anyone |

**Per-community theme sync.**
- The theme, accent and followSystem values are also stored per community, under `buzz-community-theme.v1:<pubkey>:<relayUrl>`.
- They are published as **kind 30078** with tags `["d","community-theme"]` and `["t","community-theme"]`.
- Content is NIP-44 self-encrypted JSON `{version:1, theme, accent, followSystem}`, debounced by 2 s (D/shared/theme/communityThemePreference.ts:5-21; communityThemeSync.ts:15-16, 216-232; D/shared/constants/kinds.ts:54).

### 3.2 Profile
Header: "Profile" / "Update how your name, avatar, and bio appear across Buzz." (D/features/settings/ui/ProfileSettingsCard.tsx:487-490).

| Option | UI | Purpose | Behavior on change | Persistence / protocol | Permissions |
|---|---|---|---|---|---|
| Avatar | Pencil button that opens an editor with Image / Emoji / Animated tabs; accepts upload/drop or URL ("Paste a URL (Slack profile, etc.)") | Profile photo | "Done" saves the profile | Animated avatars upload through Tauri `upload_media_bytes`. The result is saved as kind 0 `picture` (ProfileSettingsCard.tsx:549-638, 444-474) | self |
| Display name | Input inside "Profile info" (Edit/Done pill) | Name shown in the app | Saved on Done if it changed | kind 0 `display_name` | self |
| Profile description | Textarea | Bio | same | kind 0 `about` (:722-758) | self |
| Identity details → Public key | Read-only value plus "Copy" | Show npub/hex | Copies to clipboard | — (:788-795) | self |
| NIP-05 handle | Read-only plus Copy | — | — | not editable (:796-801) | self |
| Private key | "Reveal"/"Hide", then "Create backup", "Test backup", "Download backup" | Key backup | Tauri `get_nsec`, `create_ncryptsec_backup`, `save_ncryptsec_copy` (NIP-49) | D/shared/api/tauriIdentity.ts:28, 76-85; PrivateKeyBackupRow.tsx | self |
| Sign out: "Delete my data" | Destructive button, then dialog "Sign out and wipe all data?" | Wipe identity and local data | Requires a backup checkbox **and** typing "wipe all my data". Then calls Tauri `sign_out`, `localStorage.clear()` and `sessionStorage.clear()` | SignOutSection.tsx:27, 102-128 | self |

How saving works:
- The profile is saved with Tauri `update_profile {displayName, avatarUrl, about}` (D/shared/api/tauriProfiles.ts:79-84).
- On the Rust side this is a read-merge-write of **kind 0** that keeps the existing `name` and `nip05` (T/commands/profile.rs:40-98).
- Blank fields are ignored, with the notice "Clearing existing profile fields is not supported yet…" (ProfileSettingsCard.tsx:848-857).

### 3.3 Notifications
- Header: "Notifications" / "Desktop alerts are on by default. Fine-tune what gets through below."
- Every option lives in one localStorage JSON blob: **`buzz-notification-settings.v2:<pubkey>`** (D/features/notifications/hooks.ts:38, 93-95, 198-200).
- Defaults are at hooks.ts:56-62.

| Option | UI | Purpose | Behavior on change | Default | Gating |
|---|---|---|---|---|---|
| Desktop alerts | Switch | OS notifications | Requests OS permission (macOS uses Tauri `request_notification_access` / `notification_permission_state`). If denied, the switch turns off and an error is shown (hooks.ts:245-298) | on | Automatically off when permission is denied or unsupported |
| Notify while viewing | Switch | Alert even for the DM you have open | `notifyWhileViewing` | off | Requires Desktop alerts |
| Sound (master) | Switch | Alert sounds | Off zeroes every slot and remembers the previous state; On restores it (hooks.ts:314-345) | derived | Shown only if Desktop alerts is on |
| Alert sounds (per slot) | Sound picker dropdown, ▶ preview button and switch | Sound for each event type | `sounds[slot]`, `slotAlertsEnabled[slot]`. Files are `/sounds/<name>.mp3` | sound `flutter` | Agent job slots show "Coming soon" and are disabled |
| Home badge | Switch | Home badge for mentions and needs-action items | `homeBadgeEnabled` | on | — |

Slots (D/features/notifications/lib/sound.ts:26-106):

| Slot | Enabled by default |
|---|---|
| Direct messages | on |
| @Mentions | on |
| Thread replies | on |
| Needs action | on |
| Agent: job accepted | on (coming soon) |
| Agent: progress update | off (coming soon) |
| Agent: job result | on (coming soon) |
| Agent: job error | on (coming soon) |

Available sounds: bong, boo, dng, doo, doodone, doong, doop, flirl, flutter, oh-no, ping, unison.

### 3.4 Voice
- Header: "Voice" / "Choose whether Buzz reads new agent responses aloud during an active huddle."
- Persistence: Rust app-data file `tts-settings.json` (T/huddle/tts_settings.rs:27, 143-149, 223-226).

| Option | UI | Behavior / protocol | Default |
|---|---|---|---|
| Agent text to speech | Switch | Tauri `set_tts_enabled` | on |
| Pocket TTS voice | Dropdown | Tauri `set_pocket_voice {voiceKey}` | Mary (`pocket:mary`) |
| Preview | Button | Tauri `preview_pocket_voice` | — |
| Add voice | Button | Tauri `import_pocket_voice` (native file picker) | — |
| Delete imported voice | Icon button, then confirmation | Tauri `delete_pocket_voice` (only for `pocket:imported:*` keys) | — |

Source: D/features/settings/ui/VoiceSettingsCard.tsx:58-82, 196-380.

### 3.5 Experiments
- UI: one switch per manifest entry (D/features/settings/ui/ExperimentalFeaturesCard.tsx:11-51).
- Persistence: localStorage **`buzz-feature-overrides-v1`**, a JSON map of `{id: bool}` (D/shared/features/store.ts:12, 37-41).
- Every flag defaults to **off**.

| id | Label | Extra side effect |
|---|---|---|
| workflows | Workflows | — |
| threadScopedAcpSessions | Thread Scoped ACP Sessions | Tauri `set_thread_scoped_acp_sessions` |
| projects | Projects | — |
| pulse | Pulse | — |
| forum | Forum Channels | — |
| agentManagedProfiles | Agent-managed profiles | Tauri `set_agent_managed_profiles` |
| bestie | Bestie | Internal builds only (`VITE_BUZZ_BESTIE=1`; D/protectedFeatures/internal.ts:4-11) |

### 3.6 Agents
Header: "Agents" / "Control how agents behave in conversations and run on this machine." Nothing in this section is gated by role.

| Option | UI | Persistence / protocol | Default |
|---|---|---|---|
| Automatically mention agents | Switch | localStorage `buzz.messages.keepMentionedAgentsPinned`. Turning it off resets the persistent audience store | off |
| Keep awake while agents are active | Switch | localStorage `buzz-prevent-sleep` and Tauri `set_prevent_sleep_active`. Releases after 1 h idle | off |
| Agent runtimes → Check again | Button | Tauri `discover_acp_providers {force:true}`, plus `discover_git_bash_prerequisite` on Windows | — |
| Per-runtime Install / Update / Edit / Delete | Buttons and menu | Tauri `install_acp_runtime`, `connect_acp_runtime`, `delete_custom_harness` | — |
| Add runtimes → Custom harness (Name, ID, Command, Arguments, Env vars, Docs URL, Install hint) | Form | Tauri `save_custom_harness` | — |
| Agent defaults: Default harness, provider, API key, model, effort, env vars → Save defaults | Dropdowns, inputs, button | Tauri `set_global_agent_config`, stored in `global-agent-config.json`. Restarts local agents | empty |

Sources: AgentsSettingsPanel.tsx:21-49; PreventSleepSettingsCard.tsx:11-58; HarnessesSettingsPanel.tsx; CustomHarnessForm.tsx:115-466; AgentDefaultsEditor.tsx:146-363; T/commands/global_agent_config.rs:44-63.

### 3.7 Channel templates
- UI: a template list with "Create", plus Edit / Duplicate / Delete on each row. Delete is not offered for built-in templates.
- Template fields: Name (required), Description, Canvas template (supports `{channel.name}` and `{template.name}`), Agent personas, Teams, and a Runtime per agent.
- Persistence: Tauri `list/create/update/delete/duplicate_channel_template`, stored in `<app_data>/templates/channel-templates.json` (D/shared/api/tauriChannelTemplates.ts:66-113; T/templates/storage.rs:10-20).
- Local to the device; no role check (ChannelTemplatesSettingsCard.tsx:113-790).

### 3.8 Compute (card title "Share compute")

| Option | UI | Persistence / protocol | Default |
|---|---|---|---|
| Share this machine | Switch | Tauri `mesh_start_node {mode:"serve", modelId, maxVramGb}` / `mesh_stop_node`; status via `mesh_node_status` | off |
| Model | Dropdown (hardware-fit labels, "Custom model…") | localStorage `buzz.mesh-compute.share.model.v1`; catalog from `mesh_model_catalog` / `mesh_installed_models` | the catalog's recommended model |
| Advanced → Max VRAM (GB) | Text input | localStorage `buzz.mesh-compute.share.max-vram-gb.v1` | no limit |

Source: D/features/mesh-compute/ui/MeshComputeSettingsCard.tsx:43-44, 191-583.

### 3.9 Hosted communities and Invites
- **Hosted communities** covers Builderlab sign-in, identity binding, and per-row Connect / Transfer / Archive / Unarchive / icon, plus hosted create.
- **Invites** covers the member list, role changes, direct add and invite links, and is visible only to owner/admin.

Both are community-level features, so they are documented in `OLD_BUZZ_COMMUNITY_SETTINGS_REPORT.md` §4–6.

### 3.10 Moderation (hidden from the nav)
- The card is limited to owner/admin. Anyone else sees "The moderation queue is available to community moderators only." (ModerationQueueCard.tsx:563-585).
- **Queue tab:** `GET /moderation/reports?status=open` and **Audit log tab:** `GET /moderation/audit`, both with a NIP-98 GET header (D/shared/api/moderation.ts:222-248, 344-363). Rows are NIP-56 kind 1984 reports, grouped by target and sorted by severity (D/features/settings/lib/moderationQueue.ts:23-182).
- **Resolve ▾ options:**
  - Delete content: `delete_message` (kind 9005)
  - Kick author: kind 9001
  - Ban author: kind 9040 `["p",author]`
  - Escalate
  - Dismiss
- Each resolution then publishes **kind 9044** `["report",id]`, `["status",resolved|dismissed]`, `["action",a]`, and optionally `["reason"]` (moderation.ts:186-209).

### 3.11 Custom emoji
- Protocol: NIP-30. Each user publishes their own **kind 30030** with `["d","buzz:custom-emoji"]` and one `["emoji", shortcode, url]` tag per emoji (D/shared/api/customEmoji.ts:26-29, 170-185).
- Adding an emoji:
  - Upload an image with Tauri `pick_and_upload_media`.
  - Name it: lowercase, `^[a-z0-9_-]+$`, at most 64 characters.
  - "Save emoji" republishes your set.
- Removing one is a trash icon with no confirmation.
- The "Community emoji" list is read-only. Anyone can edit their own set (CustomEmojiSettingsCard.tsx:56-339).

### 3.12 Local archive
- Everything is stored in a SQLite database at `<nest>/archive/archive.db` (T/archive/archive_db.rs:85).

| Option | UI | Protocol | Default |
|---|---|---|---|
| Archive my agents' observer frames (kind 24200) | Switch | Tauri `merge_save_subscription_kinds` / `remove_save_subscription_kind`; seeded flag stored in localStorage `buzz:observer-archive-default-seeded:<pubkey>` | on |
| Archive my agents' turn metrics (kind 44200) | Switch | same mechanism; `buzz:agent-metric-archive-default-seeded:<pubkey>` | on |
| Channel subscriptions: Add (Channel select, event-type checkboxes, custom kinds) and delete | Form and trash icon | Tauri `create_save_subscription {scopeType:"channel_h", …}` / `delete_save_subscription` | none |

Source: D/features/local-archive/ui/LocalArchiveSettingsCard.tsx:73-637.

### 3.13 Mobile
- "Start pairing" calls Tauri `start_pairing` and shows a QR code for `nostrpair://<ephemeral_pk>?secret=<hex>&relay=<url>&v=1` (NIP-AB), with a "Copy pairing code" button.
- The user then confirms the 6-digit SAS: "Codes match" calls `confirm_pairing_sas`, and "Cancel" calls `cancel_pairing`.
- On a match, the desktop sends `{relayUrl, pubkey, nsec}` to the phone, NIP-44 encrypted, in kind **24134**.
- The session times out after 130 s. Nothing is persisted (MobilePairingCard.tsx:179-551; T/commands/pairing.rs:139-150, 319-328).

### 3.14 Shortcuts
- Read-only; no keys can be rebound and nothing is persisted.
- Groups: Navigation, Messages, Formatting, Zoom (D/shared/lib/keyboard-shortcuts.ts:24-275).
- Relevant entries:
  - "Settings — Open or close settings": `⌘,` / `Ctrl+,`
  - Quick search: `⌘K`
  - Browse channels: `⇧⌘O`
  - New DM: `⇧⌘K`
  - New channel: `⇧⌘N`
  - Home: `⇧⌘A`
  - Toggle sidebar: `⌘S`
  - Mark all as read: `⇧Esc`
- **No shortcut for switching communities** (not present in OLD BUZZ).

### 3.15 Updates
- Header: "Software Updates".
- States and buttons: "Check for Updates", "Check Again", "Download Update" (Linux builds that are not AppImage, which opens `https://github.com/block/buzz/releases/latest`), "Update Now" (`install()` then `relaunch()`), and "Retry".
- Uses `@tauri-apps/plugin-updater` `check()`. A background check runs on mount and every 6 h.
- **No user-configurable options**: no auto-update toggle and no release-channel choice (D/features/settings/UpdateChecker.tsx; hooks/use-updater.ts:23, 33, 148-150, 212-223).

---

## 4. Protocol and API summary

| Setting | Transport |
|---|---|
| Profile | kind 0 via Tauri `update_profile` |
| Per-community theme | kind 30078, `d=community-theme`, NIP-44 self-encrypted |
| Custom emoji | kind 30030, `d=buzz:custom-emoji` |
| Moderation | HTTP `/moderation/reports` and `/moderation/audit` (NIP-98), plus kinds 9005, 9001, 9040 and 9044 |
| Invites | HTTP `POST /api/invites` (NIP-98), plus kinds 9030, 9031 and 9032 |
| Mobile pairing | kind 24134 (NIP-AB) |
| Everything else | Local: localStorage keys listed above, or Tauri app-data files (`tts-settings.json`, `global-agent-config.json`, `channel-templates.json`, `archive.db`) |

**Not present in OLD BUZZ:**
- a language/locale setting
- a privacy or read-receipt setting
- an editable NIP-05
- any settings search
- any server-synced notification preferences (they are local only)

## 5. UI structure

The Settings page has three regions:
- **Left sidebar:**
  - drag region
  - "Back to app"
  - membership notices
  - groups Personal / Communities / App, each item an icon plus label
  - version footer
- **Right content:** a rounded surface with a scrollable area, max width `4xl`, which renders `renderSettingsSection(section)` (SettingsView.tsx:212-366).
- **Inside each section:** a `SettingsSectionHeader` (title and description) above one or more `SettingsOptionGroup` cards made of `SettingsOptionRow` rows (SettingsSectionHeader.tsx; SettingsOptionGroup.tsx).
