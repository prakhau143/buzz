# Mobile UX — Phase D: Productivity (Inbox, Search, Notifications)

Date: 2026-09-30. Builds on C1–C3. Not committed.

## Audit: what already exists

| Piece | Where | Finding |
|---|---|---|
| Inbox feed | `features/inbox/useInboxFeed.ts` + `inboxModel.ts` | The ONE feed: the relay's `mentions` / `needs_action` / `activity` categories, merged and grouped (`buildInboxItems`), unread from the NIP-RS read frontier (`readState.lastSeenAt`), `markRead` / `markAllRead` / `markUnread`. Existing filters: **All, Mentions, Threads, Needs action, Reminders** (`INBOX_FILTERS`, `matchesFilter`, `EMPTY_STATE`). There is no "Activity" filter — `activity` is a source, not a category — and SWF ships no Agents filter |
| Mobile Inbox | `MobileInboxView.vue` (Phase B + C2) | Flat list, no filters, reminders dropped, spinner on load, a whole-page error, rows open through `fromInboxItem` → `useOpenMessageTarget` (C2) |
| Inbox badge | `useInboxBadge.ts` | One rule for desktop sidebar + mobile bottom nav: unread mentions + needs-action + reminders; 0 while the Inbox is open or the badge setting is off |
| Search | `SearchService` (NIP-50 via `fetchEventsOnce`, relay enforces access), `useMessageSearch` (250 ms debounce, community-scoped cache key), `paletteModel.buildPalette` (local channel / DM / people matches + message hits) | Reusable as is |
| Mobile Search | `MobileSearchView.vue` (Phase B) | Wraps the desktop `CommandPalette`: a message hit opened the channel **without** the message; a DM hit went Home; a person hit did nothing |
| Recent searches | — | No existing state. Not invented |
| Notifications | `useNotificationService` (classify → freshness → ledger dedup → settings → native / in-app toast), `notificationEngine`, `inAppToasts` | One pipeline. Own messages excluded (`classifyMessage`), replays excluded (`isFresh`), dedup by ledger. Clicks → `fromNotificationTarget` → `useOpenMessageTarget` (C2). **No persistent notification feed** exists — the Inbox is the attention list. Bug: a needs-action alert treats only the desktop `inbox` route as "viewing", so on the mobile Inbox it still toasts |
| Target / opener | `messageTarget.ts`, `useOpenMessageTarget.ts` | Reuse; add `fromSearchHit` |

## Plan

- **D1 Inbox** — rebuild `MobileInboxView` on the same feed: filter chips from `INBOX_FILTERS` (with per-filter unread counts, `matchesFilter` semantics, horizontally scrollable inside the row), day groups (Today / Yesterday / date), premium rows (avatar, sender, event verb, `#channel` / DM context, preview, time, grouped count, unread dot + weight + screen-reader text), row skeleton on first load, `EMPTY_STATE` per filter, "Unable to load Inbox" + Retry only when nothing is loaded, an inline retry notice for a partial failure (data kept), "Mark all read" via `feed.markAllRead`. Filter kept in `?f=` so back restores it. Opening: `feed.markRead` → `fromInboxItem` → `openMessageTarget` (unchanged C2 path).
- **D2 Search** — a mobile-native `MobileSearchView` on the same sources (`useMessageSearch`, `buildPalette`, channels / DMs / members, `useProfileMap`). Tabs **All / Messages / People / Channels** (DMs listed under People and All). Message → `fromSearchHit` → `openMessageTarget` (exact reveal, thread-aware, DM-aware). Person → `ui.openProfile` (the mobile profile sheet). Channel → `mobile-channel`, DM → `mobile-dm`. Query and tab kept in `?q=&t=` (replace), so back restores them and nothing is global. Message skeleton, "Nothing found", error + Retry.
- **D3 Notifications** — no new pipeline or feed. Fix mobile "viewing Inbox" for needs-action; keep the badge on `useInboxBadge` (restyled: smaller, 99+, screen-reader count); verify toast → target on mobile.
- **D4** — cross-feature tests, responsive / a11y QA, desktop regression.

(Implementation note: Search ranks local matches with the palette's own `matchScore` through a small `rankLocal` wrapper instead of `buildPalette`, because a phone tab is a full list rather than a five-row preview; the ranking rule is the same function.)

---

## A. Architecture

Nothing new underneath. Every surface is a mobile presentation of an existing source:

| Surface | Source of truth (unchanged) | Navigation |
|---|---|---|
| Inbox | `useInboxFeed` + `inboxModel` (`INBOX_FILTERS`, `matchesFilter`, `EMPTY_STATE`, `isUnread`) | `fromInboxItem` → `useOpenMessageTarget` |
| Search | `useMessageSearch` → `SearchService` (NIP-50, relay-enforced access) + channels / DMs / community members | `fromSearchHit` → `useOpenMessageTarget`; `ui.openProfile`; mobile channel / DM routes |
| Badge | `useInboxBadge` (the same rule as the desktop sidebar) | — |
| Notifications | `useNotificationService` → `notificationEngine` → native / in-app toast | `fromNotificationTarget` → `useOpenMessageTarget` (C2) |
| Read state | `readState` NIP-RS frontier (`markChannelSeen`, never rewinds) | — |

No second store, feed, notification pipeline, search backend, target model or navigation system. There are no protocol, relay, NIP-42, membership or backend changes.

## B. Inbox

`MobileInboxView.vue` was rewritten on the same feed.

- **Header.** It shows "Inbox" with a quiet "N unread" subtitle. A **Mark all as read** check (44 px) calls `feed.markAllRead(visible)` and is disabled when nothing visible is unread.
- **Filters.** They are exactly the existing Inbox filters: **All, Mentions, Threads, Needs action, Reminders**. There is no invented "Activity" category (`activity` is a relay source) and no Agents filter.
  - The chips are compact pills inside 44 px touch targets (`role=tablist` / `tab`, `aria-selected`).
  - Each chip carries its unread count, with a screen-reader text of ", N unread". The row scrolls sideways inside itself without overflowing the page.
  - The filter is kept in `?f=` via `replace`, so back restores it. An unknown value falls back to All.
- **Rows.** Rows are grouped by day (Today / Yesterday / "Mon, Sep 28") under sticky headings. Each row shows:
  - the avatar (batched `useProfileMap`) and the sender
  - the verb ("mentioned you", "replied in a thread", "mentioned you in a thread", "sent you a direct message", "needs your action", "sent a reminder")
  - `in #channel`, a two-line preview, a compact time (`2m`, `3h`, `1d`), and "N messages" for grouped rows

  An unread row has a heavier name and preview, an accent time, a soft tint, a small dot, **and** ", unread" in its accessible name, so unread is never shown by colour alone.
- **Opening a row.** `feed.markRead(item)` (the existing rule) runs, then `openMessageTarget(fromInboxItem(item))`. Rows without a conversation, such as a reminder without `h`, are shown but disabled.
- **States.**
  - **Loading:** a row-shaped skeleton (`MobileListSkeleton`: `aria-busy`, labelled, no motion under reduced-motion). It appears only on the first load; once rows exist a refresh never replaces them.
  - **Empty:** the existing per-filter `EMPTY_STATE` copy in a compact card.
  - **Error:** "Unable to load Inbox" with Retry appears only when every source failed **and** nothing is loaded. A partial failure keeps the rows and shows an inline "Some items couldn't be loaded. Retry".

## C. Search

`MobileSearchView.vue` is a mobile-native screen and no longer wraps the desktop palette.

- **Field.** A 44 px pill field with `type=search`, `enterkeyhint=search`, 16 px text (no iOS zoom), a labelled 44 px clear button and a focus ring. It autofocuses only on a fresh visit (no query); coming back does not pop the keyboard.
- **Before a query.** It shows "Messages, people and channels in &lt;community&gt;." plus quick access to channels and DMs. There are **no "recent searches"**, because no existing state supports them.
- **Tabs.** All / Messages / People / Channels appear once a query is searchable (2+ characters), as `role=tab` with `aria-selected`. The query and tab are kept in `?q=&t=` (replace, following the *debounced* query, not each keystroke).
- **Messages** are the relay's NIP-50 answer via `useMessageSearch`: 250 ms debounce, community-scoped cache key, access enforced by the relay. No client-side search is performed. Each row shows the avatar, sender, time, `#channel` or "DM with X" (plus "· thread"), and a snippet around the match.
  - In **All**, the first 4 are shown with "See all N messages".
  - Loading is a skeleton; an error shows "Couldn't search messages" with Retry (`role=alert`).
- **People.** Community members (role label plus community) and DM partners, ranked by the palette's `matchScore`. Presence is not shown, because the member roster doesn't carry it and loading it per person would add subscriptions.
- **Channels.** The sidebar channels, with a lock or hash icon, Public or Private, and the topic.
- **"Nothing found"** appears per tab ("No people for “deploy”").
- **Opening results.**
  - A message goes through `fromSearchHit` (channel or DM from the DM list, `threadRootId` from the hit's NIP-10 root) and then `openMessageTarget`. That is the exact C2 reveal, the thread page for a reply, or the DM.
  - A person opens `ui.openProfile`, the existing mobile profile sheet.
  - A channel pushes `mobile-channel`; a DM pushes `mobile-dm`.
- **Cross-community isolation.** Search results can't leak between communities: every source is community-scoped (query keys), and the URL only holds the text.

## D. Notifications

- **No persistent notification feed exists**, so none was invented. The Inbox is the mobile attention list, and in-app toasts remain ephemeral. The pipeline is unchanged: classify (own messages and plain chatter excluded), then freshness (replays silent), then the ledger (dedup per identity × community × event), then settings, then native or in-app toast.
- **Fix.** A needs-action alert counted only the desktop `inbox` route as "viewing". It now counts **`inbox` and `mobile-inbox`**, so a request that is already on the phone's screen is treated like the desktop one.
- **Tap.** Unchanged from C2: the identity fingerprint is checked, the target is validated (ID-only payload, never guessed), then the verified community switch, the tier route and the exact reveal.
- **In-app toast at phone width (CSS only, `max-width: 767px`).** The stack is centred with 12 px gutters, sits below the safe-area top, and the dismiss control is 44 × 44. Desktop windows never reach that width.

## E. Badges

- The bottom-nav Inbox badge is still `useInboxBadge`: unread mentions, needs-action and reminders from the same feed and read state. It is 0 while the Inbox is open or when the badge setting is off.
- **Restyled:** a 16 px tabular pill ringed in the bar colour, showing "99+" above 99.
- The tab's accessible name is "Inbox, N unread", and the visual number is `aria-hidden`.

## F. MessageTarget integration

- **New:** `fromSearchHit(hit, isDm)`, and the `source` union gains `"search"`.
- **Entry points:** Inbox (`fromInboxItem`), Search (`fromSearchHit`) and notifications (`fromNotificationTarget`) all produce the same `MessageTarget` and call the same `useOpenMessageTarget`.
- **Reveal:** C2 is unchanged (`?m=` dropped after reveal, thread-aware, DM-aware).

## G. Read-state integration

- **Opening an Inbox row:** `feed.markRead`, which is `readState.markChannelSeen`, the same frontier channels and DMs use. It only advances, and `publishedFrontier` never rewinds (tested).
- **Consistency:** the badge, the row unread state, the chip counts and the header count all read `feed.unread`, which reads `readState.lastSeenAt`. No mobile-specific unread calculation exists.
- **Visual QA:** after opening a row, the row and the counts dropped together, and the state persisted across reloads through the existing storage.

## H. Cross-community behaviour

- **Inbox and Search** belong to the open community (the feed and NIP-50 search are community-scoped), so their targets have `community: null` and never switch. This is tested.
- **Community B targets** (notifications, and any target carrying B) go through the one verified switch, then the B conversation, then the exact message.
- **Refused switch:** you stay in A and nothing is navigated (tested). The C3 overlay presents the switch.

## I. Responsive QA

Headless Chrome at **390×844, 375×812, 360×800 and 320×720**, in **light and dark**, covered:

- Inbox
- Search: idle, results, People tab (empty), person → profile sheet
- the in-app toast
- Inbox loading, error and empty

Result: **no horizontal overflow** and **no touch control under 44 px** in any combination.

One real bug was found and fixed: the visually-hidden chip-count text escaped the horizontally scrolling filter row and widened the page. Chips are now `position: relative`.

## J. Accessibility

- **Tabs:** the Inbox filters and Search tabs use `tablist` / `tab` with `aria-selected`.
- **Bottom nav:** `aria-current` (existing); the badge count is spoken, not just drawn.
- **Row labels:** full accessible names such as "Prakhar mentioned you in #engineering, 2m, unread".
- **Loading and errors:** loading uses `aria-busy` with a label; errors use `role=alert` / status; "Nothing found" uses `role=status`.
- **Search field:** labelled field, labelled clear button, `focus-visible` rings on chips, tabs, rows and buttons.
- **Unread** is never shown by colour alone.
- **Motion:** skeleton pulses and chip transitions are off under `prefers-reduced-motion`.

## K. Performance

- **No new polling or subscriptions.** The Inbox's existing 30 s feed refresh is unchanged, and search REQs stay one-shot (`fetchEventsOnce`) with the existing debounce.
- **Profiles** are loaded in one batched `useProfileMap` query per screen, not per row.
- **URL sync** follows the debounced query. There are no new timers or listeners to clean up.
- **Local ranking** is bounded (`TAB_LIMIT = 50`).
- The mobile chunk is 32.9 kB (12.7 kB gzipped), essentially unchanged.

## L. Files changed

| File | Change |
|---|---|
| `src/features/mobile/views/MobileInboxView.vue` | rewritten (D1) |
| `src/features/mobile/views/MobileSearchView.vue` | rewritten (D2) |
| `src/features/mobile/inboxPresentation.ts` | **new**: verbs, context, day groups, short time, badge text |
| `src/features/mobile/searchPresentation.ts` | **new**: tabs, `rankLocal` over the palette's `matchScore` |
| `src/features/mobile/ui/MobileListSkeleton.vue` | **new**: row skeleton |
| `src/features/navigation/messageTarget.ts` | `fromSearchHit`, `source: "search"` |
| `src/features/notifications/useNotificationService.ts` | needs-action "viewing" on `inbox` **or** `mobile-inbox` |
| `src/features/notifications/ui/InAppToastStack.vue` | phone-width CSS only |
| `src/features/mobile/ui/MobileBottomNav.vue` | badge style |
| `tests/unit/features/mobile/mobileInbox.spec.ts` | **new** (15) |
| `tests/unit/features/mobile/mobileSearch.spec.ts` | **new** (13) |
| `tests/unit/features/mobile/productivityFlows.spec.ts` | **new** (12) |
| `tests/unit/features/notifications/needsActionViewing.spec.ts` | **new** (5) |
| `tests/unit/features/navigation/entryPoints.spec.ts` | mocks extended for the new Inbox (`partialError`, `markAllRead`, `useProfileMap`) |
| `docs/assets/mobile-d/*.png` | 13 QA screenshots |

## M. Tests added (45)

The numbers below refer to items in the Phase D brief.

- **Inbox** (1–7):
  - the filters are exactly the existing ones, with `?f=` restore and fallback
  - `matchesFilter` semantics, and reminders are not actionable without a conversation
  - unread shown by weight, dot and accessible text; header and chip counts
  - `markRead` runs, *then* the target opens
  - `markAllRead` works and is disabled when nothing is unread
  - day groups
  - skeleton only on the first load
  - per-filter empty states
  - full error with Retry, no clearing on a failed refresh, partial-failure notice
  - presentation helpers
- **Search** (8–15, 25, 26):
  - accessible field, and autofocus only on a fresh visit
  - no recent searches
  - the query drives the same search and `?q=`
  - message, people and channel rendering; tabs with `?t=`
  - message → the exact `MessageTarget`; thread and DM targets
  - person → profile; channel and DM routes
  - loading skeleton, "Nothing found", error with Retry
  - back restores the query and tab without focusing the field; clear refocuses
- **Notifications and badge** (16–19):
  - badge "99+" with a spoken count
  - ledger dedup
  - ID-only, validated payloads
  - needs-action "viewing" on `mobile-inbox` / `inbox` but not on other screens; no duplicate alert
- **Cross-feature** (20–24):
  - Search → exact channel, thread and DM routes, and the desktop tier from the same target
  - Search and Inbox targets never switch
  - a B target → verified switch → exact message
  - a refused switch stays in A
  - read-state frontier shared by the Inbox, channels and DMs, and it never rewinds

## N. Final test count

**150 files / 1586 tests, all passing.** C3 ended at 146 / 1541, so Phase D adds 4 files and 45 tests.

## O. Typecheck

`npx vue-tsc --noEmit` exits 0.

## P. Lint

`npx eslint . --max-warnings 0` exits 0.

## Q. Build

`npm run build` exits 0.

## R. Desktop regression

Desktop code paths are untouched:

- `InboxView`, `InboxListPane`, `CommandPalette`, `SearchPanel`, `AppSidebar`, `CommunityRail` and `CommunitySwitcher`
- the desktop reveal routes
- `inboxModel` and `useInboxFeed`

The only shared changes are:

- `messageTarget.ts` (an added function and union member)
- the needs-action "viewing" set, which adds `mobile-inbox` while `inbox` behaves as before
- phone-width-only toast CSS

The full suite passes, including all desktop Inbox, search, notification, rail, switching, reveal, DM, thread and read-state specs. The installed desktop app was **not** rebuilt or reinstalled in this phase.

## S. Visual QA

A temporary harness (`mobile-harness.html` plus `src/__harness__/mobileHarness.ts`) seeded the vue-query cache with deterministic inbox rows, channels, a DM, members and one NIP-50 answer. A key-less stand-in signer held relay requests in flight (loading) or failed them (error). No real relay, messages or communities were used.

Verified flows:

- Inbox row → `/m/c/c1` with the message highlighted, then back: the row is read and the counts dropped.
- Search result → `/m/c/c1` highlighted, then back: `/m/search?q=deploy` with the value and rows restored and no keyboard popped.
- Person → profile sheet.

Afterwards the harness was **deleted**, Chrome and Vite were stopped, and ports 1420, 9333 and 9334 were confirmed closed. Screenshots are in `docs/assets/mobile-d/`.

## T. Known limitations

- **Not verified on a real Android or iOS device, a live relay, or live notification delivery.** All results are from emulated viewports plus unit tests.
- **No persistent notification centre**, because the architecture has none. The Inbox is the attention list.
- **No recent searches**, because no existing state supports them.
- **People search** shows role but not presence.
- **Inbox and Search cover the open community only**, because the feed and NIP-50 search are community-scoped. Cross-community reach is through notifications and the verified switch.
- **Swipe, long-press and pull-to-refresh** are Phase F.
- **The installed desktop app** was not rebuilt in this phase.

## U. Recommendation for Phase E

Next is **Phase E, Settings and personalization**: Profile, Appearance, Notifications (the Inbox badge toggle already feeds `useInboxBadge`), Shortcuts, Custom emoji, Communities and Send Feedback, in the full-width Settings layout with a mobile counterpart for each section.

Then comes Phase F, followed by real-device QA.

---

**PHASE D = COMPLETE.** D1–D4 are implemented, and `vue-tsc`, `eslint` (0 warnings), `vitest` (150 / 1586) and `npm run build` are green. The temporary harness was removed and nothing was committed.
