# Mobile UX — Phase C1: Communication

Date: 2026-09-30. Builds on `docs/MOBILE_PHASE_B_FOUNDATION.md`. Not committed.

**No changes to:** Nostr/NIP-42, identity/storage, membership, relay, backend APIs, the
channel/DM/thread/read-state/search/upload protocols. No excluded features were added.

Every mobile action goes through an existing shared primitive:
- **Channels:** `useChannelMessages`, `useSendMessage`, `useMessageMutations`, `channelPermissions`, `ReportMessageDialog`
- **DMs:** `useDmList`, `useDmMessages`, `useSendDm`, `useHideDm`, `useOpenDm`
- **Reactions:** `useAddReaction` / `useRemoveReaction`
- **Profile and presence:** `useProfile`, `usePresenceOf`, `useUserStatusOf`
- **Read state:** `readState` store

## 1. DM architecture

```
/m (Home)  ── Direct messages ──►  /m/d/:conversationId  (mobile-dm)
                                        └──►  /m/d/:conversationId/t/:rootId  (mobile-dm-thread)
```

**Breakpoint mapping.** The desktop `dm?conversationId=&threadRootId=` route now maps to
`mobile-dm` / `mobile-dm-thread` and back. The Phase B stop-gap that sent `dm` to Home was
removed. Parent and depth are defined, so the header back and the platform back walk
DM thread → DM → Home.

**Home → Direct messages**
- Source is the same kind:41010 list as the desktop sidebar.
- Each row shows:
  - partner avatar, with the presence dot from the one store
  - name
  - unread count and bold styling, from `readState.visibleUnread`, the same number the desktop badge uses
  - the latest message and its time, **only when this session already holds that DM's timeline**. It is read from the DM screen's own query cache, never fetched per row. When it isn't held, no preview is invented.
- States: skeleton rows while loading; error with retry; empty → "Your direct conversations will appear here."

**DM screen**
- **Header:** back, the partner's avatar with a presence dot, name, and "Online / Away / Offline" or "Agent". Tapping the header opens the profile sheet.
- **Overflow (⋮):** View profile, and **Hide conversation** — the desktop DM's own Hide (`useHideDm`).
- **Body:** the existing `MessageList`.
- **Footer:** `TypingIndicator`, then `MessageComposer`. The mention scope is the DM's participants; attachments are on.
- **Read state:** marks the DM seen at its newest message, on the same NIP-RS frontier as desktop.

## 2. Message actions (touch)

- **`MessageItem` touch mode** (`mobileActions`, off by default, so desktop is unchanged): an
  always-visible "⋯" with a 44 px hit area. It is labelled "Message actions, &lt;author&gt;"
  and emits `open-actions`. The hover row and the hover "Reply in thread" link are not rendered.
- `MessageList` and `ThreadPanel` pass the prop through. `MessageList` also gained
  `emptyTitle` / `emptyDescription`; mobile uses "Start the conversation".
- **`MobileMessageActions`** is a bottom sheet with the message context and quick reactions
  (your own are marked; `aria-pressed`). **It shows only what the screen authorises, using the
  desktop's rules:**

| Surface | Offered |
|---|---|
| Channel message | Reply in thread, react, copy. **Edit** when `canEditMessage`. **Delete** when `messageDeleteMode` is `self`, or "Delete (moderator)" for `admin`. **Report** on others' messages |
| DM message | Reply, react, copy. The desktop DM has no edit/delete/report, so neither does mobile |
| Thread message | Copy. The desktop thread panel offers no row actions |

- **Delete** asks for confirmation inside the sheet, naming the author when it's a moderation act.
- **Reactions** use one toggle rule, `features/reactions/reactionToggle.ts`, now shared with
  the desktop quick-react buttons: react again → retract your kind:7 via kind:5.
- **Report** opens the existing `ReportMessageDialog`.
- **Long-press** was not added. An explicit "⋯" is used so gestures can't interfere with
  scrolling (see Phase F).

## 3. Edit / delete

- **Edit.** "Edit message" swaps the composer for **`MobileEditBar`**:
  - "Editing message ×" header, prefilled, 16 px text, 44 px controls
  - saving calls the existing `useMessageMutations.editMessage` (kind:40003 overlay), so there is no duplicate message
  - an unchanged or emptied edit is not published (desktop rule); Escape or × cancels; stays open on failure
- **Delete** uses `useMessageMutations.deleteMessage`: kind:5 for self, kind:9005 for admin. Relay
  refusals show inline above the composer.

## 4. Reply / thread

- **Reply** opens the thread page of the message's root, or of the message itself:
  `mobile-thread` for channels, `mobile-dm-thread` for DMs.
- The thread page is `ThreadPanel` (`hideHeader`, `mobileActions`): root, "N replies", replies,
  and the reply composer, with the right mention scope for channel or DM.

## 5. Profile / mention surface

- Every person surface already calls `ui.openProfile(pubkey)`: avatar, sender name, **@mention
  chip**, member rows. On mobile, **`MobileLayout` shows that request as `MobileProfileSheet`**.
  No call-site changes and no second profile model.
- The sheet shows:
  - avatar, name
  - role in this conversation — a screen provides it from its member query via `MEMBER_ROLE_KEY`; "Agent" for agents
  - designation, presence, NIP-38 status
- Its actions:
  - **Message** → the existing find-or-create DM (`useOpenDm`), then `mobile-dm`. Not offered on yourself.
  - **View profile** → about + public key + copy.
  - **Close**.
- It is a dialog with a focus trap. Escape and a backdrop tap close it. All controls are 44 px+.

## 6. Attachments

- Upload, progress, error and retry behaviour are the existing composer's (upload on send; a
  failed upload keeps the draft; there is no upload on pick, so cancelling leaves no orphans).
- Mobile constrains every image and video inside a message to the column
  (`max-width: 100%; height: auto`). Existing attachment cards cap at 360 px with `width: 100%`.
- No horizontal overflow was measured at any tested width.

## 7. Typing / presence

- Typing uses the existing `TypingIndicator`: max 5 names/avatars then +N, zero height when idle,
  an accessible announcement, reduced motion. It sits between the messages and the composer on
  channel and DM screens (tested on DM).
- Presence always comes from the one presence store: DM header, DM rows, avatars, profile sheet.

## 8. Read state

- Channel and DM screens call `readState.markChannelSeen(id, newest)`, the same NIP-RS frontier
  the desktop views write.
- The Home DM and channel badges use `readState.visibleUnread`; the Inbox badge uses `useInboxBadge`.
- No mobile-only unread arithmetic, and nothing rewinds a published frontier.

## 9. Empty / loading / error

- **Loading:** skeleton rows on Home (channels, DMs); pulse animation off under reduced motion.
- **Empty:**
  - channel: "Start the conversation — Say hello in #x"
  - DM: "Say hello to &lt;name&gt;"
  - DM list: "Your direct conversations will appear here."
- **Error:** the shared `StateView` retry and the "Couldn't load older messages · Retry" link are 44 px+ on mobile.
- **No membership:** the existing join bar, with a 44 px button.

## 10. Files

- **New:**
  - `src/features/mobile/`
    - `views/MobileDmView.vue`
    - `ui/MobileSheet.vue`, `ui/MobileMessageActions.vue`, `ui/MobileEditBar.vue`, `ui/MobileProfileSheet.vue`
    - `useMobileMessageActions.ts`, `memberRole.ts`
  - `src/features/reactions/reactionToggle.ts`
  - Tests: `tests/unit/features/mobile/mobileCommunication.spec.ts`, `tests/unit/features/mobile/mobileDmView.spec.ts`
- **Changed (mobile):**
  - `views/MobileHomeView.vue`: DM section, skeletons
  - `views/MobileChannelView.vue`: actions, edit, delete, report, roles
  - `views/MobileThreadView.vue`: DM threads, actions
  - `ui/MobileLayout.vue`: profile-sheet host, media and target rules
  - `ui/MobileBottomNav.vue`
  - `mobileRoutes.ts`
- **Changed (shared, additive, default-off):**
  - `components/MessageItem.vue`: `mobileActions`, `open-actions`; toggle via `reactionToggle`
  - `components/MessageList.vue`: `mobileActions`, `open-actions`, `emptyTitle` / `emptyDescription`
  - `components/ThreadPanel.vue`: `mobileActions`, `open-actions`
  - `app/router/index.ts`: `mobile-dm`, `mobile-dm-thread`
- **Tests updated:** `mobileRoutes.spec.ts` (DM mapping), `mobileShell.spec.ts` (DM list, empty, skeleton).

## 11. Verification

**Automated**
- `vue-tsc`: clean. `eslint . --max-warnings 0`: clean (fixed 6 test-stub warnings from the first run).
- Mobile tests: **49**. They cover:
  - mobile DM route, DM list, DM unread
  - DM screen: header, presence, mention scope, typing position, read state, thread navigation, actions
  - action authorisation per surface, delete confirmation, reaction marking and toggle
  - edit mode: save only on change, stays open on failure, Escape
  - reply → thread, delete path
  - profile sheet: role, agent, presence, Message → DM, self, details, close
  - mention / avatar → profile sheet via `ui.openProfile`, and closing clears it
  - `MessageItem` touch mode vs desktop default
  - back and parents, empty and skeleton states

  Full suite, build and test counts: see §13.

**Visual.** Headless Chrome ran the real views with the real theme CSS and seeded data, on a
temporary harness that was deleted afterwards.
- States: Home (channels + DMs), channel, action sheet, edit mode, DM, profile sheet.
- Sizes: **390×844, 375×812, 360×800, 320×720**.
- Results:
  - no horizontal overflow anywhere
  - no control under 44 px, other than inline author names and mention chips, which are text
  - sheets anchored to the bottom (366 px / 352 px tall)
  - edit bar and composer flush with the bottom
  - dark / violet DM checked by screenshot

**Not verified:**
- A real phone: software keyboard, notch.
- A live community on mobile.
- Real uploads at phone width: the upload UI is unchanged and was not exercised end to end.

## 12. Desktop regression

The shared components only gained default-off props. Desktop `MessageItem` renders the hover
row and no "⋯" (tested). `ChannelsView` and `DmView` are unchanged. `MessageItem`'s reaction toggle
now calls the shared `reactionToggle`, with the same rule. The full suite, which includes the desktop
message, DM, thread, edit/delete, mention and rail specs, is green — see §13.

## 13. Test counts

Final run after the last change:

| Check | Result |
|---|---|
| `vue-tsc --noEmit` | clean |
| `eslint . --max-warnings 0` | clean |
| `vitest run` | **141 files, 1482 tests, all passing** (Phase B: 139 / 1454, so +2 files / +28 tests) |
| `npm run build` | pass |

## 14. Remaining for Phase C2

- **Deep reveal:** Inbox / notification → exact community → channel or DM → **exact message**
  (`messageId` scroll + highlight). `MessageList` already supports `highlightId`; the mobile routes
  don't pass it yet.
- **Notification tap routing** to mobile routes on narrow screens.
- **Scroll anchoring** when returning from a thread page (restore position).
- **Long-press and swipe-back** (Phase F), attachment preview polish (C3), a mobile mark-unread action.
- **Removing your own reactions in DMs.** The mobile DM wires `useRemoveReaction`, the same kind:5
  retraction channels use. The desktop DM view does not wire it; that is a desktop gap left unchanged.
