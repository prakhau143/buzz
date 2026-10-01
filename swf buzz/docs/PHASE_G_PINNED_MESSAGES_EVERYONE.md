# Phase G — Pinned messages + `@everyone`

Status: implemented, automated-verified. Not committed.

This phase adds two features to the relay-backed conversation screens:

- the desktop `ChannelsView` and `DmView`;
- the mobile `MobileChannelView` and `MobileDmView`;
- every surface that renders `MessageItem` (threads, the Inbox detail).

The HTTP-backend preview screens (`/community`, `/community-dm`) are out of scope. See *Known limitations*.

---

## 1. Protocol audit (before any code)

| Question | Finding (OLD BUZZ relay, read-only) |
|---|---|
| Existing pin support? | `KIND_STREAM_MESSAGE_PINNED = 40004` exists (`buzz-core/src/kind.rs:484-485`). It is in the ingest allow-list (`ingest.rs:477`, `MessagesWrite` scope) and h-scoped (`ingest.rs:713`). It has **no side effects, no role check, no replacement semantics** and no read model. `KIND_PIN_LIST = 10001` is a NIP-51 per-user list, global-only, so it is unusable per conversation. |
| Old desktop client pins? | None. The "Pinned" strings there are sidebar mock data and mention-picker agent pinning. There is no tag format to copy. |
| Channel / moderation metadata? | NIP-29 9002 / 39000-39003 hold channel metadata. 9005 is the admin delete (author OR channel owner/admin): the closest role pattern. None of these can carry a pin. |
| Replaceable / custom kinds? | Replaceable ranges are 0, 3, 41, 10000-19999 and 30000-39999 (addressable). An unknown kind is refused (`ingest.rs:545`), so **a new kind would need relay changes**. SWF must not modify OLD BUZZ. |
| NIP-29 role enforcement? | It exists for 9000-9022 (`side_effects.rs`), but not for 40004. |
| DM metadata? | A DM is a channel with `channel_type = "dm"`. Its kind:9 messages carry `h` = the DM channel. The relay restricts write/read to participants. |
| Audience mention? | None anywhere. Mentions are `p` tags indexed into `event_mentions`. |
| Navigation | `MessageTarget` + `useOpenMessageTarget()` (desktop `?messageId=&threadRootId=` reveal; mobile `?m=`). It is reused unchanged. |

**Decision:** use the relay's existing kind 40004. Do not invent a kind; the relay would refuse one. Define one canonical tag shape for it, and put the authorization the relay lacks into a pure, deterministic read model that every SWF client applies.

---

## 2. Pin event structure

```
kind:    40004   (KIND_STREAM_MESSAGE_PINNED)
content: ""
tags:
  ["h", <channel id | DM channel id>]   conversation; the relay scopes + membership-gates on it
  ["e", <message id>]                   the message pinned / unpinned
  ["action", "pin" | "unpin"]
  ["author", <64-hex>]                  pin only: the message's author (a CLAIM, see §3)
```

- **Conversation id:** the `h` tag, the same id the messages use.
- **Pinner:** the event's signed `pubkey`.
- **Time:** `created_at`.
- **No `p` tag.** The relay indexes `p` tags into mentions, so tagging the author would put every pin into their Inbox.

Code:
- `src/protocol/pins.ts` holds `buildPinEvent` and `parsePinEvent`.
- `src/protocol/kinds.ts` holds `KIND_STREAM_MESSAGE_PINNED`.
- `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` §13 records the shape.

## 3. Authorization

| Actor (channel role) | Pin own message | Pin other's message | Unpin |
|---|---|---|---|
| member | yes | no | only a pin **they made** |
| admin | yes | yes | any |
| owner | yes | yes | any |
| non-member | no | no | no |

- **Replacement:** pinning while a different pin is active removes that pin. It therefore also requires the right to unpin it. A member cannot knock someone else's pin off by pinning their own message.
- **DMs:** there are no roles. Both participants own the conversation equally, so either may pin any message and unpin any pin. The relay itself limits a DM to its participants.
- **Roles** are NIP-29 *channel* roles from the channel roster (39001/39002, `useChannelMembers`). This is the same plane the relay uses for the admin delete (9005).

### Where it is enforced

- **Relay (OLD BUZZ, unmodified).**
  - Rejects 40004 from anyone who cannot write to the conversation: non-members of private channels, non-participants of DMs, unauthenticated users.
  - Never serves a private conversation's pin events to non-members.
  - Does **not** check roles.
- **Every SWF reader.** `src/features/pins/pinModel.ts` → `resolveActivePin` folds the conversation's 40004 events in a deterministic order and admits only the events their actor was allowed to make:
  - the order is `created_at`, then event id, so same-second ties resolve identically everywhere;
  - each event is judged against the state before it.
- **The UI.** `canPin` / `canUnpinActive` come from the same model, so the menus never offer an action that readers would reject.

A pin event published by a modified client that bypasses the UI is stored by the relay but **ignored by every SWF client**. It can never become the pin anyone sees. This is the strongest enforcement available without changing the OLD BUZZ relay.

**Recommended follow-up (needs approval to touch OLD BUZZ):** add a role check for 40004 to `ingest.rs`, mirroring `actor_is_channel_owner_or_admin` in the 9005 path, so the relay also refuses unauthorized pins at write time.

### Author claim

A member may pin only their own message, so the pin carries the claimed author:

- When the message is loaded or fetched, the real author must match the claim, or the pin is rejected.
- When the message is unknown (deleted, or outside history), the claim stands, and the bar shows "no longer available".
- A member's pin with no claim on an unknown message is not trusted.
- Admin and owner pins never depend on the claim.

## 4. Pin lifecycle

`src/features/pins/useConversationPin.ts`:

1. **Open a conversation.**
   - Subscribe to `{kinds:[40004], #h:[id], since: now-5}` (live).
   - Fetch the conversation's pin history: `limit 100`, the newest events.
   - Events are deduplicated by id, so a reconnect replay or the subscribe/fetch overlap is harmless.
2. **Resolve** the active pin with `resolveActivePin` once the roster has loaded. No pin is judged before roles are known.
3. **Find the pinned message.**
   - Look in the loaded timeline first, with edits applied.
   - If it isn't there, do **one** fetch by id, scoped with `#h`, so the relay's read gate applies.
   - The bar then shows one of these states: `ready`, `loading`, `unavailable` (deleted / not on the relay), or `error` (fetch failed, retry offered).
4. **Pin / unpin** through `PinService.publish`. The signed event is folded in immediately, without waiting for the echo. A refusal leaves the state unchanged, shows the relay's reason inline, and shows an error toast.

**Flow** (`usePinFlow.ts`), shared by all four screens:

- First pin: publishes at once and shows a **"Message pinned"** toast. There is no dialog.
- Replacing a *different* pin: **"Replace pinned message? The current pinned message will be replaced with this one."** with Cancel / Replace. It uses `OverlayDialog` on desktop and `MobileSheet` on mobile (never `window.confirm`).
- Unpin: publishes at once and shows a **"Message unpinned"** toast.

Toasts are the existing in-app toast stack (`inAppToasts.ts`), extended with a compact `status` variant. It is not a new toast system.

### One active pin

The fold keeps exactly one `active` value, and every accepted pin replaces it. Duplicate, stale (unpin of a no-longer-pinned message), out-of-order and same-second events are all covered by tests. There is no pin history UI in this phase.

## 5. Desktop UI

The layout is header → **pinned bar** → conversation. `src/features/pins/ui/PinnedMessageBar.vue` is a compact strip, not a banner:

- **Size and shape:** min-height 56px, inset 16px, radius `--radius-md`.
- **Colours:** the dedicated tokens `--color-pin-text/bg/bg-hover/border/icon`. They are accent-derived in `tokens.css`, with stronger dark-scheme values in `appearance.css`.
- **Content:**
  - pin glyph;
  - pinner avatar (16px) and "Pinned by **Name**", from the profile registry with a public-key fallback;
  - relative time, with the absolute time as a tooltip;
  - attachment and thread cues;
  - a 1-line preview, 2 lines on wide (≥1200px) panes, via `safePreview` (markdown/secrets stripped, URLs shortened to host);
  - a chevron.
- **Activation:** click / Enter / Space → `MessageTarget` → `useOpenMessageTarget()`. That is the existing verified reveal: scroll, highlight, thread-aware via `threadRootId`. No new navigation was written.
- **Unpin (×):** only for someone allowed to unpin, labelled "Unpin message".
- **Unavailable or error:**
  - "This message is no longer available." / "Unable to load pinned message" (with retry).
  - The bar is not clickable in these states, but it is never a dead link, and unpin stays available to whoever may unpin.
- **Messages:** the pinned message shows a small "Pinned" marker beside its time.
- **Menu:** the desktop `⋮` menu offers **Pin message** or **Unpin message** only when allowed (see Phase H for the menu itself).

## 6. Mobile UI

The layout is the `MobileHeader` → full-width pinned strip → conversation.

- The strip has a min-height of 56px, a 44px unpin target, a 2-line preview and no radius. The surrounding `MobileLayout` already handles the header's safe area.
- It sits outside the message scroller, so it stays put while the conversation scrolls and never covers the composer or keyboard.
- **Pin message** / **Unpin message** appear in the existing `MobileMessageActions` bottom sheet. They use the same abilities as desktop.
- A thread target remembers the list scroll position before navigating, just as opening a thread does.

## 7. `@everyone`

### Representation

- A `kind:9` channel message (or a `kind:40003` edit that keeps it) carries the tag **`["mention", "everyone"]`**, alongside the literal text `@everyone`.
- Text plus tag is the mention; text alone is not. It is distinguishable from a person mention (`p` tag) and from plain text.
- Code: `src/protocol/messages.ts` exports `EVERYONE_MENTION_TAG` and `hasEveryoneMentionTag`. `Message.mentionsEveryone` is parsed from the tag only.

### Composer and picker

- `MessageComposer` / `MentionPicker` offer **@everyone · Mention everyone** in **community channels only**, including channel threads and Inbox replies on channels. It is never offered in DMs.
- Position in the picker: first while typing `@eve…`, last for a bare `@`.
- Keyboard: ↑ ↓ (wrapping), Enter / Tab to select, Escape to close. Mouse/touch use `mousedown` so focus stays in the textarea. Rows are 44px on coarse pointers.
- A typed or picked `@everyone` at a mention boundary sets the tag on send. Inside code or a URL, or edited away, it does not.
- The person-mention cap (50 `p` tags) is unchanged.
- No role restriction: member, admin and owner can all use it.

### Rendering

`EveryoneMentionChip.vue` renders the chip through the shared tokenizer `messageSegments.segmentMessage`, used by `MessageContent`. The tokenizer covers every message surface: channel, thread, DM, Inbox detail, desktop and mobile.

The chip uses the **same** chip rules and tokens as `MentionChip`:
- `--color-mention-*` colours, which are theme- and dark-aware;
- weight 600, 6px radius, subtle border;
- hover and pressed states.

It adds a small group glyph. It is focusable, with the accessible name "@everyone. Mentions everyone who can see this channel", so the distinction is not colour-only.

### Notifications, Inbox and unread (the existing pipeline)

`features/mentions/everyone.ts` → `messageMentionsMe()` returns true for a `p` match, OR for the everyone tag when the message is not mine and not in a DM. It is used by:

- `notificationEngine.classifyMessage`: produces the `mention` / `thread_reply` slots. The in-app card says "Mentioned @everyone".
- `unreadPolicy.countsAsUnread`, `useUnreadTracking` and `unreadCatchUp`: the mention badge.
- `inboxModel.buildInboxItems`: the relay's `mentions` feed joins on indexed `p` tags only. An @everyone therefore enters the Inbox from the relay's `activity` category, which the relay already limits to accessible channels.

The rules that follow from this:

- **No fan-out.** The sender publishes one event. Each reader decides, from subscriptions the relay has already access-checked.
- **Private channels.** Only authorized members receive the event at all. No recipient list exists anywhere, so membership cannot leak.
- **Never yourself.** The sender is never notified by their own @everyone.
- **Deduplication and settings.** The existing `NotificationLedger` dedupes, and the existing notification settings apply. Read state is unchanged.

### Edits, replies and search

- **Edits.**
  - The original event's tag stays authoritative: it is what notified people.
  - An edit re-asserts the tag when the edited text still says `@everyone`.
  - An edit from an older client without the tag does not strip it.
  - The chip only renders where the text still says `@everyone`.
- **Replies and threads:** a thread reply carries the tag like any channel message.
- **Opening the message:** messages opened from a notification, the Inbox or Search are the same events, so the chip renders there too.
- **Search results:** results now render semantic tokens through the non-interactive `MessagePreview` (see §14). Mention, `@everyone` and link chips are plain spans inside the result button, so there is still no nested interactive content. The raw tag never appears anywhere in the UI.

## 8. Security

- Pin authorization is enforced by every reader (§3). The relay enforces membership. The UI only reflects the same model.
- DM pins are limited to DM participants by the relay.
- Private-channel pins are never readable by non-members. They are fetched only via `#h`-scoped, relay-gated queries.
- `@everyone` creates no recipient list and makes no membership query. A reader learns nothing it couldn't already read.
- No keys, `nsec` or secrets appear in events, URLs or logs.
  - Pin events carry ids only.
  - The opener does not log URLs (Phase H).
  - Errors are logged through `logError` without content.
- The production build check is in the Verification section of `PHASE_H_MESSAGE_ACTIONS_RICH_LINKS.md`.

## 9. Tests

| File | Covers |
|---|---|
| `tests/unit/features/pins/pinModel.spec.ts` | Pin tests 1-15: member / admin / owner pin and unpin, replacement, one active pin, duplicates, stale events, reconnect order, same-second ties, author claims (16-17), DMs |
| `tests/unit/protocol/pins.spec.ts` | Event shape, no `p` tag, malformed events ignored |
| `tests/unit/features/pins/conversationPin.spec.ts` | Stream dedup and replacement (15), thread-aware target (19), deleted (16) / unavailable (17) / error states, relay unavailable, abilities, first-pin toast, replace confirmation (11), permission denied (22), unpin, pinned bar desktop and mobile (20/21), accessibility names, menu / sheet gating (P2) |
| `tests/unit/features/mentions/everyoneMention.spec.ts` | Everyone tests 23-41: picker, keyboard, mouse, DMs excluded, semantic tag (26), chip rendering and theme tokens (27-29), notification / Inbox / unread classification (30-34), edit / reply / thread preservation (35-37), segments |
| `tests/unit/features/mobile/mobileDmView.spec.ts` | Updated: DM sheet now offers Pin |

Exact reveal (18) reuses `useOpenMessageTarget`, which is already covered by `tests/unit/features/navigation/*`.

## 10. Verification status

The results are in the Verification section of `PHASE_H_MESSAGE_ACTIONS_RICH_LINKS.md`. Both phases were verified in the same run.

| Level | Status |
|---|---|
| AUTOMATED VERIFIED | Yes: unit and component tests above, full suite, typecheck, lint, build |
| EMULATED UI VERIFIED | **No.** Not exercised in a browser or emulated viewport in this phase |
| LIVE RELAY VERIFIED | **No.** The local relay (Docker) was not running during this work |
| REAL DEVICE VERIFIED | **No** |

## 11. Context-panel ownership: no stale thread column on Inbox, Settings, etc.

### Bug

1. Open a thread in `#SWF Project`, so the layout is main | thread.
2. Click **Inbox**.

Inbox rendered in the main area, but the right third of the window stayed reserved and blank.

### Root cause

- **One shared panel state.** `stores/ui.ts` holds one `contextPanel` (`none | thread | profile | channelDetails`). `AppShell` derived the details column from it alone (`detailsPaneOpen = contextPanel.kind !== "none"`).
- **No reset on navigation.** Nothing reset it when the **view** changed:
  - `selectChannel` / `selectConversation` close it, but only on channel / DM switches;
  - route changes to Inbox, Settings or the community picker left `contextPanel = thread`.
- **The empty column.** InboxView's `#details` slot renders only a `profile` panel. The shell nevertheless reserved the grid column (`.body:has(.details-pane)`) and the resize handle for a thread nobody draws, which left a blank column.

The panel state was not owned by any view.

### Fix: ownership, enforced at two central points

`src/features/navigation/contextPanelPolicy.ts` declares which panel kinds each view owns. That is exactly what its `#details` slot or sheet renders:

| View (route) | Owns |
|---|---|
| `channels` | thread, profile, channelDetails |
| `dm` | thread, profile |
| `inbox` | profile |
| `community-channels` (HTTP preview) | thread |
| every `mobile-*` page | profile (the `MobileLayout` sheet) |
| Settings, community picker, operator, platform admin, onboarding, … | nothing |

The two enforcement points:

1. **Navigation.** `installContextPanelInvariant(router, …)` is installed once in `app/router/index.ts`. When the route **name** changes, it closes the panel: `contextPanel = none` and `threadExpanded = false`.
   - It runs in `afterEach`, after the navigation is confirmed and before the new view renders.
   - A panel belongs to the view that opened it. It never follows you to Inbox / Settings / Search, and it is not restored when you come back. Inbox → channel shows the channel with no stale thread.
   - Same-view navigations (another channel, a `?messageId=` reveal, another Inbox item) are untouched, because those views already manage their panel.
2. **Layout.** `AppShell` computes `detailsPaneOpen = panelShownOn(route.name, contextPanel)`. The details column, its resize handle, the drawer scrim and the `thread-expanded` class exist **only** for a panel the current view owns.
   - So a panel opened later from a shared surface (the sidebar's own-profile card, a mention chip) on a view that cannot render it takes **no** layout space.
   - The panel is not `display: none`, `width: 0` or hidden: it is not rendered, so the grid falls back to `sidebar | main`.

Search is a palette / panel, not a route, so it does not change the view. Desktop Search over a conversation therefore keeps that conversation's panel; mobile Search (`mobile-search`) is its own view and starts clean.

**Invariant:** if the active view does not own the panel's kind, the panel is closed, takes no layout space and renders no resize handle. **Inbox and every other global view always get the full width.**

### What was kept

- **Panel resizing:** the docked width is persisted by `usePanelWidth("details")` and restored the next time a thread opens in a conversation. The expanded-thread mode is session-only and is reset by the invariant.
- **MessageTarget / notifications / Inbox "Open in channel":**
  - The navigation lands on `channels` / `dm`.
  - The invariant runs first.
  - Then the view's own reveal watcher opens the target thread.
  - Back/Forward (`useAppNavigation.apply`) pushes the route, then opens the thread after `nextTick`.

  So both still work.
- **Mobile:** the same router invariant runs, with no mobile-specific logic. A thread or profile from the desktop state never leaks into mobile Inbox.
- **Focus and accessibility:** the panel is unmounted rather than hidden, so screen readers never reach stale thread content and focus can't be trapped in it. The Inbox click leaves focus on the control that was activated.
- **Performance:** only the one store field changes. There is no remount, no cache clear and no subscription change.

### Tests

`tests/unit/features/navigation/contextPanelOwnership.spec.ts` drives a real router and the real `AppShell`:

- channel → thread → Inbox: full width, no column, no handle, no expanded class (1, 9, 11);
- DM → thread → Inbox (2);
- → Settings and → community picker (4, 5, 13, 14);
- an expanded thread is reset;
- thread → Inbox → channel brings no stale thread back (6, 20);
- rapid hops, and Inbox → Inbox (7, 8);
- a view's own panel (an Inbox profile) survives same-view navigation;
- a reveal into a thread still opens it on arrival (17, 18);
- a thread opened while on Inbox takes no space (10);
- the resize handle exists for a conversation thread (15, 16);
- mobile channel → Inbox (19).

Desktop "Search" (3, 12) is not a route (see above).

| Level | Status |
|---|---|
| AUTOMATED VERIFIED | Yes: the tests above, existing layout / navigation / view / mobile suites, full suite, typecheck, lint, build |
| EMULATED VIEWPORT VERIFIED | **No.** Not checked in a rendered window at 1440 / 1280 / 1024 / 768 or at the phone sizes |
| REAL DEVICE VERIFIED | **No** |

## 12. Community switching and channel access consistency (hardening)

### Bug

The reported sequence:

1. Start in community A and switch to B.
2. Join a private channel B1.
3. Switch back to A.
4. Open A1, a private channel the user already belongs to.

A1's messages loaded, **and** the header said "You're not a member of this channel yet" with a *Join channel* button.

### Audit: what was not the cause

- **Cache keys** were already identity- **and** community-scoped. `queryKeys.members(channelId)` is `["identity", pubkey, "community", relayUrl, "members", channelId]`. Channel, message, DM, reaction, thread, invite and search keys all use the same scope.
- **The switch already tears down.** `identitySession.beginIdentitySession` → `tearDownConnectionScopedState` ends the community session, disconnects, resets UI and read state, and calls `queryClient.clear()`.
- **A generation guard already exists.** Every subscription and one-shot fetch is stamped with the community-session generation. `RelayConnectionService` and `fetchEventsOnce` drop or reject anything from an ended session with `StaleCommunitySessionError`, which the query client never retries.
- **The existing generation guard already gives A → B → A protection.** A new test (`channelAccess.spec.ts` #7) pins it.

So community B's state could not be read as A's, and the switch already runs in a fixed order:

1. Tear down the old session.
2. Begin the new session (generation +1).
3. Connect.
4. NIP-42 AUTH.
5. Resolve the community role.
6. Mark the session READY.
7. Load channels.
8. Restore the selected channel (`channelRestore`).
9. Load history.

It was reused, not replaced.

### Root cause

1. **An incomplete roster read became an empty roster.** `ChannelService.fetchMembers` read 39001/39002 with `fetchEventsOnce`, which:
   - resolved with whatever it had **on timeout** (8s, counted from before the new socket had even connected and authenticated);
   - never listened for a relay **`CLOSED`** reply (e.g. `auth-required:` while a just-switched session authenticates, or `restricted:`). It sat until the timeout, then resolved `[]`.

   In a switched session the roster read is one of the first requests, so it is the one that hits this. An empty roster is indistinguishable from "you are not a member".
2. **The screens had no "unknown" state.** `isMember = myRole !== null`, with `myRole = roster?.find(me)?.role ?? null`. A roster that was loading, failed or empty, as in (1), all rendered as not-a-member. Desktop even showed the join bar while the roster was `undefined`.

Meanwhile history comes from a different request (the HTTP bridge channel window), issued later, once the channel was restored. So it succeeded, and the screen showed both answers at once.

### Fix

- **Transport.**
  - `RelayConnectionService` now reports a relay `CLOSED` to the subscriber (`onClosed`). Socket loss and our own closes are ignored, because the subscription is re-issued on reconnect.
  - `fetchEventsOnce(…, { requireEose: true })` rejects with `IncompleteRelayAnswerError` on `CLOSED` or timeout, instead of resolving partial data.
  - Lenient callers keep the old behaviour.
- **Roster.**
  - `fetchMembers` uses `requireEose`.
  - `useChannelMembers` retries an incomplete answer three times with backoff (500ms → 4s). A stale-session answer is never retried.
- **One access state machine.** `src/features/channels/channelAccess.ts` holds `resolveChannelAccess` (pure) and `useChannelAccess` (composable), with these states:
  - `unknown`: no identity or channel;
  - `checking`: no authoritative answer yet;
  - `member`: role known, or private-channel history the relay served (see below);
  - `not_member`: a **complete** roster without me;
  - `error`: no answer and nothing known before.
- **Known-good is never downgraded.** vue-query keeps the last complete roster across a refetch and across a failed refetch, so MEMBER stays MEMBER with `rechecking: true`. Only a new authoritative roster can change it.
- **Message-access consistency.** In a **private** channel, the relay serves history only to members. A relay-served history (≥ 1 confirmed message) therefore resolves to `member`, even if the roster has not caught up. In an **open** channel anyone may read, so history proves nothing and the roster decides.
- **Join rule.** `showsJoin(access) === (access.status === "not_member")`. Nothing else shows "You're not a member" or *Join*. The composer is disabled only in that state; the relay rejects any send it shouldn't accept.
- **One UI.** `features/channels/ui/ChannelAccessBar.vue`, used by both desktop `ChannelsView` and `MobileChannelView`:
  - `not_member`: the message and Join;
  - `error`: "Couldn't verify your access" and Retry;
  - `checking`: a quiet "Checking channel access…" line, only after 400ms, so an ordinary open never flickers;
  - `member` / `unknown`: nothing.
- **One source.** Desktop and mobile both use `useChannelAccess`. Pins take their role readiness from it, and edit/delete permissions take their role from it.
  - The sidebar / Home channel lists don't compute membership at all: they list what the relay returns for the community.
  - The desktop thread panel and the Inbox don't show a join state.

**The UI never presents NOT_MEMBER unless authoritative access resolution has returned a negative result.**

### Channel restoration and switching UX

- **Restoration.** The existing `channelRestore` (`switchNavigation.channelAfterCommunitySwitch`) still picks the channel once the new community's list has loaded. Its access then starts as `checking` and resolves from the new session's own roster.
- **Switch progress.** It is still presented by the existing community-switch UI (`readyCommunityUrl`, `MobileSwitchOverlay`). No new switch system was added.

### Security

- The access state is presentation only.
- The relay enforces membership on every read and write.
- Private-channel history can only be evidence because the relay already authorized that read.
- Community A's answers can't reach B: different cache keys, the cache is cleared on switch, and the generation guard applies.
- The operator (platform) role is untouched and separate from channel roles.

### Tests

`tests/unit/features/channels/channelAccess.spec.ts` covers G15:

- strict reads: `CLOSED`, timeout, lenient compatibility;
- a stale A answer after the switch to B (7);
- community- and identity-scoped keys (8, 24);
- every state (9-13);
- re-check and failure keep a known member (6, 11);
- private vs open history (14);
- the end-to-end A → B → A with an `auth-required` first read, never passing through `not_member` (1, 4, 15);
- B's roster cannot answer A's channel (2, 3);
- the private non-member gets Join (16);
- rapid A → B → A (5, 6);
- roles preserved (22, 23);
- the shared access bar, desktop and mobile (17, 18).

Reconnect (19) is covered by the transport rule that socket loss is not a refusal. Refresh (20) is a fresh session. Restoration (21) is the existing `switchNavigation` tests.

**Not done:** visual QA at the listed viewports and themes, and live-relay verification.

## 13. Known limitations

1. **The relay does not reject role-unauthorized 40004 events.** Readers ignore them (§3), but they are stored. A one-line OLD BUZZ change would close this; it needs approval.
2. **Roles are current, not historical.** A pin made by an admin who is later demoted stops being honoured when the conversation is next resolved.
3. **Pin history depth is 100 events per conversation.** A conversation with more than 100 pin/unpin events in its lifetime resolves from its newest 100.
4. **A pinned message fetched by id shows its original text.** Edits are applied only to messages in the loaded window.
5. **Inbox:** an @everyone outside the relay's `activity` page window isn't listed. Live notifications and unread badges are unaffected.
6. **The HTTP-backend preview screens are not covered.** These are `/community` and `/community-dm` (`CommunityChannelsView`, `CommunityDmView`). They have no mention model, message menus or edit path yet, so pins and @everyone there would need backend routes first (`swf buzz/backend`).
7. **Desktop thread panel:** rows in the side panel don't offer pin actions, the same as edit/delete there today. Pinning is done from the conversation feed.
8. **Access via history evidence.** A private-channel `member` derived from history (roster lagging) has role "member" until the roster answers, so owner/admin-only actions appear a moment later.
9. **Removal while viewing.** If someone is removed from a private channel while viewing it, already-loaded history keeps it showing as accessible until the next roster / history refresh. The relay still refuses their reads and writes.
10. **No visual check yet.** The access UI has not been checked at each viewport and theme, nor against a live relay (§12).

## 14. Inbox mention rendering and semantic message previews (hardening)

Status: implemented, automated-verified and emulated-viewport-verified. Not committed.

### Original problem

Full messages already rendered mentions, `@everyone` and links through the shared tokenizer (§7, Phase H). Every **preview** surface still flattened `content` into a plain string, so mentions were indistinguishable from prose:

| Surface | Before |
|---|---|
| Desktop Inbox row (`InboxListPane`) | `preview(item)` → `{{ string }}` |
| Mobile Inbox row (`MobileInboxView`) | `inboxPreview(content)` → `{{ string }}` |
| Mobile Search hit | `snippet(content)` → `{{ string }}` |
| Desktop Search (command palette) | `label: snippet(content)` → `{{ string }}` |
| In-app notification card | `safePreview(content)` → `{{ string }}` |
| Mobile action-sheet context | `content…slice(120)` → `{{ string }}` |

Example: `Mentioned in #SWF Project` / `@Prakhar Mittal @Devankit https://x.com/…` rendered as one undifferentiated grey line.

### Architecture: one tokenizer, two renderers

```
event content + p tags + ["mention","everyone"] tag
        │   mentionTagsOf(event)              (tags are the source of truth, memoised per event)
        ▼
useMessageTokens / tokenizeMessage            (features/mentions/messageTokens.ts)
        │   resolveMentionBindings (profile registry aliases) → segmentMessage (§7 / Phase H)
        ▼
MessageSegment[]  text | mention(pubkey) | everyone | link(href)   — in message order
        ├── MessageContent  (full messages: channel, DM, thread, Inbox detail)
        │       MentionChip · EveryoneMentionChip · MessageLink   (interactive)
        └── MessagePreview  (previews: Inbox, Search, toasts, action sheet)
                .mp-chip · .mp-chip.mp-everyone · .mp-link        (non-interactive)
```

- `MessageContent` was refactored onto the same `useMessageTokens`, so there is still exactly **one** semantic parsing model (`segmentMessage`). No second mention parser and no second URL parser were added.
- **Tags, not text, decide.**
  - A person chip needs a `p` tag whose profile alias matches at a mention boundary (the existing `resolveMentionBindings` rules: ambiguity, code and URLs are masked).
  - `@everyone` needs the semantic tag.
  - An untagged `@Name`, a tagless `@everyone`, or a malformed or unknown `p` tag stays plain text.
- **No `v-html` and no raw HTML.** Every token is a text node or a span with bound text.

### `MessagePreview`

`features/mentions/MessagePreview.ts` + `messagePreview.css`:

- **Normalisation.** Before tokenizing, it drops HTML comments, collapses whitespace and caps the text at 280 characters, so the offsets stay consistent. A chip cut by the cap stays text; it never becomes half a chip. `raw` skips this for text that is already normalised: search snippets and the notification body.
- **Same mention language as `MentionChip`.**
  - The `--color-mention-text`, `--color-mention-bg` and `--color-mention-border` tokens, weight 600, a 1 px subtle border and a 5 px radius.
  - Compact: 0 × 4 px padding. Theme- and accent-aware, with **no hard-coded colours**.
  - Agent labels drop the "(… Agent)" suffix, as the full chip does.
  - `@everyone` uses the same chip plus the `users` group glyph.
- **Links.** They look like `MessageLink`: accent colour, link glyph, a quiet underline, and the compact `host/path` from `linkDisplay` (28 characters).
- **Not interactive (G8 / G14).** No `<a>`, `<button>`, `role` or `tabindex` inside a preview.
  - The Inbox row, search result or toast stays the **one** click and keyboard target (row → `MessageTarget` → exact message).
  - Tapping a chip opens the message like the rest of the row and never a profile, so there is no nested interactive content.
  - Screen readers read the chip text ("@Prakhar Mittal", "@everyone", "x.com/…"). The distinction is not colour-only: it is carried by the `@`, the weight, the border and the glyphs.
- **Truncation (G10).** Each token is `inline-block` + `nowrap` + `max-width: 100%` + `text-overflow: ellipsis`, so:
  - a chip never splits across lines;
  - a too-long name or URL ellipsizes inside its own chip;
  - `vertical-align: top` with a line height of one line minus the border keeps a chip exactly one text line tall, so previews stay the same height and the parent's 2-line clamp still works.

### Profile loading (G9 / G19)

- Chips render from the existing reactive **profile registry**. Known people (the usual case) need no request at all.
- Unknown mentioned people are requested through `requestMentionProfiles`. Requests from **all** messages and previews on screen are coalesced into **one `fetchProfiles` per tick**, and in-flight pubkeys are never re-asked.
  - Fifty Inbox rows mentioning the same unknown person make **one** request (tested).
  - This also improved `MessageContent`, which previously asked once per message.
- Until a profile arrives, the mention is safe plain text, and it becomes a chip when the registry fills.
- Tokens are a `computed` per row, re-run only when the content, the tags or a mentioned person's registry entry change. Tags are memoised per event.

### Surfaces now using it

| Surface | Change |
|---|---|
| Desktop Inbox row | `MessagePreview` with `mentionTagsOf(item.event)`. Kept the "(no text)" fallback |
| Mobile Inbox row | Same |
| Mobile Search hit | `MessagePreview raw` over the snippet + the hit's `mentions` / `mentionsEveryone` |
| Desktop Search (command palette) | Message items carry `mentions` / `mentionsEveryone`, and the label renders through `MessagePreview raw`. `snippet()` now also drops HTML comments |
| In-app notification card | `InAppToast` gained optional `mentions` / `mentionsEveryone`. The card renders the **same sanitised `safePreview` body** with tokens, so secrets stay redacted and markup is never trusted. The **OS notification still gets only the plain body** (`@Prakhar Mittal @Devankit please review…`), and no markup reaches the notification centre |
| Mobile action-sheet context | `MessagePreview` |
| DM previews | The same renderer. A DM's `p` tags are its participants, so they only become chips where the text actually says `@Name`. "Binod Taterway is inviting you…" stays plain text |

Channel messages, thread replies, DMs and the Inbox detail continue to use `MessageContent` (same tokens, interactive chips).

### Tests

`tests/unit/features/mentions/messagePreview.spec.ts`, 23 tests:

- **Token rendering**
  - single, multiple, `@everyone`, and person + everyone;
  - mention + URL, and multiple mentions + URL;
  - plain text stays plain;
  - order of mentions and URLs;
  - long names;
  - normalisation, the cap and a cut chip.
- **Tag semantics**
  - non-interactive (no `a`, `button`, `role` or `tabindex`);
  - `mentionTagsOf` parsing and memoisation;
  - text alone or malformed tags never make a chip;
  - DM participants;
  - an edited message re-tokenizes.
- **Profiles and Inbox row**
  - registry reuse with no fetch;
  - **50 rows → 1 lookup**;
  - an unknown person becomes a chip when the profile lands;
  - desktop Inbox row tokens for the screenshot case;
  - tapping a chip selects the row and never opens a profile;
  - the "(no text)" fallback.
- **Notifications and source contracts**
  - the plain notification body is readable, with no markup and the nsec redacted, and the in-app card tokenizes it;
  - wiring contract: every preview surface and `MessageContent` share `useMessageTokens`;
  - no `v-html` or `innerHTML`, and no hard-coded colours, in the preview styles.

All existing mention, link, profile, Inbox, Search, notification and mobile suites pass unchanged (30 files, 411 tests, run before the full suite).

### Verification

| Level | Status |
|---|---|
| **AUTOMATED VERIFIED** | Yes. `vue-tsc` ✓, `eslint --max-warnings 0` ✓, `vitest run` **164 files / 1833 tests** ✓, `npm run build` ✓. Bundle: 0 key material, 0 sourcemaps, no harness |
| **EMULATED VIEWPORT VERIFIED** | Yes. See below |
| **LIVE RELAY VERIFIED** | **No.** No relay was running |
| **REAL DEVICE VERIFIED** | **No** |

**Emulated check:** a temporary harness rendered the real `MobileInboxView`, `MobileSearchView` and desktop `InboxListPane` in headless Chrome. It was deleted afterwards.

- **Data:** an agent mention with long text; two mentions + an `x.com` URL; person + person + `@everyone`; `@everyone` alone; text, mention, URL and a 50-character name in order.
- **Configurations:** 390×844, 375×812, 360×800 and 320×720, plus desktop at 1440, 1280, 1024 and 768, each in light and dark. That is **90 / 90 checks passed**:
  - no horizontal overflow;
  - chips, `@everyone` and links all rendered;
  - no chip broken across lines or wider than its preview;
  - previews of at most 2 lines and chips of one line;
  - chips on the text line (vertical alignment within 3 px);
  - clicking a chip selects the row;
  - 44 px touch targets on mobile;
  - mention colours come from theme tokens (light and dark differ), weight 600, `nowrap`;
  - no console errors.
- Screenshots are in `docs/assets/phase-g-previews/` (7 files).

### Security (G20)

- No `v-html`, no `innerHTML` and no raw HTML.
- Link tokens in previews are display-only; nothing in a preview opens a URL. Full messages keep `MessageLink`'s validated opener.
- Toast tokens are built from the already-sanitised `safePreview` text, so `nsec` and `ncryptsec` values stay `[hidden]`.
- `@everyone` renders from the event's own tag. No recipient or audience list is shown or computed, so private-channel membership cannot leak.
- Profile lookups go through the existing `profileService` (relay-authorized).

### Known limitations

- In in-app notification cards, URLs show as their host in plain text (from `safePreview`, which shortens links for OS notifications too) rather than as a link token.
- Inbox rows preview the event as the relay returned it. They do not apply later edits (unchanged behaviour; the Inbox detail and the conversation show the edited text).
- Mobile Home's DM-list "last message" line is still plain text. It is a one-line summary that rarely carries mentions, and it can adopt `MessagePreview` later.
- Mention chips in previews do not open profiles. This is by design for v1 (row-level navigation). A desktop hover card could be added later.
