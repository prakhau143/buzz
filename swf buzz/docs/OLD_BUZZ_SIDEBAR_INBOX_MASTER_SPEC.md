# Sidebar, Read State, Huddles, Search and Inbox — Master Spec

**Date:** 2026-09-28 · **Status:** audit and blueprint only. No code was changed in either repo.

**Evidence** (every OLD BUZZ claim below is cited with file:line in these reports):
- `OLD_BUZZ_SIDEBAR_PROFILE_AUDIT.md`
- `OLD_BUZZ_READ_STATE_AUDIT.md`
- `OLD_BUZZ_HUDDLE_LIFECYCLE_AUDIT.md`
- `OLD_BUZZ_SEARCH_ANYTHING_AUDIT.md`
- `OLD_BUZZ_INBOX_AGENT_SCOPING_AUDIT.md`
- `OLD_BUZZ_IDENTITY_ACTIVITY_ARCHITECTURE.md`

**SWF facts** below come from tracing the SWF source plus read-only queries against the live
relay `wss://buzz.lmdconsulting.com`, as identity `8e428c1c…`.

**Implementation order** (state before UI):
1. Read state
2. Inbox agent scoping
3. Huddle and archived channels
4. Search
5. Sidebar and profile
6. Visual polish

---

## 1. Read / unread persistence (highest priority)

**Current SWF problem.** Read DMs show as unread after a restart.
- *Root cause (verified in code):* `src/stores/dmReadState.ts` is an in-memory Pinia store and is
  never persisted. Its own header says: *"Resets each session… DM unread is honestly
  session-local."*
- The sidebar rule (`AppSidebar.vue` `isUnread`) is
  `conversationId !== active && lastReadAt === 0`. That means "not opened this session", not
  "a message from someone else is newer than what I read". So after every restart, **every DM
  except the open one is unread**, whatever its messages.
- *Second, opposite defect:* channel unread (`stores/readState.ts`) counts only messages that
  arrive **live** (`recordUnseenMessage`). `ensureLoaded()` resets `unreadCounts` to `{}`, and
  nothing compares a channel's newest message with the synced frontier at startup. So messages
  that arrived while the app was closed never show as unread.

**OLD BUZZ behavior.**
- **Storage:**
  - One mechanism for channels **and DMs**: NIP-RS **kind 30078**, `d = read-state:<slot>`,
    `t = read-state`, NIP-44 encrypted to yourself. Content is `{v:1, client_id, contexts:{ctx: unixSec}}`.
  - Context keys are the channel/DM UUID, `thread:<root>` and `msg:<id>`.
  - There's also a localStorage mirror per pubkey.
- **Merge:** grow-only, the maximum per context across clients and slots.
- **Hydration gate:** local hydrate, then relay fetch (7 days), then the live subscription.
  Unread sets are **empty until `isReady`**, so nothing flashes as unread.
- **Catch-up:** after hydration, a Tauri `unread_catch_up` asks each channel/DM for events with
  `since = readAt + 1`.
- **What counts:** only messages **from others**, of kinds 9 / 40002 / forum (plus huddle-start
  in DMs), newer than max(channel, thread, msg) markers. Your own messages never count. Thread
  replies count only for threads you participated in, authored, followed, or were mentioned in.
- **Why a read DM stays read:** opening it calls `markChannelRead(dmId, newest created_at)`,
  which writes localStorage and publishes. On restart it's restored and max-merged before
  `isReady`, and catch-up drops anything at or before `read_at`.
- **Mark unread / forced unread:** local only (`buzz-forced-unread.v1:<pubkey>`).

**Expected SWF behavior.** DMs use the **same** NIP-RS frontier as channels, keyed by the DM
channel UUID. Unread = messages from others newer than the frontier. Nothing is unread before
hydration. Offline arrivals are counted by a startup catch-up.

**Implementation approach.**
1. Retire `dmReadState` as a source of truth. `DmView` and the Inbox call
   `readState.markChannelSeen(dmId, newest)`.
   - SWF's `ReadStateService` already publishes arbitrary context ids.
   - The `dmReadState` "slot allocation" concern is moot: OLD BUZZ uses the same slot for DMs.
2. **Hydration gate:** expose `readState.isReady` (set after `hydrateFromRelay()` settles).
   Sidebar and Inbox show no unread styling until then.
3. **Catch-up:** after `isReady`, for each channel and DM, fetch newest events from others with
   `since = lastSeenAt + 1`. The existing channel window, or one REQ per channel with `limit`,
   both work.
4. **Unread predicate:** author ≠ me AND kind ∈ {9, 40002} AND not a thread reply (or a reply in
   a thread I'm in) AND `created_at > lastSeenAt`.
5. Unit tests: restart simulation (hydrate from storage/relay → no DM unread), offline arrival →
   unread, own message → never unread.

**State flow.**
```text
startup → identity → readState.ensureLoaded (localStorage) → hydrateFromRelay (30078, max-merge)
       → isReady=true → catch-up per channel/DM (since=frontier+1, authors≠me)
       → unread sets → sidebar / Inbox badges
open DM/channel → markChannelSeen(id, newest) → localStorage + publish 30078 (debounced)
```

**Edge cases:**
- Relay unreachable at start: local state is used and `isReady` is still set (OLD BUZZ `.finally`).
- Blob older than 7 days on a fresh device: re-published on every start in OLD BUZZ.
- Identity switch: keys are namespaced by pubkey; teardown already resets the store.

## 2. Inbox agent (Poseidon) scoping

**Current SWF problem (verified live).**
- The Inbox built in the previous task treats every thread reply in the relay's `activity` feed
  as yours. `activity` is **not user-scoped**: it returns all activity in channels you can read.
- In your current feed, **27 thread replies in 2 threads** appear. Their roots were authored by
  Devankit and by **Poseidon (SWF Agent)**. Poseidon wrote 15 of the replies. **None** of them
  mention you, and you replied in neither thread.
- *Root cause:* `src/features/inbox/inboxModel.ts` `buildInboxItems` accepts `activity` rows of
  type `thread` unconditionally.

**OLD BUZZ behavior.**
- **The relay `activity` feed is not used by OLD BUZZ's Inbox at all:** `get_feed` returns
  `activity: []`.
- **An Inbox row exists when any of these holds:**
  - the event p-tags me (the relay's `mentions` feed); or
  - it's an approval addressed to me; or
  - it's a DM or thread reply passing `shouldNotifyForEvent`: broadcast, or p-tags me, or
    top-level in a DM, or its **thread root is one I authored, participated in, or followed**.
    Muted channels and roots are excluded.
- Captured rows are stored per relay and pubkey.
- **Agent ownership plays no part in eligibility.** The "Agents" filter only *narrows* rows
  already in the Inbox to senders in `ownedAgentPubkeys`: your managed agents, plus profiles
  whose NIP-OA owner is you.

**Expected SWF behavior.** A Poseidon reply appears only if it mentions you, is in your DM, or is
in a thread you authored or participated in.

**Implementation approach.**
- In `buildInboxItems`, keep an `activity` row only if at least one holds:
  - it's in a DM channel (`dmChannelIds`)
  - it p-tags me
  - its thread root is in `myThreadRoots` = roots I authored ∪ roots where I have replied
- Build `myThreadRoots` from my own events: a `#h`-scoped or `authors:[me]` query for my recent
  root and reply ids, or my messages already present in the feed and caches.
- **"Followed" threads are NOT SUPPORTED** in SWF (no follow feature). Document it rather than fake it.
- **Agents filter** = sender is an agent I own. SWF has no managed-agent registry. The NIP-OA
  owner tag on the agent's kind 0 profile is the portable source (OLD BUZZ `ownsAuthorAgent`).
  Until that's implemented, keep the current job-kind definition and label it honestly.

**Test cases** (from the scoping report's 18; key ones):
- Poseidon replies in **my** thread → shown.
- Poseidon replies in **Devankit's** thread I never touched → **not shown**.
- Poseidon p-tags me → shown.
- Poseidon DMs me → shown.
- A reply in a thread I replied in once → shown.
- Muted channel → not shown (SWF has no mutes, so N/A).

## 3. Huddle temporary channels

**Current SWF problem.**
- SWF has **no huddle code** (no kinds 48100–48106, no audio).
- Expired huddle backing channels, e.g. *LMD All Members huddle*
  (`["archived","true"]`, `ttl 3600`), **still show in the sidebar**. `AppSidebar.vue` renders
  every channel the relay returns and doesn't filter `archived`.

**OLD BUZZ behavior.**
- **Never deleted, always archived** (`channels.archived_at`; writes then rejected). Server-authoritative:
  - the creator's `end_huddle` or the last human's `leave_huddle` sends 48103, then 9002 `archived=true`;
  - the relay audio handler archives when the room empties;
  - a **relay TTL reaper** runs every 60 s and archives channels past `ttl_deadline`, posting
    40099 `channel_auto_archived` and re-emitting 39000 `archived=true`.
- **Client:** the sidebar hides `archived` channels and always hides huddle backing channels.
- Whether history stays readable after archive is NOT VERIFIED.

**Expected SWF behavior.**
- Archived channels disappear from the sidebar, live, when 39000 `archived=true` arrives.
- No client-side deletion: the relay is the authority, and crash/offline/restart cases are
  handled by the reaper.
- If SWF later starts huddles, it must follow the same lifecycle (9007 with `ttl`, 48100,
  48103 + 9002 archive), which needs the Opus audio client (see `FIXES_REPORT.md`).

**Implementation approach.** Filter `channel.archived` (already parsed) out of the sidebar
channel list, and let the existing live channel subscription update it. Optionally offer
"Show archived".

**Edge cases:**
- **App crash mid-huddle:** the reaper archives it later.
- **User offline at end:** they see 39000 `archived` on the next discovery.
- **Last participant was not the creator:** their archive may be rejected (inferred). The reaper
  covers it.

## 4. Search Anything

**Current SWF problem.**
- SWF has only a "Search messages" overlay (NIP-50, messages).
- The "Search for a channel / Recent activity / Actions" screen in the screenshot is **OLD BUZZ's**
  `TopbarSearch`. It isn't in SWF.

**OLD BUZZ behavior.**
- **Trigger and layout:** `Cmd/Ctrl+K` or the sidebar "Search everything" button opens a modal
  command palette. `Cmd/Ctrl+F` scopes it to the current channel.
- **"Search for a channel" is cosmetic:** one frame of a placeholder rotating every 3.2 s
  (everything / a channel / a message / a thread / an agent).
- **Empty state:**
  - **Recent activity:** the 4 most recently active member channels or DMs, with times.
  - **Actions:** Browse channels, Create a new channel, and **Create a new agent**. That last one
    is a hard-coded row dispatching `buzz:open-create-agent`.
- **Query:**
  - 300 ms debounce, minimum 2 characters, modifiers `from:` / `in:` / `after:` / `before:`.
  - **Messages:** HTTP `POST /query` with
    `{kinds:[9,40002,45001,45003], search, search_mode:"prefix", limit:40, …}`. Ranked by
    `ts_rank_cd`, then recency, with access re-checked by the relay.
  - **People:** kind 0 prefix search.
  - **Agents:** managed agents plus open agents.
  - **Channels:** local fuzzy match, top 5.
- **Sections:** Channels, Direct messages, People, Agents, "Most relevant".
- **Clicks:**
  - channel or DM → open it;
  - person or agent → open a DM;
  - message → channel with `messageId`, thread opened, scrolled, highlighted.
- **Not supported:** recent searches, files.

**Expected SWF behavior.**
- One palette (`Ctrl+K` and a sidebar trigger) with the same sections and **real** results.
- Recent activity kept.
- **"Create a new agent" removed** (SWF has no agent creation). Browse / Create channel only if
  SWF supports them (Create channel: yes; Browse: equivalent to channel discovery).
- Message hits navigate with the Inbox's existing `messageId` / `threadRootId` reveal.

**Implementation approach.**
- Reuse SWF's NIP-50 builder, moved to the HTTP bridge with `search_mode:"prefix"` (as OLD BUZZ).
- Add kind 0 people search and a local channel/DM filter.
- Recent activity = the 4 channels/DMs with the newest messages.
- Keyboard: ↑/↓, Enter, Escape. Debounce 300 ms, minimum 2 characters.

## 5. Sidebar / profile / presence

**Current SWF state.**
- Already done: one presence store (Online green / Away amber / Offline grey), the bottom-left
  profile card with menus, and DM rows with a presence avatar.
- Unread shows as a bold name. Its data is wrong until §1 is fixed.
- Width is AppShell's fixed 260 px.

**OLD BUZZ behavior.**
- **Order:**
  - search button
  - Inbox (badge ≤ 99)
  - nav
  - Starred / custom sections
  - Channels ("+" = Browse)
  - Direct messages
  - footer (unread overflow, huddle control, profile card 32 px)
- **Width:** 300 px default, resizable 220–420, stored in localStorage; `Ctrl+S` collapses it.
- **Sorting:** A–Z by default, or "Recent".
- **Unread:** bold. **DM rows get a count badge**; channels with unread threads get a dot.
- **Presence:** shown on 1:1 DMs. Missing = offline. Your own dot follows local state.

**Expected SWF behavior.**
- Keep the current order and add a count badge on unread DMs.
- Optional later: resizable width and A–Z/Recent sort.
- Presence already matches.

## 6. Identity / activity architecture

**OLD BUZZ:**
- Identity comes from Tauri keys, profiles from a batch kind-0 cache, presence and status from
  their own query caches.
- It has **duplicates**: 4 label helpers, 3 DM-label paths, 2 presence rules, 4 "is agent"
  signals, and 2 ownership definitions.

**SWF, today:**
- **Already centralized:** `session.pubkey`; profiles via `useProfileMap` / `useDisplayName`; one
  Pinia **presence** store plus **status** store keyed by pubkey; `readState`.
- **Remaining split:** `dmReadState` (fixed by §1).

**Recommendation.** Don't import OLD BUZZ's duplicates. Keep one source per concept:
- identity: `session.pubkey`
- names: `useProfileMap`
- presence / status: their stores
- read state: `readState` (channels + DMs + threads)
- activity: Inbox model + search, both reading the same caches

---

## Test plan (implementation phase)

1. **Restart:** read a DM → reload with the relay reachable → still read. The same with the relay
   down: still read, from the local mirror.
2. **Offline arrival:** a message from someone else while the app is closed → unread after start.
   My own message → never unread.
3. **Before hydration:** no unread styling flashes.
4. **Inbox scoping:** the 18 cases from the scoping report (Poseidon in someone else's thread → absent).
5. **Archived:** a channel with 39000 `archived=true` disappears from the sidebar live and after restart.
6. **Search:** `Ctrl+K` opens; 2 characters → results by section; a message hit opens the channel
   with the thread and highlight; Escape closes; no "Create a new agent".
7. **Identity switch:** no read state, Inbox rows or search results cross between pubkeys.

## Premium UI recommendations (SWF design system, not an OLD BUZZ pixel copy)

**Sidebar:**
- 280–300 px (OLD BUZZ 300), resizable 220–420 later.
- 36 px rows, 8 px radius.
- Section labels 11 px, uppercase, 0.04 em tracking, subtle colour.
- 1 px separators between sections only.

**Rows:**
- Channel rows: 🔒/# glyph, name. Unread = semibold + text colour. Selected = tinted surface.
- DM rows: 24 px avatar with presence dot, name, count badge when unread.

**Profile card:** keep the current compact 72 px card (avatar 36 px with dot, name, status or
presence, community).

**Presence:** the existing `PresenceDot` everywhere. Grey means offline, not red (OLD BUZZ semantics).

**Search trigger:** full-width "Search anything… Ctrl K" field at the top of the sidebar,
opening a centered 640 px palette:
- 48 px input
- grouped sections with 12 px headings
- selected row tinted
- footer hints (↑↓ Enter Esc)

**Inbox workspace:** as implemented (list | detail | profile). Add the DM count badge and an
unread-only toggle state.

**Motion:** 120–180 ms opacity and transform only, respecting `prefers-reduced-motion`.

**Themes:** SWF v1 is light-only (`tokens.css`). Use tokens exclusively so a dark palette is a
values-only change.

**Accessibility:**
- visible focus rings
- `aria-current` on the selected row
- the palette as `role=dialog` + `listbox` with `aria-activedescendant`
- badge counts in `aria-label`

**Responsive:** the sidebar becomes a drawer under 768 px (existing); the palette goes
full-width under 480 px.

---

## Final audit summary

| Feature | OLD BUZZ behavior | Source (report) | SWF risk | Recommended implementation |
|---|---|---|---|---|
| Sidebar / Profile | Search → Inbox → nav → sections → Channels → DMs → footer with profile card; 300 px, resizable | SIDEBAR_PROFILE | Low: structure exists | Keep; add DM count badge; resizable later |
| Presence | 20001 via `/query` snapshot + live WS + 60 s poll; missing = offline | SIDEBAR_PROFILE, IDENTITY | Low: already matches | No change |
| Read state | NIP-RS 30078, channels **and DMs**, max-merge, hydration gate, catch-up | READ_STATE | **High**: DMs session-only; offline arrivals missed | Move DMs to `readState`; `isReady` gate; startup catch-up |
| Restart persistence | Local mirror + relay, restored before `isReady` | READ_STATE | **High**: every DM unread after restart | As above; restart tests |
| Huddle cleanup | Relay archives (end/leave/audio/TTL reaper); client hides archived + huddle channels | HUDDLE_LIFECYCLE | Medium: expired huddle channels visible | Filter `archived` in sidebar; never delete on the client |
| Search | Ctrl+K palette; channels/DMs/people/agents/messages; `/query` prefix search | SEARCH_ANYTHING | Medium: SWF has messages only | Build the palette on existing NIP-50 + kind 0 + local lists |
| "Create a new agent" | Hard-coded action row | SEARCH_ANYTHING | n/a: not in SWF | Don't add it (no agent creation in SWF) |
| Inbox | Mentions + approvals (relay) + client-captured DM/thread rows | INBOX_AUDIT, AGENT_SCOPING | **High**: SWF uses unscoped `activity` | Gate `activity` rows by DM / p-tag / my thread roots |
| Agent / Poseidon scoping | Ownership only narrows "Agents"; eligibility = participation | AGENT_SCOPING | **High**: live leak (27 rows) | Participation gate; NIP-OA owner for the Agents filter |
| Identity | Centralized but with duplicates | IDENTITY | Low | Keep SWF's single sources; don't copy duplicates |
| Responsive | 768 px drawer; Inbox single pane under 600 px | SIDEBAR_PROFILE, INBOX_UI_SPEC | Low: matches | No change |
| Accessibility | No arrow keys between sidebar rows; palette keyboard nav | SIDEBAR_PROFILE, SEARCH | Low | Add palette listbox semantics; visible focus |
