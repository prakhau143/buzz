# SWF Buzz — Inbox Implementation Report

**Date:** 2026-09-28
**Behavioral reference:**
- `OLD_BUZZ_INBOX_AUDIT.md`
- `OLD_BUZZ_INBOX_USER_FLOWS.md`
- `OLD_BUZZ_INBOX_UI_SPEC.md`

```text
BEFORE:  Centered Inbox modal (OverlayDialog) with four tabs
AFTER:   Full application Inbox workspace:  app sidebar | Inbox list | detail | optional profile
```

## 1. Previous Inbox architecture

- **Entry:** the sidebar "Inbox" button set `overlay = "inbox"` in `AppSidebar.vue`.
- **Modal:** that rendered `OverlayDialog` → `InboxPanel.vue`. This is the centered box with
  a backdrop, and the reason the Inbox looked like a dialog.
- **Tabs:** four (Mentions / Needs action / Activity / Agent updates), each a separate relay query.
- **Data:** **real**. `InboxService` → `POST /query` with the relay's `feed_types` extension
  (NIP-98 signed): `mentions`, `needs_action`, `activity`.
- **Missing:**
  - no read/unread in the Inbox
  - no selection or detail view
  - clicking a row routed to `/channels?channelId=&messageId=`, but `ChannelsView` **ignored
    `messageId`**, so nothing was revealed

## 2. Why the modal was removed

OLD BUZZ's Inbox is the application's home **route**: list | detail | optional right pane. A
modal can't hold a resizable list, a detail pane with a composer, and a profile pane without
covering the app. Per the brief, it's replaced entirely: `InboxPanel.vue` is deleted and the
sidebar no longer mounts any Inbox dialog.

## 3. New architecture

```text
/inbox  (InboxView.vue, AppShell)
├── #sidebar  AppSidebar (Inbox item active + unread badge)
├── #main     inbox-workspace (CSS grid: var(--inbox-list-width) 1px minmax(0,1fr))
│   ├── InboxListPane    header [All ▾] … [⋯]  +  scrolling rows
│   ├── resize handle    role=separator, drag / double-click / arrow keys
│   └── InboxDetailPane  header (title, ↗ open in channel) · scrolling thread · pinned composer
└── #details  UserProfilePanel (the existing profile pane, opened by ui.openProfile)
```

- **Model:** `features/inbox/inboxModel.ts` holds pure functions for classifying, filtering,
  grouping, unread and labels.
- **Data:** `features/inbox/useInboxFeed.ts`.

## 4. Components changed / added

| File | Change |
|---|---|
| `src/views/InboxView.vue` (new) | Route view: selection in the URL, auto-select, narrow mode, resize, open-source |
| `src/features/inbox/ui/InboxListPane.vue` (new) | Header, filter and options popovers, rows, hover pill, right-click menu, skeleton/empty/error |
| `src/features/inbox/ui/InboxDetailPane.vue` (new) | Thread context, highlight, reply composer, event card for non-message kinds |
| `src/features/inbox/inboxModel.ts`, `useInboxFeed.ts` (new) | Model and data |
| `src/features/inbox/InboxService.ts` | `fetchCategory()` (one raw request per category); `fetchFeed()` unchanged in behavior |
| `src/features/inbox/ui/InboxPanel.vue` | **Deleted** (the modal) |
| `src/layouts/AppSidebar.vue` | Inbox is a `RouterLink` to `/inbox` with active state and badge; the Inbox overlay is removed (Search stays an overlay) |
| `src/app/router/index.ts` | `/inbox` route |
| `src/components/MessageList.vue` | `highlightId` prop + `highlight-done`: reveal a message, paging older if needed |
| `src/components/MessageItem.vue` | `data-message-id` on the row (scroll/highlight hook) |
| `src/views/ChannelsView.vue`, `DmView.vue` | Read `?messageId&threadRootId`, open the thread, reveal, then clear the URL |
| `src/components/AnchoredPopover.vue` | Keyboard focus also covers `menuitemradio` / `menuitemcheckbox` |

## 5. Components reused

- `AppShell`, `AppSidebar`
- `UserProfilePanel` (profile pane), `ui.openProfile`
- `MessageItem`, `MessageComposer`, `useThread`, `useSendMessage`
- `AvatarCircle` (presence dot from the shared store), `AnchoredPopover`, `AppIcon`
- `useChannels`, `useDmList`, `useProfileMap`
- the read-state stores (`readState`, `dmReadState`)

`ThreadPanel` was not embedded: it is a closable side panel with its own Close/Escape
behavior. The detail pane reuses its building blocks instead.

## 6. Routing

- `/inbox` (name `inbox`), inside the same auth guard as the other app routes.
- `?item=<row key>` holds the selection, so back/forward and reload keep it.
- The filter and "unread only" are session state, not URL state, as in OLD BUZZ. They reset
  to "All" on reload.
- **Open in channel:**
  - channels → `/channels?channelId&messageId[&threadRootId]`
  - DMs → `/dm?conversationId&messageId[&threadRootId]`
  - The target view opens the thread (for replies) and centers and highlights the message (or
    its root in the main feed) for 2 s. It loads up to 10 older pages if needed, then removes
    the ids from the URL.

## 7. Data flow

```text
POST /query feed_types=[mentions] ─┐
POST /query feed_types=[needs_action] ├─ useInboxFeed (Vue Query, one request each, 30 s refresh as OLD BUZZ)
POST /query feed_types=[activity] ─┘          │  + DM channel ids (useDmList)
                                              ▼
                     buildInboxItems: drop my own events, drop plain channel chatter,
                     classify (dm | mention | thread | needs_action | reminder | agent | project),
                     dedupe by event id, group per DM channel / thread root (newest wins)
                                              ▼
                     filter + unread-only  →  InboxListPane  →  selection  →  InboxDetailPane
```

**Verified live on `wss://buzz.lmdconsulting.com`:** mentions 23, needs_action 0, activity 50
(27 thread replies, 2 DM messages). No mock data is used anywhere in the app.

## 8. Read / unread

- **Unread:** the item's `created_at` is newer than its channel's read frontier. That is SWF's
  existing **NIP-RS kind 30078** read state, synced across devices, the same one channels use.
- **Select or "Mark as read":** `readState.markChannelSeen(channel, item.created_at)`, which
  publishes the frontier. For DMs it also calls `dmReadState.markRead`, so the sidebar agrees.
- **"Mark as unread":** `readState.markUnreadFrom(...)`, local-only. This is the same design
  as SWF's channel "Mark unread" and OLD BUZZ's own override (`buzz-forced-unread.v1`).
- **"Mark all as read":** one frontier advance per channel, to its newest visible item.
- **Sidebar badge:** unread mentions + needs-action + reminders (OLD BUZZ's rule), hidden
  while the Inbox is open.
- **Granularity:** SWF's read state is per channel, so reading an item also marks older items
  in the same channel read. OLD BUZZ additionally has per-thread and per-message markers; SWF
  doesn't implement those, and inventing them would fork the synced read state.

## 9. Filters

OLD BUZZ's dropdown, same labels and order: **All · Projects · Mentions · Threads · Needs action ·
Agents | Reminders**.

| Filter | Rows | Note |
|---|---|---|
| All | everything except reminders | OLD BUZZ always keeps kind 40007 out of the main lists |
| Projects | git (1617–1633) / forum (45001/45003) kinds | |
| Mentions | any row whose categories include a mention (project mentions too) | |
| Threads | thread replies (NIP-10, as the relay resolves them) | |
| Needs action | approvals (46010) | |
| Agents | agent job events (43001/43003/43004) | OLD BUZZ uses "sender is one of *my* agents"; SWF has no agent ownership, so the job-event definition SWF already used is kept |
| Reminders | kind 40007 | Nothing auto-selected, as in OLD BUZZ |
| Drafts | **omitted** | SWF has no drafts feature to source it from |

- **Selection rules** (OLD BUZZ `handleFilterChange`): keep the selection if it's still
  visible; otherwise select the first row (wide only).
- **"Show unread only":** keeps the selected conversation visible after it's read, so reading
  never cascades through the list.

## 10. Profile / auxiliary pane

- Avatar clicks (rows and messages) and "View profile" in the right-click menu call
  `ui.openProfile(pubkey)`. That opens the **existing** `UserProfilePanel` in `AppShell`'s
  right pane (Message / Huddle / Wave, presence, status).
- The list, selection, detail scroll and composer text are untouched; closing the pane
  restores the two-pane view.

## 11. Responsive

| Inbox workspace width (measured with ResizeObserver on the workspace itself) | Layout |
|---|---|
| ≥ 600 px | List + detail, first row auto-selected |
| < 600 px | One pane: list, or detail with "← Back to Inbox"; no auto-select |

- Below 768 px viewport, the app sidebar becomes a drawer (existing `AppShell` behavior).
- Auto-select waits until the workspace has been measured. A bug where a narrow window opened
  the first row before measuring was caught by a test and fixed.

## 12. Resize

- List: 365 px default, 300–520 px.
- Drag the 1 px handle (col-resize cursor, 8 px hit area, accent on hover or focus).
- Double-click resets to 365.
- Keyboard: ←/→ (Shift = 40 px), Home/End.
- Width persisted in `localStorage` `swf-buzz:inbox-list-width` (a per-device view preference).

## 13. Accessibility

- Rows are keyboard-focusable (`role=button`, Enter/Space selects) with a descriptive
  `aria-label` (sender, context, unread) and `aria-current` on the selection.
- The hover pill also appears on `:focus-within`.
- The filter and options use menu roles (`menuitemradio`, `menuitemcheckbox`) with arrow-key
  navigation, Escape to close and focus restored to the trigger.
- The resize handle is a focusable `separator` with `aria-valuenow/min/max`.
- Icon-only buttons have labels and tooltips.
- Reduced motion turns off transitions and the skeleton pulse.
- **No new global shortcuts.**

## 14. Performance

- One request per relay category, shared through the Vue Query cache. The sidebar badge reads
  the same cache, so opening the Inbox adds no extra requests.
- No live relay subscription is added.
- Grouping keeps the list to one row per conversation. Each category returns at most 50 events
  (≤ 150 rows before grouping), so **virtualization was not added**. It isn't needed at that
  size, and it would be a new dependency.
- Computations are `computed` over the query data. The list uses keyed rows.

## 15. Tests

| Test | Result |
|---|---|
| Typecheck (`vue-tsc`) | PASS |
| ESLint (`--max-warnings 0`) | PASS |
| Unit tests | **PASS: 1107 / 1107 in 108 files** (new: `inboxModel.spec.ts` 8, `inboxView.spec.ts` 8, 3 reveal tests in `messageListScroll.spec.ts`) |
| Production build | PASS |
| `cargo check` | PASS (no Rust changes) |

What the new tests prove:
- OLD BUZZ filter order, labels and predicates
- grouping, and exclusion of your own messages and channel chatter
- unread = after the read frontier
- the workspace isn't a dialog
- wide auto-select puts the row in the URL and marks it read
- an explicit `?item` is respected
- unread-only keeps the selection and doesn't cascade
- narrow = single pane with Back and no auto-select
- Open in channel routes DMs to `/dm` with the message id
- `MessageList` reveals and highlights, pages older until found, and gives up honestly

## 16. Visual inspection

The real Inbox only renders inside the Tauri identity boundary. For visual QA, a **temporary
harness page** mounted the real `InboxView` (real components and styles, sample rows seeded
into the query cache) on the Vite dev server. Headless Edge took screenshots, and the harness
was then **deleted**.

Checked:
- **1440 × 900:** sidebar | 365 px list | detail. No modal or backdrop. 52 px headers aligned.
  Selected row tint. Unread dots and weight. 2-line previews. Context lines. Composer pinned at
  the bottom.
- **560 × 800:** single-pane list, app sidebar in its drawer, nothing auto-selected.
- **Dark mode: not applicable.** SWF has no dark palette (`tokens.css`: "Dark theme is not in
  scope for v1"). The Inbox uses only theme tokens, so it follows a future dark palette
  automatically.

## 17. Remaining limitations

1. **Not yet clicked through in the Tauri window with your live data.** Still to check:
   - reply sending, profile pane, Open in channel on a real message
   - resize and reload persistence
   - no console errors

   The `?item` / filter logic is covered by unit tests.
2. Read state is per channel (see §8). Per-thread and per-message markers would need a
   NIP-RS extension.
3. **Agents** = agent job events, not "my agents" (SWF has no agent ownership). **Drafts** and
   **Remind** are omitted (no SWF data source or action).
4. The right pane is `AppShell`'s 300 px details pane, not OLD BUZZ's resizable 380 px pane. It
   is kept for consistency with channels and DMs.
5. No pagination beyond the relay's 50 per category (OLD BUZZ has none either).
