# Mobile UX — Phase C2: Deep Links & Exact Message Reveal

Date: 2026-09-30. Builds on C1 (`docs/MOBILE_PHASE_C1_COMMUNICATION.md`). Not committed.

## 0. Audit: what already exists

| Piece | Where | Status |
|---|---|---|
| Reveal + highlight + load older until found (≤ 10 pages) → `highlight-done(found)` | `MessageList.vue` `highlightId` | Reuse as is |
| Desktop reveal from the URL `?messageId=&threadRootId=` | `ChannelsView` / `DmView` | Unchanged |
| Notification target (community, kind, channelId, messageId, threadRootId, identity fingerprint), validated parse | `notificationEngine.ts` `NotificationTarget`, `parseNotificationTarget` | Converted into the shared model |
| Notification click → switch community → route | `useNotificationService.openTarget` | Switched **without membership verification** and routed to a desktop route only |
| Inbox → source | `InboxView.openSource` (desktop), `MobileInboxView.open` (mobile) | Mobile dropped the `messageId`; DM rows were disabled |
| Desktop ⇄ mobile route mapping | `mobileRoutes.ts` | Dropped `messageId` |
| Highlighting a reply inside a thread | `ThreadPanel.vue` | Missing |
| Verified community switch with restore-on-failure | `useCommunitySwitch.switchTo` (Phase A) | Reuse |

## 1. Plan (implemented below)

1. **One target model**: `features/navigation/messageTarget.ts`.
   - `MessageTarget { community | null, kind: channel | dm, conversationId, messageId | null, threadRootId | null, source }`
   - Built by `normalizeMessageTarget`, `fromNotificationTarget` and `fromInboxItem`. Invalid input → `null`, never routed.
   - `desktopRoute()` is the existing `?messageId=&threadRootId=` contract. `mobileRoute()` maps to `mobile-channel`, `mobile-thread`, `mobile-dm` or `mobile-dm-thread` with `?m=<messageId>`.
2. **One opener**: `useOpenMessageTarget()`.
   - Resolves the community through `useCommunitySwitch.switchTo` (verify → switch → restore on failure; shared error).
   - Then pushes the route for the current tier (mobile or desktop).
   - A module-level phase (`community` | `navigating`) drives the mobile "Resolving community…" state and pauses the breakpoint mapper, so it can't race the navigation.
3. **Mobile reveal**:
   - The channel and DM screens pass `route.query.m` to `MessageList.highlightId`. It uses the existing load-older-until-found.
   - The thread screen passes it to a new `ThreadPanel.highlightId`.
   - When done, `m` is removed with `replace`, so there is no extra history entry and no re-reveal.
   - Not found → a "Message unavailable" notice.
4. **Breakpoint mapping** carries `messageId` ⇄ `m`.
5. **Inbox (mobile)**: every row with a conversation opens its exact target, DMs included. The item is marked read through the existing `markRead`.
6. **Notifications**:
   - `openTarget` keeps the identity-fingerprint guard.
   - Channel and DM targets go through the shared opener, which now verifies the community.
   - Inbox targets route to the Inbox of the current tier.
7. **Tests, visual QA at 4 sizes, full suite, docs.**

---

# Final report

## A. Architecture

```
Inbox row ──┐                                    ┌─ desktop: channels/dm ?messageId=&threadRootId=
            ├─► MessageTarget ─► useOpenMessageTarget ─┤      (existing ChannelsView/DmView reveal)
Notification┘   (normalised)    1. verified switch     └─ mobile: /m/c|d/:id[/t/:root] ?m=<id>
                                2. tier route                  └─► MessageList / ThreadPanel highlightId
```

- **One model and one opener**, used by every entry point.
- **No new store, protocol, subscription or backend.** Reveal reuses `MessageList`'s existing bounded load-older.
- **Pause, not race.** The breakpoint mapper in `App.vue` holds off while a deep navigation is in flight (`isDeepNavigating()`), so it can't overwrite the target route.

## B. Target model

`features/navigation/messageTarget.ts`:
- `MessageTarget` fields: `community` (relay URL or null = current), `kind` (`channel | dm`),
  `conversationId`, `messageId`, `threadRootId` (only for a reply), and `source`.
- **Validation.** Ids must be hex or safe ids, and the community must be `ws(s)://`. Anything else → `null`.
- **Degrades, never guesses.** A bad message id opens the conversation without a reveal. A root "reply to itself" is treated as the root.
- **Builders:** `fromInboxItem` and `fromNotificationTarget`.
- **Routes:** `desktopRoute` and `mobileRoute`.

## C. Channel deep reveal

- **Route:** `mobile-channel?m=<id>`. `MessageList.highlightId` reveals the message immediately when it is loaded.
- **Older messages:** otherwise it emits `load-older` through the **existing** `useChannelMessages.loadOlder`. This is the Phase 4A cursor path, so page boundaries and same-second messages behave as they already do. It stops after **10 pages** or when history is exhausted.
- **When done:** it reports `highlight-done`, and `?m=` is removed with `replace`.
- **A reply** opens the thread page instead (see E).

## D. DM deep reveal

- **Route:** `mobile-dm?m=<id>`.
- **Same mechanism**, over `useDmMessages` and its existing `loadOlder` paging.

## E. Thread deep reveal

- **Route:** `mobile-thread` / `mobile-dm-thread` `?m=<id>`. A reply target always opens its thread; it never falls back to the channel.
- **Revealing:** new `ThreadPanel.highlightId`.
  - Waits for the thread to load, which is a single fetch with no paging.
  - Centres the root or reply and highlights it.
  - Reports found or not found **once**, so later refreshes never re-scroll or fight the reader.
- **Failure:** if the thread fails to load (no access), it reports not found.

## F. Inbox navigation

Every mobile Inbox row with a conversation opens its exact target:

| Row | Opens |
|---|---|
| Mention | Channel, revealing the message |
| Thread reply | Thread, revealing the reply |
| DM | The DM, revealing the message. These rows were disabled in C1 |
| Needs-action that is a chat message | Its message |
| Other needs-action event (e.g. kind 46010) with a conversation | The conversation, with no reveal |

- Rows with no conversation are disabled.
- The item is marked read with the existing `feed.markRead` **before** navigating, so the NIP-RS frontier only moves forward.

## G. Notification navigation

`useNotificationService.openTarget`:
- The identity-fingerprint guard is kept: a toast from another identity is never routed.
- **Channel / DM targets** go through the shared opener. They now use the *verified* community switch; previously it was an unverified `switchCommunity`.
- **Incomplete targets** are ignored, never guessed.
- **Inbox targets:** a verified switch if needed, then `mobile-inbox` or the desktop Inbox.
- The same opener serves in-app toasts and Windows toast clicks, so it covers the app being open, in the background, or returning from the background.
- Payloads carry ids only (relay URL, channel, message, thread root, identity fingerprint). The existing safety rule is unchanged: no keys.

## H. Cross-community behaviour

**A → B:**
1. `deepNavPhase = "community"`, and the mobile frame shows "Resolving community &lt;host&gt;…".
2. `useCommunitySwitch.switchTo(B)` verifies membership first, then switches, and restores A if B fails after verifying.
3. On success: `clearChannelRestore`, then the target route.

**On refusal or unreachability:** `openMessageTarget` returns `false` and navigates nowhere. You stay in A, and the frame shows the shared switch error (dismissible). A remembered-but-unverified relay is never entered.

## I. Error behaviour

| Case | Result |
|---|---|
| Invalid target / missing channel / missing DM / bad community | Not routed (`null`) |
| Bad message id | Conversation opens without a reveal |
| Deleted / inaccessible / beyond history / thread not loadable | "**Message unavailable** — It may have been deleted, or you may no longer have access to it." (44 px dismiss) |
| Refused community | Stay put, with the shared error banner |
| Double tap | The second deep navigation is ignored while one is in flight |

## J. Highlight behaviour

- **Style:** the existing `MessageList` accent tint, plus a 3 px accent inset rail on mobile. The thread uses the same style. Background and shadow only, so there is **no layout shift**.
- **Motion:** 600 ms fade; none under `prefers-reduced-motion`.
- **Timing:** removed after 2 s.
- **One reveal per target.** `?m=` is dropped with `replace`, so going back or reloading doesn't re-reveal, and there's no extra history entry.

## K. Read-state behaviour

- **Inbox:** only the existing `markRead`, which is the conversation frontier up to the item.
- **Opened conversation:** only the existing `markChannelSeen(newest)`.
- There is no mobile-specific unread logic, and nothing rewinds a published frontier.

## L. Performance and cleanup

- **No new subscriptions or polling.** Deep reveal is a navigation plus the screen's existing queries.
- **Bounded history:** at most 10 older pages. Thread reveals are a single cached query.
- **Cleanup:**
  - The opener's phase always resets in `finally`.
  - The `ThreadPanel` highlight timer is cleared on unmount.
  - `useMobileReveal` holds no timers.

## M. Files changed

- **New**
  - `src/features/navigation/messageTarget.ts`, `src/features/navigation/useOpenMessageTarget.ts`
  - `src/features/mobile/useMobileReveal.ts`, `src/features/mobile/ui/MobileRevealNotice.vue`
- **Changed**
  - `components/ThreadPanel.vue`: `highlightId`, `highlight-done`, highlight style. Default null, so desktop is unchanged.
  - `features/mobile/mobileRoutes.ts`: `messageId` ⇄ `m` in the counterpart mapping.
  - `features/mobile/ui/MobileLayout.vue`: "Resolving community…" and switch-error banners; mobile highlight rail.
  - `features/mobile/views/`
    - `MobileChannelView.vue`, `MobileDmView.vue`: `highlightId`, reveal notice
    - `MobileThreadView.vue`: thread `highlightId`, reveal notice
    - `MobileInboxView.vue`: exact targets via the opener, DM rows enabled
  - `features/notifications/useNotificationService.ts`: `openTarget` → shared opener (verified switch, tier-aware).
  - `features/communities/useCommunitySwitch.ts`: read-only `communitySwitchError`, `communitySwitchingTo`, `clearCommunitySwitchError` for display surfaces.
  - `App.vue`: the breakpoint mapper pauses during a deep navigation.
- **Tests**
  - New: `tests/unit/features/navigation/{deepReveal,revealMechanics,entryPoints}.spec.ts`
  - Updated mocks: `tests/unit/features/mobile/mobileShell.spec.ts`

## N. Tests added (32)

- **`deepReveal.spec.ts` (15)**
  - target normalisation (valid, root-as-reply, invalid ×6)
  - Inbox mention, thread, DM, needs-action, no conversation
  - notification conversion
  - mobile and desktop routes; breakpoint mapping keeps the reveal
  - opener: same community, desktop tier, cross-community via the verified switch (phase = community), refused switch stays put, double tap ignored
  - `?m=`: found → replace without `m`; not found → unavailable → dismiss; none
- **`revealMechanics.spec.ts` (9)**
  - `MessageList`: already loaded (no fetch), pages older history via the existing `load-older` then reveals, history exhausted → not found, bounded at 10 pages
  - `ThreadPanel`: waits for load then reveals the reply; root as target; missing reply → not found once (no re-report on refresh); load error → not found; desktop (no id) does nothing
- **`entryPoints.spec.ts` (8)**
  - Inbox: markRead **then** open; mention, thread reply, DM, needs-action; no-conversation row disabled
  - Notification: channel reply target normalised with its community; foreign identity ignored; incomplete ignored; Inbox target opens the tier Inbox after a verified switch, and a refused switch goes nowhere

## O. Final test count

**144 files, 1514 tests, all passing.** C1 was 141 / 1482.

## P. vue-tsc

Clean.

## Q. eslint

`--max-warnings 0` clean. The first run flagged 6 attribute-order and 3 unused-import warnings in the new code; both were fixed.

## R. npm build

Pass.

## S. Desktop regression

- `ChannelsView` / `DmView` reveal and `InboxView.openSource` are unchanged. The desktop route produced by the model is the same `?messageId=&threadRootId=` contract, and is tested.
- `ThreadPanel` without `highlightId` behaves as before (tested).
- **One behaviour change:** desktop notification clicks now switch community through the *verified* switch (verify first, restore on failure) instead of an unverified switch. This is intentional, to satisfy "never bypass membership verification".
- The full suite, including the Community Rail, switcher, desktop Inbox, channel, DM, thread, notification and read-state specs, is green.

## Visual QA

Headless Chrome, the real views, and the real theme CSS on a temporary harness (deleted afterwards), at 390×844, 375×812, 360×800 and 320×720:

| Case | Result at every size |
|---|---|
| Channel target above the fold | Scrolled to the centre (within ±30 px), highlighted, `?m=` removed |
| Thread reply | Highlighted and in view, `?m=` removed |
| Missing reply | "Message unavailable" with a 44×44 dismiss, `?m=` removed |
| Layout | No horizontal overflow anywhere |

**Not verified live:**
- A real device.
- A real cross-community switch from a notification on mobile.
- Paging against a live relay. That path is the existing `loadOlder` and is covered by the tests above.

## T. Remaining for Phase C3

- Attachment preview polish at phone width; conversation-level skeletons in place of `MessageList`'s spinner.
- **Scroll restore** when returning from a thread page to its conversation. The browser restores within the same component instance, but a remounted list starts at the bottom.
- **Session chrome during a switch.** The chrome is hidden while `session.isReady` is false during a community switch (existing behaviour), so on mobile the "Resolving community…" banner is visible only until the switch tears down the session. A persistent resolving screen would need session-lifecycle work.
- The desktop DM view doesn't wire reaction removal (noted in C1).
- **Phase F:** long-press, swipe-back.
