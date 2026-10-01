# Phase 3 — Implementation Audit

> **Current status is in §19 (P0 identity switching + reactions fix, 2026-09-22).** The status
> blocks at the end of §18 are superseded by §19's and kept only as history.

Companion to `PHASE_3_OLD_BUZZ_PROTOCOL_AUDIT.md` (Audit A) and `PHASE_3_CHAT_UI_DESIGN.md`
(Audit B), which this implementation pass treated as the spec. Their §0 finding governs
everything here: **SWF Buzz already had a working NIP-29 chat implementation before this pass** —
this was VERIFY → FIX GAPS → HARDEN → POLISH, not a from-scratch build. OLD BUZZ (`../buzz`) was
not modified; nothing under it was touched by this work.

**Read this first — what this pass is, and is not (updated after the second implementation
pass — see §18 for the full account):** the real protocol/data-layer gaps (3.4 pagination, 3.6
reaction removal, 3.7 unread/mentions) were implemented in the first pass and pass
typecheck/lint/build/unit-tests. The second pass fixed a real channel-open bug, implemented the
attached UI design spec's tractable parts (message menu, hover toolbar, jump-to-latest pill,
sidebar ☰ toggle, z-index token cleanup), a real six-breakpoint responsive layout, an
accessibility baseline (Escape-to-close, focus-visible, aria-live, aria-labels), ran
`cargo clippy`/`cargo test` for both Rust crates (clean), and ran a genuine — though narrower
than originally scoped — live-relay E2E. **Still not done, honestly, not silently**: a dedicated
Inbox view, the composer's attachment/voice/formatting/full-emoji-picker affordances, message
edit/delete, admin-delete-others, "Remind me later", and channel-settings edit controls beyond
what already existed — all deferred with reasons in §18, not stubbed as fake. Full two-identity
send/receive/thread/reaction/pagination/reconnect E2E (the user's TEST 1–24) could **not** be
run: it requires an operator-created community, which requires the real operator's private key,
which this process correctly does not have and was explicitly told not to work around by
modifying `RELAY_OPERATOR_PUBKEYS`. See §18's E2E section for exactly what live verification
*was* possible without that, and what unblocks the rest. **Third pass (§18.8):** with the user's
explicit permission, a throwaway operator key was added temporarily and the full scripted flow
was run for real against the live relay (2/2, twice), then the key was reverted and the revert
verified. That run also surfaced one new real bug (reactions' `#h` query, §18.8 #16).
**PHASE 3 remains PARTIAL**, not COMPLETE — 3.9 UI, responsive and accessibility are still
partial — see the status block at the end.

## 1. Phase 3 architecture

Unchanged from the audits, confirmed intact by this pass:

```
Vue 3 UI (ChannelsView.vue, AppSidebar.vue, MessageList.vue, ...)
   ↓
Vue composables / feature services (ChannelService.ts, MessageService.ts,
ThreadService.ts, ReactionService.ts — the live, non-Http track)
   ↓
RelayConnectionService (src/services/RelayConnectionService.ts)
   ↓
Nostr WebSocket (nostr-tools)
   ↓
Existing Buzz Relay / NIP-29 protocol (../buzz, read-only reference + running instance)
```

Rust/Tauri (`src-tauri/`) remains solely responsible for local identity, private-key storage,
signing, NIP-42 auth, and deep links — no private key material was moved into Vue or
`localStorage` anywhere in this pass. The Okta-era `swf-buzz-backend`/`*ServiceHttp.ts`/
`CommunityChannelsView.vue` track was left untouched (not deleted, not extended) — see D11 in
`DECISIONS.md`.

## 2. Existing functionality reused (verified, not rebuilt)

Per Audit A §13/§14 and Audit B §2/§14, traced and confirmed still correct in this pass:
channel discovery (`ChannelService.discoverChannels`, kind:39000/39001/39002), channel creation
(`useCreateChannel.ts`/`CreateChannelDialog.vue`, kind:9007, any member → owner), send + optimistic
UI (`useSendMessage.ts`, `optimisticMessage.ts`), realtime message delivery + client dedup
(`useChannelMessages.ts`), threads (`ThreadService.ts`, `ThreadPanel.vue`, NIP-10 markers, no
depth limit), reactions add-path (`ReactionService.react`), agent activity (`useAgentActivity.ts`,
`AgentActivityBar.vue`, `useAgentObserverFeed.ts` — see §10), the entire design-token system
(`tokens.css`), and the `AppShell.vue` 3-column shell. None of these were rewritten.

## 3. New functionality implemented

| Area | Files | Summary |
|---|---|---|
| Older-message pagination | `MessageService.fetchOlderMessages`, `useChannelMessages.ts` (`loadOlder`/`hasOlderMessages`/`isLoadingOlder`/`olderMessagesError`), `MessageList.vue` (top sentinel, scroll-position preservation, loading/error affordances) | §5 |
| Reaction removal (unreact) | `protocol/kinds.ts` (`KIND_DELETION`), `protocol/reactions.ts` (`buildRemoveReactionEvent`), `ReactionService.unreact`/`retractReactionLocally`, `useRemoveReaction.ts`, `MessageItem.vue` (toggle-to-unreact), `types/domain.ts` (`Reaction.reactorEventIds`) | §8 |
| Unread/mentions (local-only) | `stores/readState.ts`, `features/readState/useUnreadTracking.ts`, `AppSidebar.vue` (mount + wiring), `ChannelListItem.vue` (badge), `ChannelsView.vue` (`markChannelSeen` on view) | §7 |
| Design tokens | `app/theme/tokens.css` — `--z-dropdown/-sticky/-drawer/-modal/-toast` | Audit B §10 gap closed |

No new chat service was created — pagination extends `MessageService`/`useChannelMessages`,
unreact extends `ReactionService`, unread tracking is a new store + composable (matching the
existing `dmReadState.ts` precedent for DMs — same "local-only, no fake protocol" pattern,
extended with persistence and counts since the spec asked for those for channels specifically).

## 4. OLD BUZZ protocol mapping

No changes from Audit A's mapping — this pass only *used* the protocol OLD BUZZ already exposes,
never invented one. New wire usage added: `kind:5` (NIP-09 deletion) for reaction retraction
(confirmed generically supported server-side, not reaction-specific — see §8); `REQ` with `until`
for older-message pages (already OLD BUZZ's own mechanism, Audit A §5).

## 5. Pagination implementation

`MessageService.fetchOlderMessages(channelId, beforeCreatedAt, limit=50)` issues
`{"kinds":[9,40002,40099],"#h":[channelId],"until":beforeCreatedAt,"limit":50}` and filters out any
returned event with `created_at >= beforeCreatedAt` as a boundary-dedup safety net (on top of the
existing id-based dedup in `useChannelMessages`). `useChannelMessages.loadOlder()` reads the
current oldest loaded message from the Vue Query cache, fetches the next page, prepends de-duped
results, and sets `hasOlderMessages = false` the first time a page comes back empty (EOSE with
nothing further — no opaque cursor, matching Audit A §5/§10). Initial page size changed from an
unused 100-default to 50, matching the design doc's "load latest 50" spec (nothing called it with
an explicit limit, confirmed via grep before changing).

`MessageList.vue` adds an `IntersectionObserver` sentinel at the top of the scroll container; when
it's visible and `hasOlderMessages && !isLoadingOlder`, it emits `load-older`. A `previousFirstId`
comparison distinguishes a prepend (older page landed) from an append (new/realtime message) —
only a prepend triggers the scroll-position-preservation formula
(`scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop`); an append still auto-scrolls to
bottom, unchanged from before. "Loading older messages…" and a "Couldn't load older messages —
Retry" affordance render inline above the message list, per the design doc.

**Not done in this pass**: the design doc's "↓ New messages" pill (for a *new* message arriving
while the reader is scrolled up) — out of scope budget-wise; today an append still always
scrolls to bottom regardless of reader position. Flagged in §16/§17, not implemented as a shortcut.

## 6. Reconnect implementation

**No new code — traced to source and found already correct**, contradicting Audit A §6/§14.2's
"needs verification" flag (now resolved, not just re-flagged). `RelayConnectionService.subscribe()`
stores each subscription's original filters (including the live-message filter's
`since: Math.floor(Date.now()/1000)`, captured **once**, at subscribe time) in a registry;
`attemptConnect()` re-issues every registered subscription with those *same, frozen* filters on
both the initial connect and every reconnect (`handleClose` → `scheduleReconnect` → capped
exponential backoff → `attemptConnect` → `issueSubscription` for each registered sub). Because the
`since` bound doesn't move, a reconnect causes the relay to redeliver everything published since
the channel was opened — including whatever arrived during the disconnect gap — and the existing
id-based dedup in `useChannelMessages`/`useChannelReactions` already discards the re-sent
already-seen events. Net effect: no missed messages, no duplicates, with zero new code required.

**Caveat, disclosed not hidden**: this was verified by reading `RelayConnectionService.ts` and
`useChannelMessages.ts` together, not by an actual disconnect/reconnect test against the live
relay in this session (§15/§16) — the reasoning is sound and the mechanism is real, but "traced
correct" is a weaker claim than "observed correct under a real socket drop."

## 7. Unread/mention local-state design

Per Audit A §9 (confirmed: **no unread/read-marker protocol exists in OLD BUZZ at all** — no kind,
no table, no field), this is entirely local, non-authoritative state:

- `stores/readState.ts` (`useReadStateStore`) persists `{ channelId: lastSeenCreatedAt }` to
  `localStorage` under `swf-buzz:read-state:<pubkey>` (namespaced per identity — never per device
  alone, so switching identities on the same machine doesn't leak one identity's read state as
  another's). Only timestamps are stored — no message content, no keys, no tokens.
- `features/readState/useUnreadTracking.ts` mounts once (in `AppSidebar.vue`, always present while
  a community is open) and opens a single channel-agnostic live subscription
  (`{"kinds":[9,40002],"since":now()}`, no `#h`) — for every event outside the currently-open
  channel and not authored by me, it increments `unreadCounts[channelId]` and sets
  `hasMention[channelId]` when my pubkey appears in the message's `p`-tags (`message.mentions`,
  already parsed by the existing `parseMessageEvent`).
- `ChannelsView.vue` calls `readStateStore.markChannelSeen(channelId, newestVisibleCreatedAt)`
  whenever the open channel's message list changes, resetting its count/mention flag and advancing
  the persisted watermark.
- `ChannelListItem.vue` renders a plain badge for unread, a `--color-danger` badge for
  mention-included unread — matching the design doc's "mention badge visually differs" requirement,
  using only existing tokens.

This mirrors the existing `stores/dmReadState.ts` precedent for DMs (same "local-only, no fake
Nostr event" rule, already established in this codebase before this pass) — extended with
persistence and counts because the spec asked for those specifically for channels.

**Known imprecision**: `unreadCounts` are session-derived from the live feed only — they do not
retroactively reconstruct "how many messages did I miss while the app was closed" from history,
only from the moment `useUnreadTracking` mounts. A precise historical count would require paging
every channel's history against `lastSeenAt` on load, which was out of budget this pass and would
also be a much heavier startup cost — flagged in §17, not silently done as a shortcut.

## 8. Reaction behavior

Add path unchanged (`kind:7`, `ReactionService.react`). Retraction was the audit's flagged
"unconfirmed both sides" gap (Audit A §8/§14.4) — **traced and resolved, not invented**:
`crates/buzz-relay/src/handlers/side_effects.rs:233` (`validate_standard_deletion_event`) is a
*generic* NIP-09 `kind:5` handler that looks up any target event by its `e`-tag and enforces
self-authorship — it is not reaction-specific, so a self-authored `kind:5` deleting my own `kind:7`
reaction event is standard, already-supported behavior, not new protocol. Implemented as
`ReactionService.unreact(reactionEventId)` → `buildRemoveReactionEvent` → publish; `MessageItem.vue`
toggles react/unreact based on `reactedByMe` + the new `Reaction.reactorEventIds` map (pubkey → the
reaction event id needed to build the deletion's `e` tag — this field didn't exist before and had
to be added to `groupReactions`/`applyReaction`, with `retractReactionLocally` as the inverse for
optimistic local removal).

**Known limitation, explicit**: the relay does not fan out a "reaction removed" signal to other
live subscribers (only the bare `kind:7` add is delivered live, per Audit A §8) — this pass's
`unreact` updates the *retracting user's own client* immediately via optimistic cache patch, but
other connected users will only see the removal on their next full re-fetch of that channel's
reactions (a channel switch, a refresh, or reopening), not in realtime. Propagating deletion in
realtime to everyone would need the reaction subscription to also match `kind:5`, but those events
don't carry `#h` (Audit A §8's cross-reference), so a combined filter doesn't work as-is and a
proper fix needs a separate subscription strategy — out of budget this pass, documented rather than
faked.

## 9. Thread behavior

No changes — verified via source trace against Audit A §7 (NIP-10 markers, unlimited depth
collapsing to root, `ThreadPanel.vue` as an existing details-pane side panel matching Audit B §7's
placement decision). Not independently re-tested live this pass (§15).

## 10. Agent activity architecture

No changes — **traced and resolved**, closing Audit A §11/§14.6's open question rather than
re-flagging it. `useAgentActivity.ts` composes real signal over fallback: `stores/agentActivity.ts`
is fed by `features/agents/useAgentObserverFeed.ts`, which subscribes to a real `kind:24200`
"observer frame" event stream (`AgentActivityService`) — a genuine per-turn working/idle signal,
*not* the typing indicator. The `kind:20002` typing indicator is used only as a fallback when no
observer-frame signal exists yet for that agent. `AgentActivityBar.vue` renders this, mounted above
the composer, never in the message timeline, per the user's explicit requirement.

The existing code already self-documents a real, pre-existing limitation worth restating here (not
introduced by this pass): `useAgentObserverFeed.ts`'s working/idle classification is an "UNVERIFIED
HEURISTIC" (its own comment, citing `docs/KNOWN_LIMITATIONS.md`) — the full set of real
`buzz-acp` observer-frame `type` values hasn't been enumerated against a live `buzz-acp` instance,
so some frames could misclassify as finished/not-finished. Not a Phase 3 regression; a pre-existing
gap this pass surfaced rather than fixed.

## 11. UI architecture

Unchanged — `AppShell.vue`'s existing 3-column grid, `tokens.css`'s existing palette, and the
existing component set (Audit B §14's "reuse" list) were used as-is. Only additions: the
`MessageList.vue` sentinel/pagination-status markup and `ChannelListItem.vue`'s badge markup, both
built from existing tokens, no new colors hardcoded.

## 12. Responsive behavior

**Not implemented in this pass.** Audit B §9's breakpoint table (1440/1280/1024/768/390/375) was
a *design*, not yet code — this pass did not touch `stores/ui.ts`'s collapse thresholds or
`AppShell.vue`'s CSS to enforce them. This is real, disclosed remaining work for 3.9, not silently
skipped-and-claimed-done.

## 13. Accessibility

**Not audited or implemented in this pass** beyond what already existed (e.g. the new unread badges
use `aria-label`, and the pagination status row uses `role="status"`). The design doc's minimum bar
for 3.9 (message-list `log`/`feed` role + live-region announcements, composer Enter/Shift+Enter
verification, thread-panel focus trapping on narrow viewports, icon-button labels) was not
attempted — genuine remaining work, not a shortcut.

## 14. Security

No security-relevant behavior changed except the new `kind:5` reaction-retraction path, which
relies entirely on the relay's own existing self-authorship enforcement (§8) — no new client-side
trust decision was introduced. `readState.ts`'s `localStorage` persistence stores only
`{channelId: timestamp}` pairs, namespaced by pubkey, never key material, tokens, or message
content — consistent with the explicit "never store private keys/secrets" instruction. No new
network origin, no new credential handling, no OLD BUZZ code touched.

## 15. Test results

| Gate | Result |
|---|---|
| `npm run typecheck` (`vue-tsc --noEmit`) | **PASS** |
| `npm run lint` (`eslint . --max-warnings 0`) | **PASS** (one warning found and fixed: unused destructured var in `ReactionService.ts`) |
| `npm run build` (`vue-tsc --noEmit && vite build`) | **PASS** |
| `npm run test` (Vitest) | **521 passed, 8 failed, 529 total** — all 8 failures are in `tests/integration/relayConnectionService.spec.ts`, a file this pass never touched; re-running that file in isolation reproduces the same failures (auth-timing/"Not connected yet" assertions against the in-memory `minimalNostrRelay.ts` mock), confirming pre-existing environment flakiness, not a Phase 3 regression. Fixed 3 of an original 11 failures in this same run: `tests/unit/features/reactions.spec.ts`'s `toEqual` assertions needed updating for the new `reactorEventIds` field this pass added to `Reaction` — a legitimate test update, not a masked bug. |
| `cargo check` (`backend/`) | **PASS** (clean; this pass made zero changes here) |
| `cargo check` (`src-tauri/`) | **PASS** (clean; this pass made zero changes here) |
| `cargo clippy --all-targets -- -D warnings` | **NOT RUN** — ran out of session budget after the above; no Rust files were touched by this pass, so risk of a clippy regression is low but unconfirmed |
| `cargo test --lib` | **NOT RUN** — same reason |
| Live scripted real-relay E2E (user's TEST 1–17 list, two real identities) | **NOT RUN** — see the box at the top of this document. This is the most important gap: the new pagination/unreact/unread code has not been exercised against the actual running relay (`ws://localhost:3000`, `RELAY_OPERATOR_PUBKEYS` configured per the earlier cleanup work), only against static analysis + the existing unit-test suite. |

**Environment note (pre-existing, not caused by this pass, same as `PHASE_2_1_OPERATOR_TERMINOLOGY_AND_HARDENING_AUDIT.md`'s):** this machine has Node 20.19.4; the repo's undici/jsdom combination calls `webidl.util.markAsUncloneable`, which doesn't exist on Node 20's bundled webidl shape. Vitest does not start unmodified. Run through a shim kept outside the repo
(`NODE_OPTIONS="--require <path-to>/node20-undici-webidl-shim.cjs"`, a small monkey-patch making
that call a no-op) — not needed on a Node version where jsdom's own stated minimum is met.

## 16. Known limitations (superseded by §18 below — kept for history)

1. Reaction removal does not propagate to other clients in realtime (§8) — only the retracting user's own view updates immediately; others see it on next re-fetch. **Still true after the second pass.**
2. Unread counts are session-derived only, not reconstructed from full history on load (§7). **Still true.**
3. ~~No "↓ New messages" pill~~ — **fixed in the second pass, see §18.2.**
4. `RelayConnectionService` reconnect/missed-message behavior was verified by source trace, not by an actual live disconnect/reconnect test (§6). **Still true** — the second pass's live E2E could not reach this (see §18.5's operator-key blocker).
5. ~~Responsive breakpoints not implemented~~ — **implemented in the second pass, see §18.3.**
6. ~~Accessibility minimum bar not implemented~~ — **baseline implemented in the second pass, see §18.4.**
7. `useAgentObserverFeed.ts`'s working/idle classification remains an unverified heuristic — pre-existing, not introduced by either pass (§10).
8. ~~`cargo clippy`/`cargo test` not run~~ — **run in the second pass, both clean, see §18.6.**
9. Live scripted real-relay E2E — **partially run in the second pass; full two-identity flow still blocked, see §18.5.**

## 17. Remaining technical debt (superseded by §18.7 below — kept for history)

See §18.7 for the current, accurate punch list.

## 18. Second implementation pass — channel-open bug, UI, responsive, a11y, live E2E

Scope: the user's follow-up directive after reviewing the first pass — fix a reported
channel-create-then-can't-open bug first, then implement the attached UI design spec, then
responsive + accessibility, then push the live E2E and Rust gates as far as genuinely possible.
Everything below is new in this pass; §1–§17 above is the first pass, left as written (with
strikethrough notes where this pass superseded something).

### 18.1 Channel-open bug — root cause and fix

**Root cause**: `AppSidebar.vue`'s `selectChannel()` navigates with
`router.push({ name: "channels", query: { channelId } })`. The `channels` route maps
`route.query.channelId` to `ChannelsView.vue`'s `channelId` prop reactively
(`app/router/index.ts:42`) — but `ChannelsView.vue` only ever read that prop inside `onMounted()`,
once. Vue Router reuses the same component instance across query-only navigations on the same
route, so after the view's first mount (with no channel, or with whatever channel a deep link
opened), clicking a *different* channel in the sidebar updated the URL and the prop, but nothing
called `ui.selectChannel()` again — `selectedChannelId` (the Pinia state everything else reads)
stayed frozen. A freshly created channel is exactly this case: the view is already mounted with no
channel selected, so the very first click silently did nothing.

**Fix**: replaced the one-shot `onMounted` read with `watch(() => props.channelId, ..., {
immediate: true })` in `ChannelsView.vue` — `immediate: true` covers the original mount case, the
watcher covers every later click. Root cause fixed in the one place it lives; no duplicate
channel service, no second route architecture, as instructed.

**Same bug, same fix, in `DmView.vue`**: `AppSidebar.vue`'s `selectConversation()` has the
identical pattern (`router.push` + query prop, never re-read after mount) — found and fixed the
same way while tracing the channels case, since it's the same root cause in a sibling view, not a
separate rebuild.

Files: `src/views/ChannelsView.vue`, `src/views/DmView.vue`.

### 18.2 UI design spec implementation

Built for real, using only existing components/tokens:

- **Message hover toolbar + `⋮` menu** (`MessageItem.vue`, new `MessageMenu.vue`): hover-reveal
  (also `:focus-within`, for keyboard users) toolbar — 👍❤️😊 quick reactions, ↩ reply, 🔗 copy
  link, ⋮ more. The menu has **Mark unread** (new `readState.markUnreadFrom` action — rewinds the
  channel's local watermark and recomputes the count from currently-loaded messages; verified
  self-correcting once new activity arrives or the channel is reopened, since `ChannelsView`'s
  existing `markChannelSeen` watcher only re-fires on a `messages.value` identity change, not on a
  timer), **Copy message**, **Copy link**, and **Report message** (moved from the old always-shown
  danger button into the menu, hidden entirely on your own message rather than shown+disabled).
- **"Copy link" is a real NIP-19 `nevent` identifier** (`nostr:nevent1…`, via `nostr-tools`'
  `nip19.neventEncode`), not an invented app deep link — there's no registered `swfbuzz://` link
  type for "open this exact message" (that would need Rust-side `src-tauri/src/deeplink.rs`
  changes, out of scope), and a fake one would be worse than a real, standards-compliant Nostr
  event reference any Nostr tool can resolve.
- **Relative timestamps with an absolute-on-hover title** — `2m ago` / `3h ago` / `Just now`,
  native `title` attribute for the exact time on hover. Not a ticking clock (doesn't re-render
  purely from time passing without some other re-render trigger) — accepted simplification, not a
  hidden bug.
- **"↓ New messages" pill** (`MessageList.vue`) — the design doc's explicitly-required behavior:
  a reader scrolled away from the bottom is never yanked down by an incoming message; a floating
  pill appears instead, click scrolls to bottom. Tracks "near bottom" via a scroll listener,
  decided *before* the new message's DOM update lands (not after, which would always read "at
  bottom" because the list just grew).
- **`role="log"` / `aria-live="polite"` / `aria-relevant="additions"`** on the message list —
  the design doc's live-region requirement without being spammy (`log`+`additions` is the standard
  accessible pattern for a growing chat transcript, not a custom announcer).
- **Sidebar `☰` toggle** wired into `ChannelHeader.vue`, calling `uiStore.toggleSidebar()` — only
  visible ≤1024px (see §18.3), a no-op elsewhere.
- **z-index token cleanup**: every hardcoded `z-index` in the live track now uses the
  `--z-dropdown`/`--z-drawer`/`--z-modal`/`--z-sticky` scale the first pass added
  (`ChannelMenu.vue`, `MembersModal.vue`, `CreateChannelDialog.vue`, `ChannelDetailsPanel.vue`,
  `ReportMessageDialog.vue`, `CreateCommunityDialog.vue`, `IdentityModal.vue`,
  `CommunityManagementModal.vue`, `AppShell.vue`). `CreateChannelDialogHttp.vue` (legacy Okta-era
  track) was deliberately **left untouched** — briefly edited, then reverted, once realized it was
  out of the live track's scope, per the explicit "leave the legacy track alone" rule.

**Deliberately NOT built this pass, with reasons (not faked, not silently skipped)**:

- **Message Edit (kind:40003) and admin-delete-others (kind:9005)** — OLD BUZZ genuinely supports
  both (Audit A §3 confirms the exact kinds), but neither the *send* side nor the *receive/render*
  side exists in `MessageService.ts`. Wiring only a "send a delete/edit event" button with no
  subscription anywhere handling the incoming event would be a half-built, actively misleading
  feature — worse than not having it. Left out of the message menu entirely, not shown
  disabled/greyed.
- **"Remind me later"** — no reminder store, scheduler, or notification plumbing exists anywhere
  in this codebase to back it. Same reasoning.
- **Full emoji picker (the design's "+")**, **attachment/voice/formatting composer buttons** — no
  backend support for any of these (no media upload endpoint reachable from the live chat track, no
  formatting-aware renderer). Building the UI affordance alone would be exactly the "fake
  protocol/feature" the instructions explicitly forbade. The composer keeps its existing, real,
  working mention-picker + plain-text kind:9 send path, untouched.
- **Dedicated Inbox view** (mentions+DMs list with a detail pane) — a genuinely new screen/route,
  not a tweak to something existing; out of budget alongside everything else in this pass.
- **Channel settings edit controls, Members modal remove/make-admin** — not extended beyond what
  `ChannelDetailsPanel.vue`/`MembersModal.vue` already had; not audited deeply enough this pass to
  claim confidently whether the gap is real or already covered — flagged as unverified rather than
  guessed either way.

### 18.3 Responsive implementation

`AppShell.vue`'s existing 260px/fluid/300px grid (already correct for 1440+/1280 — "tighter main"
at 1280 falls out of `1fr` for free, no code needed) now has real behavior at the breakpoints that
actually need it:

- **≤1024px**: grid collapses to a single column; the sidebar/details toggle (☰, and the existing
  details-toggle bar) become the way to reach them — no forced auto-collapse at this tier, matching
  the spec's "collapsible" (not "hidden by default").
- **≤768px**: sidebar and details pane become fixed-position **drawers** over full-width main
  content, with a dismissible backdrop (`.scrim`, click or Escape to close). This needed one piece
  of real logic pure CSS can't provide: a `window.matchMedia("(max-width: 768px)")` watcher in
  `AppShell.vue` that sets the sidebar's default to *closed* on entering this tier and *open* again
  on leaving it — without it, a fresh narrow window would render the sidebar drawer full-open,
  covering the channel content it's supposed to reveal. `detailsPaneOpen` is deliberately **not**
  auto-toggled by this watcher — it's already content-triggered (opening a thread/profile/settings)
  and force-closing it on a resize would just slam shut whatever the reader had open; only its CSS
  treatment (drawer → full-screen) changes at this width.
- **≤480px** (covers 390/375): the details drawer becomes a true full-width/full-screen view
  (matches "Thread becomes full-screen" for mobile) rather than a partial overlay.
- New `stores/ui.ts` action `setSidebarCollapsed()` for the watcher to call (alongside the existing
  user-driven `toggleSidebar()`).
- **Real regression caught and fixed during this work**: `window.matchMedia` doesn't exist in
  jsdom's default environment, which broke two *legacy-track* component tests
  (`CommunityChannelsView.spec.ts`, `CommunityDmView.spec.ts` — they also render the shared
  `AppShell.vue`). Guarded with `typeof window.matchMedia === "function"` before use — real
  browsers and Tauri's webview always have it; this is a test-environment guard, not a production
  code path. Verified fixed: full suite back to the pre-existing 521/529 baseline (see §18.6).

Files: `src/layouts/AppShell.vue`, `src/stores/ui.ts`, `src/features/channels/ui/ChannelHeader.vue`.

**Not verified**: actual rendering at each of the six breakpoints in a real browser/Tauri window —
this pass wrote and reasoned through the CSS/JS but has no way to screenshot-verify layout
correctness at each width. Real, disclosed remaining risk, not claimed as visually confirmed.

### 18.4 Accessibility baseline

- New `composables/useEscapeKey.ts` — a `document`-level `keydown` listener (works regardless of
  which element inside the dialog has focus, e.g. a search input), wired into every dismissible
  overlay in the live track that was missing it: `MessageMenu.vue`, `ChannelMenu.vue`,
  `MembersModal.vue`, `ChannelDetailsPanel.vue` (Escape closes an open leave-confirmation first,
  then the panel — not both at once), `ReportMessageDialog.vue`, `CreateChannelDialog.vue`,
  `CreateCommunityDialog.vue`, `IdentityModal.vue`, `CommunityManagementModal.vue`.
  (`CreateChannelDialogHttp.vue`, legacy track, deliberately not touched.)
- `:focus-visible` outlines added to every icon-only button touched this pass (message action row,
  `ChannelHeader.vue`'s sidebar-toggle/member-count/menu buttons) — previously hover-only feedback,
  invisible to keyboard navigation.
- `.message-actions` (the hover toolbar) now also reveals on `:focus-within`, not only `:hover` —
  otherwise a keyboard user tabbing into a message's action buttons would be tabbing to invisible
  controls.
- `aria-label`s added where missing: `ChannelHeader.vue`'s member-count and sidebar-toggle buttons,
  every message action button (reactions, reply, copy-link, more-menu — the last two with
  `aria-haspopup="menu"`/`aria-expanded`), `MessageList.vue`'s `aria-label="Channel messages"`.
- `role="log"`/`aria-live="polite"`/`aria-relevant="additions"` on the message list (§18.2).
- `prefers-reduced-motion` respected for the two new animations (new-messages pill entrance,
  message-actions fade).

**Not attempted this pass, honestly**: a full keyboard-navigation walkthrough (tab order across
the whole channel view), a focus trap inside modals/the mobile full-screen thread (Escape closes
them, but focus isn't currently *contained* while open — a keyboard user can still Tab out to
content behind the overlay), and focus restoration to the trigger element on close. These are real,
disclosed gaps against the design doc's full accessibility list, not silently declared done.

### 18.5 Live E2E — what could and could not be run, and why

> **Superseded by §18.8.** The blocker described here was resolved in a third pass with the
> user's explicit permission for a temporary, reverted throwaway operator key; the full flow
> was then run for real. This section is kept as the record of *why* it was blocked first.

**The blocker**: every one of the user's TEST 1–24 steps after the first happens *inside* a
community, which requires `POST /operator/communities` to succeed first. That endpoint only
accepts a request signed by a pubkey already in the relay's `RELAY_OPERATOR_PUBKEYS`
(`0f61e5e47ca8c4e22c64bab3a1163989a4e3a2d45d014e3d153f1c15b2320029`, per the earlier cleanup work
this session) — the real operator's private key, which this process correctly does not have and
was explicitly told, repeatedly and across this whole session, never to work around by modifying
`RELAY_OPERATOR_PUBKEYS` (even temporarily/reversibly). Every downstream step — join, send,
realtime, threads, reactions, pagination, reconnect — needs an authenticated `relay_members` row,
which needs a community, which needs that one step. This is a real, structural blocker, not a
budget shortfall: **no amount of additional session time changes this** without either (a) the
human performing the one "Operator Dashboard → Create Community" click in the running app
themselves (a `swf-buzz.exe` process was already confirmed running earlier this session), after
which this same test file/pattern could drive everything downstream against that real community,
or (b) explicit permission to add a second, throwaway, session-only pubkey to
`RELAY_OPERATOR_PUBKEYS` for this test run and then remove it again afterward.

**What *was* genuinely run against the real, currently-running relay** (new file
`tests/integration/liveRelay.e2e.spec.ts`, excluded from the default `npm test` run via a new
`vitest.e2e.config.ts` since it needs a live external process — run explicitly with
`npx vitest run --config vitest.e2e.config.ts`, `NODE_OPTIONS` pointing at a small
`ws`-package WebSocket shim for Node 20 — see the file's own header): a fresh, throwaway
`DevSigningService("ephemeral")` identity (the app's own real dev-signer class, never touching
real key material) connects, via the app's own real `RelayConnectionService`, to the actually-
running `ws://localhost:3000`.

**Real finding, not an assumption**: this succeeds — `status` reaches `"connected"`, not refused.
`ws://localhost:3000` resolves to one of the bare "row-zero host-binding" `communities` rows the
relay's own bootstrap recreates on every start (zero `relay_members`, no owner, never provisioned
by an operator). Whether an *owned* community with real members correctly refuses a non-member
(the `authDenialKind: "not_member"` path clearly exists in `RelayConnectionService.ts`) was **not**
verified this pass, precisely because provisioning one is the blocked step above — recorded as an
open question for whoever runs the unblocked E2E next, not asserted either way.

### 18.6 Rust quality gate — now actually run

| Gate | Result |
|---|---|
| `cargo clippy --all-targets -- -D warnings` (`backend/`) | **PASS**, 0 warnings |
| `cargo clippy --all-targets -- -D warnings` (`src-tauri/`) | **PASS**, 0 warnings |
| `cargo test --lib` (`backend/`) | **PASS**, 35 passed / 0 failed |
| `cargo test --lib` (`src-tauri/`) | **PASS**, 57 passed / 0 failed (matches the count `PHASE_2_1_OPERATOR_TERMINOLOGY_AND_HARDENING_AUDIT.md` recorded — no regression) |

Neither Rust crate was modified by either pass, so this is confirmation, not new risk — but it was
genuinely run this time rather than assumed low-risk.

### 18.7 Updated punch list

In priority order, for whoever continues this (written before §19; item 1 and item 3 were
subsequently resolved in §19 — kept as the state at the end of this pass):

1. **Reactions `#h` query returns nothing for kind:7** (§18.8 #16) — the live app's reaction lists
   are probably empty right now. Investigate the relay's `#h` matching for reactions vs the
   client's `buildReactionFilter`; do not paper over it client-side until the cause is known.
2. Manual GUI verification of the steps a scripted run can't drive: unread/mention badges (#21–22),
   the six responsive breakpoints (#24), and the channel-open fix in the actual window.
3. Focus trapping for modals and the mobile full-screen thread, plus a full keyboard tab-order
   walkthrough (§18.4).
4. Visual/layout verification of the six responsive breakpoints in an actual browser or Tauri
   window (§18.3) — this pass only reasoned through the CSS.
5. The deliberately-deferred features from §18.2 (Edit/Delete, admin-delete, Remind-later, full
   composer toolbar, dedicated Inbox view) — each needs real backend/protocol wiring first, not
   just UI.
6. Cross-client realtime reaction-removal and session-spanning unread counts — unchanged limitations
   from the first pass (§16 items 1–2).

### 18.8 Live E2E — third pass, full flow actually run (temporary throwaway operator, reverted)

**Authorization.** Asked which of the two unblock options in §18.5 to take, the user chose (b):
temporarily add a throwaway test operator pubkey to `RELAY_OPERATOR_PUBKEYS`, run the scripted
E2E, then revert. That is the only thing under `../buzz` this pass touched, and it is reverted.

**Exact config change, for the audit trail** (`../buzz/.env` line 107):

| When | `RELAY_OPERATOR_PUBKEYS` |
|---|---|
| Before | `0f61e5e47ca8c4e22c64bab3a1163989a4e3a2d45d014e3d153f1c15b2320029` |
| During the run | `0f61e5e4…320029,0dcc145858a6fdf98cc330e956b26904ae37e942def4a8beda3dd9c4b6b7abb3` (real key kept, throwaway appended) |
| After (now) | `0f61e5e47ca8c4e22c64bab3a1163989a4e3a2d45d014e3d153f1c15b2320029` |

The throwaway keypair was generated for this run only. Its secret was initially hard-coded in the
test file; the P0 pass (§19) removed that — the test now reads it from the `SWF_E2E_OPERATOR_SK`
environment variable and skips the operator blocks when it is unset, so no secret exists in the
repository. The key has no authority anywhere any more. The relay was restarted
after the addition and again after the revert. **Revert verified**: a NIP-98-signed
`GET /operator/communities/availability` from the throwaway key returns **403** on the reverted
relay (identical to any non-operator), and the real key's line is byte-identical to before.

**Harness.** `tests/integration/liveRelay.e2e.spec.ts` gained a second `describe` block (the first,
no-operator block from §18.5 is unchanged and still passes). Run with
`npx vitest run --config vitest.e2e.config.ts` plus the Node-20 `ws` shim in `NODE_OPTIONS`. It
uses the app's real services (`OperatorService`, `ChannelService`, `MessageService`,
`ThreadService`, `ReactionService`, `RelayMembersService`, `RelayConnectionService`) against the
real relay — no mocks. The second identity runs on its **own `RelayConnectionService` instance**
(its own WebSocket + NIP-42 auth), so realtime delivery is genuinely cross-connection. One
test-process-only patch: Node's `dns.lookup` is overridden for `*.localhost` hostnames (Node,
unlike a browser, does not resolve those as loopback on this machine); nothing system-level.
Passed **2/2 twice in a row** (~10.5 s and ~11.1 s).

**What each step actually verified, against the user's TEST list:**

| # | Step | Result | What was actually checked |
|---|---|---|---|
| 1–2 | Operator creates community | PASS | Real NIP-98 `POST /operator/communities` (`create_only:true`, `initial_owner_pubkey`) → 2xx; response `host`/`owner_pubkey` match. Origin subtlety confirmed: the request goes to `RELAY_OPERATOR_API_ORIGIN` (`http://localhost:3000`), the new host is body data. |
| 3 | Owner enters | PASS | Owner's NIP-42 auth on `ws://<new-host>` → `status === "connected"`. |
| 4–7 | Create channel, appears, opens, history loads | PASS | kind:9007 publish → relay-authored kind:39000 discovered by name → `fetchMessages` round-trip. **Real finding:** the relay auto-posts a relay-authored kind:40099 "channel created" system message (`isSystemMessage:true`) on creation, so a fresh channel's history is not literally empty — the "empty" state must mean "no user-authored messages". |
| 9 | Second identity joins | PASS | Owner adds Bob at community level (kind:9030 via `RelayMembersService`, `actingRole:"owner"`) and channel level (kind:9000); Bob's own NIP-42 connection then succeeds. |
| 10–11 | A sends, B receives realtime | PASS | Bob's own live subscription receives Owner's kind:9 by event id, no polling. |
| 12–13 | B replies, A receives realtime | PASS | Bob signs+publishes a NIP-10 reply over his own socket; Owner's live subscription receives it by id. |
| 14 | Thread opens | PASS | `ThreadService.fetchThread(root)` returns the root and Bob's reply with `thread.rootId` resolved. |
| 15 | Mention | PASS (protocol-level) | `mentionPubkeys` → `p` tag → parsed `mentions` contains Bob. The badge itself is UI/local state (unit-tested, §7); not driven live. |
| 16 | Reaction add / remove | PASS, with a **new real finding** | kind:7 add lands and parses (emoji, reactor); kind:5 self-deletion removes it from subsequent REQs. **Finding:** `ReactionService.fetchChannelReactions`'s own filter `{kinds:[7], "#h":[channelId]}` returns **nothing** on this relay build, even though the identical `#h` shape works for kind:9 in the same run. The relay does derive+store the reaction's channel server-side (`handlers/ingest.rs derive_reaction_channel`) and the event is retrievable via bare `{kinds:[7]}` or `#e`. So the live app's reaction *display* is very likely empty today, independent of anything in these passes. Verified here via `#e`; **not fixed** — needs its own investigation of the relay's `#h` matching for kind:7 (added to §18.7). |
| 17 | Older-message pagination | PASS | 4 spaced sends; `fetchMessages(limit 2)` then `fetchOlderMessages(until = oldest.createdAt)` returns strictly older events with zero overlap with the newest page. |
| 18–20 | Disconnect / reconnect / missed message, no dupes | PASS | Bob subscribes, then his **underlying socket is force-closed** (the private `relay.close()`, not the public `disconnect()` which intentionally drops the registry) → real `handleClose → scheduleReconnect` path. Owner sends while Bob is down. Bob's automatic reconnect re-issues the registry's frozen-`since` filter and receives the missed message **exactly once**. This is the §18 mechanism, now empirically confirmed. |
| 21 | Unread | not live-driven | Local-only state (§7), unit-tested; nothing on the relay to drive. |
| 22 | Mention badge | not live-driven | UI over the protocol result from #15. |
| 23 | Agent activity out of timeline | PASS (type-level) | A live kind:24200 publish additionally needs a *registered* agent owned by the recipient (`users.agent_owner_pubkey`; relay rejects otherwise) — standing that up is a separate feature. The exclusion mechanism itself is asserted directly: 24200 ∉ `CHANNEL_TIMELINE_KINDS`. |
| 24 | Responsive | not live-driven | No GUI automation available; §18.3 stands as implemented-not-screenshotted. |

Test data from this run (community `swf-e2e-<timestamp>.localhost:3000`, its channel, members,
messages, reactions) was left in the local DB as evidence, per the established pattern.

---

PHASE 3:
PARTIAL

CHANNEL OPEN BUG:
PASS (root-caused and fixed — see §18.1; `ChannelsView.vue` and the identical bug in `DmView.vue`)

3.1 Channels:
PASS (live: discovery, open, history load against the real relay — §18.8 #4–7)

3.2 Creation:
PASS (live: operator community creation + owner-created channel — §18.8 #1–7)

3.3 Messaging:
PASS (live: two independent connections, send/receive/reply in realtime both directions — §18.8 #10–13)

3.4 Pagination:
PASS (live: `until`-based older page, strictly older, zero overlap — §18.8 #17)

3.4B Reconnect:
PASS (live: forced socket drop → automatic reconnect → missed message recovered exactly once — §18.8 #18–20)

3.6 Reactions:
PASS with a new real finding (live: add and kind:5 removal work at the protocol level via `#e`; but `fetchChannelReactions`'s `#h` query returns nothing on this relay — app reaction display likely empty today, NOT fixed, §18.8 #16 / §18.7 item 1; cross-client realtime removal remains a documented limitation)

3.5 Threads:
PASS (live: root + nested reply resolved via `ThreadService.fetchThread` — §18.8 #14)

3.7 Unread/Mentions:
PASS (mention `p`-tag path live-verified §18.8 #15; unread is local-only state, unit-tested, nothing on the relay to drive)

3.8 Agent Activity:
PASS (kind:24200 excluded from the timeline kinds, asserted; live publish needs a registered agent owner — separate setup, §18.8 #23)

3.9 UI:
PARTIAL (message menu, hover toolbar, jump-to-latest pill, sidebar toggle, z-index cleanup implemented per §18.2; Edit/Delete, Remind-later, full composer toolbar, and a dedicated Inbox view deliberately deferred with reasons, not faked)

RESPONSIVE:
PARTIAL (six-breakpoint CSS/JS implemented per §18.3; not visually verified in a real browser/Tauri window)

ACCESSIBILITY:
PARTIAL (Escape-to-close, focus-visible, aria-live, aria-labels implemented per §18.4; focus trapping and a full keyboard walkthrough not done)

LIVE E2E:
PASS for the scripted protocol flow (§18.8: operator→community→owner→channel→second identity→realtime both ways→thread→reaction add/remove→pagination→forced reconnect, all against the real relay, 2/2 twice). Steps that need a human at the GUI (unread/mention badges, responsive layout) remain unverified live. The temporary throwaway operator key is reverted and the revert is verified (403).

TESTS:
Vitest: 521 passed / 8 failed / 529 total (same 8 pre-existing failures, in a file no pass touched). Live-relay E2E (`vitest.e2e.config.ts`, real relay): 2 passed / 2 total, run twice. typecheck: pass. lint: pass, 0 warnings. build: pass. cargo check (backend + src-tauri): pass. cargo clippy (backend + src-tauri): pass, 0 warnings. cargo test --lib: backend 35/35 pass, src-tauri 57/57 pass.

KNOWN LIMITATIONS:
See §16 (as annotated) and §18.7 for the current punch list. Most consequential, in order: (1) **new** — `ReactionService.fetchChannelReactions`'s `#h`-scoped kind:7 query returns nothing on this relay build, so reaction lists in the running app are very likely empty today (§18.8 #16; not fixed, needs a relay-side investigation); (2) a dedicated Inbox view, message Edit/Delete/admin-delete, "Remind me later", and full composer affordances are deferred, not built, for lack of real backend support (§18.2); (3) modal focus trapping is not yet implemented (§18.4); (4) responsive breakpoints and unread/mention badges are implemented but not verified in a real window.

FILES CHANGED (this pass, live track only — nothing under `../buzz` touched):
`src/views/ChannelsView.vue`, `src/views/DmView.vue`, `src/layouts/AppShell.vue`,
`src/stores/ui.ts`, `src/stores/readState.ts`, `src/components/MessageList.vue`,
`src/components/MessageItem.vue`, `src/components/MessageMenu.vue` (new),
`src/composables/useEscapeKey.ts` (new), `src/features/channels/ui/ChannelHeader.vue`,
`src/features/channels/ui/ChannelMenu.vue`, `src/features/channels/ui/MembersModal.vue`,
`src/features/channels/ui/ChannelDetailsPanel.vue`, `src/features/channels/ui/CreateChannelDialog.vue`,
`src/features/moderation/ui/ReportMessageDialog.vue`, `src/features/communities/ui/CreateCommunityDialog.vue`,
`src/features/identity/ui/IdentityModal.vue`, `src/features/community-members/ui/CommunityManagementModal.vue`,
`src/app/theme/tokens.css` (no new tokens this pass — only consumers of the first pass's `--z-*` scale),
`vite.config.ts` (test exclude for `*.e2e.spec.ts`), `vitest.e2e.config.ts` (new),
`tests/integration/liveRelay.e2e.spec.ts` (new), `docs/PHASE_3_IMPLEMENTATION_AUDIT.md` (this file).

## 19. Third pass — P0 identity switching / sign-out / import hardening, and the reaction `#h` bug

Full design and the Phase A runtime trace: `IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md`. This
section records what changed and what was measured. OLD BUZZ (`../buzz`) was not modified except
the temporary, reverted `RELAY_OPERATOR_PUBKEYS` addition described in 19.5.

### 19.1 Root causes (traced, not guessed — lifecycle doc §0 has the full A–O table)

1. **Un-scoped, never-cleared Vue Query cache.** Keys were global and `queryClient.clear()` was never
   called, so after A→B the app rendered A's cached channels/roster/messages/reactions as B's and
   derived B's "role" from A's cached roster. Plus `ui`/`readState`/`dmReadState`/`agentActivity`/
   `connection` stores were never reset.
2. **Import teardown gated on a signed-in session.** `replaceIdentityLocal` only tore down when
   `session.pubkey` was set — i.e. never on the reported path (sign out first, then import).
3. **"Connected" was treated as "authenticated as X".** Nothing verified whose key signed NIP-42.
4. **Disconnect didn't invalidate an in-flight connect** (generation race) nor the stored URL for a
   pending reconnect timer.
5. **Login wording** presented a retained identity as if still signed in.

### 19.2 Fix (files / mechanisms)

- `src/features/auth/identitySession.ts` (**new**): `endIdentitySession()` (the single teardown),
  `beginIdentitySession()` (tear down → signer → connect → *verify AUTH pubkey* → `relay_members`
  role → optional platform probe → READY), `currentIdentitySessionReport()`, `useIdentitySessionStore`
  (phase for the login progress list).
- `src/features/auth/useAuth.ts`: `logout`, `loginWithLocalIdentity`, `openRelay`,
  `replaceIdentityLocal` now go through the lifecycle; `resolveAccess` writes
  `session.platformRole`; lifecycle phases drive the "Authenticating… → NIP-42/NIP-98 ✓ → Resolving
  permissions… → Ready" list on operator-only paths too.
- `src/services/RelayConnectionService.ts`: records the signed AUTH event's pubkey
  (`connection.authenticatedPubkey`), `isAuthenticatedAs()`, `disconnect()` bumps the connect
  generation and clears the URL.
- `src/stores/session.ts`: `platformRole` + `setPlatformRole` + `isPlatformOperator` getter
  (separate from `communityRole`; both cleared on sign-out). `src/stores/connection.ts`:
  `authenticatedPubkey`, `resetForSignOut`. `src/stores/ui.ts`: `resetForSignOut`.
- `src/app/providers/queryKeys.ts`: every key prefixed `["identity", <pubkey>]`;
  `usePlatformAdmin.ts` uses the new `adminReportsAll()` prefix instead of a literal key.
- `src/views/LoginView.vue`, `ImportAnotherIdentity.vue`, `IdentityImportForm.vue` (`submitLabel`):
  STATE 1 "No identity is active on this device." / STATE 2 "Existing identity found — Continue
  with this identity / Switch / Import another identity" / STATE 3 "Switch identity — Current
  identity: … — ☑ I understand this will switch the active identity — [Switch identity]" /
  post-switch "Identity switched successfully — Current identity: <new>" + progress list.
- `src/layouts/AppSidebar.vue`: footer shows the active pubkey and the two role badges from the
  session store; the mount-time operator re-probe is pubkey-guarded and writes `platformRole`.
- Rust: **no change needed** — `replace_identity` already swaps the signing key atomically and
  archives the old one; the bug was entirely in the webview's session lifecycle.

### 19.3 Reaction `#h` bug (Phase L) — root cause and fix

Reproduced against the live relay with a fresh community: `#e=1  #h=0  bare=1  #h+#e=0`, while the
DB row had `channel_id` set correctly and the relay's `filter_match_one` (buzz-core) explicitly
falls back to `channel_id` for h-less kinds. **The relay is correct.** The drop is in **nostr-tools**:
`Relay.subscribe` re-applies the REQ filters to every incoming EVENT against the event's *literal*
tags (`matchFilters`, relay.ts) and silently discards mismatches — kind:7 carries only an `e` tag,
so every reaction the relay correctly served under `#h` was thrown away client-side, for the initial
fetch and the live subscription alike. Kind:9 worked because it carries a literal `h` tag.

Fixed in the correct layer (SWF client, `RelayConnectionService.issueSubscription`): nostr-tools'
`oninvalidevent` hook receives what it rejected; `matchesAllowingVirtualChannelTag()` re-applies the
relay's own rule — leniency for the `#h` clause **only** when the event has no `h` tag at all, every
other clause (kinds, authors, ids, since/until, `#e`, `#p`) still enforced — and the signature is
verified before delivery. Regression tests: `tests/unit/services/RelayConnectionService.virtualChannelTag.spec.ts`
(rule) and `tests/integration/reactions.e2e.spec.ts` (live: `#h` now returns the reaction and
`fetchChannelReactions` groups it). The stale "bare {kinds:[7]} delivers nothing" comment in
`protocol/reactions.ts` was corrected (bare works; it was never the problem).

### 19.4 Phase M/N (remaining UI, GUI verification) — PARTIAL, plainly

Done this pass: **modal focus trapping** (`src/composables/useFocusTrap.ts`, applied to IdentityModal,
CreateChannelDialog, MembersModal, CreateCommunityDialog, CommunityManagementModal,
ReportMessageDialog — focus enters on open, Tab/Shift+Tab wrap, focus returns to the opener on
close; unit-tested). Not done (unchanged from §18.2/§18.4, no protocol support or out of budget): a
dedicated Inbox view, message edit, own-message delete and admin-delete-others (kind:5 exists but
no receive-side timeline handling), composer attachment/voice/formatting, channel-settings edit
controls beyond the existing panel, member-management beyond `MembersModal`, a full keyboard-tab-order
walkthrough. **Needs the user's eyes** (no GUI automation available to this process): the six
breakpoints (375/390/768/1024/1280/1440), sidebar/channel/DM/thread/mobile-thread/dialog rendering,
the identity modal and the new switch screen, unread/mention badges, no horizontal overflow, and —
specifically for P0 — doing the A→B→A switch in the real desktop window and checking the sidebar
footer badges and the login progress list.

### 19.5 Operator test setup (Phase K) — temporary, reverted, verified

A throwaway keypair was generated outside the repository; its public key
`ff089f46ff08e47bbcb938b66fb6de2584bfc226a71d971ef1164e7d9e4d11f4` was appended to
`RELAY_OPERATOR_PUBKEYS` in `../buzz/.env` **after** the real key (never replacing it), the relay
restarted, the E2E run, then the line restored to exactly
`RELAY_OPERATOR_PUBKEYS=0f61e5e47ca8c4e22c64bab3a1163989a4e3a2d45d014e3d153f1c15b2320029`, the
relay restarted again and confirmed healthy (NIP-11 200; "buzz-relay TCP listening 0.0.0.0:3000").
Verified refused afterwards: with the throwaway secret the operator step fails
`OperatorError: This identity isn't a community operator on this server.`; without it the
operator-dependent E2E blocks are *skipped* by design (`describe.skipIf`). The secret was never
written into the repository (the earlier hard-coded test secret was removed; the test now reads
`SWF_E2E_OPERATOR_SK`), and the scratch file holding it was deleted. Test communities created by the
runs (`swf-p0-*`, `swf-react-*`, `swf-e2e-*`) are left in the local DB as evidence.

### 19.6 Test results (this pass)

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings 0`) | pass, 0 warnings |
| `npm run build` | pass |
| `npm run test` (Vitest, jsdom, Node 20 shim) | **57 files, 548 tests, all pass** (+19 new: identitySession 8, loginView +2, security +2, virtualChannelTag 5, useFocusTrap 2) |
| `cargo check` / `cargo clippy --all-targets -- -D warnings` / `cargo test --lib` — `src-tauri` | pass / pass 0 warnings / **57 passed** |
| same — `backend` | pass / pass 0 warnings / **35 passed** |
| `npx vitest run --config vitest.e2e.config.ts` with the throwaway operator (real relay) | **liveRelay 3/3** (connectivity, full Phase 3 flow, **13-row A→B→A→B→A switching matrix**), **reactions 1/1** |
| same, after revert, no key | 1 passed, 3 skipped (operator blocks skip; connectivity passes) |

### 19.7 Status block

```
PHASE 3: PARTIAL
IDENTITY SWITCHING (P0): PASS — root-caused, fixed, A→B→A→B→A live on the real relay with no restart, AUTH pubkey verified per switch
CHANNEL OPEN BUG: PASS (§18)
3.1 Channels: PASS (live)
3.2 Creation: PASS (live)
3.3 Messaging: PASS (live)
3.4 Pagination: PASS (live)
3.4B Reconnect: PASS (live)
3.5 Threads: PASS (live)
3.6 Reactions: PASS — the #h drop was nostr-tools client-side matching, fixed in RelayConnectionService, live-verified; cross-client realtime *removal* fan-out remains the documented relay limitation (§8)
3.7 Unread/Mentions: PASS (mention path live; unread local-only; badge rendering needs GUI eyes)
3.8 Agent Activity: PASS (type-level)
3.9 UI: PARTIAL (focus trapping added; Inbox/edit/delete/composer affordances still deferred — §19.4)
RESPONSIVE: PARTIAL (implemented, not visually verified)
ACCESSIBILITY: PARTIAL (Escape, focus-visible, aria-live, aria-labels, focus trapping; full keyboard walkthrough not done)
LIVE E2E: PASS for the scripted protocol + switching flows; GUI-only steps unverified
TESTS: Vitest 548/548; live E2E 3/3 + 1/1 (with temporary operator), 1/1 + 3 skipped (reverted); typecheck/lint/build pass; cargo check/clippy/test pass (src-tauri 57, backend 35)
RELAY_OPERATOR_PUBKEYS: reverted to the single real key, relay healthy, throwaway key refused (403)
```

KNOWN LIMITATIONS: (1) realtime fan-out of a reaction *removal* to other open clients is not
provided by the relay (only the kind:7 add is pushed live) — documented, not faked; (2) Inbox,
message edit/delete, admin-delete, composer attachment/voice/formatting, channel-settings edit
controls, member-management beyond `MembersModal` — deferred for lack of real protocol/backend
support or budget; (3) responsive layout, unread/mention badges and the new switch screen are
implemented but not verified in a real window; (4) `dmReadState` is reset per session but its
in-memory map is not pubkey-namespaced (it is never persisted, so no cross-identity leak — noted
for consistency with `readState`); (5) the relay's Moderator platform role has no client probe and
is deliberately not represented.

FILES CHANGED (this pass, live track only — nothing under `../buzz` except the reverted `.env` line):
`src/features/auth/identitySession.ts` (new), `src/features/auth/useAuth.ts`,
`src/services/RelayConnectionService.ts`, `src/stores/session.ts`, `src/stores/connection.ts`,
`src/stores/ui.ts`, `src/app/providers/queryKeys.ts`, `src/features/platform-admin/usePlatformAdmin.ts`,
`src/views/LoginView.vue`, `src/features/onboarding/ui/ImportAnotherIdentity.vue`,
`src/features/onboarding/ui/IdentityImportForm.vue`, `src/layouts/AppSidebar.vue`,
`src/protocol/reactions.ts` (comments), `src/composables/useFocusTrap.ts` (new),
`src/features/identity/ui/IdentityModal.vue`, `src/features/channels/ui/CreateChannelDialog.vue`,
`src/features/channels/ui/MembersModal.vue`, `src/features/communities/ui/CreateCommunityDialog.vue`,
`src/features/community-members/ui/CommunityManagementModal.vue`,
`src/features/moderation/ui/ReportMessageDialog.vue`,
`tests/unit/auth/identitySession.spec.ts` (new), `tests/unit/onboarding/loginView.spec.ts`,
`tests/unit/security/identitySecurity.spec.ts`,
`tests/unit/services/RelayConnectionService.virtualChannelTag.spec.ts` (new),
`tests/unit/composables/useFocusTrap.spec.ts` (new), `tests/integration/liveRelay.e2e.spec.ts`
(secret removed → env var; switching block added), `tests/integration/reactions.e2e.spec.ts` (new),
`docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md` (new), `docs/DECISIONS.md` (D12 appended),
this file (§19).

## 20. Fourth pass — SWF sign-out removes the identity from the device (shared-device policy)

One deliberate policy change on top of §19, which is otherwise untouched: **sign-out = end the
session + securely remove the current identity from this device.** §19's implementation kept OLD
BUZZ semantics (key stays); that is not the desired SWF behaviour on shared/work machines. Full
account in `IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md` (§1 storage matrix, §3a deletion flow and
failure path, §3b warning, §4 login states, §5 npub rule, §15a E2E, §16 difference from OLD BUZZ);
decision `DECISIONS.md` D13. OLD BUZZ source untouched; `../buzz/.env`'s operator line edited for
one E2E run and reverted (§20.5).

### 20.1 Storage audit → Rust `delete_identity`

`src-tauri/src/identity/storage.rs`: `KeyStore` gained `delete()` / `delete_archive(label)`
(`SecureKeyStore` → the existing `secure_store::delete`); `replace_identity` now records each
keyring archive's label in an `identity.archives` manifest (public-key prefixes only — the keyring
cannot be enumerated); new `delete_identity(store, dir, current)` removes the live keyring entry,
`identity.key` if it holds this key (zero-filled, then unlinked), this key's archive + every
manifest-recorded archive + every `identity.previous-*.key` file, the keyring marker and the
manifest, then **re-resolves and only succeeds when no key and no recovery state remain**. Refuses
an environment identity and an empty device; a `corrupt` entry is never wiped blindly. New Tauri
command `delete_identity` (`commands.rs`, registered in `lib.rs`) holds the identity lock for the
whole remove-verify sequence and never returns key material. `backup::recover_keys_from_input`
refuses `npub1…` up front with the exact UI wording.

### 20.2 Webview

`identitySession.ts`: `endIdentitySessionAndRemoveIdentity(remove = deleteIdentity)` = the
§19 teardown, then Rust delete, then `pubkey === null` check; result `{removed}` and
`session.identityRemovalError` (new field, survives `clearSession()`, cleared on a successful
removal or sign-in). `useAuth.logout()` (local mode) and new `removeStoredIdentity()` (retry) use
it; `useSignOut.ts` + `ui/SignOutDialog.vue` gate every Sign-out button (`AppSidebar`, `AppHeader`,
`PlatformAdminView`) behind the exact backup warning for local identities only. `LoginView.vue`:
STATE 1 "No identity is stored on this device." / Import existing identity / Create new identity;
STATE 2 "Identity found on this device."; removal-failed panel with retry. `IdentityImportForm.vue`:
npub refused (message, `role=alert`, submit disabled). `identityApi.ts`: `deleteIdentity()`,
`IDENTITY_REMOVAL_FAILED_MESSAGE`, `NPUB_REJECTED_MESSAGE`.

### 20.3 Tests

Rust `cargo test --lib` src-tauri **65 passed** (+8: seven `delete_*`/shred tests, one npub test);
backend 35 passed. Vitest **58 files / 566 passed / 0 failed** (+18 over §19: `useAuth.spec.ts`
logout-removes / removal-fails / lying-removal / import-after-logout; `identitySession.spec.ts`
sign-out order, failure path, A→delete→B→delete→A, stale AUTH after B; `loginView.spec.ts` STATE 1
after sign-out with B importing, removal-failed + retry, npub rejection, nsec/hex/ncryptsec
forwarding; `signOutDialog.spec.ts` (new) copy/actions/Escape/`useSignOut` gating;
`identityApi.spec.ts` delete wrapper). Full unit run needs both Node-20 shims in `NODE_OPTIONS`
(the `relayConnectionService.spec.ts` integration file uses a real `WebSocket` global that Node 20
lacks — with only the undici shim those 8 fail with `WebSocket is not defined`, an environment
gap, not a regression; with both shims 566/566).

### 20.4 Live E2E — shared-device sign-out (real relay)

`liveRelay.e2e.spec.ts`, new block "shared-device sign-out removes the identity: A → delete → B →
delete → A ×3": **PASS, 1/1 (~12.7 s)**, run once with a temporary throwaway operator. Drives the
app's own `endIdentitySessionAndRemoveIdentity` on the singleton connection; the Rust command is
stood in for by an injected fake device store (records removals, answers `get_identity() = none`)
because the Tauri command needs a desktop process — so the webview orchestration + relay behaviour
were verified live, and the Rust removal by `cargo test` (§20.3). Per-step results are tabulated in
`IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md` §15a; removal ledger `[B, A, B, A, B, A, B]`.

### 20.5 Operator key — before / during / after (auditable)

| | `RELAY_OPERATOR_PUBKEYS` in `../buzz/.env` |
|---|---|
| before | `0f61e5e4…320029` (real key only) |
| during the one E2E run | `0f61e5e4…320029,2dffbd52…14cf` (throwaway *public* key appended; its secret lived only in the test process's environment) |
| after | `0f61e5e4…320029` (real key only) — verified by reading the file |

Two mishaps during the revert, both fixed and worth knowing: (a) Windows PowerShell 5.1's
`Set-Content -Encoding utf8` writes a UTF-8 BOM, which `just`'s env loader rejects ("Failed to load
environment file … line index 0") — the BOM was stripped byte-wise; `.env` is BOM-free; (b) the
relay process started during the temporary phase survived the scripted stop, so it was killed
explicitly, the relay restarted on the reverted file (`buzz-relay TCP listening 0.0.0.0:3000`, no
env-file error), and the revert was then verified **behaviourally through the app's own NIP-98
path**: re-running the operator-dependent E2E block with a *fresh* throwaway key on the restarted
relay fails at step 1 with `OperatorError: This identity isn't a community operator on this server`
(403). A scan of `tests/` and `docs/` for `SWF_E2E_OPERATOR_SK=<hex>`, `nsec1…` or `ncryptsec1…`
values finds nothing; the E2E reads the throwaway secret from the environment only.

### 20.6 Status block

```
PHASE 3: PARTIAL
IDENTITY SWITCHING (P0): PASS (§19, unchanged)
SHARED-DEVICE SIGN-OUT (identity removed): PASS — Rust delete_identity verified by cargo test; webview flow live A→delete→B→delete→A ×3 on the real relay; login STATE 1 after sign-out; failure path never claims success; npub refused
CHANNEL OPEN BUG: PASS
3.1–3.5: PASS (live)
3.6 Reactions: PASS (unchanged; cross-client realtime removal fan-out remains a relay limitation)
3.7 Unread/Mentions: PASS (unchanged)
3.8 Agent Activity: PASS (unchanged)
3.9 UI: PARTIAL (unchanged — Inbox/edit/delete/composer affordances deferred)
RESPONSIVE: PARTIAL (unchanged, not visually verified)
ACCESSIBILITY: PARTIAL (unchanged + SignOutDialog is an alertdialog with focus trap/Escape)
LIVE E2E: PASS for scripted protocol, switching and sign-out-removal flows; GUI-only steps unverified
TESTS: Vitest 58 files / 566 passed / 0 failed; live E2E shared-device 1/1 (temporary operator), revert check fails-as-expected (403); typecheck pass; lint pass 0 warnings; build pass; cargo check/clippy(-D warnings)/fmt --check/test --lib pass — src-tauri 65, backend 35
RELAY_OPERATOR_PUBKEYS: reverted to the single real key, relay healthy on it, throwaway key refused
```

KNOWN LIMITATIONS (this pass): (1) the live E2E verifies the webview orchestration against the
real relay with a stand-in for the Rust `delete_identity` command; the Rust removal itself is
unit-tested against a fake keyring + real temp files, not against the real OS keyring in the live
run (the real keyring holds the user's own identities, which must not be touched) — a human sign-out
in the desktop app is the remaining confirmation; (2) archives created by an app version before the
`identity.archives` manifest are not removed on sign-out (unrecorded → left alone, by design); (3)
a debug-build environment identity (`SWF_BUZZ_PRIVATE_KEY`) cannot be removed by sign-out and is
reported as such; (4) the sign-out dialog and STATE 1 screen are unit-tested, not viewed in a real
window; (5) items carried from §19 unchanged (reaction-removal fan-out, deferred UI, responsive/a11y
visual pass, `dmReadState` namespacing, Moderator role).

FILES CHANGED (this pass, live track only — nothing under `../buzz` except the temporary, reverted
`.env` operator line): `src-tauri/src/identity/storage.rs`, `src-tauri/src/identity/commands.rs`,
`src-tauri/src/identity/backup.rs`, `src-tauri/src/lib.rs`, `src/features/auth/identitySession.ts`,
`src/features/auth/useAuth.ts`, `src/features/auth/useSignOut.ts` (new),
`src/features/auth/ui/SignOutDialog.vue` (new), `src/features/identity/identityApi.ts`,
`src/stores/session.ts`, `src/views/LoginView.vue`, `src/features/onboarding/ui/IdentitySetup.vue`,
`src/features/onboarding/ui/IdentityImportForm.vue`, `src/features/onboarding/ui/ImportAnotherIdentity.vue`,
`src/layouts/AppSidebar.vue`, `src/layouts/AppHeader.vue`, `src/features/platform-admin/ui/PlatformAdminView.vue`;
tests: `tests/unit/auth/useAuth.spec.ts`, `tests/unit/auth/identitySession.spec.ts`,
`tests/unit/auth/signOutDialog.spec.ts` (new), `tests/unit/onboarding/loginView.spec.ts`,
`tests/unit/onboarding/onboardingUi.spec.ts`, `tests/unit/features/identity/identityApi.spec.ts`,
`tests/integration/liveRelay.e2e.spec.ts`; docs: `docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md`,
`docs/DECISIONS.md` (D13 appended; D10/D11/D12 untouched), this file (§20).

## 21. Fifth pass — identity/operator-role diagnostics, create-identity onboarding, capability model

Full account: `PHASE_3_FINAL_IMPLEMENTATION_REPORT.md` (all 20 sections + §1a). Summary of what
changed here, and what it means for Phase 3's status.

**The reported symptom ("operator key imported, member UI appears") was diagnosed, not guessed.**
Part A1 made the runtime observable first: a Rust audit line on every identity state change
(public key only), `OperatorService.probeOperator` returning {status, signerPubkey, error, origin}
instead of a bare boolean, a diagnostics store, and a dev-only panel. The audit line then recorded a
real import on this device deriving to `7e13d4f6…` — the *member* identity, not the configured
operator `0f61e5e4…`. Classification: **pubkey match NO — a key/config fact, not a UI bug**; no
operator was provisioned and the relay was not changed (report §1a, §19).

**Real client defects found and fixed while getting there:**
- a signer/identity mismatch fell through to the member UI; `resolveAccess` now returns an explicit
  `mismatch` decision (error, signer cleared, nothing routed);
- "403", "network failure" and "signed by the wrong key" were indistinguishable — now separate;
- create-identity had no backup checkpoint (generated a key and signed straight in);
- role checks were scattered across components — now one capability model;
- the persisted "last opened community" could be inherited by the next identity.

**Status impact.** 3.1–3.8 unchanged (PASS, live). Identity lifecycle, role isolation and both switch
directions re-verified live ×3 with no restart. Create-identity onboarding is new and unit-tested but
has not been seen in a real window. 3.9 UI, responsive and accessibility remain **PARTIAL** —
unchanged and not upgraded on the strength of this pass.

```
PHASE 3: PARTIAL
Identity lifecycle / role isolation / both switch directions: PASS (live, ×3, no restart)
Signer-mismatch guard: PASS (live)
Create-identity onboarding: PASS (implemented + unit-tested; not GUI-verified)
3.1–3.8: PASS (unchanged)
3.9 UI / RESPONSIVE / ACCESSIBILITY: PARTIAL (unchanged)
LIVE E2E: PASS for scripted protocol, switching, sign-out-removal and role-routing flows; GUI-only steps unverified
TESTS: Vitest 59 files / 581 passed / 0 failed; live E2E 2 files / 6 passed (temporary operator),
       1 passed + 5 skipped by design on the reverted relay; typecheck / lint (0 warnings) / build pass;
       cargo clippy -D warnings clean, cargo test --lib: src-tauri 68, backend 35
RELAY_OPERATOR_PUBKEYS: reverted to the single real key, verified byte-identical; relay healthy
```

