# Mobile Release Readiness (Phases A–F)

Date: 2026-10-01. Not committed and not pushed.

## Verdict

**Ready to start real-device and live-relay QA. Not yet production-verified.**

Every check that can run in this workspace passes:

- typecheck
- lint
- 1661 unit and integration-style tests
- production build and bundle inspection
- 166 emulated responsive and gesture checks
- 21 emulated user-journey checks

The product has **not** been run against a live relay, on a physical Android phone or iPhone, or as the installed Windows build. Those are the remaining release gates (§13–§14).

| Level | Status |
|---|---|
| **AUTOMATED** | ✅ Verified (this document, §3–§6, §9) |
| **EMULATED** | ✅ Verified in headless Chrome with CDP device emulation and real touch events (§10, §1 journeys) |
| **LIVE RELAY** | ❌ Not performed. No relay on `ws://localhost:3000`, and Docker was not running |
| **REAL DEVICE** | ❌ Not performed (Android, iOS, installed Windows `.exe`) |

---

## 1. Product architecture

- **One app, two shells.**
  - At widths up to 767.98 px (`MOBILE_QUERY`), routes are the `mobile-*` stack: `/m`, `/m/c/:channelId`, `…/t/:rootId`, `/m/d/:conversationId`, `mobile-dm-thread`, `/m/inbox`, `/m/search` and `/m/profile`, plus the phone screen of `SettingsView`.
  - Wider than that, the desktop shell (AppShell + Community Rail) is unchanged.
  - Both shells use the same stores, vue-query caches, services, protocol code and permission rules.
- **Screen frame.** `MobileLayout`:
  - Layout: header | scrolling content | composer footer | bottom navigation.
  - Height follows `--app-height`, which tracks the visual viewport, so the composer sits on top of the keyboard.
  - Respects the safe-area insets.
  - Every person surface opens the one `MobileProfileSheet`.
- **Navigation.** `useMobileNav().goBack` uses the real history entry when the previous screen was in the mobile stack, and otherwise goes to the parent route. The header Back button, the edge swipe and Android system Back all go through the router history.
- **Conversations.** The shared `MessageList`, `ThreadPanel` and `MessageItem` run with `mobileActions`. Message actions go `open-actions` → `useMobileMessageActions` → `MobileMessageActions`, with caller-derived `MessageActionAbilities`.
- **Deep links.** A target (notification, Inbox or Search) resolves to the exact message:
  - `useOpenMessageTarget` → `?m=` → `useMobileReveal` (load older messages until found, then highlight).
  - A target in another community goes through the **verified** community switch first.
- **Gestures (Phase F).** One `gesturePolicy` owns each touch sequence. The gestures are long press, edge swipe-back and pull-to-refresh, with `touch-action` keeping the browser's own history swipe out. `platform/haptics` uses the Vibration API or does nothing.
- **Settings.** The same registry and sections as desktop. On phones they show as a list → section screen stack.

## 2. Completed phases

| Phase | Scope | Doc | Tests at end of phase |
|---|---|---|---|
| A | Community Rail (desktop) | `COMMUNITY_RAIL_IMPLEMENTATION.md` | 136 / 1433 |
| B | Mobile foundation (routes, layout, bottom nav, viewport/keyboard, safe areas) | `MOBILE_PHASE_B_FOUNDATION.md` | 139 / 1454 |
| C1 | Mobile channels, DMs, threads, action sheet, profile | `MOBILE_PHASE_C1_COMMUNICATION.md` | 141 / 1482 |
| C2 | Deep links and exact message reveal | `MOBILE_PHASE_C2_DEEP_REVEAL.md` | 144 / 1514 |
| C3 | Conversation polish, attachments, community switching | `MOBILE_PHASE_C3_CONVERSATION_POLISH.md` | 146 / 1541 |
| D | Inbox, Search, Notifications | `MOBILE_PHASE_D_PRODUCTIVITY.md` | 150 / 1586 |
| E | Settings and personalization | `MOBILE_PHASE_E_SETTINGS_PERSONALIZATION.md` | 152 / 1613 |
| F | Interactions and final polish | `MOBILE_PHASE_F_INTERACTIONS.md` | **155 / 1661** |

## 3. Final automated test count

`npx vitest run` gives **155 test files and 1661 tests, all passing**. The run takes 346 s.

Live-relay end-to-end suites (`tests/integration/*.e2e.spec.ts`, `vitest.e2e.config.ts`) are opt-in and need a running buzz-relay. They were **not run** (see §13).

## 4. Typecheck

`npx vue-tsc --noEmit` passes.

## 5. Lint

`npx eslint . --max-warnings 0` passes with 0 warnings.

## 6. Build

`npm run build` (`vue-tsc` + `vite build`) passes. `dist/` is 1.6 MB with 151 assets. The largest chunk is `index-*.js`: 487 kB, or 168 kB gzipped.

**Bundle inspection:**

| Check | Result |
|---|---|
| `nsec1…`, `ncryptsec1…`, PEM private keys, `sk_live_`, AWS, GitHub or Slack tokens | 0 |
| Sourcemaps | 0 |
| QA harness or test-only helpers | 0 |
| Gesture policy shipped as its own lazy chunk | yes |
| **Baked env values** | This local build inlined the git-ignored `.env.local`: `VITE_RELAY_URL=ws://localhost:3000`, `VITE_SWF_BACKEND_URL=http://127.0.0.1:8787`, `VITE_ENVIRONMENT=development`, and empty Okta IDs. These are not secrets, but **a release build must be produced with the production env** (see the checklist in §14). |

## 7. Accessibility

- **Action sheet:** named `dialog`, every action named, focus moves in, is trapped and is restored. Escape closes **only the top sheet**; this was fixed in F, where it used to also close the thread underneath. Scrim tap closes it too.
- **Non-gesture equivalents:** long press = "⋯" (44 px), swipe back = header Back (44 px), pull to refresh = an announced `role=status` with a normal refetch path.
- **Unread:** never colour-only. Chips and rows carry "N unread" in their accessible names (emulated check).
- **Touch targets:** every interactive control is at least 44 px at 320–390 px widths, in light and dark (emulated: 0 violations). The sender avatar was fixed from 32 px in F.
- **Reduced motion:** 0 running animations on a conversation (measured). Swipe-back makes the same decision without following the finger.
- Inputs are 16 px, so iOS does not zoom on focus.

## 8. Performance

- Gesture listeners are delegated per list or screen and never per row. None are global; the one exception is the modal-Escape capture listener, which exists only while a sheet is open.
- Every listener, timer, rAF and observer is removed on unmount (unit-tested).
- Viewport and media-query listeners are reference-counted.
- Pull to refresh writes a CSS variable in rAF and only changes reactive `phase` a few times per gesture. Swipe-back writes `transform` in rAF with no reactive state.
- Animations use transform, opacity and colour only. Nothing loops except loading placeholders.
- Not measured: frame timing or memory on real hardware (§13).

## 9. Security

| Area | Result |
|---|---|
| Private keys / nsec | Never logged. Redacted from notification text and from feedback payloads (`nsec1`, `ncryptsec1`, auth/token/secret patterns). |
| Auth tokens | None in `localStorage`. It holds only appearance, community list/current, panel sizes, notification prefs, profile cache, update-check time and read state. |
| URLs | Only channel, message and pubkey IDs (`?m=`, `?q=`, `?f=`) |
| Gesture/haptic state | Coordinates, timestamps and a message id only |
| Destructive actions | Unchanged and caller-derived: kind 5 (self) and kind 9005 (moderator) |
| Cross-community targets | Always go through the verified switch (Phase C3/D tests pass) |
| Production bundle | Clean (§6) |

## 10. Responsive QA — EMULATED

Headless Chrome, CDP device emulation, touch enabled, deterministic data, and a key-less signer with no network.

- **Phones:**
  - Sizes: 390×844, 375×812, 360×800 and 320×720, each in light and dark.
  - Screens: Home, channel (long text, an image attachment, a thread root, reactions), thread, DM, Inbox, Search, Profile, Settings, and the action sheet.
  - Result: **0 horizontal overflow, 0 elements off screen, 0 controls under 44 px, and 0 console errors** (166 checks).
- **Gestures, driven by real touch events:**
  - Long press opens the sheet in channels, DMs and threads.
  - A short tap does not open it. Holding and then scrolling cancels it.
  - A mid-screen sideways drag does not navigate (**fixed in F**).
  - A short, slow edge swipe snaps back, and the transform is cleared.
  - A swipe that starts in the composer is ignored.
  - An edge swipe goes back in channels, threads, DMs and Settings sections.
  - An edge swipe under an open sheet is ignored.
  - Dragging the Inbox chips neither navigates nor opens a sheet.
  - Inbox pull to refresh announces its status. Search has no pull to refresh.
- **Desktop:** Settings at 1440, 1280, 1024 and 768 has no overflow. Screenshots are in `docs/assets/mobile-f/`.

### R1 journeys

| Journey | AUTOMATED (unit, see the phase docs) | EMULATED (this run) | LIVE / DEVICE |
|---|---|---|---|
| 1. Login → community → channel → send → receive → thread → reply → react → long press → back | Each step is unit-tested on its own (shell, optimistic send, thread live update, reactions, long press, back) | ✅ Channel → thread via replies → long press → Escape closes only the sheet → header back → edge swipe back | ❌ Login, send and receive need a relay or Okta |
| 2. Home → DM → send → receive → notification → tap → exact message → back | DM list, notification engine (DM alert, routing to the exact message), in-app toast click, back from a notification target | ✅ DM long press, sheet blocks swipe, swipe back | ❌ Live DM, OS notification tap |
| 3. Inbox → filter → unread → exact message → mark read → back | `mobileInbox.spec` (filters, opening marks read and then opens the exact target) | ✅ Filter tab, unread not colour-only, row → `/m/c/c2?m=…`, back → `/m/inbox` | ❌ |
| 4. Search → message → exact message → thread → back | `mobileSearch.spec` (message → exact, thread reply → thread, back restores query and tab) | ✅ Message hit → channel, back → `/m/search?q=rollback` | ❌ Relay FTS |
| 5. Search → person → profile → back | `mobileSearch.spec`, `mobileCommunication.spec` | ✅ Person → profile sheet → close → still on search | ❌ |
| 6. Home → community switch → verified → channel → message | `mobileCommunitySheet`, `communitySwitchRuntime`, `switchRetry` | — | ❌ Needs two real communities |
| 7. Notification for B while in A → verified switch → B → exact message | `productivityFlows.spec`, `deepReveal.spec` (from a built target) | — | ❌ An alert generated for B while A is open, live |
| 8. Settings → Profile → save → back → channel → updated name | `profileConsistency.spec` (store-level, live update across surfaces) | — | ❌ Publishing needs a signer and relay |
| 9. Settings → Appearance → theme → back → whole app | `phaseESections`, `settingsModels` | ✅ Colour mode Dark → back → channel: root theme, body and header all switch to dark | ❌ |
| 10. Settings → Notifications → preference → qualifying event | `phaseESections`, `notificationEngine`, `inAppToasts` (settings decide both surfaces) | — | ❌ Live event |

**Coverage gaps in the automated suite:** no test runs a whole journey as one chain end to end. No unit-level UI test covers the composer send or the Settings Profile, Appearance and Notifications forms. An OS notification tap is untested. These are covered only by the live and device checklist below.

## 11. Desktop regression

- The full unit suite, which includes the desktop shell, rail, channels, DMs, threads, menus, modals and settings, passes.
- Phase F code paths are mobile-only by construction:
  - gestures attach only with `mobileActions` or inside `MobileLayout` and `.m-settings`;
  - `touch-action` and the avatar hit area are scoped to `.mobile-layout`, `.m-settings` and `.m-sheet`.
- The shared changes were:
  - `useEscapeKey`: non-modal behaviour is unchanged unless a modal sheet consumed the press. Only the mobile sheets use modal mode.
  - Radius tokens of equal value: no visual change.
- Desktop Settings at 1440, 1280, 1024 and 768 was checked emulated with no overflow.
- **Not done:** a manual desktop click-through in the installed Windows app.

## 12. Known limitations

- No live relay, real device or installed Windows verification (see the top of this document).
- iOS WKWebView has no Vibration API, so haptics are silent on iPhone by design.
- There is no full emoji picker on mobile; the quick-reaction row is the picker.
- The thread screen has no pull to refresh, intentionally, because it is live-subscribed.
- The browser history-swipe guard (`touch-action`) matters in mobile browsers. Tauri's WebViews don't enable that gesture, so in the apps it is defence in depth.
- Remaining radius literals are deliberate tiers: 12 px media and 14 px cards, plus small preview and skeleton radii. They are not tokens yet.
- Two stray `bash.exe.stackdump` files (Sep 24/25, untracked) sit in the repo root and `src/`. They are unrelated to this work and were left alone.

## 13. What still requires real hardware or live infrastructure

- **Live relay:**
  - production relay, real members and messages;
  - send and receive in channels and DMs;
  - typing and presence;
  - read-state sync;
  - Inbox categories from the relay;
  - NIP-50 search;
  - notification generation;
  - Community A → B switch with exact-message reveal.
- **Android (APK):**
  - install, login or identity import, community connect;
  - channel and DM;
  - long press, swipe back, pull to refresh, haptics (Vibration);
  - notification tap → exact message;
  - soft keyboard with the composer, attachments;
  - dark and light.
- **iPhone:**
  - the same flows;
  - especially edge swipe-back next to the system gestures, safe areas (notch and home indicator), keyboard, notifications, and haptics being silent.
- **Windows installed build:**
  - install the latest `.exe`;
  - Community Rail, DMs, Inbox, Search, Settings;
  - notifications and taskbar;
  - cross-community switch.
- **Live end-to-end suites:** `npx vitest run --config vitest.e2e.config.ts` against a running buzz-relay.

## 14. Release checklist

1. [x] `npx vue-tsc --noEmit`
2. [x] `npx eslint . --max-warnings 0`
3. [x] `npx vitest run`: 155 files / 1661 tests
4. [x] `npm run build` and bundle scan: no key material, no sourcemaps
5. [x] Emulated responsive and gesture QA (166/166) and emulated journeys (21/21)
6. [ ] **Production env for the release build:** `VITE_RELAY_URL` (prod `wss://`), `VITE_SWF_BACKEND_URL`, `VITE_OKTA_ISSUER` and `VITE_OKTA_CLIENT_ID`, `VITE_ENVIRONMENT=production`, and `SWF_BUZZ_OKTA_*` exported for the Tauri build. Do **not** build a release from a workstation `.env.local` that points at localhost.
7. [ ] Rebuild and re-scan `dist/` with the production env, and confirm no `localhost` or `127.0.0.1` URLs remain.
8. [ ] Start a buzz-relay and run `npx vitest run --config vitest.e2e.config.ts`.
9. [ ] Live relay walkthrough of journeys 1–10 (§10), including Community A → B notification → exact message.
10. [ ] Android APK: the §13 list.
11. [ ] iPhone: the §13 list.
12. [ ] Installed Windows `.exe`: the §13 list.
13. [ ] Record the results with the labels LIVE RELAY VERIFIED and REAL DEVICE VERIFIED. Only after all of items 6–12 pass can the product be called production-verified.
14. [ ] Commit and tag. This was intentionally **not** done in this phase.
