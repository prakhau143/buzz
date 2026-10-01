# Mobile UX — Phase B: Foundation

Date: 2026-09-30. Scope: the mobile navigation/layout foundation only.

**No changes to:** protocol, NIP-42, identity/storage, membership, relay behaviour,
message/DM/thread/read-state/search protocols, backend APIs, or Add Community semantics.
No excluded OLD BUZZ features were added. Nothing was committed.

## 1. Architecture

**The same shared core, with a different presentation below 768 px.**

The core — identity, communities, relay, messages, threads, profiles, mentions, inbox,
search and read state — is untouched and shared.

| | Desktop (≥ 768 px) | Mobile (< 768 px) |
|---|---|---|
| Frame | `App.vue` → header + `CommunityRail` + `AppShell` views (unchanged) | `MobileLayout.vue` per screen: header / content / footer (composer) / bottom nav |
| Navigation | Rail \| Sidebar \| Conversation \| Thread | Single stack of real routes + 4-tab bottom nav |
| Thread | Split / expanded side panel | Its own full-screen page |

**Routes.** Each stack level is a history entry, so Android back, browser back and the header
back all walk the stack. `features/mobile/mobileRoutes.ts`:

```
/m                        mobile-home      Home: community + channels   depth 0
/m/c/:channelId           mobile-channel   Conversation                  depth 1
/m/c/:channelId/t/:rootId mobile-thread    Thread                        depth 2
/m/inbox · /m/search · /m/profile          bottom-nav destinations      depth 0
```

**Crossing the breakpoint.** `App.vue` maps the current in-community view to its counterpart:
- `channels?channelId=&threadRootId=` ⇄ `mobile-thread`
- `inbox` ⇄ `mobile-inbox`
- …

So rotating or resizing keeps you in place. Sign-in, the community picker and Settings are
left alone. Mobile routes carry `meta.mobile`, and `App.vue` then omits the desktop header and
rail. The same session guard applies: the routes are not public.

The Tauri desktop window has `minWidth: 960`, so the desktop app never enters the mobile tier.

## 2. Reused, not duplicated

| Need | Reused |
|---|---|
| Community switching | `useCommunitySwitch` (Phase A), shared with the rail and the sidebar switcher |
| Add Community | Existing flow (`communities` route) via `openAddCommunity` |
| Channel list | `useChannels`, `sidebarChannels`, `readState.visibleUnread / hasMention`, `ChannelListItem` (touch-sized via CSS) |
| Conversation | `useChannelMessages`, `useSendMessage`, `useChannelReactions`, `useAddReaction`/`useRemoveReaction`, thread summaries + `threadIndex`, `useTypingIndicator`, `useChannelMembers`, `useJoinChannel`, `readState.markChannelSeen`, `MessageList`, `MessageComposer` (mentions and attachments), `TypingIndicator` |
| Thread | `ThreadPanel` (new `hideHeader` prop; default false, so desktop is unchanged), `useThread` (same cache entry) |
| Inbox shell | `useInboxFeed`, `contextLabel`, `markRead` |
| Search shell | `CommandPalette` (shown as the page body) |
| Profile shell | `useProfile`, `usePresenceOf`, the existing Settings sections |
| Active conversation | `useReportActiveConversation` (notifications) |

Two pieces of logic were **moved out of `AppSidebar` into shared composables** (behaviour
unchanged), so desktop and mobile run the same code:
- `features/readState/useUnreadCatchUp.ts`: the startup unread catch-up, once per identity + community.
- `features/inbox/useInboxBadge.ts`: the Inbox badge rule.

## 3. New files

- `src/features/mobile/`
  - `breakpoints.ts`: tiers; `useIsMobile()` is one shared `matchMedia` listener
  - `mobileRoutes.ts`: stack, parents, depth, counterpart mapping
  - `mobileNav.ts`: header back, transition direction, keyboard/visual-viewport tracking
  - `ui/`: `MobileLayout.vue`, `MobileHeader.vue`, `MobileBottomNav.vue`, `MobileCommunitySheet.vue`
  - `views/`: `MobileHomeView.vue`, `MobileChannelView.vue`, `MobileThreadView.vue`,
    `MobileInboxView.vue`, `MobileSearchView.vue`, `MobileProfileView.vue`
- `src/features/readState/useUnreadCatchUp.ts`, `src/features/inbox/useInboxBadge.ts`
- Tests: `tests/unit/features/mobile/{mobileRoutes,mobileShell,mobileCommunitySheet}.spec.ts`

**Changed:**
- `src/App.vue`: tier switch; header and rail hidden on mobile routes
- `src/app/router/index.ts`: mobile routes
- `src/layouts/AppSidebar.vue`: uses the two extracted composables
- `src/components/ThreadPanel.vue`: `hideHeader`
- `src/components/AppIcon.vue`: `home` and `inbox` glyphs
- `index.html`: `viewport-fit=cover, interactive-widget=resizes-content`

## 4. Behaviour

**Home**
- SWF Buzz brand and your avatar (→ Profile).
- **Current community card**: avatar/icon, name, connection dot, "Switching…". Tapping it opens
  the **community selector sheet**:
  - CURRENT, with connection state
  - OTHER COMMUNITIES, with role
  - error line
  - Add community
- **Channels**: lock/hash, unread and mention badges, 48 px rows. Loading, error and empty
  states. Renders safely with no community.

**Bottom nav**
- Home · Inbox · Search · Profile. There is no Communities tab: Home owns the community context.
- 52 px tabs; the active one gets an accent indicator. Home stays lit through its conversation and thread.
- The Inbox badge follows the same rule as the desktop sidebar.
- Tab switches `replace` the entry, so back doesn't cycle through tabs.

**Conversation**
- Back, `🔒/# name`, "N members".
- Existing message list, with reactions and thread summaries.
- Typing indicator. A join bar when you're not a member.
- Composer with mention picker and attachments.
- Opening a thread **navigates** to the thread page.

**Thread**
- Back, "N replies · #channel".
- Root message, then replies, then reply composer.

**Inbox / Search / Profile (shells)**
- Inbox: rows open the conversation or thread and mark the item read.
- Search: the existing palette as a page.
- Profile: you plus Settings entries.

## 5. Safe areas, keyboard, motion

- **Safe areas** (`viewport-fit=cover`):
  - header: `env(safe-area-inset-top)`
  - bottom nav, or the footer on stack pages: `env(safe-area-inset-bottom)`
  - frame: left and right insets
  - sheet: bottom and side insets
- **Keyboard.** `startViewportTracking` writes `visualViewport.height` to `--app-height`, and the
  frame is exactly that tall.
  - Only the content scrolls (`flex: 1; min-height: 0; overflow: auto`), so the composer sits on the keyboard. No fixed offsets and no negative margins.
  - `data-keyboard="open"` removes the bottom inset and the bottom nav. It is set when the visual viewport is > 120 px shorter than the layout viewport at the same moment, so resizing or rotating never reads as a keyboard. That was a bug found and fixed during QA.
  - Android also resizes the layout via `interactive-widget=resizes-content`.
- **Touch.** 44 px minimum for header buttons, tabs, sheet rows and composer controls. 16 px
  composer and search text, so iOS doesn't zoom. `resize: none` on phones.
- **Motion.** Deeper screens slide in from the right, going back slides in from the left, tab
  switches fade (140–220 ms). All of it is off under `prefers-reduced-motion`.
- **Tiers.** `< 430 px` tightens the page padding.

## 6. Accessibility

- Bottom nav is `<nav aria-label="Main">` with `aria-current="page"`. The badge is in the
  label ("Inbox, 3 unread").
- The header back button has an explicit label ("Back to channels" / "Back to conversation").
- The community sheet is `role="dialog" aria-modal`, labelled, focus-trapped, closes on
  Escape, and receives focus when it opens.
- The community card says what it does ("…, Connected. Switch community").
- `:focus-visible` rings throughout.
- All colours are existing tokens, so contrast follows the Appearance system.

## 7. Verification

**Automated**
- `vue-tsc`: clean. `eslint . --max-warnings 0`: clean.
- The first lint run flagged two `vue/one-component-per-file` warnings in the new test; fixed.
- New mobile tests: **21**, covering:
  - route mapping both ways, parents, depth, and header back (history vs one level up)
  - bottom nav: exactly 4 tabs, the active tab through the stack, badge + label + 99+ cap, navigation
  - Home: channels shown, tap opens the conversation, the card opens the sheet, safe render with no channels and no community
  - community sheet: CURRENT / OTHER, switching via the **shared** switch with the desktop rail agreeing, refusal keeps the current community and shows the shared error, Add → the existing flow, dialog semantics
  - the breakpoint query and live change
- Full suite: **139 files, 1454 tests, all passing** (1433 before Phase B + 21 new). Re-run after the last code change.
- `npm run build`: pass.

**Visual (headless Chrome, real components + real theme CSS, seeded data, temporary harness since deleted)**
- Home, Conversation, Thread, Inbox, Search and Profile at **390×844, 375×812, 360×800 and 320×720**:
  - frame exactly viewport height; header 57 px at the top; nav or composer flush with the bottom
  - no horizontal overflow on any screen
  - no interactive control under 44 px apart from inline "Retry" links in error states (shared components; Phase F)
- Dark (swf-dark / indigo) conversation, thread and community sheet were checked by screenshot.

**Not verified**
- A real phone: notch, home indicator, real software keyboard.
- The Tauri mobile runtime (none yet).
- A live community on mobile: browser mode cannot sign in, and the desktop app can't be narrower than 960 px.

## 8. Remaining for Phase C

- **DM conversations on mobile.** DMs currently start from Home; the desktop `dm` route maps to Home.
- **Message actions:**
  - edit / delete / report
  - long-press menu (Phase F gestures)
  - deep reveal (`messageId`) from Inbox and notifications
- **Profile taps.** Tapping a person or a mention (`ui.openProfile`) has no mobile surface yet; a mobile profile sheet is needed.
- **Home DM section**, and unread state for DMs.
- **Presence / typing polish**, attachment previews at phone width.
- **Later phases:** the grouped Inbox and Search (D); the mobile Settings stack (E); swipe-back, skeletons, and error-state target sizes (F).
