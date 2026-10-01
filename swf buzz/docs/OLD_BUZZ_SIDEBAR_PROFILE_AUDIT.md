# Old Buzz Sidebar and Profile Audit

This audit is read-only and covers `buzz/buzz`. Path prefixes:

- **D** = `buzz/buzz/desktop/src`
- **T** = `buzz/buzz/desktop/src-tauri/src`
- **C** = `buzz/buzz/crates`

All behaviour below comes from reading the source; the app was not run. Where the source does not settle a point, the text says **NOT VERIFIED IN OLD BUZZ SOURCE**.

Related reports, which this one does not repeat:

- `OLD_BUZZ_BOTTOM_LEFT_AUDIT.md`: profile popover, status dialog, community submenu, and where Sign out lives.
- `OLD_BUZZ_INBOX_AUDIT.md`: Inbox badge and seen-set rules.
- `OLD_BUZZ_SEARCH_ANYTHING_AUDIT.md`: the search dialog.
- `OLD_BUZZ_IDENTITY_ACTIVITY_ARCHITECTURE.md`: identity data sources.

---

## 0. Feature support matrix

| Feature | Status | Evidence |
|---|---|---|
| Resizable sidebar width (drag rail) | SUPPORTED | D/shared/ui/sidebar.tsx:421-560 |
| Width persistence | SUPPORTED (localStorage `buzz-sidebar-width`) | sidebar.tsx:30, 121-134, 180-198 |
| Sidebar collapse or expand (offcanvas) | SUPPORTED | sidebar.tsx:200-219, 340-389; D/features/sidebar/ui/AppSidebar.tsx:506-509 |
| Open-state persistence across restarts | NOT SUPPORTED. A cookie is written but never read, and `defaultOpen` is `true`. | sidebar.tsx:146, 163, 174-175; D/app/AppShell.tsx:771-774 |
| Icon-only (48 px) collapsed mode | NOT SUPPORTED in AppSidebar. The code exists, but AppSidebar uses `collapsible="offcanvas"`. | sidebar.tsx:37, 358-359; AppSidebar.tsx:508 |
| Community switcher rail | SUPPORTED, only when the user has more than one community | AppShell.tsx:131, 761-770 |
| Search entry in the sidebar | SUPPORTED | D/features/sidebar/ui/AppSidebarPinnedHeader.tsx:69-88 |
| Inbox nav item with count badge | SUPPORTED | AppSidebarPinnedHeader.tsx:110-129 |
| Dedicated "Agents" list section in the sidebar | NOT SUPPORTED. There is an "Agents" nav item; agent DMs appear inside "Direct messages". | AppSidebarPinnedHeader.tsx:158-170; AppSidebar.tsx:759-802 |
| Starred section | SUPPORTED, shown only when at least one channel is starred | AppSidebar.tsx:349-355, 585-621 |
| Custom user-defined sections | SUPPORTED, with drag-and-drop | AppSidebar.tsx:268-279, 622-690 |
| Per-section sort (Recent / A–Z) | SUPPORTED | D/features/sidebar/lib/channelSortPreference.ts:7, 25, 169-186 |
| Section collapse | SUPPORTED, in-memory only (not persisted) | AppSidebar.tsx:239-266 |
| Unread bold | SUPPORTED (channels and DMs) | D/features/sidebar/ui/SidebarSection.tsx:292-293 |
| Unread count badge | SUPPORTED on DMs only | SidebarSection.tsx:489-503 |
| Thread-unread dot | SUPPORTED on non-DM rows | SidebarSection.tsx:269-273, 358-360 |
| Per-channel mention badge in the channel list | NOT SUPPORTED. Mentions only change the emphasis of the "N unread" overflow button. | AppSidebar.tsx:547-556, 816-831; D/features/channels/useUnreadChannels.ts:869-874 |
| Presence dot on DM rows | SUPPORTED, for 1:1 DMs only | SidebarSection.tsx:226-238 |
| Custom status on DM rows | SUPPORTED (emoji indicator) | SidebarSection.tsx:318-326 |
| Bottom profile card | SUPPORTED (see OLD_BUZZ_BOTTOM_LEFT_AUDIT §1) | D/features/sidebar/ui/SidebarProfileCard.tsx |
| Sign out in the sidebar or profile menu | NOT SUPPORTED. It lives in Settings → Profile (see OLD_BUZZ_BOTTOM_LEFT_AUDIT, Summary). | — |
| Keyboard arrow navigation between sidebar rows | NOT SUPPORTED. No ArrowUp/ArrowDown handler was found in the sidebar or app shell; the only matches are icon imports. | D/features/sidebar/ui/CustomChannelSection.tsx:2-4 |
| Mobile drawer (Sheet) | SUPPORTED at viewport widths under 768 px | sidebar.tsx:36, 316-337; D/shared/hooks/use-mobile.ts:5 |

---

## 1. Complete hierarchy and order

The window is laid out left to right as follows (AppShell.tsx:761-925):

```
[CommunityRail (only if communities.length > 1)] [SidebarProvider → AppSidebar] [main content]
```

### 1.1 AppSidebar, top to bottom

Source: `D/features/sidebar/ui/AppSidebar.tsx`.

1. **Pinned header (does not scroll):** `AppSidebarPinnedHeader`, which contains only `TopbarSearch`. The wrapper is `mx-[3px] shrink-0 px-2 pb-2 pt-3` (AppSidebar.tsx:524-540; AppSidebarPinnedHeader.tsx:69-88).
   - The trigger is an `h-8` full-width button with the text "Search everything" and a hard-coded `⌘K` kbd (D/features/search/ui/TopbarSearch.tsx:927-964).
   - There is **no workspace/community name header** inside the sidebar. Community identity appears in the rail and in the profile card.
2. **"N unread" overflow button (top):** shown when unread rows are scrolled out of view above (AppSidebar.tsx:547-556).
3. **Scrolling content** (`SidebarContent`, AppSidebar.tsx:558-812):
   1. **Primary menu** `AppSidebarPrimaryMenu`, in this order (AppSidebarPinnedHeader.tsx:104-189):
      - **Inbox** (always shown; badge = `min(homeBadgeCount, 99)`, :110-129)
      - **Pulse** (FeatureGate `pulse`, :130-143)
      - **Projects** (FeatureGate `projects`, :144-157)
      - **Agents** (always shown, Bot icon, :158-170)
      - `ProtectedBestieSidebarEntry` (a protected component; NOT VERIFIED IN OLD BUZZ SOURCE, :171)
      - **Workflows** (FeatureGate `workflows`, :172-185)
      - then `SidebarProjectsSection` (:188).
      - Pulse, Projects, Workflows and Forum are preview features. They are disabled by default: `preview-features.json` has no `defaultEnabled`, and `resolveEnabled` defaults to `false` (buzz/preview-features.json; D/shared/features/resolveEnabled.ts:16-18).
   2. A loading skeleton while `isLoading` (:579-581).
   3. **Starred**, if any channels are starred (:585-621).
   4. **Custom sections**, in user order, wrapped in a DnD context (:622-690).
   5. **Channels**: unassigned stream channels. The quick-create "+" is labelled "Browse channels" (:691-728).
   6. **Forums** (FeatureGate `forum`; action "New forum") (:730-758).
   7. **Direct messages**: quick action "New message" plus a ⋮ menu (:759-802).
   8. Error text, when present (:806-810).
4. **Footer** (`data-buzz-glass-footer-wrap`, :815-883):
   - The "N unread" overflow button (bottom). It can show up to 3 DM avatar previews (:816-832; D/features/sidebar/ui/MoreUnreadButton.tsx:13-21).
   - `SidebarRelayConnectionCard` (:835-847)
   - `SidebarUpdateCard` (:848-854)
   - `HuddleProfileControl` (:855-859)
   - **`SidebarProfileCard`** (:860-881)
5. `SidebarRail`, the resize handle (:959).

### 1.2 What goes into the channel and DM lists

- The sidebar receives `sidebarChannels`: channels where `isMember`, `archivedAt === null`, and `shouldShowSidebarChannel` passes (huddle backing channels are hidden) (AppShell.tsx:262-278, 831).
- DMs are `channelType === "dm"`, then filtered by `useProtectedVisibleDirectMessages`, a protected component whose filtering rule is NOT VERIFIED IN OLD BUZZ SOURCE (AppSidebar.tsx:157-164).
- Streams go to Starred, a custom section, or Channels. A starred channel is removed from its section bucket (:312-347).

---

## 2. Widths, resize, collapse and persistence

| Item | Value | Citation |
|---|---|---|
| Default width | **300 px** | sidebar.tsx:31 |
| Min width | **220 px** (`SIDEBAR_WIDTH_MIN`, shared with the right sidebar) | D/shared/layout/sidebarLayout.ts:2; sidebar.tsx:70-75 |
| Max width | **420 px** | sidebar.tsx:35 |
| Snap to default | Snaps to 300 within 8 px, with an eased magnet up to 28 px away; a haptic fires near 300 (±2 px) | sidebar.tsx:32-34, 77-119 |
| Drag threshold | 3 px before the resize starts | sidebar.tsx:524 |
| Width persistence | localStorage `buzz-sidebar-width`, clamped on read and write | sidebar.tsx:30, 121-134, 180-198 |
| Width variable | `--sidebar-width: {width}px` on the provider wrapper | sidebar.tsx:255-262 |
| Collapse mode | `offcanvas`: the width animates to 0 and the content fades/scales out (200 ms linear) | sidebar.tsx:351-383; AppSidebar.tsx:508 |
| Toggle | **Cmd/Ctrl+S** (window keydown); the TopChrome "Toggle Sidebar" button | sidebar.tsx:38, 206-219; D/app/AppTopChrome.tsx:33-43, 134 |
| Open-state persistence | Writes cookie `sidebar_state` (max-age 7 days) but never reads it; always starts open | sidebar.tsx:28-29, 163, 174-175; AppShell.tsx:771-774 (no `defaultOpen`) |
| Mobile (< 768 px) | Rendered as a Radix `Sheet` at a fixed **288 px**; toggle flips `openMobile` | sidebar.tsx:36, 200-204, 316-337; use-mobile.ts:5 |
| Community rail width | `w-14` = **56 px**; 36 px (`h-9 w-9`) icons | D/features/sidebar/ui/CommunityRail.tsx:127, 145, 376-377 |
| Rail overlap | When there are more than 1 community, the sidebar content gets `md:-ml-[11px] md:w-[calc(100%+11px)]` | AppSidebar.tsx:517-520 |

---

## 3. Rows: sizes, states and classes

### 3.1 Base row

`SidebarMenuButton` (sidebar.tsx:761-781) uses these classes: `h-8 text-sm rounded-md p-2 gap-2`.

| State | Classes / behaviour | Citation |
|---|---|---|
| Hover | `hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`. Channel rows use `group-hover/menu-item:bg-sidebar-accent`. | sidebar.tsx:762; SidebarSection.tsx:289-291 |
| Selected / active | `data-[active=true]:bg-sidebar-active text-sidebar-active-foreground shadow-xs`. The default active weight is `font-semibold`, but channel rows override it with `data-[active=true]:font-normal`. | sidebar.tsx:762; SidebarSection.tsx:288 |
| Active condition | `selectedView === "channel" && selectedChannelId === channel.id` | SidebarSection.tsx:482-484 |
| Unread | `font-bold text-sidebar-foreground`, and `data-[active=true]:font-bold` | SidebarSection.tsx:292-293 |
| Inactive, read, not muted | Label and glyph at `opacity-80` | SidebarSection.tsx:276-277 |
| Muted, read | `sidebar-muted-content opacity-50 dark:opacity-45`, plus a trailing `BellOff` icon | SidebarSection.tsx:278-282, 348-357 |

### 3.2 Unread indicators

| Indicator | Where | Look | Citation |
|---|---|---|---|
| Count badge | **DM rows only**, when unread and not the active row | `h-5 min-w-5 rounded-full bg-primary text-2xs font-semibold`; shows "99+" above 99; minimum 1 | SidebarSection.tsx:55-83, 489-503 |
| Dot | **Non-DM rows**, when there are unread threads (`unreadThreadChannelIds`) | `h-2 w-2 rounded-full bg-primary ml-auto` | SidebarSection.tsx:85-100, 268-273, 358-360; AppShell.tsx:742-744, 922 |
| Bold | Any row in `unreadChannelIds` | see 3.1 | — |
| Mention badge per channel | **NOT SUPPORTED** | Mentions or DMs only set `highPriorityUnreadChannelIds`, which drives the `primary` emphasis of MoreUnreadButton | useUnreadChannels.ts:869-874; AppSidebar.tsx:550, 821 |
| Overflow button | "`{n} unread`" at the top and bottom; clicking scrolls to the next unread, preferring DMs | D/features/sidebar/lib/useSidebarUnreadOverflow.ts:24-26; MoreUnreadButton.tsx:47-55; AppSidebar.tsx:823-827 |
| Community rail | Mention count badge, **or** a plain unread dot, mutually exclusive; nothing is shown unless the state is `ready` | CommunityRail.tsx:55-84, 163-173 |

### 3.3 Other row adornments

- **Agent working badge:** a pulsing elapsed-time pill with the tooltip "X working". It is hidden below the `sm` breakpoint (SidebarSection.tsx:123-153, 341-347).
- **Ephemeral badge** (SidebarSection.tsx:274-275, 328-334).
- **Agent provenance marker** on 1:1 agent DMs (`AgentManagementMarker`, :335-340).
- **Hover popover** `ChannelActivityPopover`, only when the row has working agents or thread unread (:364-372).
- **DM "×" close (hide):** visible on hover or focus on desktop and replaces the count badge on hover (:43-46, 504-522).
- **Context menu:** every row has one (mark read or unread, mute, copy) (:526-543).
- **Channel glyph:** `Lock` for a private channel, `FileText` for a forum, `Hash` otherwise, and the project icon on project homes (D/features/channels/ui/ChannelGlyph.tsx:17-28).

---

## 4. Avatar sizes

| Surface | Size | Citation |
|---|---|---|
| Bottom profile card | **32 px** (`h-8 w-8`, `size={32}`). The presence dot is 8 px (`h-2 w-2`) in a 14 px masked badge at bottom-right (−2, −2), with cutout r = 7.5 at (28, 28). | SidebarProfileCard.tsx:121-146 |
| DM row (1:1) | **24 px** (`DM_AVATAR_SIZE`). The status geometry is scaled from the default (dot 10, cutout 16 at a 34/34 centre). Agents use a squircle shape, humans a circle. | SidebarSection.tsx:49-53, 193-209; D/features/profile/ui/ProfileAvatarWithStatus.tsx:32-37 |
| Group DM | A 24 px circle showing the participant count (no avatar, no presence) | SidebarSection.tsx:179-191 |
| Unknown DM participant | `CircleDot` 16 px | SidebarSection.tsx:175-177 |
| Community rail icon | 36 px, `rounded-xl`; active indicator bar `h-5 w-1` | CommunityRail.tsx:127-147 |

---

## 5. Presence

### 5.1 Own presence (profile card)

- **Source:** `usePresenceSession(deferredPubkey).currentStatus`. This is **local state**, not the relay value (AppShell.tsx:230, 865).
- **Resolution:** `offline` when there is no pubkey or the preference is offline; `away` when the preference is away; otherwise automatic online/away from OS idle or in-app activity with a 10-minute idle threshold (D/features/presence/hooks.ts:350-359; D/features/presence/lib/presence.ts:61-72).
- **Preference storage:** localStorage `buzz-presence-preference:<pubkey>` (presence/hooks.ts:38, 53-84).
- **Publishing:** kind 20001 plus a 60 s heartbeat. See OLD_BUZZ_BOTTOM_LEFT_AUDIT §3.

### 5.2 Other users (DM rows)

1. `useDmSidebarMetadata` collects the other participant pubkeys, excluding the self pubkey and participants whose fallback label matches your own display name (D/features/sidebar/useDmSidebarMetadata.ts:23-47).
2. `usePresenceQuery(pubkeys)`:
   - **Query key:** `["presence", ...sortedLowercasePubkeys]`.
   - **queryFn:** Tauri `get_presence`, which sends HTTP `POST /query` with `{kinds:[20001], authors}` and keeps the latest status per subject. A `p` tag identifies the subject on relay-synthesized events; otherwise the author is the subject (T/commands/profile.rs:338-392).
   - **Relay side:** the relay synthesizes presence from Redis for these queries (C/buzz-relay/src/api/bridge.rs:2243-2253).
3. **Realtime:**
   - `usePresenceSubscription` keeps one live WS subscription for all pubkeys requested by active presence queries (`{kinds:[20001], authors, limit:0}`) and patches cached lookups with `setQueriesData`.
   - Live events trust the **event author only**, not a `p` tag.
   - It re-reconciles 100 ms after observers change and invalidates on reconnect (presence/hooks.ts:124-194; presence/lib/presence.ts:3-50).
4. **Polling backstop:** 60 s while focused and connected; staleTime 5 min; no refetch on window focus (presence/hooks.ts:24-36, 93-117).
5. **Row value:** `presence[otherPubkey] ?? "offline"`. A missing entry means offline even if the query has not loaded (useDmSidebarMetadata.ts:55-82).
6. **Shown only for 1:1 DMs:** when `participantPubkeys.length === 2`, or exactly one resolved participant (SidebarSection.tsx:226-238).
7. **Deferred load:** DM metadata (presence and profiles) loads after 400 ms, or immediately when a DM is selected (AppSidebar.tsx:386-400).

| Status | Dot class | Citation |
|---|---|---|
| online | `bg-emerald-500` | presence.ts:85-94 |
| away | `bg-amber-500` | same |
| offline | `bg-muted-foreground/35` | same |

**Realtime vs persisted:** presence is ephemeral kind 20001. Freshness comes from the WS live path first, then the HTTP snapshot and poll. The only thing persisted is your own preference, in localStorage.

---

## 6. Custom status display

- **Profile card:** second line = status emoji and text. On card hover it cross-fades to the community label ("🐝 {community name}"). With no status, the community label is always shown (SidebarProfileCard.tsx:86-99, 206-242).
- **DM rows:** `UserNameIndicators size="dm"` shows the status emoji (with the text in a tooltip) and 🎧 when the user is in a huddle. It only appears for 1:1 DMs (SidebarSection.tsx:318-326; D/features/user-status/ui/UserNameIndicators.tsx:17-80).
- **Data source:** the shared `UserStatusLookupProvider` mounted at the route root, falling back to a per-pubkey `useUserStatusQuery` (UserNameIndicators.tsx:26-40; D/app/routes/root.tsx:10). The protocol is in OLD_BUZZ_BOTTOM_LEFT_AUDIT §2.

---

## 7. Community identity display

- **Rail:** shown only when there is more than one community (AppShell.tsx:131, 761-770).
  - Each button has a tooltip with the name and unread state, supports drag reorder, and uses the icon image or a text fallback.
  - An "Add community" "+" button sits at the end.
  - Right-click menu: mark read, copy link, invite, settings (CommunityRail.tsx:88-185, 240-290, 376-424).
  - Icons are cached in localStorage `buzz-community-icons` (D/features/communities/communityIconCache.ts:7).
- **Profile card:** "🐝 {activeCommunity.name}", or "No community" (SidebarProfileCard.tsx:86-99).
- **Profile popover → community submenu:** see OLD_BUZZ_BOTTOM_LEFT_AUDIT §4. "Invite" is gated on the `myRelayMembershipLookup` role being owner or admin (SidebarProfileCard.tsx:63-65).
- There is **no community name header** at the top of the sidebar: the pinned header only contains search.

---

## 8. Profile card, popover, settings and sign out

- **Card:** display name = `profile.displayName` → `fallbackDisplayName` (the truncated pubkey from `get_identity`) → "Current identity" (AppSidebar.tsx:461-464; T/commands/identity.rs:32).
- **Avatar:** `profile.avatarUrl`, with the cached `avatarDataUrl` from localStorage as the offline fallback (SidebarProfileCard.tsx:138-145).
- **Popover and community submenu:** fully documented in OLD_BUZZ_BOTTOM_LEFT_AUDIT (Summary and §1, §4).
- **Settings:** the popover item and the `⌘,` / `Ctrl+,` shortcut (D/shared/lib/keyboard-shortcuts.ts:59-63).
- **Sign out:** NOT SUPPORTED in the sidebar or popover (OLD_BUZZ_BOTTOM_LEFT_AUDIT, Summary).

---

## 9. Ordering and sorting

| Group | Default | Options | Tie-break / rules | Citation |
|---|---|---|---|---|
| Starred, Channels, Forums, each custom section | `alpha` | `recent`, `alpha` (menu labels "Recent" and "A–Z") | `alpha`: lowercase name by code unit, then id. `recent`: `lastMessageAt` descending; channels without activity sink to the bottom in alphabetical order. | channelSortPreference.ts:7, 25, 155-186; CustomChannelSection.tsx:72-75 |
| Direct messages | `alpha` | same | `alpha`: resolved DM label with `localeCompare`, then id. `recent`: newest first; quiet DMs last, in label order. | D/features/sidebar/lib/dmSidebarSort.ts; AppSidebar.tsx:401-409 |
| Custom sections themselves | user order | Drag-and-drop or "Move up/down" | — | AppSidebar.tsx:274-276, 622-690 |

Persistence of sort, sections, stars and mutes: each is stored in localStorage **and** synced as encrypted NIP-78 **kind 30078** app data.

| Preference | localStorage key | d-tag |
|---|---|---|
| Sort | `buzz-channel-sort.v1:<pubkey>[:<relay>]` | `channel-sort` |
| Sections | `buzz-channel-sections.v1…` | `channel-sections` |
| Stars | `buzz-channel-stars.v1…` | `channel-stars` |
| Mutes | `buzz-channel-mutes.v1…` | `channel-mutes` |

Citations: channelSortPreference.ts:4, 43-48; D/features/sidebar/lib/channelSortSync.ts:20, 45; channelSectionsSync.ts:21; channelStarsSync.ts:21; channelMutesSync.ts:21; D/shared/constants/kinds.ts:49-52.

---

## 10. Section collapse and section actions

- **Collapse:** clicking the section label toggles it. A chevron appears on hover or focus and rotates −90° when collapsed; the label has `aria-expanded` (SidebarSection.tsx:37-42, 435-465).
- **Collapse state** is React state only. Starred, Channels, Forums and DMs default to expanded; custom sections are tracked by id. It is **not persisted** (AppSidebar.tsx:239-266).
- **Section header actions** use the reveal class `opacity-0`, shown on group hover, focus-within or when the menu is open (D/features/sidebar/ui/sidebarSectionStyles.ts:1-5).
- **⋮ menu items**, rendered only when a handler exists (CustomChannelSection.tsx:160-290):
  - Mark all as read
  - New message
  - Browse channels
  - Create channel / New forum
  - Rename section
  - Move up / Move down
  - Sort (Recent / A–Z)
  - Delete section

---

## 11. Responsive behaviour

- **Below 768 px:** the sidebar becomes a Sheet (288 px) and the resize rail does not apply (sidebar.tsx:316-337; use-mobile.ts:5).
- **Mobile hit areas:** row action buttons get a larger invisible hit area, and hover-only actions are always visible below `md` (SidebarSection.tsx:43-46, 508).
- **Working badge:** hidden below `sm` (SidebarSection.tsx:142).
- **Relay connection card:** shown only while the sidebar is open (`isMobile ? openMobile : sidebarOpen`) (AppSidebar.tsx:835-836).

---

## 12. Keyboard

Registry: D/shared/lib/keyboard-shortcuts.ts:27-119. Handlers: D/app/useAppShellKeyboardShortcuts.ts:56-100 and sidebar.tsx:206-219.

| Shortcut | Action |
|---|---|
| Cmd/Ctrl+K | Open "Search everything" |
| Cmd/Ctrl+F | Scoped search in the current channel (channel view only) |
| Shift+Cmd/Ctrl+K | New direct message |
| Shift+Cmd/Ctrl+N | Create channel |
| Shift+Cmd/Ctrl+O | Browse channels |
| Shift+Cmd/Ctrl+A | Home (Inbox) |
| Cmd/Ctrl+S | Toggle sidebar |
| Cmd/Ctrl+, | Settings |
| Esc / Shift+Esc | Mark current channel read / mark all read |
| Cmd+[ / ] (Alt+←/→ on Windows) | Back / forward |
| Ctrl+Shift+Space | Huddle (capture phase) |

Arrow-key movement between sidebar rows, and jump-to-next-unread shortcuts: **NOT SUPPORTED** (none found). Rows are ordinary buttons, reachable with Tab.
