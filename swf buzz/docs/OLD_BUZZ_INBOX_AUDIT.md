# OLD BUZZ — Inbox Audit (source-derived)

Scope: behavior of the Inbox in the OLD BUZZ desktop app, derived only from source. Nothing here comes from clicking the running app.

Path abbreviations used in citations:

- `D/` = `C:\Users\lenovo\New folder (2)\buzz\buzz\desktop\src\`
- `T/` = `C:\Users\lenovo\New folder (2)\buzz\buzz\desktop\src-tauri\src\`
- `C/` = `C:\Users\lenovo\New folder (2)\buzz\buzz\crates\`

Citation format: `file:line` or `file:start-end`.

Terminology: in code the Inbox is the **Home** route (`/`) and its components live in `D/features/home/`. The user-facing label is "Inbox".

---

## 1. Entry Point

| Aspect | Finding | Source |
|---|---|---|
| Button | First item of the sidebar primary menu. It uses the lucide `Inbox` icon, the label "Inbox", and the tooltip "Inbox". The other items, in order, are Pulse, Projects, Agents, (Bestie), and Workflows. | `D/features/sidebar/ui/AppSidebarPinnedHeader.tsx:110-129` |
| Active state | `isActive={selectedView === "home"}`, and it keeps `data-[active=true]:font-normal`, so the active item is not bold. | `AppSidebarPinnedHeader.tsx:111-113` |
| Click handler | `onSelectHome` calls `goHome()`. | `D/app/AppShell.tsx:890` |
| Route | `goHome` navigates to `to: "/"`. | `D/app/navigation/useAppNavigation.ts:74-83` |
| Route definition | `createFileRoute("/")` with validated search params `item`, `profile`, `profileTab`, and `profileView` (all optional strings). | `D/app/routes/index.tsx:13-44` |
| Route resolution | Any pathname that is not `/channels/*`, `/messages/new`, `/agents`, `/workflows*`, `/projects*`, or `/pulse` resolves to `selectedView: "home"`. | `D/app/AppShell.helpers.ts:215-268` |
| Legacy route | `/reminders` redirects to `/`. Reminders is now a filter inside the Inbox. | `D/app/routes/reminders.tsx:1-10` |
| Keyboard shortcut | **Cmd/Ctrl + Shift + A** calls `onGoHome()`. It is ignored if Alt is held, if the key is repeating, or if the event is already `defaultPrevented`. | `D/app/useAppShellKeyboardShortcuts.ts:56-100` |
| Badge | A count badge (`data-testid="sidebar-home-count"`) is shown when `homeBadgeCount > 0` and is capped at 99. | `AppSidebarPinnedHeader.tsx:121-128` |
| Badge value | `homeBadgeCount + dueReminderBadge`. | `D/app/AppShell.tsx:835` |

## 2. Overall Architecture

- **It is a full route view, not a modal.** The `/` route renders `HomeScreen`, which renders `HomeView` (`D/app/routes/index.tsx:93-100`, `D/features/home/ui/HomeScreen.tsx:51-73`).
- `HomeView` renders a CSS grid (`data-testid="home-inbox"`). The grid sits inside the app content area, to the right of the app sidebar (`D/features/home/ui/HomeView.tsx:661-683`).
- **Columns inside the Inbox:**
  1. **List pane.** Component: `InboxListPane`. Width comes from `--home-inbox-list-width`.
  2. **Detail pane.** Component: `InboxDetailPane` for messages, or `HomePersonalInboxDetail` for drafts and reminders. Its track is `minmax(0,1fr)`.
  3. **Optional right auxiliary pane.** Component: `RightAuxiliaryPane`. Width comes from `--home-channel-management-width`. It hosts either `UserProfilePanel` or `ChannelManagementSheet`.

  Grid template selection (`HomeView.tsx:663-674`):

  | Condition | Template |
  |---|---|
  | list + detail + aux | `[list]_minmax(0,1fr)_[aux]` |
  | list + detail | `[list]_minmax(0,1fr)` |
  | aux only | `minmax(0,1fr)_[aux]` |
  | single-panel aux | `grid-cols-1` |
  | otherwise | `grid-cols-1` |
- With the app sidebar counted, the widest layout is 4 visual columns: app sidebar | list | detail | aux.
- A shared translucent header backdrop, `h-13` (52px), is drawn across the top of the list and detail panes (`HomeView.tsx:684-690`).
- A draggable resize handle sits between the list and the detail pane (`HomeView.tsx:759-780`).
- Narrow behavior: when the measured Inbox width is under 600px, the layout switches to a single column (`INBOX_SINGLE_COLUMN_BREAKPOINT_PX = 300*2`, `D/features/home/useResizableInboxListWidth.ts:4-5`; `HomeView.tsx:108-111`; `D/features/home/lib/homePaneLayout.ts:18-54`).

## 3. Left Sidebar (while the Inbox is open)

- The Inbox nav item is active (`selectedView === "home"`) (`AppSidebarPinnedHeader.tsx:113`).
- No channel row is selected, because `deriveShellRoute` returns `selectedChannelId: null` for home (`AppShell.helpers.ts:264-267`).
- The sidebar is not hidden or collapsed by the Inbox. The only thing the Inbox changes is the `selectedView` prop. Sidebar width and state are global: default 300px, max 420px, localStorage `buzz-sidebar-width`, cookie `sidebar_state`, and Cmd/Ctrl+S toggles it (`D/shared/ui/sidebar.tsx:28-38, 200-216`).
- **Badge while the Inbox is open.** `useHomeFeedNotificationState` receives `isHomeActive = selectedView === "home" && !settingsOpen` (`D/app/AppShell.tsx:450-460`). While home is active:
  - Every current badge feed id is merged into the "seen" set (`D/features/notifications/hooks.ts:447-458`).
  - Only locally-forced-unread items keep counting (`hooks.ts:474-478`).

  In effect, opening the Inbox clears the numeric badge, except for items that were marked unread manually.
- The seen set persists in localStorage key `buzz-home-feed-seen.v1:<pubkey>` and holds at most 500 ids (`D/features/notifications/use-feed-desktop-notifications.ts:29-44`; `hooks.ts:39,177-179`).
- Badge counting rules:
  - Items in muted channels are excluded unless they are mentions (`hooks.ts:479-485`).
  - The badge is gated by the setting `settings.homeBadgeEnabled` (`hooks.ts:463-465`).
  - Badge items are: mentions, needs-action items, non-thread extra items, and locally-unread activity or agent items (`D/features/notifications/lib/homeBadge.ts:22-51`).
- Sidebar channel hover popover: `ChannelActivityPopover` also uses `buildInboxItems` and clears the `"inbox"` forced-unread source (`D/features/sidebar/ui/ChannelActivityPopover.tsx:9,357`). It is related to the Inbox but is not part of the Inbox view.

## 4. Middle Inbox (the list pane)

- Component: `InboxListPane` (`D/features/home/ui/InboxListPane.tsx:243-770`).
- Structure:
  - A `<section>` with class `relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60`.
  - A right divider when both panes are visible (`InboxListPane.tsx:604-609, 79-80`).
- Header: see §6.
- Body variants by filter:

  | Filter | Body | Source |
  |---|---|---|
  | `reminders` | `RemindersPanel presentation="inbox-list"` | `InboxListPane.tsx:677-690` |
  | `drafts` | `DraftsPanel` | `InboxListPane.tsx:691-702` |
  | everything else | A virtualized list (`VirtualizedList`, `estimateSize={96}`, default overscan 5) inside a scroll container with `data-testid="home-inbox-list"` | `InboxListPane.tsx:703-747`; `D/shared/ui/VirtualizedList.tsx:76-82` |

- Rows in the virtualized list are built by `buildInboxListRows` (`D/features/home/lib/inboxListRows.ts:19-82`):
  - One `inbox` row per conversation group. A pending reminder that targets the group's events is attached as `dueReminder`.
  - Standalone due-reminder rows (`kind: "reminder"`) are added, but only in the **All** filter (`InboxListPane.tsx:288-294`).
  - Reminders are dropped entirely when unread-only is on (`InboxListPane.tsx:280-284`).
  - Rows are sorted by `sortAt` descending.
- **No day-group headers are rendered.** `groupInboxItems` exists (`D/features/home/lib/inbox.ts:442-460`), but no UI file calls it (grep result: the only definition is in `inbox.ts`).
- Inbox row anatomy (`InboxListPane.tsx:344-557`):
  - A full-row invisible `<button>` with `aria-label="Open inbox item from {sender}"` that selects the row (`:355-370`).
  - The avatar, a 36px `UserAvatar` inside `UserProfilePopover`. Agents are drawn as a squircle (`rounded-[30%]`); everyone else as a circle (`:378-404`).
  - The sender name (`text-sm font-semibold`), also wrapped in `UserProfilePopover` (`:406-422`).
  - On the right: an unread dot (`h-1.5 w-1.5 rounded-full bg-primary`, shown when not read), an "{n} unread" label when `unreadCount > 1`, and the timestamp. This group fades out on hover or focus (`:423-441`).
  - The type label from `getInboxTypeLabel`. See the table below (`inbox.ts:271-317`; rendered by `InboxLabel` at `InboxListPane.tsx:82-118`).
  - An optional "Reminder due" line with a Bell icon (`:448-456`).
  - An optional reopen status: a spinner with "Reopening…", or an alert with "Couldn’t reopen" plus a "Retry" link (`:458-497`).
  - The preview, rendered as markdown (`VideoReviewCommentMarkdown`, `interactive={false}`) and clamped to 2 lines by CSS. It is bold when unread and normal/muted when read (`:499-514`; `D/shared/styles/globals/markdown.css:131-168`).
  - Hover actions: see §17.

  Type label text:

  | Row kind | Label | Source |
  |---|---|---|
  | Project | "Review" / "Task" / "Project update" | `inbox.ts:274-280, 131-135` |
  | DM | "DM from {sender}", or "DM" | `inbox.ts:282-287` |
  | Mention | "Mentioned in #chan", or "Mentioned" | `inbox.ts:290-295` |
  | Needs action | "Needs action in #chan", or "Needs action" | `inbox.ts:297-302` |
  | Thread activity | "Thread in #chan", or "Thread" | `inbox.ts:304-309` |
  | Other | "{headline} in #chan", or "{headline}" | `inbox.ts:311-316` |

- Standalone reminder row (`PersonalItemRow`, `InboxListPane.tsx:162-211`):
  - A Bell avatar and the title "Reminder".
  - A location: "In DM with X", or "In #chan".
  - A preview.
  - A status: "Pending", "Reminder due", "Reminder in less than a minute", or "Reminder in {n}m/h/d" (`:120-132`).
- Grouping: events are grouped per conversation (§26), and each list row is one conversation.

## 5. Right Context Panel

There are two different "right" surfaces.

### 5a. Detail pane (the message context; always shown on wide layouts)

- It opens when a row is selected.
- On wide layouts the **first visible item is auto-selected** (`D/features/home/useHomeInboxAutoSelection.ts:18-60`; `D/features/home/lib/inboxSelection.ts:3-20`). On narrow layouts nothing is auto-selected.
- Contents:
  - **Project items** (Buzz Git PR/issue) use `ProjectInboxDetail` (`D/features/home/ui/InboxDetailPane.tsx:147-157`).
  - **Everything else** uses `InboxMessageDetailPane` (`InboxDetailPane.tsx:166-900`):
    - A header (§6b).
    - A scrollable conversation built from the thread context (`useInboxThreadContext`): the thread root, the ancestors of the selected event, and descendants of the root (§26).
    - The selected message is highlighted, with an unread divider.
    - An inline `MessageComposer` for replies.
    - A lazy `MembersSidebar`.
- If nothing is selected, it shows the Mail icon, "Select a message", and "Pick an inbox item to see the full message and react to it." (`InboxDetailPane.tsx:435-452`).
- Drafts and reminders modes use `HomePersonalInboxDetail`, which renders `DraftDetailPane` or `ReminderDetailPane` (`D/features/home/ui/HomePersonalInboxDetail.tsx:1-45`).

### 5b. Auxiliary pane (the third column)

It is opened by these triggers:

1. **Clicking an avatar or name** (in a list row, or in a detail-pane message).

   `UserProfilePopover.handleTriggerClick` calls `openProfilePanel(pubkey)` from `ProfilePanelContext` (`D/features/profile/ui/UserProfilePopover.tsx:173-184`). `HomeView` wraps everything in `ProfilePanelProvider onOpenProfilePanel={handleOpenProfilePanel}` (`HomeView.tsx:647`).

   `handleOpenProfilePanel` does two things:
   - clears the managed channel
   - writes `?profile=<pubkey>` and clears `profileTab` and `profileView` (`HomeView.tsx:181-191`)

   The result is `RightAuxiliaryPane` containing `UserProfilePanel` with `layout="split"` (`HomeView.tsx:935-960`).

   Enter or Space on a focused trigger does the same (`UserProfilePopover.tsx:199-211`).

   Hovering the trigger for 500ms opens a profile **popover**, not the panel (`UserProfilePopover.tsx:152-160`; `D/shared/ui/popover.tsx:19`). It closes 200ms after the pointer leaves (`UserProfilePopover.tsx:64,162-167`).
2. **"Manage channel" from `ChannelMembersBar`** in the detail header.

   `onManageChannel` closes the profile panel and sets `managedChannelId` (`InboxDetailPane.tsx:668-681`; `HomeView.tsx:818-821`). The result is `RightAuxiliaryPane` containing `ChannelManagementSheet` with `layout="split"` (`HomeView.tsx:961-983`).

   The managed-channel state is local React state and is **not** in the URL (`HomeView.tsx:168-170`).
3. **Deep links or history** with `?profile=` in the URL (`HomeView.tsx:152-158`).

The profile panel wins over channel management if both are set (`HomeView.tsx:935, 961`).

A separate `HomeMembersSidebarOverlay` is opened from `ChannelManagementSheet`'s `onOpenMembers` (`HomeView.tsx:974, 986-990`).

## 6. Header Controls

### 6a. List-pane header

`TopChromeInsetHeader flush transparent` wraps a `px-5 py-2` row with `min-h-9` (`InboxListPane.tsx:610-675`).

| Order (visual) | Element | Label / aria | Default | Source |
|---|---|---|---|---|
| Left (`order-1`) | Filter dropdown trigger (`InboxFilterMenu`) | Shows the active filter label and a ChevronDown. aria-label is `Filter inbox: {label}[. {n} due reminder(s) \| {n} active draft(s)]`. | "All" | `D/features/home/ui/InboxFilterMenu.tsx:39-68`; state default `"all"` at `HomeView.tsx:112` |
| Right (`order-2`) | "Inbox options" button (Ellipsis icon, `h-8 w-8`) that opens a Popover (`w-60`, align end) | `aria-label="Inbox options"` | closed | `InboxListPane.tsx:613-662` |
| inside popover | Switch labeled "Show unread only" (`id=inbox-unread-only-switch`). Disabled, and rendered at 50% opacity, for Reminders and Drafts. | — | off (`unreadOnly=false`, `HomeView.tsx:113`) | `InboxListPane.tsx:626-646` |
| inside popover | Separator | — | — | `:647` |
| inside popover | Button "Mark all as read", with the count of unread visible items on the right. Disabled when the count is 0. | — | — | `:648-660, 296-307` |

The Inbox header has no title text. There is no search box and no "Clear" button.

### 6b. Detail-pane header

`px-5 py-2`, `min-h-9` (`InboxDetailPane.tsx:545-692`).

| Element | Label | Condition | Source |
|---|---|---|---|
| Back button (ArrowLeft, ghost, round) | `aria-label="Back to inbox list"` | Single-panel (narrow) only | `:554-565`; `HomeView.tsx:806-812` |
| Context title (h2). It is a button when the channel can be opened, and underlines on hover. | "Thread in #chan" / "Thread" / "Thread with {sender}" / "DM with {sender}" / "Message in #chan" / type label. Its tooltip (`title`) is the open label. | Always | `:566-596, 497-521` |
| `UpdateIndicator` | (app update indicator) | Always rendered, with internal logic | `:602` |
| Reopen status pill | "Reopening…", or "Couldn’t reopen" + "Retry" | Hidden-DM reopen only | `:603-643` |
| Open-context icon button (ExternalLink) | Tooltip and aria text: "Open full thread" / "Open conversation" / "Open in channel" | `canOpenChannel && channelId` | `:644-667` |
| `ChannelMembersBar` | Members toggle and a manage-channel action | Selected channel is known | `:668-681` |
| More actions (MoreHorizontal) opens a dropdown with one item: "Delete message" (Trash2, destructive) | aria and tooltip: "More actions" | `canDelete`, meaning the current user authored the item | `:682-687, 902-941`; `D/features/home/lib/homeMessageCapabilities.ts:23-26` |

## 7. Dropdowns

### 7a. Filter dropdown (`InboxFilterMenu`)

Built from `DropdownMenuRadioGroup` with content `w-52` aligned to start (`InboxFilterMenu.tsx:69-104`). Options in exact order (`InboxFilterMenu.tsx:14-26`):

| # | Label | Value | What it matches |
|---|---|---|---|
| 1 | **All** | `all` | Any of: DM (the representative item's `channelType === "dm"`), a mention, a thread reply (a non-broadcast reply with a parent), a Buzz Git project item, needs_action, or a representative sender in the user's **owned agents**. See `D/features/home/lib/inboxViewHelpers.ts:50-54, 78-102`. |
| 2 | **Projects** | `project` | Any group event is a Buzz Git project event (`inboxViewHelpers.ts:62-66`). |
| 3 | **Mentions** | `mention` | The `categories` include `mention` (`inboxViewHelpers.ts:75`). |
| 4 | **Threads** | `thread` | Any group event is a non-broadcast thread reply (`inboxViewHelpers.ts:56-60`). |
| 5 | **Needs action** | `needs_action` | The `categories` include `needs_action` (`inboxViewHelpers.ts:75`). |
| 6 | **Agents** | `agent_activity` | The representative sender's pubkey is in `ownedAgentPubkeys` (`inboxViewHelpers.ts:68-73`). |
| — | *(separator `my-2 bg-border/60`)* | | `InboxFilterMenu.tsx:76-78` |
| 7 | **Reminders** | `reminders` | Shows `RemindersPanel`. A badge shows `reminders.length` when it is greater than 0. |
| 8 | **Drafts** | `drafts` | Shows `DraftsPanel`. A badge shows `activeDraftCount` when it is greater than 0. |

`ownedAgentPubkeys` is built by `useOwnedAgentPubkeys`. It combines the managed agents with every profile whose `ownerPubkey` equals the current user (`D/features/home/useOwnedAgentPubkeys.ts:7-16`; `D/features/agents/knownAgentPubkeys.ts:27-52`).

- **Selected state:** a radio indicator from the shared dropdown component, bound through `value={filter}`. The trigger text shows the active label.
- **State location:** local React `useState` (`HomeView.tsx:112`). **The filter is NOT stored in the URL**, so it resets to "All" when the component remounts or the page reloads. The route comment says Reminders is "selected via local state rather than the URL" (`D/app/routes/reminders.tsx:3-6`).
- **On change** (`handleFilterChange`, `HomeView.tsx:535-581`):
  - It computes the next visible items and calls `resolveInboxFilterSelection`.
  - The current selection is kept if its conversation is still visible.
  - Otherwise `?item` is cleared and the first item is auto-selected on wide layouts (none on narrow).
  - Switching to Reminders or Drafts clears `?item` and the auto-selection.
  - The unread boundary, the selected draft, and the selected reminder are always reset.
  - **No refetch**, because the change is client-side filtering only.

### 7b. Other dropdowns

- "Inbox options" popover: see §6a.
- Detail-pane "More actions": see §6b.
- There is no sort dropdown and no community/channel scope dropdown: **not present in OLD BUZZ source**.

## 8. Filters

- Type filter: §7a.
- Read filter: the "Show unread only" switch (`InboxListPane.tsx:638-645`) sets `unreadOnly` (`HomeView.tsx:113, 748`). When it is on, only items not in `effectiveDoneSet` are shown. **The currently selected conversation stays visible** even after it becomes read (`HomeView.tsx:421-436`). Due reminders are hidden while it is on (`InboxListPane.tsx:280-284`).
- Baseline filter: `filterInboxItems` always removes events of kind 40007 (`KIND_REMINDER`) (`inboxViewHelpers.ts:28-30`).
- Persistence: none. Both the filter and `unreadOnly` are local state.

## 9. Tabs

- **There are no tabs.** Categories are chosen from one dropdown (§7a).
- Exact labels in code order: `All, Projects, Mentions, Threads, Needs action, Agents, Reminders, Drafts` (`InboxFilterMenu.tsx:17-26`).
- "Activity" is **not** a filter option. Rows with `category: "activity"` appear only through All, Threads, or Projects, and only when they match those predicates.
- "Agent updates" is **not** the label. The label is "Agents". "Agent update" does appear as a headline or category label string (`inbox.ts:172-174, 202-203`).
- "Needs action" is the dropdown label (sentence case). "Needs Action" (title case) is `categoryLabel`, which is computed but not rendered in the list row (`inbox.ts:197-205`).

## 10. Mentions

- **Source:** the relay `/query` with a filter on `#p = [my_pubkey]` over these kinds:
  - 9, 40002, 1, 45001, 45003
  - Git kinds 1618, 1619, 1621, 1630, 1631, 1632, 1633
  - `limit = min(limit, 100)`; the client passes `limit: 50`, and there is an optional `since`

  See `T/commands/messages.rs:74-95, 106-112` and `C/buzz-core/src/kind.rs:613-625`. The client call is in `D/features/home/hooks.ts:25-38`.
- Mention detection is therefore done **by the relay on the `#p` tag**. There is no client-side text parsing for list membership.
- Edits of mentions are fetched (kind 40003 `#e`) to decide link-preview suppression (`messages.rs:121-137`).
- Row label: "Mentioned in #chan" (§4).
- Live refresh: `onLiveMention` refetches the home feed (`D/app/AppShell.tsx:404`, `refetchHomeFeedFromLiveSignal` at `:245-251`).

## 11. Threads

- The backend `activity` array is always empty (`T/commands/messages.rs:156`). Thread rows come from the client-side `threadActivityFeedItems`, which are appended to `feed.activity` (`D/features/home/ui/HomeScreen.tsx:33-49`).
- These items are synthesized from live channel events. `useLiveChannelUpdates` calls `onThreadReplyNotification` when **all** of the following hold:
  - the event is an external trigger (not your own)
  - it is the first delivery of that event
  - `shouldNotifyForEvent` is true
  - `isHomeActivityEvent` is true, meaning a threaded reply **or a DM**

  See `D/features/channels/useLiveChannelUpdates.ts:92-97, 283-313`.
- `shouldNotifyForEvent` passes for:
  - broadcast replies
  - mentions
  - top-level messages in unmuted channels
  - replies in participated, followed, or authored roots

  It fails for muted roots and channels (`D/features/notifications/lib/shouldNotify.ts:28-70+`).
- Stored in `localStorage` key `buzz-thread-activity.v1:<normalizedRelayUrl>:<pubkey>`, max 100 items (`D/features/channels/threadActivityStorage.ts:14-21`; `useUnreadChannels.ts:540-570`).
- Muted roots and channels not in the active community are filtered out (`D/app/useThreadActivityFeedItems.ts:7-40`).
- Row label: "Thread in #chan". The "Threads" filter matches any non-broadcast reply in the group.
- Detail-pane title: "Thread in #chan". The composer placeholder is "Send reply to #chan thread" (`InboxDetailPane.tsx:503-508, 873-877`).

## 12. Messages / DMs

- DM messages enter the Inbox through the same live path, because `isHomeActivityEvent` returns true for DM channels (`useLiveChannelUpdates.ts:92-97`).
- They are grouped per DM channel: `conversationId = dm:<channelId>` (`inbox.ts:389-391`).
- Hidden DMs are forced to `channelType: "dm"` by `markHiddenDmFeedItems` (`D/features/channels/dmResurface.ts:46-66`; `HomeScreen.tsx:48`).
- Row label: "DM from {sender}".
- Detail title: "DM with {sender}". Open label: "Open conversation". Composer placeholder: "Message {sender}". Replies in a DM are sent with `parentEventId = null` (top level) (`InboxDetailPane.tsx:479-481, 509-510, 519-520, 873-876`).
- DM unread count uses the channel read marker, `getChannelReadAt(channelId)` (`inbox.ts:554-557, 566-570`).
- Opening a **hidden** DM first reopens it on the relay. It fetches the members, then `openDm`, and verifies the returned channel id. On failure it shows the toast "Could not reopen conversation. Try again." and the row shows "Couldn’t reopen / Retry" (`D/features/home/hiddenDmInboxAction.ts:27-76`; `D/features/home/useHiddenDmInboxNavigation.ts:55-86`).

## 13. Needs Action

- **Source:** relay `/query` with `kinds [46010, 46011, 46012]`, `#p=[me]`, `limit 20`, and an optional `since` (`T/commands/messages.rs:96-104, 113-119, 146-149`).

  | Kind | Constant | Source |
  |---|---|---|
  | 46010 | `KIND_WORKFLOW_APPROVAL_REQUESTED` | `C/buzz-core/src/kind.rs:578` |
  | 46011 | `..._GRANTED` | `C/buzz-core/src/kind.rs:580` |
  | 46012 | `..._DENIED` | `C/buzz-core/src/kind.rs:582` |
- Live: subscription `{kinds:[46010, 40007], "#p":[me], limit:50, since:now}`. Each event triggers a home-feed refetch (`D/app/useLiveHomeFeedActions.ts:12, 65-74`).
- Row: the label "Needs action in #chan" in amber (`text-amber-600/80`, dark `text-amber-300/80`) while not done (`InboxListPane.tsx:96-100`). `isActionRequired` = the categories include needs_action (`inbox.ts:616`).
- Headline for 46010 is "Approval requested". If the preview is empty it reads "A workflow is waiting for approval." (`inbox.ts:165-166, 186-188`).
- **There is no approve/deny button in the Inbox list or detail header.** Not present in the OLD BUZZ Inbox source. Whether approval UI is rendered inside the message body markdown was not verified in OLD BUZZ.

## 14. Agent Updates

- The backend `agent_activity` array is **always empty** (`T/commands/messages.rs:157`), even though the client requests `types: "mentions,needs_action,activity,agent_activity"` (`D/features/home/hooks.ts:30-31`).
- The "Agents" filter works instead on the **sender identity**: rows whose representative sender is an owned agent (§7a).
- Job kinds 43001–43006 map to the headlines "Job requested / accepted / Progress update / Job result / Job cancelled / Job failed" (`inbox.ts:149-160`). These kinds are **not** in the mention query filter (`messages.rs:76-89`). Whether they ever reach the Inbox (for example through thread activity) was not verified in OLD BUZZ (runtime). Source indicates only that the headline mapping exists.

## 15. Read / Unread

**What marks read:**

- **Selecting a row.** `onSelect` calls `markItemRead(itemId)` (`HomeView.tsx:721-735`).
- The "Mark as read" hover action or context-menu item (`InboxListPane.tsx:527-533, 569-574`).
- "Mark all as read" in the options popover. It marks every **visible, filtered** unread item (`InboxListPane.tsx:301-307`).
- Global **Shift+Esc**, "mark all read". It marks all channel markers and clears the local unread feed ids (`D/app/useMarkAsReadShortcuts.ts:35-38`; `D/app/AppShell.tsx:431-448`).

**`markItemRead` algorithm** (`D/features/home/useHomeInboxReadState.ts:210-273`):

1. Clear the local unread overrides for every grouped id.
2. Clear the channel's `"inbox"` forced-unread source when no other override remains.
3. **If the item is a thread reply:**
   - Advance a per-message marker `msg:<id>` for each reply.
   - Advance `thread:<root>` to `latestActivityAt`.
   - Advance the channel marker to the latest non-thread grouped event (`topLevelOnly`, `preserveForcedUnread`).
4. **Else, if it is channel-backed:** `markChannelRead(channelId, ISO(latestActivityAt), {preserveForcedUnread:true})`.
5. **Else:** local `markDone`.

**`markItemUnread`** (`useHomeInboxReadState.ts:275-290`):

- `undoDone`, then `markUnreadLocal(id)`.
- For channel items, `markChannelUnread(channelId, "inbox")`, which forces the channel's unread indicator.

**How read state is computed.** An item is read when `latestActivityAt <= readAt`, where `readAt` comes from these markers (`useHomeInboxReadState.ts:113-134, 171-208`):

- thread item: the message marker, else the thread marker
- channel item: the channel marker
- neither: the local done set

A local unread override always wins.

**Persistence:**

| Store | Location | Source |
|---|---|---|
| NIP-RS read state (shared across devices) | Relay event **kind 30078** (`KIND_READ_STATE`) with `d = read-state:<slotId>` and tag `t = read-state`. Content is a NIP-44 self-encrypted JSON blob `{v:1, client_id, contexts:{...}}`. Context keys include the channel id, `thread:<root>`, and `msg:<id>`. Max 8 slots, 32 KB plaintext each. Fetched with `{kinds:[30078], authors:[me], "#t":["read-state"], since: now-7d, limit:500}`. | `D/shared/constants/kinds.ts:48`; `D/features/channels/readState/readStateFormat.ts:1-60`; `D/features/channels/readState/readStateManager.ts:435-445, 690-712` |
| Local read-state mirror | localStorage `buzz.channel-read-state.v2:<pubkey>`, `buzz.channel-read-state.publishable.v1:<pubkey>`, `buzz.channel-read-state.source-created-at.v1:<pubkey>` | `readStateFormat.ts:64-74` |
| Local done / unread fallback | localStorage `buzz-home-feed-done.v1:<pubkey>` and `buzz-home-feed-unread.v1:<pubkey>`, max 500 each | `D/features/home/useFeedItemState.ts:3-5, 7-35` |
| Forced-unread channels | localStorage `buzz-forced-unread.v1:<pubkey>` | `D/features/channels/forcedUnreadStore.ts:76-78` |
| Badge "seen" ids | localStorage `buzz-home-feed-seen.v1:<pubkey>` | §3 |

**Visual changes when an item is read:**

- The unread dot is removed.
- The preview changes from `font-semibold text-foreground` to `font-normal text-muted-foreground`.
- The type label becomes `text-muted-foreground/70 font-normal`, and the amber color is removed.
- The timestamp weight changes from `font-medium` to `font-normal`.

See `InboxListPane.tsx:96-100, 423-441, 499-506`.

**Per-row unread count.** `unreadCount` counts unread events in the group. "{n} unread" is shown only when the count is greater than 1 (`inbox.ts:566-580, 624`; `InboxListPane.tsx:435-439`).

## 16. Clear / Done / Archive

- **Clear:** not present in OLD BUZZ source (no match in `D/features/home`).
- **Archive:** not present. The only "archive" reference is `channel?.archivedAt`, which gates message editing (`InboxDetailPane.tsx:756-757`).
- **Done:** a local "done" set exists only as the internal fallback for items with no channel (§15). `FeedSection.tsx` has "Mark done / Undo done" (`D/features/home/ui/FeedSection.tsx:249`), but **FeedSection is not imported anywhere** (grep), so it is dead code.
- The Inbox has no row-removal action. The only reversible pair is Mark as read / Mark unread. Items leave the list only by filter or unread-only.

## 17. Context Menus / Hover Actions

**Hover or focus-within action pill.** Position: `absolute right-3 top-2`, `rounded-full`, `p-1`, background `--inbox-row-highlight-bg`, fading in over 150ms. Each button is `h-8 w-8 rounded-full` with a Tooltip. See `InboxListPane.tsx:519-556, 772-811`.

| # | Icon | Label | Action | Disabled when |
|---|---|---|---|---|
| 1 | MailOpen | "Mark as read" (if unread) / "Mark unread" (if read) | `onMarkRead` / `onMarkUnread` | never |
| 2 | ExternalLink | "Open in channel" / "Reopening…" / "No channel link" | `onOpenDirect(item)` → navigate to the channel (§24) | no `channelId` or reopen pending |
| 3 | Clock | "Remind me later" / "Reminder set" (active style `bg-blue-500/10 text-blue-500`) / "Cannot remind without a channel" | `openReminder({authorPubkey, channelId, eventId, preview: first 100 chars})` | no `channelId` |

Also on hover: the timestamp group hides, and the type label gets `pr-[6.75rem]` so the pill does not overlap it (`InboxListPane.tsx:95, 425`).

**Right-click context menu.** Radix `ContextMenu` around every inbox row (`InboxListPane.tsx:560-599`). Items, in order:

1. "Mark as read" / "Mark unread" (MailOpen)
2. separator
3. "Open in channel" / "Reopening…" / "No channel link" (ExternalLink; disabled when it cannot open)
4. "Remind me later" / "Reminder set" (Clock; disabled with no channel)

Reminder rows and draft rows have no context menu (`PersonalItemRow`, `InboxListPane.tsx:162-211`).

**Detail pane per-message actions.** `MessageActionBar` provides reply, reactions, edit, delete, and copy link, each only where permitted (`D/features/home/ui/InboxMessageRow.tsx:156-182`). The individual options come from the shared `MessageActionBar` component and are not enumerated in this audit.

## 18. Search

- **Not present in OLD BUZZ source.** The Inbox has no search box or search state. `InboxListPane` has no input (`InboxListPane.tsx:603-770`).
- Global search (`TopbarSearch` in the sidebar, Cmd/Ctrl+K) is app-wide, not Inbox-scoped (`AppSidebarPinnedHeader.tsx:73-87`; `useAppShellKeyboardShortcuts.ts:73-77`).

## 19. Scrolling

**List pane:**

- It is its own scroll container (`overflow-y-auto overflow-x-hidden overscroll-contain`), with `-mt-13 pt-13` so content passes under the translucent header (`InboxListPane.tsx:704-708`).
- Virtualized (`VirtualizedList`, estimate 96px per row).
- **No pagination or "load more".** The feed is a single query: 50 mentions + 20 approvals + up to 100 local thread-activity items (`D/features/home/hooks.ts:25-38`; `T/commands/messages.rs:56, 100`; `threadActivityStorage.ts:15`).
- Initial position: the top, meaning newest first. No explicit scroll restore was found in `InboxListPane`.
- New items: rows re-sort by latest activity. There is no "new items" pill: not present in OLD BUZZ source.
- **Selection scroll-into-view:** no code in `InboxListPane` scrolls the selected row into view. Not present in OLD BUZZ source.

**Detail pane:**

- Separate scroll container (`overflow-y-auto overscroll-contain pb-32 pt-13`, `[overflow-anchor:none]`) (`InboxDetailPane.tsx:694-705`).
- `useAnchoredScroll({pinTargetCentered:true, targetMessageId: selectedEventId, channelId: conversationId})` **centers the selected message and keeps it centered until the user scrolls** (`InboxDetailPane.tsx:315-323`; `D/features/messages/ui/useAnchoredScroll.ts:45-46, 501-509, 572-587`).
- Bottom padding follows the composer height (`useComposerHeightPadding`, `InboxDetailPane.tsx:429-433`).

**Panel independence:** the list, detail, and aux panes scroll independently.

## 20. Loading

- **First load**, when `isLoading && !feed`: `HomeLoadingState`. It is a skeleton with two columns, `lg:grid-cols-[320px_minmax(0,1fr)]`: 5 list skeleton rows, 3 detail skeleton messages, and a composer skeleton (`HomeView.tsx:583-585`; `D/features/home/ui/HomeLoadingState.tsx:1-116`).
- **Thread context loading** (in the detail pane, when at most 1 message is shown): a spinner and "Loading surrounding context..." (`InboxDetailPane.tsx:707-715`).
- **Project detail:** "Loading project item…" (`D/features/home/ui/ProjectInboxDetail.tsx:83-85`).
- **Polling:** every 30s while the relay is connected and the document is focused/visible. Focus refetch is disabled; `staleTime` is 5 min and `gcTime` is 5 min (`D/features/home/hooks.ts:7-39`).
- **Live signals** that trigger a refetch: approval or reminder events (`useLiveHomeFeedActions.ts:65-85`), and live mentions (`AppShell.tsx:404`).

## 21. Empty States

**List pane.** No icon and no CTA button. The empty state is text only (`InboxListPane.tsx:748-765`), styled `text-sm font-medium` for the title and `text-sm text-muted-foreground` for the description.

| Filter | Title (unreadOnly off) | Title (unreadOnly on) |
|---|---|---|
| All | "No activity yet" | "No unread activity" |
| Projects | "No project work found" | "No unread project work" |
| Mentions | "No mentions found" | "No unread mentions" |
| Threads | "No threads found" | "No unread threads" |
| Needs action | "Nothing needs action" | "No unread items needing action" |
| Agents | "No agent updates found" | "No unread agent updates" |
| Reminders* | "No reminders" | "No unread reminders" |
| Drafts* | "No drafts" | "No unread drafts" |

Source: `InboxListPane.tsx:55-75`.

The description line:

- unreadOnly on: "Turn off Show unread only to see read activity."
- filter All: "New activity will appear here."
- otherwise: "Switch back to All to see other activity."

\*Reminders and Drafts actually render their own panels, with `RemindersPanel` showing "No reminders" (`D/features/reminders/ui/RemindersPanel.tsx:322`) and `DraftsPanel` showing "No drafts" (`D/features/messages/ui/DraftsPanel.tsx:639`). The table entries above are unreachable for those two filters.

**Detail pane, nothing selected:** Mail icon in a 56px muted circle, "Select a message", "Pick an inbox item to see the full message and react to it." (`InboxDetailPane.tsx:435-452`).

## 22. Error States

- **Feed failed** (no feed data) (`HomeView.tsx:587-606`):
  - A box styled `rounded-md border-destructive/30 bg-destructive/5`.
  - Title: "Home feed unavailable".
  - Body: the error message, or "The relay did not return a feed response."
  - A button with a RefreshCcw icon labeled "**Try again**", which calls `homeFeedQuery.refetch()`.
  - When the relay is unreachable, the body is `RELAY_UNREACHABLE_MESSAGE` (`HomeScreen.tsx:56-64`; value defined in `D/shared/lib/relayError`, not inspected).
- **Thread context partial failure:** an AlertCircle and "Some message context could not be loaded." There is no retry (`InboxDetailPane.tsx:716-724`).
- **Hidden DM reopen failure:** the toast "Could not reopen conversation. Try again.", plus "Couldn’t reopen" with a "Retry" link in the row and in the detail header (`useHiddenDmInboxNavigation.ts:79-85`; `InboxListPane.tsx:474-494`; `InboxDetailPane.tsx:620-640`).
- **Project detail:** "Could not load this project item." / "This project item could not be found." / "Some project activity could not be loaded. Actions are unavailable until the item is current." (`ProjectInboxDetail.tsx:82-85, 107`).
- **Reply unavailable** (as the composer placeholder or a thrown error): "This item does not support inline replies yet." / "Open the linked channel to reply." / "This inbox item does not have a reply target." / "Replies are not available for this item." (`homeMessageCapabilities.ts:13-20`; `HomeView.tsx:835`; `InboxDetailPane.tsx:878-879`).
- **Reaction error:** shown inline under the message (`InboxMessageRow.tsx:307-311`).

## 23. Keyboard

| Key | Scope | Effect | Source |
|---|---|---|---|
| Cmd/Ctrl+Shift+A | Global | Go to Inbox | `useAppShellKeyboardShortcuts.ts:97-100` |
| Shift+Esc | Global (unless an escape surface is active) | Mark all read (channels + local unread feed ids) | `useMarkAsReadShortcuts.ts:35-38` |
| Esc (plain) | Global | Marks the active **channel** read, only when `selectedView === "channel"`. **No effect in the Inbox.** | `useMarkAsReadShortcuts.ts:41-44` |
| Esc | Profile panel | Closes it, only when overlay or single-panel | `D/features/profile/ui/UserProfilePanel.tsx:127` |
| Enter / Space | Focused avatar or name trigger | Open the profile panel | `UserProfilePopover.tsx:199-211` |
| Tab + Enter/Space | Row | Each row has a native `<button>` overlay, so it is focusable and Enter or Space selects it | `InboxListPane.tsx:355-370` |
| Cmd/Ctrl+K | Global | Search everything | `useAppShellKeyboardShortcuts.ts:73-77` |
| Cmd/Ctrl+S | Global | Toggle the sidebar | `D/shared/ui/sidebar.tsx:206-216` |
| **j / k / ArrowUp / ArrowDown** | Inbox list | **Not present in OLD BUZZ source.** No keydown handler exists in `D/features/home` (grep for keydown / Arrow / Escape returns nothing). | — |

## 24. Navigation (from the Inbox to the source)

- **Clicking a row does NOT navigate.** It selects the row in-place: `?item=<eventId>` is pushed and the detail pane shows the context (`HomeView.tsx:174-180, 721-735`).
  - URL writes coalesce per event handler and push a history entry by default (`D/shared/hooks/useHistorySearchState.ts:40-80`).
  - Back and forward restore the selected item (`HomeView.tsx:114-117`).
- **Navigation to the channel** happens through:
  - the "Open in channel" hover or context action (`onOpenDirect`)
  - the detail header title button
  - the ExternalLink button ("Open full thread" / "Open conversation" / "Open in channel")
- `onOpenDirect` passes `(channelId, item.id, rootId-from-tags)` (`useHiddenDmInboxNavigation.ts:118-129`). The detail header passes `(channelId, selectedEventId ?? item.id, isThread ? conversationId : null)` (`InboxDetailPane.tsx:514-516, 572-577`).
- The route handler calls `goChannel(channelId, {messageId, threadRootId})` (`D/app/routes/index.tsx:97-99`). This navigates to `/channels/$channelId?messageId=<id>&threadRootId=<root>` with `resetScroll: true` (`useAppNavigation.ts:263-331`).
- In the channel, the route passes `targetMessageId=search.messageId` and `targetThreadRootId = search.threadRootId ?? search.thread` (`D/app/routes/channels.$channelId.tsx:79-87`). If the events are not already loaded they are fetched and spliced in (`D/app/routes/ChannelRouteScreen.tsx:230-280`).
- `useChannelRouteTarget` (`D/features/channels/ui/useChannelRouteTarget.ts:95-160`):
  - **Root message** (no parent): **opens the thread panel** for that root (`setOpenThreadHeadId`, `replace:true`) (`:119-133`).
  - **Reply:** opens the thread panel on the thread head, expands the ancestor replies, and scrolls the thread to the target (`setThreadScrollTargetId`) (`:140-160`).
  - **Main timeline target:** the message itself for a root or broadcast, else the thread root (`:40-53`).
- **Scroll and highlight** in the channel timeline: `scrollToMessage(id, {highlight:true})` centers the message and sets `highlightedMessageId` for **2000ms** (`useAnchoredScroll.ts:418-429, 490`).
  - The visual is `before:bg-primary/10` with `animate-[route-target-highlight-fade_2s_ease-out_forwards]` (`D/features/messages/ui/TimelineMessageRow.tsx:135-142`).
  - `onTargetReached` then clears `messageId` from the URL (`replace`) (`D/features/channels/ui/ChannelScreen.tsx:939-941`).
- **Inside the Inbox detail pane**, the selected message is centered, and its highlight (`bg-primary/[0.07]`, `rounded-2xl`) fades out after 1200ms through `transition-opacity duration-1000` (`InboxDetailPane.tsx:345-355`; `InboxMessageRow.tsx:133-143`).
- **Profile:** clicking an avatar or name opens the profile in the Inbox aux pane (`?profile=`), not a new route. From the profile panel, "open DM" calls `handleOpenDm`, which opens the DM and then `goChannel(dm.id)` (`useHiddenDmInboxNavigation.ts:131-141`; `HomeView.tsx:949`).

## 25. Right Panel (aux) Persistence and Close

- **Profile panel:**
  - State is in the URL (`profile`, `profileTab`, `profileView`), so it survives back/forward and reload (`HomeView.tsx:77-82, 152-158, 181-214`).
  - Close calls `handleCloseProfilePanel`, which removes the three params (`HomeView.tsx:192-198`). The close button label is "Close panel" (`D/shared/layout/AuxiliaryPanelHeader.tsx:60`).
  - Esc closes it only in overlay or single-panel mode (`UserProfilePanel.tsx:127`).
- **Channel management:**
  - Local state only. Close happens through `onOpenChange(false)`, which sets `managedChannelId(null)` (`HomeView.tsx:975-979`).
  - Esc is explicitly **prevented** from closing the sheet (`onEscapeKeyDown` preventDefault) (`D/features/channels/ui/ChannelManagementSheet.tsx:380`).
- **After close:** the grid falls back to `list | detail`, and the detail pane keeps its selection (`HomeView.tsx:663-674`).
- **Width:**
  - Default 380px, min 300px, max 720px, clamped to the viewport.
  - Stored in **sessionStorage** `buzz.desktop.thread-panel-width`, shared with the channel thread panel.
  - Double-click the handle to reset.

  See `D/shared/layout/auxiliaryPanelLayout.ts:1-5`; `D/shared/hooks/useThreadPanelWidth.ts:9, 46, 67-85`; `HomeView.tsx:223-228`.
- **Narrow width** (Inbox width under 600): the aux pane takes the full width and hides the list and detail (`isSinglePanelAuxiliaryView`) (`HomeView.tsx:287-290`; `homePaneLayout.ts:34-44`).

## 26. Data / Protocol

**Pipeline:**

```
useHomeFeedQuery ──invoke("get_feed",{limit:50,types:"mentions,needs_action,activity,agent_activity"})
   └─ Tauri get_feed (T/commands/messages.rs:49-165)
        ├─ POST {relay_api_base}/query  [NIP-98 auth]   (T/relay.rs:360-389)
        │    filter A (mentions):  kinds [9,40002,1,45001,45003,1618,1619,1621,1630,1631,1632,1633], #p:[me], limit ≤100 (50), since?
        │    filter B (approvals): kinds [46010,46011,46012], #p:[me], limit 20, since?
        │    filter C (mention edits): kinds [40003], #e:[mention ids]  (link-preview suppression only)
        └─ returns {feed:{mentions, needs_action, activity:[], agent_activity:[]}, meta:{since,total,generated_at}}
HomeScreen: feed.activity += threadActivityFeedItems (client-side, localStorage buzz-thread-activity.v1)
            markHiddenDmFeedItems(...)
HomeView:   buildInboxItems → filterInboxItems(drop kind 40007) → matchesInboxFilter/unreadOnly
```

**FeedItem fields:** `id, kind, pubkey, content, createdAt, channelId (from the "h" tag), channelName (empty from the backend), channelType (null from the backend), tags, category` (`T/commands/messages.rs:939-968`; `D/shared/api/tauri.ts:310-326, 430-448`). The channel name and type are resolved client-side from the channels list (`inbox.ts:243-269`).

**Grouping key** (`getInboxConversationId`, `inbox.ts:371-395`):

1. Buzz Git: `project:<repoAddress>:<rootId>`. The repo address is from the `a` tag and must match `30617:<hex64>:...`. Root kinds are 1618 and 1621; activity kinds are 1, 1619, and 1630–1633, with the root taken from the `e`/`E` tag (`D/features/home/lib/projectInbox.ts:20-70`).
2. DM: `dm:<channelId>`.
3. Otherwise the NIP-10 root, else the parent, else the event id.

**Group representative:**

- The **oldest unread** event in the group, else the latest event (`inbox.ts:543-581`).
- Groups are sorted by `latestActivityAt` descending (`inbox.ts:534-537`).
- Categories are ordered by priority: needs_action > mention > agent_activity > activity (`inbox.ts:326-337, 582-584`).

**Detail context fetch** (`D/features/home/useInboxThreadContext.ts`):

- `getEventById` is called for the thread root and for ancestors, up to 50 hops (`:105-146`, `:31`).
- Descendants come from `relayClient.fetchEvents({"#e":[root], "#h":[channelId], kinds:[9,40002,45001,45003], limit:100})` (`:148-165, 30`; `D/shared/constants/kinds.ts:91-99`).
- Structural events (edits and deletions) and kind:7 reactions are fetched by `#e` (`:274-355`).
- For DMs the full channel messages are used (`HomeView.tsx:295-305`).
- Cold anchors (a `?item=` that is not in the feed) are resolved with `getEventById`, then validated against the community channel set (`D/features/home/useInboxSelectionAnchor.ts:1-60`).

**Live subscriptions:**

- `{kinds:[46010,40007],"#p":[me],limit:50,since:now}`
- `{authors:[me],kinds:[30300],limit:50,since:now}` (reminders; this one also invalidates the reminders query)

Retry backoff is 1s to 30s (`D/app/useLiveHomeFeedActions.ts:12-116`; `D/shared/constants/kinds.ts:24,34,69`).

**Actions:**

- Reply calls `sendChannelMessage(channelId, content, parentEventId, imeta, mentionPubkeys, …)`. An optimistic local reply is kept per `conversationId`, and then the feed is refetched (`HomeView.tsx:827-894`).
- React calls `toggleReactionMutation`, `recordThreadInteraction(root)`, and refetches (`HomeView.tsx:895-915`).
- Delete calls `deleteMessage(channelId, eventId)` (`HomeView.tsx:466-484`).
- Edit uses `useInboxEditMessage` (`HomeView.tsx:306-309`).

**Read state:** kind 30078 NIP-RS (§15).

**Secrets:** requests use NIP-98 auth headers built from the local keys (`T/relay.rs:379`). No secrets are reproduced here.

## 27. Permissions

- **Reply** (`canReply`): the channel is in `availableChannelIds` (the user is a member), and the item kind is not 45001 or 45003 (`homeMessageCapabilities.ts:8-12`).
- **React** (`canReact`): the channel is in `availableChannelIds`.
- **Delete from the header** (`canDelete`): the current pubkey equals the item author (`homeMessageCapabilities.ts:23-26`).
- **Per-message edit/delete:** `canManageMessageForCurrentUser(...)` and `channel.archivedAt === null` (`InboxDetailPane.tsx:741-757`).
- **Open channel** (`canOpenSelected`): a `channelId` exists, is not pending reopen, and is either an available channel or a hidden DM with a known relay and signer (`useHiddenDmInboxNavigation.ts:100-107`).
- The relay decides which `#p` items are visible. The relay's own auth logic (the bridge p-gate) is noted in `T/commands/messages.rs:28-34` but was not audited.

## 28. Open Questions

1. The `activity` and `agent_activity` arrays are always empty from `get_feed`. Is that intended in this snapshot? The client still requests them. Not verified in OLD BUZZ (runtime).
2. Do job events (43001–43006), 46011, or 46012 ever render with meaningful headlines? The source only shows the mapping; 46011 and 46012 fall back to the default headline "Channel update" (`inbox.ts:167-177`).
3. The exact options of `MessageActionBar` and `ChannelMembersBar` in the detail pane were not enumerated (shared components).
4. The runtime theme may override the Catppuccin defaults (`D/shared/theme/ThemeProvider.tsx`, `adaptive-theme.ts`). Exact rendered colors were not verified in OLD BUZZ (runtime).
5. `RELAY_UNREACHABLE_MESSAGE` text was not inspected.
6. How `RemindersPanel` and `DraftsPanel` rows look inside the Inbox list was only partially audited (their empty states only).
7. The list does not scroll the selected row into view on back/forward. That is confirmed absent in `InboxListPane`; whether `VirtualizedList` does it implicitly was not verified.
