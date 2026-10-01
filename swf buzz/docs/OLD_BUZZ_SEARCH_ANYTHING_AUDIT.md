# Old Buzz "Search Anything" Audit

This audit is read-only and covers `buzz/buzz`. Path prefixes:

- **D** = `buzz/buzz/desktop/src`
- **T** = `buzz/buzz/desktop/src-tauri/src`
- **C** = `buzz/buzz/crates`

All behaviour below comes from reading the source; the app was not run. Where the source does not settle a point, the text says **NOT VERIFIED IN OLD BUZZ SOURCE**.

Related reports: `OLD_BUZZ_INBOX_AUDIT.md` §18 notes that the Inbox has no search of its own. `OLD_BUZZ_SIDEBAR_PROFILE_AUDIT.md` covers where the search trigger sits.

---

## 0. Summary

- **What it is:** one component, **`TopbarSearch`** (D/features/search/ui/TopbarSearch.tsx). It is a **modal Dialog command palette**: `max-w-2xl`, top margin 18vh, `rounded-2xl`. It is not a full-page view and not a dropdown.
- **Two modes in the same dialog:**
  - **Empty query** (fewer than 2 characters globally, or fewer than 1 when scoped): a **suggestions** view with the sections "Recent activity" and "Actions".
  - **Query** (at least the minimum): **grouped search results**.
- **"Search for a channel" is not a separate picker.** It is one frame of an **animated rotating placeholder**: "Search for everything / a channel / a message / a thread / an agent", rotating every 3.2 s (D/features/search/ui/SearchPromptPlaceholder.tsx:4-11, 158). With reduced motion it stays on "Search for everything" (:98-102, 138-147). The input does not change mode as the text rotates.
- **"Create a new agent":** a hard-coded action row in TopbarSearch (:465-473). It is added only because `onCreateAgent` is passed. That handler comes from AppShell as `() => requestOpenCreateAgent()` (D/app/AppShell.tsx:864). It dispatches the window event `buzz:open-create-agent`, which the app-level `RequestedAgentCreateDialogs` answers by opening `AgentDialog mode="definition"` without navigating away (D/features/agents/openCreateAgentEvent.ts:1-23; D/features/agents/ui/RequestedAgentCreateDialogs.tsx:12-67; AppShell.tsx:957).
- **Message search protocol:** Tauri `search_messages` sends HTTP **`POST {relay}/query`** (NIP-98 authenticated), **not** a WS REQ. The filter is:

  ```
  {kinds:[9,40002,45001,45003], search, search_mode:"prefix", limit, #h?, authors?, since?, until?}
  ```

  The relay bridge runs Postgres FTS (`to_tsquery` prefix `:*` on the last token), ranks by `ts_rank_cd DESC, created_at DESC, id`, then re-authorizes and hydrates each hit (T/commands/messages.rs:167-237; T/relay.rs:355-388; C/buzz-relay/src/api/bridge.rs:364-373, 1925-2036; C/buzz-search/src/query.rs:60-67, 145-160, 205-212, 307-311).

---

## 1. Feature support matrix

| Feature | Status | Evidence |
|---|---|---|
| Global search dialog | SUPPORTED | TopbarSearch.tsx:924-997 |
| Cmd/Ctrl+K trigger | SUPPORTED | D/app/useAppShellKeyboardShortcuts.ts:73-77 |
| Sidebar "Search everything" button | SUPPORTED | TopbarSearch.tsx:927-964 |
| Channel-scoped search (Cmd/Ctrl+F, or a scope chip) | SUPPORTED | useAppShellKeyboardShortcuts.ts:67-71; TopbarSearch.tsx:600-627 |
| Message search (channels and DMs) | SUPPORTED | §4 |
| Thread-reply search | PARTIALLY SUPPORTED. Replies are indexed and returned as ordinary kind 9/40002 hits. `threadRootId` is never populated on hits (see §7), so they show as "Message in #x" unless the kind is 45003. | T/nostr_convert.rs:424-453; T/models.rs:234-243; TopbarSearch.tsx:190-199 |
| Channel search | SUPPORTED (local fuzzy, top 5) | D/features/search/useSearchResults.ts:265-301 |
| DM search (as conversations) | SUPPORTED (DM channels appear under "Direct messages") | TopbarSearch.tsx:202-205 |
| People search | SUPPORTED (relay kind-0 search) | useSearchResults.ts:180-188, 331-433 |
| Agent search | SUPPORTED (managed agents, plus relay agents with `respondTo === "anyone"`) | useSearchResults.ts:167-174, 320-330, 385-413 |
| Forum post / comment search | SUPPORTED (kinds 45001/45003) | messages.rs:176-179 |
| File / attachment search | NOT SUPPORTED (no file kind or entity) | messages.rs:176-179; SearchResultItem.tsx:23-34 |
| Search operators `from:` `in:` `after:` `before:` | SUPPORTED | D/features/search/lib/parseSearchOperators.ts:15-37 |
| Recent activity suggestions | SUPPORTED (4 most-recent channels/DMs) | TopbarSearch.tsx:49, 286-318 |
| Recent searches / search history | NOT SUPPORTED (nothing found for recentSearch, searchHistory or similar) | — |
| Result highlighting after navigation | SUPPORTED | §8 |
| Tab key handling | NOT SUPPORTED (no handler) | D/features/search/ui/useSearchMenuKeyboardNavigation.ts |
| Inbox-scoped search | NOT SUPPORTED | OLD_BUZZ_INBOX_AUDIT §18 |

---

## 2. Triggers, shortcuts and components

| Trigger | Effect | Citation |
|---|---|---|
| Sidebar button "Search everything" (`data-testid="open-search"`) | `openSearchDialog(null)` | TopbarSearch.tsx:927-938 |
| **Cmd/Ctrl+K** (not with Shift) | `handleOpenSearch`: bumps `searchFocusRequest` and refetches channels | useAppShellKeyboardShortcuts.ts:73-77; AppShell.tsx:522-525 |
| **Cmd/Ctrl+F**, only when a channel is the current view | Bumps `scopeSearchFocusRequest`, which opens the dialog scoped to the current channel | useAppShellKeyboardShortcuts.ts:67-71; AppShell.tsx:526-529, 678-679; TopbarSearch.tsx:600-610 |

- **Where the shortcuts are disabled:** when Settings is open or in the huddle room (AppShell.tsx:680).
- **Hard-coded kbd hint:** the button shows `⌘K` on every platform (TopbarSearch.tsx:959-961). The shortcut registry lists "Ctrl+K" for Windows, but the button does not use it (D/shared/lib/keyboard-shortcuts.ts:27-31).

**Component tree:**

- `AppSidebarPinnedHeader` → `TopbarSearch` (D/features/sidebar/ui/AppSidebarPinnedHeader.tsx:73-87)
  - `SearchDialogInputRow`: a 48 px input row with a search icon, an optional scope chip, the rotating placeholder and an "ESC" kbd (D/features/search/ui/SearchScopeControls.tsx:37-94)
  - `CurrentChannelSearchAction`: the leading option "Search in #x" or "Search conversation with …" (SearchScopeControls.tsx:104-145)
  - Result rows, rendered inline (TopbarSearch.tsx:655-796)
  - Data comes from `useSearchResults` (D/features/search/useSearchResults.ts) and `useSearchMessagesQuery` (D/features/search/hooks.ts:12-62).

---

## 3. Suggestions view: "Recent activity" and "Actions"

This view is shown when `max(debounced, trimmed).length < minimumQueryLength` and no scope is active (TopbarSearch.tsx:481-483, 502-508, 824-873).

### 3.1 Leading option

If a channel is currently open and no scope is set, the list starts with **"Search in #channel"** (or "Search conversation with {name}"). Selecting it sets the scope; it does not navigate (TopbarSearch.tsx:437, 616-621, 810-823).

### 3.2 "Recent activity"

`getSuggestedSearchResults` (TopbarSearch.tsx:286-318):

- **Source:** `suggestionChannels`. AppSidebar passes `channels={sidebarChannels}`, so these are member, non-archived channels (D/features/sidebar/ui/AppSidebar.tsx:539; AppShell.tsx:266-278).
- **Filter:** `!archivedAt && (isMember || channelType === "dm")`.
- **Sort:**
  1. `lastMessageAt` descending
  2. type rank: dm, then stream, then other
  3. name
- **Count:** **4** (`MAX_SEARCH_SUGGESTIONS`, :49).
- **Timestamp:** a trailing relative time from `lastMessageAt` ("just now", "Xm ago", "Xh ago", "Xd ago", otherwise "Mon D") (:71-112).
- **Preview:** the channel description (empty for DMs) (:121-131).
- **Click:** `onOpenChannel(id)` → `handleSidebarChannelSelect` (navigation) (:546-549; AppShell.tsx:883).
- **Empty state:** "No recent activity yet." (:834).
- **Classification:** recent activity plus navigation. It is not a real search.

### 3.3 "Actions"

TopbarSearch.tsx:442-476 builds these actions; :556-571 handles them.

| Action | Icon | Shown when | Does | Classification |
|---|---|---|---|---|
| **Browse channels** | HashSearch | `onBrowseChannels` passed (always, from AppShell) | Closes the dialog, then `handleOpenBrowseChannels` opens `ChannelBrowserDialog` (type "stream") (D/app/useChannelBrowserDialog.ts:12-19; AppShell.tsx:516-521, 874) | action shortcut |
| **Create a new channel** | Plus | `onCreateChannel` passed | `AppSidebar.handleOpenCreateChannel` → `onCreateChannelOpenChange(true)` → `CreateChannelDialog` (stream) (AppSidebar.tsx:489-496, 532, 234-238) | action shortcut / command |
| **Create a new agent** | Bot | `onCreateAgent` passed | `requestOpenCreateAgent()` → `buzz:open-create-agent` → `AgentDialog` in definition mode (see §0) | action shortcut / command |

Actions run through `openAfterExit`, after the dialog's exit animation (TopbarSearch.tsx:559-569). Actions **appear only in the suggestions view**; they are never mixed into query results. `groupSearchResults` has an "actions" slot (:53-60), but `useSearchResults` never emits actions (useSearchResults.ts:435-451).

---

## 4. Query data flow

```
input onChange → setQuery + selectedIndex=0                        (TopbarSearch.tsx:984-987)
  → debounce 300 ms, only if trimmed.length >= min (2 global / 1 scoped); else debounced=""
                                                                    (useSearchResults.ts:460-474; hooks.ts:5-10)
  → parseSearchOperators(debounced) → {text, from, in, since, until} (useSearchResults.ts:119-122)
  → parallel queries (enabled only while the dialog is open):
       a) messages:  useSearchMessagesQuery(text, {channelId, authors, since, until, limit: 40})
       b) people:    useUserSearchQuery(text, limit 40)            [global only]
       c) fuzzy:     useUserSearchQuery("", allowEmpty, limit 100) [global only, text.length >= 4]
       d) agents:    useManagedAgentsQuery + useRelayAgentsQuery   [global, or for from: resolution]
       e) open-channel directory (non-member open channels)        [global only]
       f) channels:  local fuzzy over (all channels ∪ open directory)
  → transform / merge / rank → group → render
```

### 4.1 Messages (relay FTS)

- **Query hook:**
  - Key: `["search-messages", q, limit, channelId, authors, since, until, unresolvedOperator]`
  - staleTime 30 s, gcTime 5 min (hooks.ts:36-61)
- **Tauri `search_messages`:**
  - Filter built by `build_search_messages_filter`:
    - `kinds: [9, 40002, 45001, 45003]`: stream message, stream message v2, forum post, forum comment (D/shared/constants/kinds.ts:4, 19, 32-33)
    - `search: q.trim()`
    - **`search_mode: "prefix"`**
    - `limit` (default 20, max 500; TopbarSearch passes 40)
    - `#h: [channelId]` when scoped or `in:` resolves
    - `authors` from `from:`
    - `since` / `until` from `after:` / `before:`
  - Citations: T/commands/messages.rs:167-237; tests at T/commands/messages_tests.rs:89-128.
- **Transport:**
  - `query_relay` sends HTTP `POST {api_base}/query` with a NIP-98 `Authorization` header over the JSON array of filters (T/relay.rs:355-388).
  - This is **not** a WS REQ. The Tauri comment says `search_mode` is a bridge-only extension, and that general WS / NIP-50 search stays word-based (messages.rs:181-184).
- **Relay bridge** (C/buzz-relay/src/api/bridge.rs:1925-2036):
  - Channel scope = the `#h` values intersected with the reader's accessible channels, or the community-wide scope.
  - It calls `buzz_search` with the given mode and page, hydrates events by id **in FTS order**, and drops any hit failing `search_hit_accepted` or `event_visible_to_reader`.
  - Results are de-duplicated.
- **Ranking** (C/buzz-search/src/query.rs):
  - Prefix mode = the last token gets `:*`, and earlier tokens must match exactly (:145-160).
  - Order: `ts_rank_cd DESC, created_at DESC, id` (:205-212, 311).
  - Full-text mode uses `websearch_to_tsquery('simple', …)` (:60, 145).
- **Tauri transform:** `score = 1 - idx/total`. `channel_name` is **always None**, and there is **no thread-root field** (T/nostr_convert.rs:424-453; T/models.rs:234-243).
- **Client:** de-duplicates by eventId, and returns no message results if an operator is unresolved (useSearchResults.ts:39-50, 259-264).

### 4.2 People and agents

- **`search_users`** also goes through HTTP `/query`: `{kinds:[0], search, search_mode:"prefix", limit, page}`. Results are ranked server-side by `rank_user_search_results` (T/commands/profile.rs:240-262, 264-335).
- **Candidate merge** (useSearchResults.ts:331-433):
  - Candidates come from user search ∪ fuzzy directory ∪ relay agents (`respondTo === "anyone"` only) ∪ managed agents.
  - Archived identities are skipped.
  - Known agents that are not "eligible" are dropped.
  - Duplicates are merged per pubkey (the agent display name wins).
- **Ranking:** `rankUserCandidatesBySearch` sorts by score, then label, then original order, and slices to 40 (D/features/profile/lib/userCandidateSearch.ts:70-104).
- **Self is excluded** from results (TopbarSearch.tsx:484-492).

### 4.3 Channels

- **Candidates:** channels visible when open or member (archived channels only if member). Global search also merges the non-member open directory, and only after a query exists (useSearchResults.ts:132-142, 272-277).
- **Scoring:** `scoreChannelMatch` on the display label + description and on the raw name. Bands:
  - exact 0
  - prefix 1
  - word-exact 2
  - word-prefix 3
  - substring 4
  - collapsed separators 5
  - subsequence 6
  - one-edit typo 7
  - description 8

  (D/features/channels/lib/channelSearchScore.ts:26-34)
- Sorted by score, then name; the **top 5** are kept (useSearchResults.ts:278-300).

### 4.4 Grouping and rendering

Results are merged as channels, then users, then messages, and grouped into sections in this fixed order:

| Order | Section title | Contains |
|---|---|---|
| 1 | Channels | non-DM channels |
| 2 | Direct messages | DM channels |
| 3 | People | non-agent users |
| 4 | Agents | agent users |
| 5 | Most relevant | message hits |
| 6 | Actions | (never populated by query results) |

Citations: TopbarSearch.tsx:53-60, 202-233, 259-284; useSearchResults.ts:435-451.

**Message row:**
- 32 px author avatar (squircle for agents)
- author label via `resolveUserLabel(preferResolvedSelfLabel)`
- a context line: "Message in #chan", "Thread in #chan" or "Direct message"
- a preview with the query highlighted
- relative time

(TopbarSearch.tsx:655-796, 171-200.) Author profiles come from `useUsersBatchQuery(hit pubkeys)` (useSearchResults.ts:453-458).

**Loading, error and empty states:**
- Loading: a skeleton.
- Error: the error message.
- Empty: "No matches for **q**", or "No messages for **q** in #x" when scoped (TopbarSearch.tsx:874-911).
- Stale results are hidden while the debounced value differs from the typed text (:421-424, 493).

---

## 5. Scoped search (in a channel or DM)

- **Entering scope:** choose "Search in …", or press Cmd/Ctrl+F. The scope shows as a removable chip; Backspace on an empty input removes it (SearchScopeControls.tsx:51-63; useSearchMenuKeyboardNavigation.ts:44-48).
- **Placeholder:** "Search messages".
- **Minimum query length:** 1 (hooks.ts:5-10).
- **Scoped mode** runs only message search: there are no channel, people or agent results, and no suggestions (useSearchResults.ts:160, 266, 332; TopbarSearch.tsx:502-505, 824-825).

---

## 6. Keyboard

| Key | Behaviour | Citation |
|---|---|---|
| ArrowDown / ArrowUp | Move the selection, clamped, then `scrollIntoView({block:"nearest"})` | useSearchMenuKeyboardNavigation.ts:26-40, 50-62 |
| Enter (not while an IME is composing) | Index 0 with a leading scope action activates the scope; otherwise opens the selected result | :64-73 |
| Backspace on an empty query while scoped | Removes the scope | :44-48 |
| Escape | Closes the dialog. This comes from the Radix Dialog `onOpenChange` (not a custom handler); the "ESC" kbd is a visual hint. The reset clears the index and scope. | TopbarSearch.tsx:525-538; SearchScopeControls.tsx:89-91 |
| Tab | No custom handling | — |
| Mouse hover | Sets the selected index | TopbarSearch.tsx:712 |
| Focus | Focuses the input on open; returns focus to the trigger on close | :969-976 |

---

## 7. Result click behaviour

`openResult` closes the dialog, clears the scope and clears the query (TopbarSearch.tsx:540-587).

| Result | Action | Citation |
|---|---|---|
| Channel | `onOpenChannel(id)` → `handleSidebarChannelSelect` | TopbarSearch.tsx:546-549; AppShell.tsx:883 |
| DM (conversation) | Same as channel | same |
| Person | `onOpenDm({pubkeys:[pubkey]})` → `openDmMutation` → `goChannel(dm.id)` (opens or creates the DM) | AppSidebarPinnedHeader.tsx:81; AppShell.tsx:875-881 |
| Agent | **Same as person:** opens a DM with the agent. There is no agent-profile navigation from search. | same |
| Action | See §3.3 | — |
| Message | `onOpenResult(hit, query)` → `openSearchHit` → `openSearchHitWithNavigation` | AppShell.tsx:658-663; D/app/navigation/useAppNavigation.ts:433-456 |

### Message navigation, step by step

1. **Build the highlight state:** `createSearchHighlightNavigation(eventId, query)` produces `{activationId, messageId, query}` (D/app/navigation/searchHighlightNavigation.ts:7-21).
2. **Cache the hit:** it is stored as a synthetic event, max 200 entries (D/app/navigation/searchHitEventCache.ts:3, 22-39).
3. **Resolve the destination** (D/app/navigation/resolveSearchHitDestination.ts:20-73):
   - no `channelId`: nothing happens
   - kind 45001: forum post
   - kind 45003: fetch the event, find its root/parent, and open the forum post with `replyId`
   - otherwise: `{channel, messageId, threadRootId: hit.threadRootId ?? null}`
4. **Navigate:** `goChannel(channelId, {force:true, messageId, threadRootId, searchHighlight})`. This sets route search `?messageId=&threadRootId=`, history state `searchHighlight`, and `resetScroll` (useAppNavigation.ts:270-330; D/app/navigation/searchHitNavigation.ts:59-72).
5. **Load the target:** the channel route passes `targetMessageId` / `targetThreadRootId`. `ChannelRouteScreen` fetches the target event, then its thread root and up to N parent ancestors (D/app/routes/channels.$channelId.tsx:47, 79-87; D/app/routes/ChannelRouteScreen.tsx:62-110).
6. **Locate, scroll and open the thread** (D/features/channels/ui/useChannelRouteTarget.ts:40-53, 95-160):
   - **Root message:** opens its **thread panel** (`setOpenThreadHeadId`).
   - **Reply:** opens the thread head, expands the reply chain, and scrolls the thread to the reply. The main timeline target becomes the root.
7. **Highlight:** `searchMatchingMessageIds` plus `searchQuery` highlight the message and terms in both the timeline and the thread (D/features/channels/ui/useSearchHighlightProps.ts:3-17).

Because the Tauri hit never carries `threadRootId`, step 3 always passes `null`. The thread is recovered in step 5 from the event's tags.

---

## 8. What could be removed or enhanced (fact-based only)

- **Rotating placeholder:** it implies entity-specific modes ("a channel", "an agent") that do not exist. It is cosmetic (SearchPromptPlaceholder.tsx:4-11).
- **Unused "actions" section slot:** it is never filled by query results (TopbarSearch.tsx:53-60; useSearchResults.ts:435-451).
- **Hard-coded `⌘K` kbd:** it is shown on Windows/Linux too (TopbarSearch.tsx:959-961), even though `keysWindows` exists in the registry.
- **`channel_name` and thread root never filled by Tauri** (nostr_convert.rs:443; models.rs:234-243):
  - The "Thread in" label only works for kind 45003.
  - `hit.channelName` is always null; the name comes from the local lookup.
- **Agents cannot be opened as profiles from search;** both people and agents open a DM (AppSidebarPinnedHeader.tsx:81).
- **No recent searches and no file search** (both NOT SUPPORTED).
- **Duplicate label helpers:**
  - `getUserDisplayName` (TopbarSearch.tsx:133-139) and `formatUserResultName` (useSearchResults.ts:35-37) re-implement `resolveUserLabel`.
  - They differ from it: truncated pubkey vs full pubkey vs "You".
  - See OLD_BUZZ_IDENTITY_ACTIVITY_ARCHITECTURE §6.
