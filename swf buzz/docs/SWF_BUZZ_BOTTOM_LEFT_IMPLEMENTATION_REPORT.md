# SWF Buzz Bottom-Left UX Implementation

**Date:** 2026-09-26 · **Community relay:** `wss://buzz.lmdconsulting.com`
**References:**
- [OLD_BUZZ_BOTTOM_LEFT_AUDIT.md](OLD_BUZZ_BOTTOM_LEFT_AUDIT.md)
- [OLD_BUZZ_SETTINGS_REPORT.md](OLD_BUZZ_SETTINGS_REPORT.md)
- [OLD_BUZZ_COMMUNITY_SETTINGS_REPORT.md](OLD_BUZZ_COMMUNITY_SETTINGS_REPORT.md)

> **Honesty note.** Automated checks all pass, and the status protocol was checked
> against the live relay. The assistant cannot click inside the Tauri window, so the
> manual checklist in section 11 is **NOT RUN**. The running app did load every change
> without errors (Vite reload log).

## Summary

The stack of sidebar links (identity block, Community, Operator Dashboard / Switch
community, Create community, My identity, Sign out, Identity diagnostics) is replaced by:

- **One compact card:** avatar with live presence dot, name, presence or custom status, and the current community.
- **Profile menu**, anchored to the card:
  - identity block
  - Update your status
  - community row ›
  - Settings (`Ctrl+,`)
  - Sign out
- **Community submenu**, anchored to the community row:
  - Copy community URL
  - My identity
  - Members & moderation
  - Operator Dashboard (operators only)
  - Switch community (if you have more than one)
  - Community settings
  - Leave community
  - Create community (operators only)
  - Add a community
- **Set a status** dialog (NIP-38, visible to other members in SWF and OLD BUZZ).
- **Settings → "Coming soon"**: no fake controls.
- **Community settings**, grounded in what OLD BUZZ actually does.
- **Leave community** using OLD BUZZ's NIP-43 event, with a confirmation step.

There is no "Send feedback" item anywhere.

## OLD BUZZ findings that shaped the build

| Topic | OLD BUZZ (source-verified) | Effect on SWF |
|---|---|---|
| Profile menu | Identity + presence chip → status → community › → Send feedback → Settings. **Sign out, My identity and Operator dashboard are not in the menu** | Same order, per your requirements: no feedback; Sign out added at the bottom; My identity / Operator in the community submenu |
| Custom status | NIP-38 **kind 30315**, `d=general`, `["emoji",…]`, `["expiration",unix]`. Clear = empty content. Read over WebSocket, refetched every 120 s; expiry enforced by the client | Implemented identically |
| Quick statuses | 🗣️ In a meeting · 🚌 Commuting · 🤒 Out sick · 🏖️ Vacationing · 🏠 Working remotely, shown only when no status is set; clicking one fills the form | Identical |
| Durations | 1 hour · 8 hours · **Today** (default, next local midnight) · This week (next Monday 00:00) · Custom (30-minute steps). Every status expires; editing keeps the old expiry unless the duration changes | Identical |
| Copy community URL | Copies the relay address (`wss://…`) | Identical |
| Leave community | **kind 28936**, `""`, `[["-"]]`; relay removes you; "not a relay member" = already left; "relay owner cannot leave" | Same event and outcomes, **plus a confirmation step** (OLD BUZZ has none, and leaving can't be undone without a new invite) |
| Community settings | Name / Relay URL / API Token / Repos Directory are **local-only, editable by anyone**. The API token is discarded even by OLD BUZZ's own backend. Only the icon is server-side (kind 9033, owner/admin) | See "Community settings" below |
| Operator dashboard | A separate admin web app, not in the desktop menu | SWF keeps its existing dashboard, shown only when the relay's operator check says yes |
| Settings | Full-screen page (`⌘,`/`Ctrl+,`) with Personal / Communities / App groups | SWF shows "Coming soon" (report written, nothing built) |

## New user card — `src/layouts/SidebarUserCard.vue`

- 72px tall, 12px radius, uses the theme tokens (works in light and dark).
- **Line 1:** name. **Line 2:** custom status (emoji + text) if set, otherwise Online / Away / Offline. **Line 3:** community tile (initial) + community name.
- The whole card is one `<button>` (`aria-haspopup="menu"`, `aria-expanded`, and an `aria-label` including the presence).

## Profile menu

1. Identity block: avatar with dot, name, presence label
2. **Update your status** (or the current status, to edit it)
3. **{community} ›**: opens the submenu (click, or → key)
4. **Settings** (`Ctrl ,` shown): "Coming soon"
5. Identity diagnostics (development builds only)
6. **Sign out**: the existing sign-out flow and its "this removes the key" warning

## Presence

- Unchanged from the previous task: one Pinia store keyed by pubkey, and one OLD BUZZ-compatible sync.
- The card and menu read the same `usePresenceOf(session.pubkey)` as the sidebar DMs, message avatars and profile.
- Offline is **grey**, matching OLD BUZZ (red was requested only if OLD BUZZ used it; it doesn't).

## Status

- **Protocol:** `src/protocol/userStatus.ts` (build, clear, parse, `statusExpiry`, presets).
- **Transport:** `src/features/presence/UserStatusService.ts`.
- **Store:** `src/stores/userStatus.ts`. Keyed by pubkey; expired statuses are hidden, with a 30 s clock so they disappear on time.
- **Sync:** part of `presenceSync.ts`, so presence and status are tracked for the same people.
  - statuses fetched for newly tracked people
  - one live subscription `{kinds:[30315],"#d":["general"],limit:0}`
  - refetch every 120 s and after reconnects
  - everything reset when the identity session ends
- **Dialog:** `src/features/presence/ui/SetStatusModal.vue`.
  - emoji + text inputs
  - "Clear after" selector (Custom shows a date-time field and must be in the future)
  - quick statuses
  - Save / Cancel / Clear status
  - "Saving…" state; no double submits
- **Visible to others:** `UserProfilePanel.vue` shows the custom status under the presence line.
- **Presence vs status:** kept separate. A person can be 🟢 Online and 🏠 Working remotely at the same time.

## Community menu

| Item | Behavior | Visibility |
|---|---|---|
| Copy community URL | Copies `activeRelayUrl` (`wss://…`) | everyone |
| My identity | Existing `IdentityModal` (public info only) | everyone |
| Members & moderation | Existing `CommunityManagementModal` (was the old "Community" link) | everyone; the modal gates its own actions |
| Operator Dashboard | Existing `/operator` route | `canAccessOperatorDashboard` (the relay's operator verdict) |
| Switch community | Existing picker `/communities` | only with 2+ memberships |
| Community settings | Dialog below | everyone |
| Leave community | Confirmation, then kind 28936 | everyone (the relay refuses the owner) |
| Create community | Existing `CreateCommunityDialog` | `canCreateCommunity` (operators) |
| Add a community | Existing picker (Connect existing community / Join with invite) | everyone |

**Leave flow:** confirm → `leaveCommunity()` → only after the relay accepts:
1. `forgetCommunity(relay)`
2. `endIdentitySession()`: closes the socket and clears community state; the **identity stays**
3. go to `/communities`, which re-discovers memberships; with none left it shows Welcome

If the relay refuses, nothing local changes and its reason is shown.

## Community settings — `src/features/communities/ui/CommunitySettingsDialog.vue`

| Field | Behavior | Why |
|---|---|---|
| Name | Editable; saved to this device's address book (`renameCommunity`) | OLD BUZZ: local-only, anyone can edit |
| Relay URL | Shown **locked** 🔒 for everyone | The address *is* the community; another one is added via "Add a community" |
| Your role | Shown locked 🔒 (the relay's answer) | Roles are changed by owners/admins in Members & moderation, and enforced by the relay |
| API Token / Repos Directory | **Not shown** | OLD BUZZ fields for its local coding agents; SWF has no feature using them, and a field that does nothing would be fake |
| Icon (server, kind 9033) | Not implemented | OLD BUZZ's only server-side community setting; left for later |

Frontend role checks here are presentation only. No server-side community setting is
editable in this dialog, so there is nothing a member could "save" against server rules.

## Application Settings — Coming soon

Opened from the menu or `Ctrl+,` / `⌘,`. A dialog with an icon, "Coming soon", one
sentence, and "Got it". No controls. The inventory for the future build is in
`OLD_BUZZ_SETTINGS_REPORT.md`.

## Popover architecture — `src/components/AnchoredPopover.vue`

- Placed from `anchor.getBoundingClientRect()`. It opens to the right, **flips left** when there's no room, and is **clamped** inside the viewport (width capped at `innerWidth − 16`). It re-positions on resize.
- **One chain:** state is `menu: "profile" | "community" | null` plus `dialog: "status" | "settings" | "community-settings" | "leave" | null`. The submenu is a `nested` popover sharing the parent's overlay, so one outside click closes both. Opening a dialog closes the menu first.
- **Keyboard:** the first item is focused on open; ↑/↓ move between items; → opens the community submenu; Escape closes the current level; focus returns to the card.
- 140 ms entrance animation, turned off when reduced motion is preferred.

## Permissions

| Action | Who | Enforced by |
|---|---|---|
| Operator Dashboard, Create community | relay-verified operators | relay (operator check); UI hides it otherwise |
| Leave community | any member except the relay owner | relay (`relay owner cannot leave`) |
| Community name label | anyone (local only) | n/a (this device only) |
| Relay URL / role | nobody here | locked; roles managed through relay-checked 9032 events |
| Set/clear own status | yourself | signed with your key; kind 30315 |

## Files changed

- **New:**
  - `src/components/AnchoredPopover.vue`
  - `src/layouts/SidebarUserCard.vue`
  - `src/protocol/userStatus.ts`
  - `src/stores/userStatus.ts`
  - `src/features/presence/UserStatusService.ts`
  - `src/features/presence/ui/SetStatusModal.vue`
  - `src/features/communities/leaveCommunity.ts`
  - `src/features/communities/ui/CommunitySettingsDialog.vue`
  - docs: the three OLD BUZZ reports + this report
- **Changed:**
  - `src/layouts/AppSidebar.vue`: footer replaced by the card; dead helpers removed; diagnostics moved into a dialog
  - `src/features/presence/presenceSync.ts`: status fetch/live/refresh/clock, `useUserStatusOf`
  - `src/features/channels/ui/UserProfilePanel.vue`: shows the custom status
  - `src/features/communities/relayCommunities.ts`: `renameCommunity`
- **Tests (new):**
  - `tests/unit/features/bottomLeft/protocol.spec.ts` (10)
  - `tests/unit/features/bottomLeft/userCard.spec.ts` (9)
  - `tests/unit/components/anchoredPopover.spec.ts` (4)

## Tests

| Test | Result |
|---|---|
| TypeScript (`vue-tsc --noEmit`) | **PASS** |
| ESLint (`--max-warnings 0`) | **PASS** |
| Unit tests | **PASS**: 1088 tests in 106 files (23 new) |
| Rust check | **PASS** |
| Rust tests | **PASS**: 78 |
| Production build | **PASS** |
| Live relay: NIP-38 status query | **PASS**: the relay accepted `{kinds:[30315],"#d":["general"]}` after NIP-42; 0 statuses are currently set in the community |
| Tauri manual checklist | **NOT RUN** (see below) |

What the new tests cover:
- exact 30315 and 28936 wire formats
- all five durations
- OLD BUZZ's quick-status list
- the card shows presence, status and community
- Escape and outside click close the menu
- Settings shows no controls
- Operator/Create hidden from members
- leave waits for confirmation, cleans up only after the relay accepts, and keeps everything on refusal
- status save publishes kind 30315 and updates the card at once
- community settings keep relay URL and role locked and rename locally
- the popover opens right, flips, clamps, focuses, and closes on Escape

## Manual verification (Tauri window) — NOT RUN

The app is running with these changes loaded. Please check:

1. The card opens the menu, aligned beside the card.
2. The dot and label match the sidebar DMs.
3. Community › opens to the right; resize the window narrower and it flips or clamps.
4. **Update your status** → 🏠 Working remotely, Today → Save → the card shows it; another member (SWF or OLD BUZZ) sees it on your profile.
5. Clear status.
6. Copy community URL (paste it: `wss://buzz.lmdconsulting.com`).
7. My identity: public key only.
8. As a member, Operator Dashboard and Create community are hidden.
9. Community settings: rename works; relay URL is locked.
10. Settings / `Ctrl+,` shows Coming soon.
11. Sign out shows the existing warning.
12. Escape, outside click and arrow keys work.
13. Light and dark themes.
14. **Leave community removes you from the server** and needs an invite to rejoin. Try it only on a community you mean to leave.

## Known limitations

1. **Community icon** (OLD BUZZ kind 9033, owner/admin) is not implemented, so the card shows an initial tile.
2. **Manual presence choice** (OLD BUZZ's Online/Away/Offline chip) is not implemented; presence is automatic.
3. **Custom status time** uses the browser's `datetime-local` control, not OLD BUZZ's date picker plus 30-minute list (same result).
4. Leave community has **no OLD BUZZ-style NIP-11 capability check**. SWF only connects to Buzz relays, which support NIP-43 (the live relay advertises 43).
5. **Tauri checklist not yet performed** (section above).
