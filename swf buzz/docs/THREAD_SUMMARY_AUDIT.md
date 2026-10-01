# Thread Summary — Audit and Fix

**Date:** 2026-09-29 · **Reference:** OLD BUZZ (`../buzz`) · **Live relay:** `wss://buzz.lmdconsulting.com`

## 1. Symptom

After login or reload, messages that have replies showed **no thread row**. The row appeared only
after opening the thread or replying, and disappeared again after the next reload.

## 2. Root cause (verified live, not inferred)

SWF had two sources for a message's thread row, merged in `ChannelsView`:

| Source | What it was | Verified live |
|---|---|---|
| "local" | Replies already in the channel message cache (`buildThreadSummaries`) | Channel history is the relay's **top-level** window (the SWF Project fix), so replies are **not** in that cache on load. They enter it only when a thread is opened (`useThread`) or a reply is sent or arrives live. |
| "relay" | `useThreadSummaries` → WebSocket REQ `{kinds:[39005], "#d":[root ids]}` | **Returns 0 events.** Kind 39005 summaries are not stored events. The relay builds them only inside its HTTP channel window. |

Together: on a fresh load both sources were empty. Opening a thread or replying filled the "local"
one, which is exactly the observed behavior. **DMs** used *only* the dead WebSocket source, so DM
threads never showed a row at all.

**Live evidence** (SWF Project, 50 top-level messages):

| Request | Thread summaries returned |
|---|---|
| WS `{kinds:[39005], "#d":[10 roots that have replies]}` | **0** |
| `POST /query` channel window with `include_summaries:true` | **23** |

## 3. How OLD BUZZ does it (source of truth)

- **History:** the channel window `POST /query` with
  `{#h, kinds, limit, top_level:true, include_summaries:true, include_aux:true}` (desktop
  `commands/channel_window.rs`).
- **Summaries:** the relay adds one **relay-signed kind 39005** per row that has replies (relay
  `api/bridge.rs:644-666`):
  - tags `e`/`d`/`h` = the root id / channel
  - content `{reply_count, descendant_count, last_reply_at, participants:[pubkeys]}`
- **Count shown:** **`descendant_count`**, every reply in the thread including nested ones
  (desktop `messages/lib/threadPanel.ts:400`, `replyCount: summary.descendantCount`).
- **Root/reply identity:** NIP-10 `e` tags. A lone `reply` marker means a direct reply to that
  root; `root` + `reply` means a nested reply. SWF mirrors the relay's resolver exactly
  (`src/protocol/nip10.ts`).
- **Participants:** pubkeys. Stable identity, never display names, so agents such as Poseidon
  (`e70dcd60…`) can't be confused with each other or with people.

## 4. The fix

```text
POST /query channel window (top_level, include_aux, include_summaries)      ← MessageService.fetchChannelWindow
   ├─ rows (kind 9 / 40002 / 40099)          → message cache (unchanged)
   ├─ edits / deletes / reactions            → overlays (unchanged)
   ├─ kind 39006 bounds                      → paging (unchanged)
   └─ kind 39005 summaries (NEW: parsed)     → Thread Index (stores/threadIndex.ts, per channel/DM)
live replies / own replies / opened thread  → message cache
                                                    ↓
mergeThreadSummaries(local replies, Thread Index)  → ChannelsView / DmView → MessageList → ThreadSummaryRow
click row / "Reply in thread"  → the existing ThreadPanel (unchanged; uses its own useThread)
```

- **Thread Index** (`src/stores/threadIndex.ts`):
  - Relay summaries per channel/DM, filled by every history page (first and older, channels and DMs).
  - The newest summary per root wins.
  - Reset on identity/community teardown.
  - Server data only: it's never persisted as authority and never guessed.
- **Merge rule, corrected:** relay count + loaded replies **newer than the relay's
  `last_reply_at`**.
  - The old rule was `max(local, relay)`. After a reload only a new reply is loaded, so
    `max(1, 3)` stayed 3 and **sending a reply didn't move the count**.
  - Replies are deduped by event id in the cache, so duplicate deliveries or subscriptions can't
    double-count.
  - Without a relay timestamp, the larger count is kept, so a stale summary never shrinks what's
    visible.
- **Count:** `descendant_count` is preferred (OLD BUZZ), with `reply_count` as fallback.
- **Participants:** newest local repliers first, then the relay's; unique by pubkey; 3 avatars
  plus **"+N"** for the rest (`participantTotal`).
- **Removed:** `useThreadSummaries.ts` and `ThreadService.fetchSummaries`, the dead WebSocket
  path. That leaves one summary system, no second fetch per visible message, and one fewer
  request per render.

## 5. UI

| Message state | Row |
|---|---|
| No replies | "↳ Reply in thread", **shown on hover / keyboard focus only** (main feed), opens the thread panel |
| 1 reply | `[avatar] 1 reply · Last reply …` |
| 2–3 repliers | `[avatar][avatar][avatar] N replies · Last reply …` |
| > 3 repliers | `[avatar][avatar][avatar] +2 · N replies` |
| Thread open in panel | Row highlighted (existing `open` state) |

- The existing `ThreadSummaryRow` is kept: one button, overlapping avatars, accessible label.
- "Reply in thread" is opt-in via `replyAffordance`, so the thread panel and Inbox detail (which
  also render `MessageItem`) don't show it.
- **Thread panel:** unchanged, and it already meets the brief:
  - "Thread · #channel" heading and reply-count divider
  - composer pinned at the bottom, Escape and Close
  - a different thread replaces the content
  - the channel's `MessageList` stays mounted, so scroll position and composer text are kept

## 6. Files

- **Changed:**
  - `src/protocol/threads.ts` (count field)
  - `src/features/messages/MessageService.ts` (`include_summaries`, parse 39005)
  - `src/features/messages/useChannelMessages.ts`, `src/features/dm/useDmMessages.ts` (fill the index)
  - `src/features/threads/threadSummary.ts` (merge rule, participant total)
  - `src/features/threads/ThreadService.ts` (removed dead method)
  - `src/views/ChannelsView.vue`, `src/views/DmView.vue` (index instead of the dead query)
  - `src/components/ThreadSummaryRow.vue` (+N)
  - `src/components/MessageItem.vue`, `src/components/MessageList.vue` (Reply in thread)
  - `src/features/auth/identitySession.ts` (reset the index on teardown)
- **New:** `src/stores/threadIndex.ts`
- **Removed:** `src/features/threads/useThreadSummaries.ts`
- **Not changed:** ThreadPanel, `useThread`, sending, the relay protocol, the sidebar, Inbox,
  search, huddles.

## 7. Verification

**Live data through the app's own code** (SWF Project, fresh load, no thread opened):
- **Before: 0 of 50** top-level messages showed a thread row. **After: 23 of 50**, matching the
  relay's 23 summaries.
- The "Jira" messages from the report: **3 replies** (participants Poseidon `e70dcd60…`, Devankit
  `1404525f…`), **3 replies** (you `8e428c1c…`, Poseidon), 2 replies, and one long thread with
  131 replies.

**Tests (new / updated):**
- `threadIndex.spec.ts` (7):
  - index per channel, newest summary wins, reset
  - fresh load shows the relay count with no replies loaded
  - +N; singular "1 reply"
  - "Reply in thread" only in the feed, only with no replies, not on replies, opens the thread
- `messagePagination.spec.ts`: the window requests `include_summaries` and parses 39005 (whole-thread count).
- `threads.spec.ts`: `descendant_count` preferred.
- `threadSummary.spec.ts`:
  - after a reload, relay 3 + my new reply = **4**
  - replies the relay already counted aren't counted twice
  - the old "max" expectation corrected from 9 to 11, with the reason
  - `participantTotal` added to one exact-match expectation

Full validation results are in the section below.

## 8. Limitations

1. **Unread thread replies are not indicated.** SWF read state is per channel (NIP-RS channel
   contexts). Thread markers (`thread:<root>`) aren't implemented, and showing an indicator
   without them would be a guess.
2. Summaries refresh with history pages and live replies. There's no separate live summary
   subscription, and OLD BUZZ has none either.
3. "Reply in thread" is hover/focus-revealed rather than always visible, a design choice to keep
   long feeds quiet.
4. Not yet clicked through in the Tauri window (open SWF Project after a restart and look for the
   rows).

## 9. Validation results

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| Unit suite, run 1 / 2 / 3 | **1203/1203 each** (119 files) |
| `cargo check` | PASS |
| `cargo test` | PASS: 78 |
