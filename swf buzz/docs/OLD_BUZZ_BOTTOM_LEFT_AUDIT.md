# Old Buzz Bottom-Left Audit

Source audited (read-only): `buzz/buzz`. Path prefixes:

- **D** = `buzz/buzz/desktop/src`
- **T** = `buzz/buzz/desktop/src-tauri/src`
- **C** = `buzz/buzz/crates`

Related reports: `OLD_BUZZ_SETTINGS_REPORT.md` and `OLD_BUZZ_COMMUNITY_SETTINGS_REPORT.md`.

---

## Summary: exact profile-menu layout

The popover is `ProfilePopover`: 280 px wide, opens upward (`side="top"`), `role="menu"`, aria-label "Profile menu" (D/features/profile/ui/ProfilePopover.tsx:105-121). Its contents, in order:

1. **Identity block.** Avatar with a presence dot, the display name, and a **presence chip** ("Online" / "Away" / "Offline"). Clicking the chip opens a submenu with Online, Away and Offline (:122-205).
2. **Status button.** It shows the current emoji and text, or a Smile icon with "Update your status" when no status is set. It opens the "Set a status" dialog (:207-243).
3. Divider.
4. **Community row.** Shows the community icon (or 🐝), the active community name (or "No community") and a ChevronRight. Hovering opens a submenu to the right (:247-255; D/features/communities/ui/CommunitySwitcher.tsx:248-359). The submenu contains:
   - "Copy community URL"
   - "Invite to community" (owner/admin only)
   - "Community settings"
   - "Leave community" (destructive)
   - divider
   - "Add a community"
5. Divider.
6. **"Send feedback"** (:257-272).
7. **"Settings"**, with the hint `⌘,` on macOS and `Ctrl+,` elsewhere (:274-291).

The following are **not present in OLD BUZZ**: a "My identity" menu item, an "Operator dashboard" item, and "Sign out" in this menu. Sign out lives in Settings → Profile.

---

## 1. Bottom-left profile card and profile menu

| Aspect | Detail | Citation |
|---|---|---|
| Component | `SidebarProfileCard`, rendered at the bottom of `AppSidebar` | D/features/sidebar/ui/SidebarProfileCard.tsx; D/features/sidebar/ui/AppSidebar.tsx:862-871 |
| Card content | A 32 px avatar with a masked presence-dot badge, the display name (bold), and a secondary line that shows either the custom status (emoji + text) or, when there is no status, "🐝 {community name}". When a status is set, hovering the card swaps the status line for the community label. | SidebarProfileCard.tsx:102-246 |
| Display name fallback | `profile.displayName` → `fallbackDisplayName` → "Current identity" | AppSidebar.tsx:461-464 |
| Opening | Clicking the avatar, the name, the status line or anywhere on the card toggles the popover | SidebarProfileCard.tsx:72-84, 111-120, 188-203, 208-220 |
| Popover | See the summary above | ProfilePopover.tsx |
| Permissions | All items are visible to everyone except "Invite to community", which requires the membership role `owner` or `admin` | SidebarProfileCard.tsx:63-65 |
| Send feedback | Opens `SendFeedbackController` and publishes **kind 42000** (`KIND_PRODUCT_FEEDBACK`) | D/app/AppShell.tsx:860, 988; D/features/settings/hooks/useSendFeedback.ts:119; D/shared/constants/kinds.ts:12 |

---

## 2. Custom user status (NIP-38)

### Protocol

| Field | Value | Citation |
|---|---|---|
| Kind | **30315** (`KIND_USER_STATUS`), parameterized-replaceable | D/shared/constants/kinds.ts:66; C/buzz-core/src/kind.rs:70 |
| `d` tag | `["d","general"]`, always | D/shared/api/relayClientSession.ts:381 |
| content | Status text, trimmed in the dialog | relayClientSession.ts:385; D/features/user-status/ui/SetStatusDialog.tsx:325-329 |
| Emoji tag | `["emoji", <value>]`, **two elements only**. The value is a native glyph (e.g. `💬`) or a custom `:shortcode:`. There is **no URL third element**, so this is not the NIP-30 form. It is added only when the emoji is non-empty. The client resolves `:shortcode:` against the community's custom emoji set when rendering. | relayClientSession.ts:382; D/features/user-status/ui/StatusEmoji.tsx:6-31 |
| Default emoji | If the user typed text but chose no emoji, the dialog uses `💬` (`DEFAULT_USER_STATUS_EMOJI`) | SetStatusDialog.tsx:262-263; StatusEmoji.tsx:31 |
| Expiration tag | `["expiration", "<unix seconds>"]` (the NIP-40 tag name), added only when `expiresAt` is set | relayClientSession.ts:383 |
| Signing and publish | `signRelayEvent`, then `publishEvent` on the active relay | relayClientSession.ts:379-393 |
| Relay handling | Kind 30315 requires scope `UsersWrite` and is global-only: it cannot be channel-scoped by an `h` tag. **No general NIP-40 expiry enforcement was found in buzz-relay**; the only `expiration` parsing is in event-reminder validation. Expiry is therefore enforced client-side. | C/buzz-relay/src/handlers/ingest.rs:437-444, 625-640, 1995-2025 |

### Set-status dialog (`SetStatusDialog`)

- **Title and subtitle:** "Set a status" / "Let others know what you're up to." (SetStatusDialog.tsx:379-380).
- **Emoji and text:**
  - Emoji picker button: "Choose a status emoji". It uses the shared `EmojiPicker`, which includes custom emoji.
  - Text input: placeholder "What’s your status?".
  - Enter saves; Shift+Enter does not (:382-415, 338-343).
- **Duration:** a dropdown row labelled "Duration" (:417-447). There is no "Don't clear" or "never" option, so **every saved status has an expiration** unless the user saves again without touching the duration (see below).
- **Quick statuses:** shown **only when the user has no existing status** (:534-554).
- **Footer:**
  - "Clear status" (destructive ghost button), shown only when a status already exists.
  - "Save status", enabled only when there is content, something changed, and the expiration is in the future.
  - Error text: "Choose a duration in the future." (:303, 315-331, 351-376, 527-531).

**Quick status presets** (exact order; SetStatusDialog.tsx:29-35):

| # | Emoji | Codepoints | Text |
|---|---|---|---|
| 1 | 🗣️ | U+1F5E3 U+FE0F | In a meeting |
| 2 | 🚌 | U+1F68C | Commuting |
| 3 | 🤒 | U+1F912 | Out sick |
| 4 | 🏖️ | U+1F3D6 U+FE0F | Vacationing |
| 5 | 🏠 | U+1F3E0 | Working remotely |

Clicking a preset fills in the text and emoji; it does not save (:305-308).

**Duration options** (exact labels and order; :37-43). The expiry is computed at save time in the user's **local time** (:92-104, 282-296) and stored as `Math.floor(ms/1000)`.

| Label | Computation |
|---|---|
| 1 hour | now + 60 min |
| 8 hours | now + 8 h |
| **Today** (default) | Next local midnight: `setHours(24,0,0,0)` |
| This week | The coming Monday at 00:00 local time: `daysUntilMonday = (8 - getDay()) % 7 \|\| 7` |
| Custom | Adds an "Until" row with a date picker (past days disabled) and a time dropdown in 30-minute steps (12:00 AM … 11:30 PM). The default is now + 24 h, rounded up to the next half hour (:47-56, 70-79, 448-526) |

**Editing an existing status:**
- When the dialog reopens, it infers the duration label from `expiresAt` minus `updatedAt`, within ±2 minutes (`inferredDuration`, :106-124).
- If the user saves without touching the duration, the original `expiresAt` is kept (:274-281).

### Clearing a status

**"Clear status"** calls `setUserStatusMutation.mutate({text:"", emoji:""})` (D/app/AppShell.tsx:899-903). This publishes kind 30315 with the following fields:

| Field | Value |
|---|---|
| content | `""` |
| tags | `[["d","general"]]` only (no emoji tag, no expiration tag) |

Because kind 30315 is replaceable, this event supersedes the old one. Readers treat empty text with an empty emoji as "no status" (D/features/user-status/hooks.ts:62-66). The Rust SDK documents the same convention (C/buzz-sdk/src/builders.rs:1734-1747).

### How others read statuses

| Mechanism | Detail | Citation |
|---|---|---|
| Fetch | `relayClient.fetchEvents({kinds:[30315], authors:<chunk>, "#d":["general"], limit: authors.length})`. Authors are sent in chunks of 1000 and the newest event per pubkey wins (ties go to the lower event id). The React Query key is `["user-status", ...sortedPubkeys]`. | D/features/user-status/hooks.ts:123-125, 198, 210-273 |
| Live subscription | `subscribe({kinds:[30315], "#d":["general"], limit:0})`, live only with no backfill. It is started by `useUserStatusSubscription`, retried with exponential backoff up to 30 s, and invalidated on reconnect. Incoming events are merged into all mounted queries only if they are newer. | relayClientSession.ts:396-401; hooks.ts:332-417, 152-191 |
| Polling | Refetches every 120 s while the window is focused. Stale time is 5 min, and there is no refetch on window focus. | hooks.ts:193-204, 301-330 |
| Expiry | An event whose `expiration` is ≤ now is stored as a hidden (empty) status. A timer fires at the nearest future `expiresAt` and hides expired entries. | hooks.ts:68-121, 255-270, 342-373 |
| HTTP endpoint | **Not present in OLD BUZZ**: statuses are read over the Nostr websocket only | — |
| Where shown | Sidebar card, profile menu, and the `StatusEmoji` render sites (for example `UserNameIndicators`) | D/features/user-status/ui/* |

The CLI also sets status with kind 30315 (C/buzz-cli/src/commands/users.rs:516).

---

## 3. Presence (brief)

- **UI:** the presence chip in the profile menu opens a submenu with **Online / Away / Offline**, in that order, each with a coloured dot. There is **no "Auto" label**: choosing "Online" stores the preference `auto` (ProfilePopover.tsx:55, 153-203; D/features/presence/hooks.ts:361-366). The chip is disabled while an update is pending.
- **Preference storage:** localStorage `buzz-presence-preference:<pubkey>` with the value `auto`, `away` or `offline` (presence/hooks.ts:38-84).
- **Automatic mode:** activity and OS-idle detection flip the status between online and away. The idle timeout is 10 min (D/features/presence/lib/presence.ts:61).
- **Wire format:** kind **20001** (ephemeral), content = status string, empty tags (D/shared/api/relayClientSession.ts:281-295). A heartbeat is sent every 60 s unless the status is offline or the relay is disconnected or rate-limited (presence.ts:55; hooks.ts:405-421). Others subscribe with `{kinds:[20001], authors, limit:0}` (D/shared/api/presenceRelaySubscription.ts:30).

---

## 4. Community menu (workspace switcher)

- **Where:** the community row inside the profile menu, rendered by `CommunitySwitcher variant="profile-menu"` (SidebarProfileCard.tsx:168-186).
- **Opening:** hover with an 80 ms open delay and a 160 ms close delay, or click. The submenu opens to the right (CommunitySwitcher.tsx:45-46, 248-278).
- **Trigger:** community icon, name and ChevronRight. If the relay connection is degraded, a pulsing WifiOff icon replaces the icon, with a tooltip such as "Reconnecting to relay…" or "Connection lost — relay is not responding" (:48-55, 193-246).
- **Items:**

| Item | Visible when | Action |
|---|---|---|
| Copy community URL | an active community exists | `writeTextToClipboard(activeCommunity.relayUrl)` (:286-297) |
| Invite to community | `canInvite` (role owner/admin) | Opens Settings → Invites (`community-members`) (:298-311; SidebarProfileCard.tsx:176-179) |
| Community settings | an active community exists | Opens the `EditCommunityDialog` (:312-323, 454-462) |
| Leave community | an active community exists | See §9 (:324-341) |
| Add a community | always | Opens `AddCommunityDialog` (:345-356) |

**This submenu does not list the other communities.** Switching happens in the community rail (§5).

---

## 5. Community switching

- **UI:** `CommunityRail` is a vertical rail, shown only when there are **2 or more** communities (D/features/sidebar/ui/CommunityRail.tsx:337-339; D/app/AppShell.tsx:762-770).
  - Click to switch.
  - Drag to reorder; the order is saved to `buzz-communities`.
  - Badges show a mention count (up to 99+) or an unread dot.
  - Right-click menu: "Mark all as read", "Copy community URL", "Invite to community", "Community settings".
- **Dropdown switcher:** the `sidebar` / `profile` dropdown variants of `CommunitySwitcher` list communities with a check mark (CommunitySwitcher.tsx:362-439), but they are **not mounted** anywhere.
- **Keyboard shortcut:** **not present in OLD BUZZ**.
- **Flow:**
  1. Save the current route in `buzz-community-destinations`.
  2. Navigate home.
  3. Write the new id to `buzz-active-community-id`.
  4. The community tree remounts with a fresh QueryClient. `resetCommunityState` disconnects the relay client and clears per-community caches (D/app/useCommunityNavigationTransitions.ts:48-72; D/features/communities/useCommunityInit.ts:59-99).

Full details are in the community report, §10.

---

## 6. My identity

**Not present in OLD BUZZ** as a menu item or page. A search of `desktop/src` for "my identity" returned no matches. Identity information (public key, NIP-05, private-key reveal and backup) lives in **Settings → Profile → "Identity details"** (D/features/settings/ui/ProfileSettingsCard.tsx:761-805).

---

## 7. Operator dashboard

**Not present in the OLD BUZZ desktop app.** A search for "operator" in `desktop/src` found only search-operator parsing and the terminal palette, and there is no menu entry. Operator and moderator tooling exists elsewhere:

- **`admin-web`:** a separate SPA (`buzz/buzz/admin-web`) with Reports and Feedback pages. Requests are signed with NIP-98 kind 27235 through a NIP-07 browser extension, against `/api/admin/v1` (admin-web/src/api.ts:1, 17, 51).
  - The relay serves it only when `config.admin` is set **and** the request Host equals the configured admin host (C/buzz-relay/src/router.rs:54-61; C/buzz-relay/src/api/admin/auth.rs:99-107).
- **Admin access rules** (auth.rs:1-28, 240-300):
  - Operator if the pubkey is in `RELAY_OPERATOR_PUBKEYS`.
  - Otherwise Operator if the pubkey equals `RELAY_OWNER_PUBKEY` **and** `RELAY_OPERATOR_PUBKEYS` is empty.
  - Otherwise the role (`operator` / `moderator`) from the `relay_operators` DB table.
  - Otherwise 403.
- **Relay operator HTTP API** `/operator/communities*`: requires a pubkey in `RELAY_OPERATOR_PUBKEYS` (C/buzz-relay/src/api/operator.rs:60-105).
- **In-app moderation queue:** Settings → Moderation, limited to owner/admin and hidden from the nav (see the Settings report §3.10).

---

## 8. Community settings

Opened from the profile menu → community submenu → "Community settings", or from the rail right-click menu. It is the "Edit Community" dialog with these fields: icon (server, kind 9033), Name, Relay URL, API Token and Repos Directory (all local). See `OLD_BUZZ_COMMUNITY_SETTINGS_REPORT.md` §2–3.

---

## 9. Leave community

| Aspect | Detail | Citation |
|---|---|---|
| UI | "Leave community" in the profile-menu community submenu, **active community only**. Red text with a LogOut icon; the label changes to "Leaving…" while pending. **No confirmation dialog.** Errors appear inline below the item. | CommunitySwitcher.tsx:163-191, 324-341 |
| Precheck | Tauri `relay_requires_membership`, which checks NIP-11 `supported_nips` for 43. If membership is not required, **nothing is published** and the community is removed locally. | D/features/communities/leaveCommunity.ts:60-62; D/shared/api/relayMembers.ts:130-134 |
| Event | **kind 28936** (`KIND_NIP43_LEAVE_REQUEST`), `content: ""`, `tags: [["-"]]`. The `["-"]` tag is the NIP-70 protected-event marker. | leaveCommunity.ts:7, 64-68 |
| Publish | On the live `relayClient` if the community is active; otherwise on a temporary `ReadOnlyRelayClient`, which is then disconnected | leaveCommunity.ts:70-87 |
| Relay | Rejects the request if membership is not enabled. Requires `created_at` within ±120 s and the `["-"]` tag. Removes the sender from `relay_members`; the event itself is **not stored**. Publishes kind 8001 (member removed) and a fresh 13534 snapshot, and replies `info: you have left this relay`. Errors: `invalid: you are not a relay member` and `invalid: relay owner cannot leave`. Channel-scoped tokens are rejected. | C/buzz-relay/src/handlers/ingest.rs:2274-2278, 2584-2667 |
| "Not a member" | An error containing "not a relay member" is treated as `already-absent`. The toast reads "Community removed" / "You were no longer a member, so Buzz removed the community from this device." | leaveCommunity.ts:31-52; CommunitySwitcher.tsx:175-180 |
| Local cleanup (only after the relay accepts) | Removes the self-profile and user-label caches, channel and project snapshots, the channel-head cache, the agent-turn snapshot and the nav destination. Rewrites `buzz-communities` and activates the next community. If it was the last community, storage is cleared and `buzz-community-discovery-after-leave="1"` is set. | D/features/communities/useCommunities.tsx:226-271; D/features/communities/communityStorage.ts:37-38, 156-178; D/app/useCommunityNavigationTransitions.ts:74-125 |

---

## 10. Create / add community

- **Entry points:** "Add a community" in the profile-menu community submenu (CommunitySwitcher.tsx:345-356), or the rail "+" button labelled "Add community" (CommunityRail.tsx:415-430).
- **Dialog:** `AddCommunityDialog`, with the choices "Create a new community" and "Join an existing community" (AddCommunityDialog.tsx:133-193).
- **Join:** accepts a community URL or an invite link (`https://<relay>/invite/<code>`, `buzz://join?relay=&code=`, or a bare code). It then starts onboarding (`buzz-community-onboarding-transaction.v1`).
- **Create:** a hosted community created through Builderlab under `<name>.communities.buzz.xyz`, with a limit of 5.

Details are in the community report, §9.

---

## 11. Application Settings entry

- **Profile menu:** "Settings" is the **last** item, with the hint `⌘,` / `Ctrl+,` (ProfilePopover.tsx:274-291). It opens `/settings`, which defaults to the **Profile** section (D/app/AppShell.tsx:638-643; SettingsPanels.tsx:102).
- **Keyboard:** `⌘,` / `Ctrl+,` toggles Settings (D/app/useSettingsShortcuts.ts).
- **Layout:** a full-screen page (not a modal) with the groups Personal / Communities / App. See `OLD_BUZZ_SETTINGS_REPORT.md`.
