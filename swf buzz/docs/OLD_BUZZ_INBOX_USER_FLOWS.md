# OLD BUZZ — Inbox User Flows (source-confirmed only)

These flows are confirmed in the OLD BUZZ source. None of them come from runtime observation.

Path prefixes used in citations:

- `D/` = `C:\Users\lenovo\New folder (2)\buzz\buzz\desktop\src\`
- `T/` = `...\desktop\src-tauri\src\`

See `OLD_BUZZ_INBOX_AUDIT.md` for the full detail behind each step.

Flows that are **not** drawn here, because the source has no such feature:

- Clear, Archive, or Done in the Inbox (§16 of the audit)
- Search inside the Inbox
- j/k or arrow-key list navigation
- Tabs

---

## F1. Open the Inbox

```
[Sidebar "Inbox" button]  or  [Cmd/Ctrl+Shift+A]
   AppSidebarPinnedHeader.tsx:110-120      useAppShellKeyboardShortcuts.ts:97-100
            │
            ▼
   goHome()  →  router navigate to "/"                     useAppNavigation.ts:74-83
            │
            ▼
   deriveShellRoute("/") → selectedView="home"             AppShell.helpers.ts:264-267
   Sidebar Inbox item isActive; home badge marks feed "seen" hooks.ts(notifications):447-458
            │
            ▼
   Route "/" → HomeScreen → useHomeFeedQuery (invoke get_feed) routes/index.tsx:93-100; home/hooks.ts:18-39
            │
     ┌──────┴───────────────┬──────────────────────────┐
     ▼                      ▼                          ▼
 loading && !feed     !feed (error)               feed ready
 HomeLoadingState     "Home feed unavailable"     HomeView grid
 HomeView.tsx:583     + [Try again]→refetch       list | detail (| aux)
                      HomeView.tsx:587-606              │
                                                        ▼
                                  wide (≥600px): auto-select first visible item (local, not URL)
                                  narrow (<600px): no selection, list only
                                  useHomeInboxAutoSelection.ts:18-60
```

## F2. Switch filter (dropdown)

```
[Filter trigger "All ▾"]  InboxFilterMenu.tsx:57-68
      │ click
      ▼
Dropdown (radio): All · Projects · Mentions · Threads · Needs action · Agents
                  ───────────
                  Reminders (badge=count) · Drafts (badge=count)   InboxFilterMenu.tsx:14-26,69-104
      │ select value
      ▼
handleFilterChange(next)                                   HomeView.tsx:535-581
  ├─ reset unreadBoundary, selected draft, selected reminder
  ├─ setFilter(next)             (local state; URL NOT changed for filter)
  ├─ next ∈ {reminders,drafts}? → clear ?item, clear auto-selection → list shows RemindersPanel/DraftsPanel
  ├─ current conversation still visible? → keep selection
  └─ else → clear ?item; auto-select first item (wide) / none (narrow)
No refetch (client-side filter).
```

## F3. Toggle "Show unread only" / "Mark all as read"

```
[⋯ Inbox options]  InboxListPane.tsx:614-624
      ▼
Popover
  ├─ [Show unread only  (switch)] → setUnreadOnly(bool)            InboxListPane.tsx:632-645; HomeView.tsx:748
  │        disabled in Reminders / Drafts
  │        effect: hide read items (selected conversation stays), hide due-reminder rows
  │                HomeView.tsx:421-436; InboxListPane.tsx:280-284
  └─ [Mark all as read   N] → for each visible unread item: markItemRead(id)   InboxListPane.tsx:301-307,648-660
           disabled when N = 0
```

## F4. Click a Mention item

```
[Row "Mentioned in #chan"]  (click anywhere except avatar/name)
InboxListPane.tsx:334-343,355-376
      ▼
onSelect(itemId)                                            HomeView.tsx:721-735
  ├─ setUnreadBoundary({conversationId, eventId}) if item unread
  ├─ clear draft/reminder selection
  ├─ handleUserSelectItem → push ?item=<eventId>            HomeView.tsx:174-180
  └─ markItemRead(itemId) → markChannelRead(channelId, latestActivityAt)   useHomeInboxReadState.ts:252-258
      ▼
Row re-renders: dot removed, preview normal weight          InboxListPane.tsx:423-441,499-506
      ▼
Detail pane: title "Message in #chan" (or "Thread in #chan" when it is in a thread)
  ├─ load thread context (root + ancestors + descendants)   useInboxThreadContext.ts:105-165
  ├─ selected message centered (pinned) + highlight fades after 1.2s   InboxDetailPane.tsx:315-323,345-355
  ├─ unread divider before the boundary event                InboxDetailPane.tsx:725-727
  └─ composer: "Send reply to #chan thread"                   InboxDetailPane.tsx:873-877
(No route change to the channel. The user stays in the Inbox.)
```

## F5. Click a Thread item

```
[Row "Thread in #chan"]
      ▼
onSelect → ?item=<eventId> → markItemRead:                  useHomeInboxReadState.ts:230-250
    for each reply in group: markMessageRead(msg:<id>, createdAt)
    markThreadRead(thread:<root>, latestActivityAt)
    markChannelRead(channel, latest top-level grouped ts, {topLevelOnly, preserveForcedUnread})
      ▼
Detail: "Thread in #chan", root + ancestor chain + replies (depth-indented)
Composer parent = the captured default parent (selected event's parent ?? selected id)   InboxDetailPane.tsx:367-427,479-481
      ▼
[Open full thread ↗] (header icon or title) → see F9
```

## F6. Click a DM item

```
[Row "DM from Alice"]
      ▼
onSelect → ?item=<eventId> → markItemRead → markChannelRead(dmChannelId, latestActivityAt)
      ▼
Detail: title "DM with Alice"; full DM channel history used as context   HomeView.tsx:295-305
Composer placeholder "Message Alice"; replies are top-level (parent=null)  InboxDetailPane.tsx:479-481,873-876
      ▼
[Open conversation ↗] → F9 (a hidden DM is reopened first, see F10)
```

## F7. Click avatar or name → profile

```
[Avatar] or [Sender name]  (list row or detail message)
InboxListPane.tsx:378-422 ; InboxMessageRow.tsx:195-239
      │
      ├─ hover 500ms ─────────► Profile POPOVER (card)       UserProfilePopover.tsx:152-160; popover.tsx:19
      │                          closes 200ms after leave       UserProfilePopover.tsx:64,162-167
      │
      └─ click / Enter / Space ► openProfilePanel(pubkey)    UserProfilePopover.tsx:173-184,199-211
                                   (row click suppressed via data-inbox-profile-trigger  InboxListPane.tsx:334-341)
            ▼
   handleOpenProfilePanel: clear managed channel; push ?profile=<pk>, remove profileTab/profileView
   HomeView.tsx:181-191
            ▼
   Grid gains a 3rd column: RightAuxiliaryPane > UserProfilePanel(layout="split")
   HomeView.tsx:663-674,935-960
            ▼
   Tab/view changes → ?profileTab= / ?profileView=           HomeView.tsx:199-214
   "Open DM" in the panel → openDm → goChannel(dm.id)          useHiddenDmInboxNavigation.ts:131-141
```

## F8. Hover actions and context menu

```
Hover / focus row ─► action pill fades in (150ms); timestamp hides    InboxListPane.tsx:423-426,519-556
Right-click row  ─► ContextMenu                                       InboxListPane.tsx:560-599

 Hover pill                      Context menu
 ┌────────────────────────┐      ┌──────────────────────────────┐
 │ ✉ Mark as read / unread│      │ ✉ Mark as read / Mark unread │
 │ ↗ Open in channel      │      │ ───────────────              │
 │ ⏲ Remind me later      │      │ ↗ Open in channel            │
 └────────────────────────┘      │ ⏲ Remind me later / set      │
                                 └──────────────────────────────┘
 Mark as read   → markItemRead (F11)
 Mark unread    → markItemUnread (F12)
 Open in channel→ onOpenDirect(item) → F9 (disabled: "No channel link" / "Reopening…")
 Remind me later→ openReminder({authorPubkey, channelId, eventId, preview[0..100]})   HomeView.tsx:709-720
                  (disabled: "Cannot remind without a channel")
```

## F9. Open the source in its channel (scroll, highlight, thread)

```
Trigger: hover/context "Open in channel" | detail title button | detail ↗ button
  onOpenDirect: (channelId, item.id, rootId from tags)           useHiddenDmInboxNavigation.ts:118-129
  detail:       (channelId, selectedEventId ?? item.id, isThread ? conversationId : null)  InboxDetailPane.tsx:514-516
      ▼
openHiddenDmInboxContext: channel available or not a DM → onOpenContext(...)   hiddenDmInboxAction.ts:43-46
      ▼
goChannel(channelId, {messageId, threadRootId})                  routes/index.tsx:97-99
  → /channels/$channelId?messageId=<id>&threadRootId=<root>, resetScroll   useAppNavigation.ts:263-331
      ▼
ChannelRouteScreen fetches and splices the target and root events if missing   ChannelRouteScreen.tsx:230-280
      ▼
useChannelRouteTarget                                            useChannelRouteTarget.ts:95-160
  ├─ target is a root   → open the thread panel on it (replace)
  └─ target is a reply  → open the thread panel on the head, expand ancestors, scroll the thread to the target
Main timeline: scrollToMessage(target|root, {highlight:true}) → centered, primary/10 flash for 2s
  useAnchoredScroll.ts:418-429,490; TimelineMessageRow.tsx:135-142
onTargetReached → clear ?messageId (replace)                     ChannelScreen.tsx:939-941
```

## F10. Open a hidden DM (reopen)

```
Open action on a DM whose channel is not in availableChannelIds
      ▼
pending: row "⟳ Reopening…", header pill "Reopening…"        InboxListPane.tsx:458-473; InboxDetailPane.tsx:603-619
getChannelMembers → peers → openDm → verify id === channelId  hiddenDmInboxAction.ts:47-68
  ├─ ok   → F9
  └─ fail → toast "Could not reopen conversation. Try again."
            row/header "Couldn’t reopen  [Retry]" → retry the same action   useHiddenDmInboxNavigation.ts:79-85
```

## F11. Mark read

```
Triggers: row select | "Mark as read" (hover or context) | "Mark all as read" | Shift+Esc (global)
      ▼
markItemRead(id)                                               useHomeInboxReadState.ts:210-273
  1. undoUnreadLocal for all grouped ids
  2. clear the channel forced-unread "inbox" source (if no other override remains)
  3. thread?  msg:<id> markers + thread:<root> + channel(topLevelOnly)
     channel? markChannelRead(channel, ISO(latestActivityAt))
     else?    local done set (localStorage buzz-home-feed-done.v1:<pk>)
      ▼
Read-state manager publishes kind 30078 (d="read-state:<slot>", t="read-state", NIP-44 self-encrypted)
readStateManager.ts:690-712
      ▼
effectiveDoneSet recomputed → unread dot removed, preview muted; sidebar badge recount
```

## F12. Mark unread

```
"Mark unread" (hover or context, only when the row is read)
      ▼
markItemUnread(id): undoDone(id); markUnreadLocal(id) (localStorage buzz-home-feed-unread.v1:<pk>)
                    channel item → markChannelUnread(channelId,"inbox") (localStorage buzz-forced-unread.v1:<pk>)
useHomeInboxReadState.ts:275-290
      ▼
Row shows unread again; the item counts toward the Inbox badge even while the Inbox is active  notifications/hooks.ts:474-478
```

## F13. Close the right (aux) panel

```
Profile panel:  [Close panel] (header) | Esc (overlay or single-panel only) | browser Back
   → handleCloseProfilePanel: remove ?profile, ?profileTab, ?profileView   HomeView.tsx:192-198
Channel management: sheet onOpenChange(false) → managedChannelId=null     HomeView.tsx:975-979
   (Esc is prevented on this sheet)                                        ChannelManagementSheet.tsx:380
      ▼
Grid returns to list | detail; the detail selection is unchanged            HomeView.tsx:663-674
```

## F14. Narrow (single-column) flow (<600px Inbox width)

```
List only (no auto-select) ─ click row ─► Detail only (list hidden) with [← Back to inbox list]
                                           homePaneLayout.ts:18-44; InboxDetailPane.tsx:554-565
[←] → handleUserSelectItem(null) → ?item removed → List only             HomeView.tsx:806-812
Profile open while narrow → aux pane full-width (list and detail hidden)  HomeView.tsx:287-290
```

## F15. Resize the list column

```
Drag the handle between list and detail (hidden unless both are shown)   HomeView.tsx:759-780
  → width = clamp(300..520) (default 365); body cursor col-resize         useResizableInboxListWidth.ts:3-7,58-85
  → persisted in sessionStorage "buzz.desktop.home-inbox-list-width"
Double-click → reset to 365 (only when the width differs)
```

## F16. Keyboard (confirmed handlers only)

```
Cmd/Ctrl+Shift+A → Inbox            Shift+Esc → mark all read
Tab to a row → Enter/Space selects (native <button> overlay)
Enter/Space on a focused avatar or name → profile panel
Esc → closes the profile panel only in overlay or single-panel mode
(j/k, ↑/↓, plain-Esc-in-Inbox: NOT PRESENT in OLD BUZZ source)
```
