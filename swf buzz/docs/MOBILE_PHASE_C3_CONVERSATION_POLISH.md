# Mobile UX — Phase C3: Conversation Polish

Date: 2026-09-30. Builds on C1 and C2. Not committed.

## Audit and plan

| Item | Finding (actual code) | Smallest safe change |
|---|---|---|
| **Attachments** | `MessageAttachments.vue` is shared with desktop: fixed `max-width: 360px`, image `width: 100%`, aspect ratio reserved from `dim`, `loading` / `error` states, blob URLs via `useAuthorizedMedia` (Blossom auth). The file row is ~36 px tall, the loading box without `dim` is 2 rem, and the "couldn't be loaded" filename doesn't wrap. `useAuthorizedMedia` exposes no retry | **Mobile-scoped CSS only** (in `MobileLayout`): `max-width: min(100%, 360px)`, `min-width: 0`; images `object-fit: contain` + `max-height`; 44 px file rows; long names ellipsised or wrapped; a taller loading placeholder with a subtle pulse. Desktop and the upload/auth path are untouched. No retry is invented |
| **Loading skeleton** | `MessageList` shows `StateView kind="loading"` (spinner) while `isLoading`. The feed and its scroll element only exist after load | Mobile screens render a **mobile skeleton** instead of mounting `MessageList` during the *initial* load (`isLoading && no messages`). `MessageList`, and so desktop, is unchanged. Paging, sending and reconnect never show it |
| **Scroll restore** | Conversation → thread is a route change, so the conversation view **remounts**. `MessageList` scrolls to the bottom as soon as its scroll element appears | `MessageList` gains, default-off: `captureScrollAnchor()` (exposed: first visible message id + its offset + scrollTop) and a `restoreAnchor` prop, applied once, at the moment it would otherwise scroll to the bottom (falling back to the bottom if the anchor isn't rendered). The mobile screens capture before opening a thread into a small module memory keyed by conversation. They restore **only** on a *back* navigation to the same conversation with no pending `?m=` reveal, then forget it. Any other arrival discards it |
| **Switch resolving** | `switchCommunity` → `session.setIdentity()` sets `authStatus = "resolvingIdentity"` (`isReady` false) → `beginIdentitySession` tears down the socket and the community caches → App hides the header, rail and SessionServices; screens lose their data. So a switch is a blank flash on mobile | **Presentation-only**: a full-screen `MobileSwitchOverlay` in `App.vue` (mobile tier), driven by the existing shared `communitySwitchingTo` / `communitySwitchError`. "Connecting to &lt;B&gt;…" with a skeleton while switching. On failure: "Unable to connect", the reason, "You're still in &lt;A&gt;", **Retry** and **Stay**. Session lifecycle, verification and restore-on-failure are untouched. `useCommunitySwitch` remembers the last failed target so Retry reuses the same verified `switchTo` |
| **Keyboard** | C1 `visualViewport` tracking (`--app-height`, `data-keyboard`) | Regression tests only |

---

## A. Scope

Only the mobile tier (`/m/*`, < 768 px). In scope:

- attachment presentation
- initial-load skeleton
- thread → conversation scroll restoration (channels and DMs)
- persistent community-switch resolving and failure screen
- small-screen QA
- keyboard regression
- C2 compatibility
- accessibility

Not touched:

- Nostr and relay protocols, NIP-42, membership verification
- identity storage, session lifecycle
- upload, auth, message, DM, thread, read-state, notification and search protocols
- backend APIs, OLD Buzz

Long-press and swipe-back (Phase F), Phase D and Phase E were not started.

## B. Attachments

`MessageAttachments.vue` (shared) is **unchanged**. The mobile presentation comes from rules scoped to `.mobile-layout` in `MobileLayout.vue`:

- **Images:** the frame hugs the image (`width: fit-content`, `max-width: min(100%, 360px)`). The image is `max-width: 100%`, `max-height: 60vh`, `object-fit: contain`, and keeps the ratio reserved from `dim`. A portrait shot is capped by height and has no letterbox bars. No stretching and no horizontal overflow.
- **Video:** full column width, capped at 360 px and `60vh`.
- **Files:** a 48 px flex row. A long name ellipsises (`min-width: 0` on the name) and the size stays visible.
- **Loading:** a 140 px-minimum placeholder with a calm pulse. The pulse is off under `prefers-reduced-motion`.
- **Failed:** the existing labelled placeholder, now 48 px minimum. The name wraps (`overflow-wrap: anywhere`) instead of overflowing.

Measured at 390 px: landscape 314×178, portrait 287×508, file 314×48, loading 314×177, failed 314×77. At 320 px all are 244 px wide. No retry button was added, because `useAuthorizedMedia` has no retry path and inventing one would change media loading.

## C. Skeleton

`MobileConversationSkeleton.vue` has five varied rows with the same metrics as a message row (avatar plus name and line widths). It fills from the bottom like the feed and uses a pulse (none under reduced motion). It is marked `role="status"`, `aria-busy="true"` and `aria-label="Loading conversation"`.

`MobileChannelView` and `MobileDmView` render it **only** while `isLoading && !messages?.length`. Otherwise `MessageList` mounts as before. So paging older messages, sending, background refetch and reconnect never show it. Desktop keeps its `StateView` spinner, and a source-guard test checks this.

## D. Scroll restoration

- **Types:** `features/messages/scrollAnchor.ts` defines `ScrollAnchor { id, offset, scrollTop }`.
- **`MessageList`** (default-off additions):
  - `captureScrollAnchor()` is exposed. It returns the first message whose bottom is below the feed top, plus its offset.
  - A `restoreAnchor` prop is applied at the exact moment the list would otherwise scroll to the bottom. If the anchor message is not rendered (deleted or out of the window), the list falls back to the normal open at the latest message. Desktop never passes it.
- **`features/mobile/scrollMemory.ts`:** a per-conversation memory keyed `channel:` or `dm:` plus the id. It is consumed once, and it applies **only** when:
  - the arrival is a *back* navigation (`navDirection === "back"`),
  - the route has no pending `?m=` reveal, and
  - the entry is under 30 minutes old.

  Any other arrival discards it, so a stale restore is impossible.
- **Views:** `openThread` in both mobile conversation screens captures the anchor, then pushes the thread route.

Measured with a real back navigation in the harness, the same message at the same offset came back in every case:

| Size | Channel (message / offset) | DM (message / offset) |
|---|---|---|
| 390×844 | `m11…` / −78 → `m11…` / −78 | `m28…` / −56 → `m28…` / −56 |
| 375×812 | −66 → −66 | −80 → −80 |
| 360×800 | −57 → −57 | −80 → −80 |
| 320×720 | −39 → −39 | −80 → −80 |

## E. Community resolving

`MobileSwitchOverlay.vue` is rendered by `App.vue` as `v-if="isMobile && session.pubkey"`. It is keyed on the identity and not on `isReady`, because `isReady` is false by design while a switch tears the old session down.

- **Switching:** a full-screen status (`role=status`, `aria-live=polite`, `aria-busy`). It shows the target's avatar and name, "Connecting to community…", skeleton lines and "Verifying your membership. Please wait."
- **Failure:** an `alertdialog`. It shows "Unable to connect", "&lt;B&gt; is unavailable right now.", the real reason, and "You're still in &lt;A&gt;" (the switch already restored A). Two 48 px buttons follow. **Retry** takes focus and runs `retryFailed()`, which is the same verified `switchTo` (membership is re-probed; nothing is bypassed). **Stay in &lt;A&gt;** clears the error.
- **`useCommunitySwitch`:** gains `failedTarget` (set on verify failure and on post-switch failure, cleared on a new attempt or on dismissal), `retryFailed()`, and read-only exports `communitySwitchingTo`, `communitySwitchingFrom` and `communitySwitchFailedTarget`, plus `clearCommunitySwitchError()`.
- **C2 banners:** the C2 "Resolving community…" and switch-error banners in `MobileLayout` were removed; the overlay supersedes them. Desktop keeps its switcher and rail UI.

Session lifecycle semantics are unchanged. The overlay only *presents* the existing shared state and never claims readiness early.

## F. Keyboard

There was no code change. Regression tests cover the following:

- A `visualViewport` shrink greater than 120 px sets `--app-height` to the visible height and sets `data-keyboard="open"`, which hides the bottom nav and drops the footer inset.
- Closing the keyboard restores `closed`.
- A small browser-chrome resize is not treated as a keyboard.
- The listener is removed on unmount.

The composer stays on the keyboard because the layout column shrinks. It uses no fixed positioning.

## G. Responsive

Harness sweep in dark mode, at 390×844, 375×812, 360×800 and 320×720. States checked: channel, attachments, skeleton, scroll restore (channel and DM), C2 reveal → thread → back, switch connecting and failed.

Every state and size had **no horizontal scroll and no element outside the viewport**. Switch buttons are full width and 48 px tall (288 px wide at 320). Light and dark were both inspected.

## H. Accessibility

- **Skeleton:** `role=status`, `aria-busy`, labelled.
- **Switch overlay:** the connecting status is `aria-live=polite`. The failure is an `alertdialog` with `aria-labelledby` / `aria-describedby`, and focus moves to Retry (verified in the harness: `activeElement = mobile-switch-retry`). Visible `:focus-visible` rings; 48 px targets.
- **Attachments:** the existing labels are kept ("Open … full size", "Download …", the hidden "Loading attachment"). File and failed rows are 48 px or more.
- **Motion:** all new motion is disabled under `prefers-reduced-motion`.

## I. Performance

- The scroll memory is a `Map` of small anchors, consumed on read and bounded by age.
- Capture and restore each measure one element, once. There are no observers and no timers.
- The skeleton is static markup.
- The overlay is a `v-if` on shared computeds, so it costs nothing when idle.
- No new dependencies. The mobile chunk stays small (`MobileSection` is 32.9 kB, 12.7 kB gzipped).

## J. Files changed

| File | Change |
|---|---|
| `src/components/MessageList.vue` | `restoreAnchor` prop, `captureScrollAnchor()` exposed (default-off) |
| `src/features/messages/scrollAnchor.ts` | **new**, the anchor type |
| `src/features/mobile/scrollMemory.ts` | **new**, back-only, consume-once memory |
| `src/features/mobile/ui/MobileConversationSkeleton.vue` | **new** |
| `src/features/mobile/ui/MobileSwitchOverlay.vue` | **new** |
| `src/features/mobile/views/MobileChannelView.vue` | skeleton, capture on thread open, restore on back |
| `src/features/mobile/views/MobileDmView.vue` | same as the channel view |
| `src/features/communities/useCommunitySwitch.ts` | `failedTarget`, `retryFailed`, read-only exports |
| `src/App.vue` | renders `MobileSwitchOverlay` on the mobile tier |
| `src/features/mobile/ui/MobileLayout.vue` | C2 banners removed; mobile attachment CSS |
| `tests/unit/features/mobile/conversationPolish.spec.ts` | **new** |
| `tests/unit/features/communities/switchRetry.spec.ts` | **new** |
| `tests/unit/features/mobile/mobileDmView.spec.ts` | + DM thread-open capture assertion |
| `docs/assets/mobile-c3/*.png` | QA screenshots |

## K. Tests added

**`conversationPolish.spec.ts` (23 tests)**

- **`MessageList`:** capture returns the first visible row and its offset; restore puts it back; a missing anchor falls back; desktop still opens at the bottom.
- **Scroll memory:** back-only and consume-once; DM and channel are separate; forward navigation discards it (no stale restore); `?m=` wins; entries over 30 minutes are ignored; `null` is ignored; both screens are wired (source guard).
- **Skeleton:** accessible and varied; shown only on the initial load of both screens; desktop spinner unchanged.
- **Overlay:**
  - idle state renders nothing
  - the connecting status names the target
  - failure shows the reason and the "still in A" text, focuses Retry, Retry calls `retryFailed`, and Stay dismisses
  - an unrelated error does not take over the screen
  - App keys it on `session.pubkey`, not `isReady`
- **Attachment CSS:** size limits, ratio, 48 px rows, ellipsis and wrap, reduced motion.
- **Keyboard:** open, close and cleanup; a small resize is not a keyboard.

**`switchRetry.spec.ts` (4 tests)**

- A verify failure never leaves A and records the target.
- A post-switch failure restores A and records the target.
- Retry re-verifies through the same `switchTo` and clears the failure on success.
- Stay clears everything, and retry with nothing failed is a no-op.

**`mobileDmView.spec.ts`:** opening a DM thread remembers the anchor.

## L. Final test count

**146 files / 1541 tests, all passing.** Before C3 it was 144 / 1514, so C3 adds 2 files and 27 tests.

## M. vue-tsc

`npx vue-tsc --noEmit` exits 0.

## N. eslint

`npx eslint . --max-warnings 0` exits 0.

## O. Build

`npm run build` exits 0 (built in about 15 s).

## P. Desktop regression

- `MessageList` changes are opt-in props and exposes; desktop passes neither, and the desktop open-at-bottom behaviour is unit-tested.
- `MessageAttachments` is unmodified, and the mobile CSS is scoped under `.mobile-layout`.
- The overlay renders only when `isMobile`.
- The desktop `CommunitySwitcher` and `CommunityRail` use the same `switchTo` with unchanged semantics. `clearError` now also clears the failed target.
- The full suite passes, including all desktop specs.

The installed desktop app was not rebuilt or reinstalled in this phase; no desktop UI changed.

## Q. Visual QA

A temporary harness (`mobile-harness.html` plus `src/__harness__/mobileHarness.ts`) seeded the vue-query cache. It used fake media (a landscape image, a portrait image, a long-named file, a loading item that never resolves, and a failed item) and a key-less stand-in signer to hold or fail the membership probe. No real relay traffic, messages or communities were involved.

It was driven by headless Chrome over CDP (port 9333) against `npm run dev`. Afterwards the harness was **deleted**, Chrome and Vite were stopped, and ports 1420, 9333 and 9334 were confirmed closed. No source references the harness.

Screenshots are in `docs/assets/mobile-c3/`:

- `c3-media-390.png`
- `c3-media-320-bottom.png`
- `c3-media-390-dark-bottom.png`
- `c3-skeleton-390.png`
- `c3-switch-connecting-390.png`
- `c3-switch-failed-320-dark.png`

C2 regression: arriving with `?m=` reveals the message and drops `?m=`. Thread → back then shows **0** highlighted rows, the URL is `/m/c/c2`, and the saved position is restored rather than a re-reveal.

## R. Known limitations

- No real phone or iOS Safari run. Viewports were emulated in Chrome, and the keyboard is covered by unit tests with a mocked `visualViewport`.
- Failed attachments have no retry, because `useAuthorizedMedia` has none. Adding one would change media loading.
- The session gap during a switch still exists by design. It is now covered by a truthful status, not removed.
- Scroll restore covers conversation → thread → back within 30 minutes. Returning from other tabs (Inbox or Search) opens at the latest message, as before.
- If the anchor message is no longer in the loaded window, the conversation opens at the latest message.
- The desktop DM reaction-removal limitation is unchanged, as instructed.

## S. Next phase recommendation

**Phase D** as planned in the master prompt. Long-press and swipe-back gestures remain for **Phase F**.

---

**PHASE C3 = COMPLETE.** All scope items are implemented, and `vue-tsc`, `eslint` (0 warnings), `vitest` (146 / 1541) and `npm run build` are green. The temporary harness was removed and nothing was committed.
