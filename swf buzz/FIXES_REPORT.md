# SWF Buzz — Profile, Presence & Conversation UX Fixes

**Date:** 2026-09-25 · **Community relay:** `wss://buzz.lmdconsulting.com` (Buzz v0.2.1)
**Reference:** OLD BUZZ source in `../buzz` (desktop client + relay). Every protocol
choice below cites what OLD BUZZ does; nothing was invented.

> **Honesty note.** Automated checks all pass, and the presence protocol was checked
> against the live relay. The **clicks in the Tauri window were not performed by the
> assistant**: it cannot drive the desktop window, and while this work was being done
> the app was signed out twice (log: `identity removed from this device`), so no
> identity was on the device for authenticated checks. Section 11 marks each item
> **NOT RUN** where that applies. Nothing is reported as passing unless it was run.

---

## 1. Profile interaction

| | |
|---|---|
| **Problem** | Clicking a message author's avatar or name did nothing. |
| **Root cause** | `MessageItem.vue` rendered the avatar and name as plain elements with no handler. `ui.openProfile(pubkey)` existed but only member lists and the DM header called it. |
| **Fix** | The avatar and name are now `<button>`s that emit `open-profile(message.authorPubkey)`. `MessageList.vue` forwards it; `ChannelsView.vue`, `DmView.vue` and `ThreadPanel.vue` call `ui.openProfile`. The key is always the **pubkey**, never the display name. |
| **Profile panel** (`UserProfilePanel.vue`) | Avatar (80px) with a presence dot that stays visible · name · status line ("● Online") · **Message / Huddle / Wave** · Info section (Status, Public key, Copy) · fixed header with scrolling body · Escape closes · the panel takes focus when it opens · slide-in animation (turned off when reduced motion is preferred). |
| **Conversation state** | The profile opens in the existing details pane beside the conversation. `MessageList` stays mounted, so closing the profile leaves the channel, scroll position and composer text unchanged. |

## 2. Presence

| | |
|---|---|
| **Problem** | DM statuses looked wrong, and opening a profile made dots disappear. |
| **Root cause 1: dots vanished** | Each `usePresence()` caller ran its own Vue Query snapshot. The snapshot was a WebSocket REQ for kind:20001, but 20001 is **ephemeral and never stored**, so it always came back **empty**. When the profile panel mounted (after the 30 s stale time) it refetched and **replaced everyone's statuses with that empty map**, so every dot disappeared. Each caller also opened its own live subscription. |
| **Root cause 2: DM statuses looked wrong** | DM sidebar rows had **no presence at all**. The dot beside each name was the **unread** marker (computed as "never opened on this device"), which read as a status. |
| **OLD BUZZ behavior** (verified in source) | Publish kind:20001 with `content = online\|away\|offline` and no tags, over the WebSocket only. Heartbeat every 60 s; **away after 10 min without activity**; window blur does **not** mean away. The relay keeps each status in Redis for 180 s and clears it when the last connection closes. **Snapshot** = `POST /query {"kinds":[20001],"authors":[…]}`: the relay answers from Redis with relay-signed kind:20001 events carrying `["p", subject]`, and anyone it omits is offline. **Live** = WS `{kinds:[20001], authors, limit:0}`, trusting **only `event.pubkey`**. Colors: online = green, away = amber, **offline = grey (not red)**. |
| **SWF implementation** | Same protocol, in `protocol/presence.ts` + `PresenceService.ts` (snapshot over the NIP-98-signed HTTP bridge `services/relayBridgeQuery.ts`). **`presenceSync.ts`** is one engine: components declare which pubkeys they show; new ones are snapshotted in batches; **one** live subscription covers them all; everything is re-snapshotted every 60 s and on reconnect. It stops, and forgets everything, only when the identity session ends (`identitySession.ts`). Heartbeat (`usePresenceHeartbeat.ts`): online, or away after 10 min without in-app input. |
| **Single source of truth** | **`stores/presence.ts`** (Pinia): `byPubkey[pubkey] → {status, updatedAt, source}`, read through `statusOf(pubkey)`. `AvatarCircle` takes `pubkey` and reads the store itself, so the sidebar DM rows, message avatars, profile, member lists, member pickers, DM header and your own avatar all show the **same** answer. One `PresenceDot.vue` holds the colors and the hover/screen-reader label ("Online", "Away", "Offline"). |
| **Why grey, not red, for offline** | The request asked for red only if it matched OLD BUZZ. OLD BUZZ uses grey (`bg-muted-foreground/35`), so SWF uses grey. |
| **Live check** | While signed in as `8e428c1c…`, the relay answered SWF's snapshot filter with **22 relay-signed kind:20001 events for the 29 community members** (content = status, `p` = subject), which confirms the format this code parses. |

## 3. Direct Messages

| | |
|---|---|
| **DM resolution** | Unchanged and correct: kind:41010 with one `["p", pubkey]` tag per participant. The relay finds or creates the DM using the SHA-256 of the sorted participants (`buzz-db/src/store/dm.rs:358-390`), so clicking **Message** again returns the **same** DM (`created:false`). SWF does not add a second key scheme. |
| **Duplicate prevention in the UI** | The profile allows one action at a time (`busy`), so double-clicking sends one request. The button shows "Opening…" meanwhile. |
| **Sidebar** | Each DM row shows the other person's avatar with their **presence** dot. Unread now shows as a **bold name**, with "(unread)" for screen readers, instead of a second dot. |

## 4. Huddle

| | |
|---|---|
| **OLD BUZZ behavior** | kind:9007 temporary private stream channel (`ttl 3600`) + kind:48100 `{"ephemeral_channel_id"}` in the DM. **Then Opus audio over the relay's `/huddle/{id}/audio` WebSocket** (microphone capture, Opus encode/decode, NIP-42 handshake). |
| **Decision** | SWF Buzz has no audio client. Publishing 9007/48100 without it would announce a huddle nobody can hear, which is exactly the fake functionality the request ruled out. The **Huddle button is shown but disabled**, with a tooltip and a note: "Huddles aren't available in SWF Buzz yet." |
| **Remaining work** | A real huddle needs the relay audio protocol (see `buzz/desktop/src-tauri/src/huddle/`). |

## 5. Wave

| | |
|---|---|
| **OLD BUZZ behavior** | A **normal kind:9 message** in the 1:1 DM with content `<!-- buzz:wave:v1 -->\n{name} waved at you.`. No special event kind and no separate notification. Recipients see a 👋 card. Only humans can be waved at. |
| **SWF implementation** | `features/dm/wave.ts` builds and parses exactly that format. `useDirectConversation.waveAt()` resolves the same 41010 DM, opens it, and sends the message. `MessageItem` shows the marker as a 👋 card (OLD BUZZ waves display correctly in SWF, and SWF waves in OLD BUZZ). The button shows "Waving…", then "Waved 👋". |

## 6. UI improvements

- **Profile panel:** fixed header, scrolling body, slide-in animation (turned off when reduced motion is preferred), 80px avatar with the dot kept, status line.
- **Presence indicators:** one component, one color set, and a hover/ARIA label everywhere.
- **Loading states:** "Opening…" and "Waving…". Actions are disabled while one is running, so there are no duplicate requests.
- **Accessibility:** the author avatar and name are real buttons with `aria-label` and visible keyboard focus rings; the profile takes focus when it opens; Escape closes it; errors use `role="alert"`.
- **Message hover:** the author name underlines and the avatar dims slightly. Only those two are clickable, not the whole message, so reactions, links, attachments, the menu and threads work as before.
- **Responsive:** the panel uses the existing details pane and its narrow-width drawer behavior. No new layout system.

## 7. Regression protection

The scroll architecture is untouched: `AppShell.vue` keeps `min-height: 0`, and `MessageList.vue` is still the only scroll container. The only changes to `MessageList.vue` are an `open-profile` passthrough and the author buttons inside `MessageItem`. The 9 scroll tests (`messageListScroll.spec.ts`) and the channel-window history tests still pass.

## 8. Tests

| Test | Result |
|---|---|
| TypeScript (`vue-tsc --noEmit`) | **PASS** |
| ESLint (`--max-warnings 0`) | **PASS** |
| Unit tests (vitest) | **PASS**: 1065 tests in 103 files, 18 of them new |
| Rust check (`cargo check`) | **PASS** |
| Rust tests (`cargo test`) | **PASS**: 78 |
| Production build (`vite build`) | **PASS** |
| Tauri manual test | **NOT RUN** (see the note at the top) |

New tests:
- `tests/unit/features/presence/presence.spec.ts` (10): filters and the 20-author cap; snapshot subject comes from `p`; a live event's `p` can't speak for someone else; unknown statuses are ignored; omitted pubkeys are offline; out-of-order live events are ignored; **two avatars of the same pubkey follow one update together**; no guessed dot.
- `tests/unit/features/profile/profileInteractions.spec.ts` (8): **avatar and name both emit the author's pubkey**; the wave format round-trips and renders as a card; **the profile keeps the dot and shows "Online"**; **Message sends one request when double-clicked**; Wave sends OLD BUZZ's exact content to the resolved DM; Huddle is disabled with a reason; Escape closes.

## 9. Manual verification (Tauri window)

**NOT RUN** for: Devankit, Gaurav Sharma, Akshat Kumar Sharma, Sonia Malik, Tanishq Chourasiya, Hardik Khandelwal, Himanshu Sharma, Sanskriti Yadav, Tejas Pushpad…

The assistant cannot click inside the desktop window, and the device had no identity (signed out) when names could have been checked against the relay. The steps to run in the app:

1. Sign in and open *LMD All Members*. Click a message author's **avatar**, then the **name**: the same profile should open, with the dot, name and "Online/Away/Offline".
2. Compare that person's dot in the **sidebar DM list** with the profile: they must match.
3. **Message**: opens the DM. Close the profile and click Message again: the **same** DM opens, with no new entry in the sidebar.
4. **Wave**: the DM shows "👋 {you} waved at you." as a card, and the recipient sees it in OLD BUZZ too.
5. Leave the app idle for 10 min: others see you as **away**. Move the mouse: back to **online**.
6. Close the profile: the channel, scroll position and composer text are unchanged.

## 10. OLD BUZZ compatibility (protocol comparison)

| Operation | OLD BUZZ | SWF Buzz (now) |
|---|---|---|
| Publish presence | kind 20001, content = status, no tags, over WS | same |
| Presence snapshot | `POST /query {kinds:[20001], authors}`, NIP-98 | same |
| Presence live | WS `{kinds:[20001], authors, limit:0}`, trust signer only | same, in chunks of ≤20 authors (relay `max_authors`) |
| Away rule | 10 min idle (OS idle, falling back to in-app input); blur ≠ away | 10 min without in-app input; blur ≠ away |
| Open DM | kind 41010 + `p` tags, relay find-or-create (sent by OLD BUZZ over HTTP POST `/events`) | kind 41010 + `p` tags, same event and dedupe (sent over the WebSocket) |
| Wave | kind 9 in the DM, `<!-- buzz:wave:v1 -->\n{name} waved at you.` | identical |
| Huddle | 9007 + 48100 + relay Opus audio WS | not offered (no audio client) |

## 11. Files changed (this task)

- **New:**
  - `src/stores/presence.ts`
  - `src/features/presence/presenceSync.ts`
  - `src/features/presence/PresenceDot.vue`
  - `src/features/dm/wave.ts`
  - tests: `presence.spec.ts`, `profileInteractions.spec.ts`
- **Changed:**
  - `src/protocol/presence.ts`
  - `src/features/presence/PresenceService.ts`, `usePresenceHeartbeat.ts`
  - `src/components/AvatarCircle.vue`, `MessageItem.vue`, `MessageList.vue`, `ThreadPanel.vue`, `MemberRow.vue`, `MemberList.vue`
  - `src/features/channels/ui/UserProfilePanel.vue`, `ChannelMemberSearchRow.vue`, `MemberPickerRow.vue`
  - `src/features/dm/useDirectConversation.ts`
  - `src/layouts/AppSidebar.vue`, `AppHeader.vue`, `DmParticipantLabel.vue`
  - `src/views/ChannelsView.vue`, `DmView.vue`
  - `src/features/auth/identitySession.ts`
  - `src/services/relayBridgeQuery.ts` (the `BridgeFilter` type was widened)
- **Removed:** `src/features/presence/usePresence.ts` (the per-component query that produced the empty snapshot).

## 12. Root causes

| Issue | Root cause | Fix |
|---|---|---|
| Profile status disappears | Each consumer refetched a snapshot of **ephemeral** events, which is always empty, and replaced the shared cache with it | One Pinia store; the relay's real presence snapshot (`/query` + `authors`); one sync engine |
| Wrong DM statuses | DM rows had no presence; the unread dot looked like a status | Presence avatar per DM row from the store; unread shown as bold |
| Avatar/name don't open profile | No click handler in `MessageItem` | Buttons emit `open-profile(authorPubkey)` |
| Duplicate DM risk | No UI guard against double submits (the relay already deduplicates) | One action at a time in the profile; relay 41010 find-or-create |
| Huddle | No audio client in SWF | Shown, disabled, with the reason given (no fake huddle) |
| Wave | Not implemented | OLD BUZZ's exact kind:9 marker format, sent and rendered |
| Profile state loss | Not an issue: the profile is a side pane, and the conversation stays mounted | Kept; Escape and focus added |
| Scroll regression | Guarded against | Layout and `MessageList` scroll logic unchanged; tests still pass |

## 13. Remaining limitations (actual)

1. **Huddle** is not available (needs the relay's Opus audio protocol).
2. **Away detection** uses in-app input only. OLD BUZZ prefers the OS idle time (`get_os_idle_seconds`), so someone active in another application for 10+ minutes shows as away in SWF but not in OLD BUZZ.
3. **No manual status choice** (OLD BUZZ has auto/away/offline under "Set status").
4. **Tauri click-through (section 9) not yet performed.**
