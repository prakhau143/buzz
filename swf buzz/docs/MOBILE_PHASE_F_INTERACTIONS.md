# Mobile UX — Phase F: Interactions & Final Polish

Date: 2026-10-01. Builds on Phases A–E. Not committed.

## F0. Audit: current interaction architecture

| Piece | Where | State before Phase F |
|---|---|---|
| Message actions on touch | `MessageItem` (`mobileActions` "⋯", 44 px) → `open-actions` → `MessageList` / `ThreadPanel` → the view's `useMobileMessageActions` → `MobileMessageActions` sheet | Works via the "⋯" only; **no long-press** |
| Action sheet | `MobileSheet` (Teleported, scrim tap closes, `useEscapeKey`, `useFocusTrap` — focus in, Tab wraps, focus **returns** to the opener on unmount), grabber, safe-area bottom, rounded top | Good. Context = name + text only (no avatar / time / attachment / thread cues) |
| Authorization | Caller-derived `MessageActionAbilities` (`channelPermissions.ts` rules; report only on others'; delete `self` = kind 5 / `admin` = kind 9005) | Reuse as is |
| Delete confirmation | In-sheet `alertdialog`, self vs moderator wording (audit-log note) | Good; focus stays on the Delete row when it opens |
| Reactions | Quick-reaction row in the sheet (👍 ❤️ 😊 🎉 👀) + `reactionToggle` (react / unreact own) + `ReactionBar` chips; the desktop has 3 hover quick reactions | **No full emoji picker exists anywhere**, so none is invented; the sheet row IS the picker |
| Back navigation | `useMobileNav().goBack` (real history when the previous entry is mobile, else parent route), header back buttons, `navDirection` page transitions; Settings phone screen `mobileBack` (Phase E) | **No swipe-back**. Android system back = WebView history = the router's history (consistent with `goBack`) |
| Refresh | Inbox: `feed.refetch()` (+ 30 s feed refresh); channel / DM: vue-query `refetch` of the conversation (+ live subscription) | **No pull-to-refresh** |
| Haptics | — (`package.json`: only `@tauri-apps/api` + notification plugin) | **None** |
| Touch listeners | None global; MessageList uses IntersectionObserver / ResizeObserver | — |
| Viewport / safe area | `startViewportTracking` (`--app-height`, `data-keyboard`), `env(safe-area-inset-*)` in layout, sheets and header | Reuse |
| Motion | Page slide / fade (`navDirection`), sheet rise, switch-overlay fade, skeleton pulse; all off under reduced motion | Extend lightly |

## Plan

1. **One gesture policy** — `src/features/mobile/gestures/gesturePolicy.ts`: thresholds, `isInteractiveTarget` (links, buttons, fields, editable, media, attachments, `[data-no-gesture]`), `inHorizontalScroller` (an ancestor that can scroll sideways, e.g. Inbox filter chips), `modalOpen()` (an `aria-modal` is up), and a one-owner **claim** so exactly one gesture interprets a touch sequence.
2. **Long press** — `useMessageLongPress` on the list host (delegated to `[data-message-id]`, touch only), 500 ms, cancels on move > 10 px, release, cancel, scroll, row removal or unmount; suppresses the native callout / the follow-up click; emits the existing `open-actions`. Wired in `MessageList` and `ThreadPanel` only when `mobileActions` (desktop untouched). The "⋯" stays as the non-touch equivalent.
3. **Swipe-back** — `useSwipeBack` on the mobile screen: starts only within 24 px of the left edge, vertical intent cancels, interactive progress on the screen (transform, rAF, no reactive per-frame state), commit at 35 % width or a fast flick, otherwise snap back; skipped in fields, horizontal scrollers and while a sheet / dialog is open. Calls the SAME back as the header (`goBack` / Settings `mobileBack`). Wired in `MobileLayout` (screens that have a back) and the Settings phone screen.
4. **Pull-to-refresh** — `usePullToRefresh` + `MobilePullIndicator` in `MobileLayout` (`refresh` prop): only at `scrollTop ≤ 0`, resistance curve, 64 px threshold, one refresh at a time, 12 s timeout, success / error status (`role=status`). Inbox → `feed.refetch`; channel / DM → the conversation query's `refetch`. Not on Search, Settings, dialogs or threads.
5. **Haptics** — `src/platform/haptics`: `lightTap / selection / success / warning / error` via `navigator.vibrate` where it exists (Android WebView / browsers), throttled; everything else (iOS WebView, desktop) is a silent no-op. No new dependency.
6. **Sheet context** (F7) — avatar (from the profile registry, no fetch), name, time, preview, attachment and thread cues; delete confirmation moves focus to "Delete" and warns with a haptic.
7. **Micro-interactions** (F6) — reaction pop, send settle, highlight fade, list fade-in after skeleton, unread row transition, settings section slide; 120–220 ms, transform / opacity only, all removed under reduced motion.
8. Tests, QA (emulated), security, full verification, documentation.

---

# Phase F status — finished and verified (2026-10-01)

**Status: COMPLETE as far as automated and emulated verification can take it.** Live relay, real devices and the installed Windows build were **not** exercised (see "Verification levels").

An earlier session implemented the plan above. This session did not take this document at its word: it audited the real source and tests item by item (F1–F20), fixed what the audit and the emulated QA found, added tests, and ran the full verification again.

## Verification levels used in this document

| Label | Meaning | Done in Phase F? |
|---|---|---|
| **AUTOMATED VERIFIED** | vitest (jsdom), vue-tsc, eslint, vite build, bundle scans | Yes |
| **EMULATED VIEWPORT VERIFIED** | Real components rendered in headless Chrome under CDP device emulation, driven by **real touch events** (`Input.dispatchTouchEvent`). Data was deterministic and a key-less stand-in signer was used, so there was no network and no keys | Yes |
| **LIVE RELAY VERIFIED** | A running buzz-relay with real members, messages and notifications | **No.** No relay was listening on `ws://localhost:3000` and Docker was not running |
| **REAL DEVICE VERIFIED** | A physical Android phone or iPhone, or the installed Windows `.exe` | **No** |

## Defects found and fixed in this session

| # | Area | Defect | Fix |
|---|---|---|---|
| 1 | F12 gesture conflicts (**release-blocking**) | In emulated Chrome, **a sideways drag in the middle of a conversation left the app**: the browser's own history swipe fired. The existing `overscroll-behavior-x: none` hold on `<html>` does not stop it once a nested scroller (`.message-list`) owns the touch. | Mobile screens, sheets and the Settings phone screen now declare `touch-action: pan-y pinch-zoom`. Sideways scrollers (`[data-hscroll]`), fields and media keep `manipulation`. The app's own edge swipe still receives every `touchmove`. Re-verified: filter chips still scroll, the edge swipe still goes back, vertical scrolling still works, and a mid-screen drag no longer navigates. |
| 2 | F13 Escape / F9 threads | **Pressing Escape on a message's action sheet inside a thread also closed the thread** and navigated back. Both surfaces registered `useEscapeKey` on `document`, so both handlers fired. | Added `useEscapeKey(fn, { modal: true })`. Modal surfaces form a stack, handle Escape in the capture phase, and only the top one closes. Ordinary handlers skip a key press a modal has already consumed. `MobileSheet` and `MobileCommunitySheet` opt in. Desktop handlers are unchanged. |
| 3 | F1 gesture ownership | If a gesture's `touchend` never reached its host, it kept its **claim forever**. This happens when the row re-renders away under the finger, so the event fires on a detached node. The stuck claim would lock out swipe-back and pull-to-refresh. | Added `beginTouchSequence()`: a new single-finger touch clears any stale owner. All three gestures call it. A second finger never clears the owner. |
| 4 | F3 swipe-back in landscape | The 24 px edge zone ignored the left safe-area inset, so on a notched phone in landscape the whole zone sat under the notch. | The edge zone is now the frame's `padding-left` (the safe area) plus 24 px. |
| 5 | F15 touch targets | The sender avatar ("Open X's profile") had a **32×32** hit area in channels, DMs and threads. | Mobile-scoped: the hit area is now 44×44 while the avatar is still drawn at 32 px. A −6 px margin keeps the row layout identical. |
| 6 | F14 leaks | The "copied" timers in `MobileMessageActions` and `MobileProfileSheet` were not cleared on unmount. The `startViewportTracking` stop function was not idempotent, so calling it twice could unbalance the reference count. | The timers are cleared in `onBeforeUnmount`, and the stop function is guarded against a second call. |
| 7 | R3 consistency | Literal `6px`, `10px` and `16px` radii in the mobile and Settings UI duplicated the radius tokens. | They now use `--radius-sm`, `--radius-md` and `--radius-lg`. The values are identical, so nothing changes visually. |

## Item-by-item result (F1–F20)

| Item | Result | Evidence |
|---|---|---|
| F1 Gesture policy | A single module, `gestures/gesturePolicy.ts`, holds the thresholds and the shared checks: `isInteractiveTarget` (links, buttons, fields, contenteditable, media, `.attachments`, `[data-no-gesture]`), `inHorizontalScroller` (`data-hscroll` or real overflow-x), `modalOpen` (`aria-modal`), the single-owner claim and the stale-claim reset. | AUTOMATED |
| F2 Long press | Fires at 500 ms. Cancelled by movement over 10 px, release, `touchcancel`, scroll, a second finger, the row being removed, or unmount. Touch only. Swallows the native callout and the click that follows. Reuses `open-actions` → `useMobileMessageActions` → `MobileMessageActions` → `MessageActionAbilities`. The "⋯" button stays. Desktop is untouched (it only runs with `mobileActions`). | AUTOMATED + EMULATED (channel, DM, thread, real touch) |
| F3 Swipe back | Starts only in the edge zone (plus safe area). Vertical intent cancels it. Excluded in fields, sideways scrollers and under modals. Commits at 35 % of the width or on a fast flick; otherwise it snaps back. The screen follows the finger via a transform written in rAF, with no per-frame reactive state; rAF and timers are cleaned up. Calls the same `goBack` (router history) as the header, or `mobileBack` in Settings. | AUTOMATED + EMULATED: channel, DM, thread, and Settings section → list. Profile is a tab and a sheet, so it has no back and no swipe, by design. Android system back is router history, unchanged |
| F4 Pull to refresh | On Inbox, Home, channel and DM. Not on Search, Settings, dialogs or threads. Starts only at `scrollTop ≤ 0`, with a resistance curve, a 64 px threshold, one refresh at a time and a 12 s timeout. Success and error are announced through `role=status`. Reuses the existing `refetch`; the app is never reloaded. | AUTOMATED + EMULATED |
| F5 Haptics | `platform/haptics` provides `lightTap`, `selection`, `success`, `warning` and `error`. Uses `navigator.vibrate` only where it exists and is a silent no-op elsewhere. Bursts of the same kind are throttled to one per 80 ms. No dependency added. | AUTOMATED |
| F6 Micro-interactions | Reaction pop 220 ms, send settle, highlight ease, list fade 180 ms, page slide 200 ms, sheet rise 260 ms. Only transform, opacity and colour are animated. Nothing loops except loading placeholders. Under reduced motion, **0 animations are running** (measured). | AUTOMATED + EMULATED |
| F7 Action-sheet context | Shows the avatar (from the profile registry, no fetch), sender, time, preview, and attachment and thread cues. The sheet is teleported, respects the safe area, has a 20 px top radius and 44 px rows, traps focus, closes on Escape or the scrim, restores focus, and respects reduced motion. | AUTOMATED + EMULATED (screenshots) |
| F8 Destructive actions | Delete is a separate in-sheet `alertdialog`. Self-delete is kind 5 and moderator delete is kind 9005, both derived from the caller. The moderator wording names the author. Focus moves to "Delete" with a warning haptic, and Cancel is one tap. No `confirm()`. The protocol is untouched. | AUTOMATED |
| F9 Threads | Long press, actions, reactions, copy, profile, swipe back and exact reveal (C2) all work. **Escape no longer closes the thread along with the sheet** (fix #2). | AUTOMATED + EMULATED |
| F10 DMs | Long press, the action sheet, swipe back and pull-to-refresh work on the existing DM view. An open sheet blocks the edge swipe. | AUTOMATED + EMULATED. Typing, presence and live receipt can only be checked against a live relay (not done) |
| F11 Inbox | Pull to refresh works. Filter chips scroll sideways without triggering swipe-back or a sheet. Unread is not shown by colour alone: the accessible name says "1 unread". A row opens the exact message (`?m=`), and back returns to the Inbox. A refresh that only partly fails is reported as an error. | AUTOMATED + EMULATED |
| F12 Gesture conflicts | Checked: vertical scroll vs long press, swipe vs fields, swipe vs filter chips, swipe under a sheet, a mid-screen sideways drag (fix #1), long press vs links, buttons and attachments, and one owner per touch. | AUTOMATED + EMULATED |
| F13 Accessibility | The sheet is named "Message actions" and every action has a name. Focus enters the sheet, is trapped, and returns afterwards. Escape closes only the top surface. Each gesture has a non-gesture equivalent: long press = "⋯", swipe = header Back, pull = status text. Targets are 44 px. | AUTOMATED + EMULATED |
| F14 Performance | Listeners are delegated: one set per list or screen, never per row, and never global for gestures. Every listener, timer, rAF and observer is removed on unmount (tested). Viewport and media-query listeners are ref-counted. During a pull only `phase` is reactive. | AUTOMATED |
| F15 Responsive QA | Phones: 390×844, 375×812, 360×800 and 320×720, light and dark. Screens: Home, channel, thread, DM, Inbox, Search, Profile, Settings and the action sheet. Desktop: Settings at 1440, 1280, 1024 and 768. Result over 166 checks: **0 horizontal overflow, 0 elements off screen, 0 controls under 44 px, 0 console errors**. | EMULATED |
| F16 Realistic data | Data used: a long multi-line message, an image attachment (1200×800), a thread with replies, a reacted own message, a 12-message DM, and two mentions (one unread). | EMULATED |
| F17 Security | See "Security" below. | AUTOMATED |
| F18 Automated tests | See "Tests" below. | AUTOMATED |
| F19 Full verification | See "Final verification" below. | AUTOMATED |
| F20 Documentation | This section. | — |

## Tests added this session

- `tests/unit/composables/useEscapeKey.spec.ts` (new, 4 tests):
  - an ordinary surface closes on Escape;
  - a sheet over a thread closes only the sheet;
  - stacked sheets close top first;
  - the listener is removed after the last sheet closes.
- `tests/unit/features/mobile/gestures.spec.ts` (3 added):
  - a lost release cannot lock out the next touch;
  - a second finger does not clear the owner;
  - the swipe-back edge zone starts inside the safe-area padding.

The existing Phase F suites are `gestures.spec.ts`, `interactions.spec.ts` and the swipe case in `settingsShell.spec.ts`. Together they cover:

- long press: timing, cancellation, and cancellation by scrolling;
- gesture ownership and action authorization;
- the sheet: focus, Escape and focus restore;
- swipe: threshold, flick, cancellation and conflicts with horizontal scrollers;
- pull to refresh: threshold, duplicate-refresh prevention, failure and timeout;
- haptics fallback and throttling;
- reduced motion;
- which gestures each screen wires up;
- listener cleanup.

No test was weakened.

## Security (F17) — AUTOMATED VERIFIED

- Gesture state holds only coordinates, timestamps and a message id. Haptics hold no state.
- **Production bundle:**
  - 0 matches for `nsec1…`, `ncryptsec1…`, PEM private keys, `sk_live_`, or AWS, GitHub or Slack tokens;
  - 0 sourcemaps;
  - no harness or test helpers shipped.
- No `console.*` call touches key material.
- `localStorage` holds only: appearance, the community list and current community, panel sizes, notification preferences, the profile cache, the last update check, and read state.
- The notification engine and the feedback model both redact `nsec1` and `ncryptsec1`.
- URLs carry only channel, message and pubkey IDs.
- Delete authorization is unchanged and still derived from the caller.
- Cross-community targets still go through the verified switch; the Phase C3 and D tests pass.

## Final verification (run one after another)

| Check | Result |
|---|---|
| `npx vue-tsc --noEmit` | pass |
| `npx eslint . --max-warnings 0` | pass (0 warnings) |
| `npx vitest run` | **155 files, 1661 tests passed** (Phase E: 152 files, 1613 tests) |
| `npm run build` | pass (`dist` 1.6 MB, 151 assets) |
| Emulated QA (responsive + gestures) | 166 / 166 checks |
| Emulated journeys | 21 / 21 checks (see `MOBILE_RELEASE_READINESS.md`) |

- Screenshots are in `docs/assets/mobile-f/` (10 files).
- The temporary harness (`mobile-harness.html` and `src/__harness__/`) was **deleted** after QA.
- Headless Chrome was stopped.
- A Vite dev server was already running on port 1420. It was reused and left running as found.

## Files changed in Phase F

| File | Change |
|---|---|
| `src/features/mobile/gestures/gesturePolicy.ts` | The shared policy: thresholds, exclusions, single owner, `beginTouchSequence`, native history-swipe hold |
| `src/features/mobile/gestures/useMessageLongPress.ts` | Long press (delegated, touch only) |
| `src/features/mobile/gestures/useSwipeBack.ts` | Edge swipe-back (rAF transform, safe-area edge zone) |
| `src/features/mobile/gestures/usePullToRefresh.ts` | Pull to refresh (resistance, threshold, timeout, one refresh at a time) |
| `src/platform/haptics/index.ts` | Haptics (Vibration API, otherwise no-op) |
| `src/features/mobile/ui/MobileLayout.vue` | Gesture wiring, the `touch-action` policy, the 44 px avatar hit area, micro-interactions |
| `src/features/mobile/ui/MobilePullIndicator.vue` | The pull indicator and its `role=status` |
| `src/features/mobile/ui/MobileMessageActions.vue` | Context header, haptics, focus on delete, timer cleanup |
| `src/features/mobile/ui/MobileSheet.vue`, `MobileCommunitySheet.vue` | Modal Escape, `touch-action` |
| `src/features/mobile/ui/MobileProfileSheet.vue` | Timer cleanup |
| `src/features/mobile/mobileNav.ts` | The viewport-tracking stop function is now idempotent |
| `src/composables/useEscapeKey.ts` | The `{ modal: true }` stack |
| `src/components/MessageList.vue`, `ThreadPanel.vue`, `MessageItem.vue` | Long-press wiring (only with `mobileActions`) |
| `src/features/mobile/views/*` | `refresh` and `back` per screen, `data-hscroll` on chip and tab rows, radius tokens |
| `src/features/inbox/useInboxFeed.ts` | `refetch()` across all categories (for pull to refresh) |
| `src/features/settings/ui/SettingsView.vue` | Swipe-back on the phone screen, `touch-action`, radius tokens |
| `src/features/settings/ui/sections/*` | Radius tokens (same values) |
| Tests | `gestures.spec.ts`, `interactions.spec.ts`, `settingsShell.spec.ts` (swipe), `useEscapeKey.spec.ts` |

## Known limitations

- **Not verified on real hardware.**
  - iOS WKWebView has no Vibration API, so haptics are silent there by design.
  - How the iOS edge swipe feels, Android WebView touch latency, and the soft keyboard with a real IME all need a real device.
- The `touch-action` fix was proven in emulated Chrome. Tauri's Android WebView and WKWebView do not enable the browser history swipe, so in the apps it is defence in depth. It matters in mobile browsers.
- The thread screen has no pull to refresh, on purpose: the thread is live-subscribed.
- There is no full emoji picker on mobile; the sheet's quick-reaction row is the picker. This is unchanged from before Phase F.
- Live typing, presence, delivery and notification flows were not exercised (**live-relay verification was not performed**).
