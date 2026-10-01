# OLD BUZZ Read-State Audit (source-derived)

Source of truth: `C:\Users\lenovo\New folder (2)\buzz\buzz` (paths below are relative to that root).
Method: static reading of source only; the app was not run. Every claim cites file:line. Anything the source does not settle is marked **NOT VERIFIED IN OLD BUZZ SOURCE**.
Related (not duplicated here): `swf buzz/docs/OLD_BUZZ_INBOX_AUDIT.md`, `OLD_BUZZ_INBOX_AGENT_SCOPING_AUDIT.md`, `OLD_BUZZ_HUDDLE_LIFECYCLE_AUDIT.md`.

Abbreviations: `RS/` = `desktop/src/features/channels/readState/`, `CH/` = `desktop/src/features/channels/`.

---

## 0. Feature matrix

| Feature | Status | Evidence |
|---|---|---|
| Relay-synced read markers (NIP-RS, kind 30078, NIP-44 self-encrypted) | SUPPORTED | `RS/readStateManager.ts:681-742`, `desktop/src/shared/constants/kinds.ts:48` |
| Local persistence of markers (localStorage) | SUPPORTED | `RS/readStateStorage.ts:145-177`, `RS/readStateFormat.ts:64-74` |
| Channel context (`<channelId>`) | SUPPORTED | `CH/useUnreadChannels.ts:319-363` |
| Thread context (`thread:<rootId>`) | SUPPORTED | `desktop/src/app/useChannelActivityProjection.ts:64-71`, `RS/readStateFormat.ts:36,54-57` |
| Per-message context (`msg:<eventId>`) | SUPPORTED | `RS/readStateFormat.ts:35,48-50`, `useChannelActivityProjection.ts:81-88` |
| Hierarchical frontier (thread/msg inherit channel marker) | SUPPORTED (with a caveat, §5) | `RS/readStateManager.ts:53-68`, `CH/unreadChannelCounts.ts:136-149` |
| Grow-only (max) merge across devices | SUPPORTED | `RS/readStateManager.ts:70-109, 346-373` |
| Hydration gate (no unread shown before read state ready) | SUPPORTED | `CH/useUnreadChannels.ts:789-800`, `RS/useReadState.ts:43-47,96-98` |
| Mark read on channel/DM open | SUPPORTED | `CH/ui/useChannelOpenReadState.ts:28-44`, `CH/ui/ChannelScreen.tsx:213-229` |
| Mark read via Esc / mark all read via Shift+Esc | SUPPORTED | `desktop/src/app/useMarkAsReadShortcuts.ts:22-44` |
| Mark all read | SUPPORTED | `CH/useUnreadChannels.ts:909-931`, `desktop/src/app/AppShell.tsx:431-448` |
| Mark unread / forced unread | SUPPORTED, **local only (not synced)** | `CH/forcedUnreadStore.ts:1-21,76-78,151-168` |
| NIP-RS `ov_*` manual-unread override layer (synced unread) | NOT SUPPORTED by desktop client | no `ov_` handling in `RS/*.ts`; forced unread documented as "NOT synced to the relay" `CH/forcedUnreadStore.ts:19-20` |
| DM unread uses same mechanism as channels | SUPPORTED (same code path, DM-specific kinds & counting) | `CH/useUnreadChannels.ts:76-82,431-435,839,873`, `desktop/src-tauri/src/unread_catch_up.rs:169-184` |
| Publish debounce | SUPPORTED (5 s relay, 1 s local) | `RS/readStateManager.ts:31-32, 634-643, 950-957` |
| Failure recovery (fetch/publish failure) | PARTIALLY SUPPORTED (best-effort; retry only on next change/debounce) | `RS/readStateManager.ts:445-449, 738-741, 550-553` |
| Mark community read (inactive community) | SUPPORTED | `desktop/src/features/communities/communityMarkRead.ts:76-130` |

---

## 1. Storage

### 1.1 Relay event (authoritative cross-device state)

- Kind: `KIND_READ_STATE = 30078` (`desktop/src/shared/constants/kinds.ts:48`; relay `crates/buzz-core/src/kind.rs:75`). Note: 30078 is shared with sections/mutes/stars/sort/etc. (`kinds.ts:49-54`), distinguished by d-tag.
- Tags (`RS/readStateManager.ts:695-699`):
  - `["d", "read-state:<slotId>"]`
  - `["t", "read-state"]`
- `slotId` = 16 random bytes hex (32 lowercase hex chars), persisted per pubkey in localStorage `buzz.nip-rs.slot-id:<pubkey>` (`RS/readStateManager.ts:299-301`, `RS/readStateIdentity.ts:11,35-37,13-17`). Rotated if another `client_id` is found squatting on the same d-tag (`RS/readStateManager.ts:500-511`).
- Extra slots (multi-slot split when channel keys exceed 32 KB): up to 8 slots (`RS/readStateFormat.ts:22,28`), ids persisted at `buzz.nip-rs.extra-slot-ids:<pubkey>` (`RS/readStateFormat.ts:118-120`). Collapsing back to one slot deletes extras with kind 5 `a`-tag deletes (`RS/readStateManager.ts:780-805`).
- Content: NIP-44 ciphertext produced by `nip44EncryptToSelf(JSON.stringify(blob))` (`RS/readStateManager.ts:691-693`). The conversation key is user privkey + own pubkey, as NIP-RS specifies (`docs/nips/NIP-RS.md:80`).
- Plaintext (`RS/readStateFormat.ts:1-5`, `RS/readStateManager.ts:685-689`):
  ```json
  { "v": 1, "client_id": "<uuid, persisted>", "contexts": { "<contextId>": <unix seconds> } }
  ```
  `client_id` = `crypto.randomUUID()` persisted at `buzz.nip-rs.client-id:<pubkey>` (`RS/readStateManager.ts:296-298`, `RS/readStateIdentity.ts:10,31-33`).
- `created_at` = `max(now, maxFetchedCreatedAt + 1)`, so it always increases (`RS/readStateManager.ts:701-704`).
- Plaintext budget is 32,768 bytes. When over budget, the oldest `msg:` entries are evicted first, then the oldest `thread:` entries. Channel keys are never evicted (`RS/readStateManager.ts:222-269, 842-873`).
- Relay side:
  - 30078 needs the `UsersWrite` scope (`crates/buzz-relay/src/handlers/ingest.rs:441-445`).
  - It is a "global-only" kind, so a stray `h` tag can't scope it to a channel (`ingest.rs:626-632`).
  - It is stored as a parameterized-replaceable row keyed by `(community_id, kind, pubkey, d_tag)`. NIP-RS coordinates (`read-state:` + 32 lowercase hex, exactly one `t=read-state`) get hard-deleted when superseded, plus a watermark (`crates/buzz-db/src/store/replaceable.rs:151-167, 169-192`).
  - The relay does not interpret the content.

### 1.2 Context key formats

| Context | Key | Written by |
|---|---|---|
| Channel / DM | raw channel UUID (`channel.id`) | `markChannelRead(channelId, …)` `CH/useUnreadChannels.ts:319-349` |
| Thread | `thread:<64-hex root id>` | `markThreadRead` `useChannelActivityProjection.ts:64-71` |
| Message (reply) | `msg:<64-hex event id>` | `markMessageRead` `useChannelActivityProjection.ts:81-88`; thread open marks each revealed reply `CH/ui/useChannelUnreadState.ts:273-280, 431-441` |

Validation on receive (`RS/readStateSnapshot.ts:18-55`, `RS/readStateFormat.ts:82-116`):
- the author must equal self;
- there must be exactly one `d` tag, starting with `read-state:`, with a slot of ≤64 ASCII characters;
- there must be exactly one `t=read-state`;
- `v === 1`;
- `client_id` must be 1-64 characters;
- there must be ≤10,000 contexts.

Individual entries are dropped if their key is over 256 bytes or their value is not an integer in 0..2^32-1.

### 1.3 localStorage (per device)

All keys are **scoped by pubkey only, not by community/relay** (`RS/readStateFormat.ts:64-74,118-120`, `RS/readStateIdentity.ts:31-37`):

| Key | Content |
|---|---|
| `buzz.channel-read-state.v2:<pubkey>` | `{ contextId: ISO-8601 string }` (`RS/readStateStorage.ts:145-161`) |
| `buzz.channel-read-state.publishable.v1:<pubkey>` | array of context ids allowed to be published (`RS/readStateStorage.ts:162-165`) |
| `buzz.channel-read-state.source-created-at.v1:<pubkey>` | `{ contextId: created_at of blob that set it }` (`RS/readStateStorage.ts:167-176`) |
| `buzz.nip-rs.client-id:<pubkey>`, `buzz.nip-rs.slot-id:<pubkey>`, `buzz.nip-rs.extra-slot-ids:<pubkey>` | identity/slots |
| `buzz-forced-unread.v1:<pubkey>` | forced-unread map (§7) (`CH/forcedUnreadStore.ts:76-78`) |
| `buzz-thread-participation.v1`, `buzz-thread-authored.v1`, `buzz-thread-mentioned.v1`, `buzz-thread-muted.v1` (per pubkey) | thread membership sets gating thread-reply unread (`CH/unreadMembership.ts:5-10`) |
| `buzz-observed-unread.v1:<relay>:<pubkey>` | legacy/fallback observed-event cache (`CH/observedUnreadStorage.ts:15,36`) |

Local pruning happens on every write (`RS/readStateStorage.ts:119-143`):
- `msg:`/`thread:` markers older than 7 days are dropped;
- the survivors are capped at 1,000;
- **channel keys are never pruned**. The code comment says why: "losing one would resurrect the channel's unread badge" (`RS/readStateStorage.ts:112-117`).

### 1.4 Native SQLite (Tauri): observed-unread read model

- File: `<app_data_dir>/observed-unread.db` (`desktop/src-tauri/src/observed_unread.rs:170-176`).
- Tables: `observed_events`, `channel_latest`, `read_markers(scope, context_id, read_at)` and `unread_membership` (`observed_unread.rs:185-205`).
- Scope key = `lowercase(pubkey):relay_url(no trailing /)` (`observed_unread.rs:42-56`).
- Pruning: 7-day horizon, at most 1,000 per channel and 5,000 globally (`observed_unread.rs:24-27, 317-327`).
- This is **not** the source of truth for read state. It stores observed candidate *unread evidence* (external trigger events) plus a mirror of markers pushed by `syncMarkers` (`CH/useObservedUnreadPersistence.ts:499-523`). The renderer computes the per-channel projection natively (`observed_unread.rs:333-411`). If native open fails, it falls back to localStorage `buzz-observed-unread.v1` (`CH/useObservedUnreadPersistence.ts:477-491`).

---

## 2. Identity scoping

- Read-state manager instance: created per `(pubkey, relayClient)` and destroyed on change (`RS/useReadState.ts:31-55`). `useUnreadChannels` receives the active community's `relayClient` and `relayUrl` (`desktop/src/app/AppShell.tsx:392-408`).
- Relay copy: per `community_id` + pubkey + d-tag (`replaceable.rs:169-176`). Each community relay therefore holds its own blob.
- Local copy: **per pubkey only** (§1.3). The same localStorage map is hydrated whatever the active community. Channel UUIDs are unique, so this is harmless for lookup. Derived consequence (not stated in the source): a blob published to community B may contain channel keys from community A that were marked publishable earlier. **NOT VERIFIED IN OLD BUZZ SOURCE** whether this was intended.
- Observed-unread evidence and thread activity: per `pubkey + relayUrl` (`observed_unread.rs:42-56`, `CH/threadActivityStorage.ts:14-20`).
- Inactive communities: `communityUnreadObserver` fetches that relay's 30078 blobs, merges them, and computes a rail dot (`desktop/src/features/communities/communityUnreadObserver.ts:179-260`).

---

## 3. Full lifecycle

### 3.1 Message received (live)
1. `useLiveChannelUpdates.handleIncomingMessage` resolves the channel from the `h` tag (`CH/useLiveChannelUpdates.ts:232-243`).
2. A trigger kind is required:
   - channels: `CHANNEL_MESSAGE_EVENT_KINDS` = stream message (v1/v2), forum post, forum comment (`CH/useLiveChannelUpdates.ts:82,86-90`, `kinds.ts:91-96`);
   - DMs: those kinds plus `KIND_HUDDLE_STARTED` (`CH/isDmNotifiableKind.ts:6-9`).

   Reactions, edits and system messages are not triggers (`CH/useLiveChannelUpdates.ts:268-271`).
3. **Self-authored** trigger events go to `onSelfChannelMessage` only. They record participation/authorship and never become unread evidence (`CH/useLiveChannelUpdates.ts:258-275`, `CH/useUnreadChannels.ts:486-517`).
4. External events that pass `shouldNotifyForEvent` go to `onChannelMessage`, which calls `handleChannelMessage` (`CH/useLiveChannelUpdates.ts:290-313`). For thread replies, `shouldNotify` requires participation, authorship, a follow, or a mention (see the Rust twin, `unread_catch_up.rs:400-438`).
5. `handleChannelMessage` records an `ObservedUnreadEvent {id, createdAt, rootId, highPriority, countsTowardBadge, countsTowardAppBadge}` and advances `latestByChannel` (`CH/useUnreadChannels.ts:425-484`, `CH/unreadChannelCounts.ts:12-30`). In native mode it is queued to SQLite with a 1 s coalesce (`CH/useObservedUnreadPersistence.ts:546-557`).

### 3.2 Unread computed
`rawUnread` memo (`CH/useUnreadChannels.ts:789-893`):
- **Gate**: if `!isReadStateReady || !observedPersistence.isScopeLoaded()`, the result is empty sets and count 0 (`:792-800`).
- The active channel is skipped unless it is forced unread (`:813`).
- An event is unread when `readAt === null || event.createdAt > readAt` (`CH/unreadChannelCounts.ts:68-79`), where `readAt = max(channel marker, msg:<id> own marker, thread:<root> own marker)` (`CH/unreadChannelCounts.ts:136-149`, `CH/useUnreadChannels.ts:818-825`). The native projection uses the same rule, skipping `created <= read_at` (`observed_unread.rs:385-391`).
- The count is the number of retained external observed events that are still unread (`:830-834`). A forced-unread channel with count 0 still gets the dot, and DMs get count 1 (`:835-842`).
- High-priority: every DM, or any unread mention/broadcast/relevant thread reply (`:870-875`).
- The app badge counts DM events plus non-thread high-priority events (`CH/unreadChannelCounts.ts:27-28`, `:855-868`).
- Sidebar DM rows show `UnreadCountBadge` with `max(count,1)` when unread and not the active DM (`desktop/src/features/sidebar/ui/SidebarSection.tsx:489-501`).

### 3.3 Conversation opened → mark read
- `ChannelScreen` computes `activeReadAt` = `created_at` of the **newest top-level message (any author)** in the loaded timeline (`CH/ui/ChannelScreen.tsx:213-224`).
- `useChannelOpenReadState` calls `markChannelRead(channelId, activeReadAt, {topLevelOnly: true})` whenever the channel or `activeReadAt` changes and the user is a member (`CH/ui/useChannelOpenReadState.ts:28-44`). While a channel stays open, each newly loaded top-level message re-advances the marker.
- `markChannelRead` (`CH/useUnreadChannels.ts:319-363`):
  1. It clears forced-unread unless `preserveForcedUnread` is set.
  2. `markAt = max(callerReadAt, observedLatest)`. `observedLatest` is ignored when `topLevelOnly`, so replies newer than the newest top-level message stay unread (`:98-120, 341-347`, NIP-RS write discipline `docs/nips/NIP-RS.md:214-226`).
  3. It calls `markContextRead(channelId, markAt)` and then `syncMarkers` into the native model.
  4. On an explicit (non-topLevelOnly) read that covers the observed latest, it drops the observed events for the channel.
- Opening a thread marks each revealed reply `msg:<id>` = its `created_at` (`CH/ui/useChannelUnreadState.ts:273-280`).

### 3.4 Persisted
`ReadStateManager.markContextRead` → `advanceContext` (`RS/readStateManager.ts:334-373`):
- If `ts <= current`, nothing happens (grow-only). The one exception: if the context was not yet publishable, it is marked publishable and a publish is scheduled.
- Otherwise:
  1. `effectiveState.set`;
  2. `persistLocalState()`, a 1 s coalesced localStorage write;
  3. `notifyListeners()` bumps `readStateVersion` and rerenders badges;
  4. `schedulePublish()`, a **5 s trailing debounce** (`:31,634-643`).
- `publish()` (`:645-675`) does this in order:
  1. read-before-write: `fetchOwnBlobBeforePublish` fetches the own d-tags and max-merges them (`:807-828`);
  2. flushes localStorage;
  3. builds the budgeted contexts;
  4. skips if identical to the last published blob;
  5. encrypts, signs and publishes (`:681-742`).
- Local flush is forced on `pagehide` and on `visibilitychange→hidden` (`:303-304, 959-971`). On `destroy()` the local state is flushed and **a pending debounced publish is fired immediately** (`:411-433`).

### 3.5 App closes
- localStorage is at most ~1 s stale and is flushed on pagehide/hidden (`RS/readStateManager.ts:959-971`).
- If the app is killed within the 5 s relay debounce, the relay copy may be missing the latest advance. The localStorage copy still has it. Whether `destroy()` runs on a Tauri window close is **NOT VERIFIED IN OLD BUZZ SOURCE**, because the manager is destroyed only in the React effect cleanup at `RS/useReadState.ts:49-54`.
- The native observed store flushes on pagehide (`CH/useObservedUnreadPersistence.ts:421-428`).

### 3.6 App restarts → state restored → unread recomputed (hydration order)
1. **Identity**: `useReadState` does nothing until `pubkey` and `relayClient` exist. Until then it returns `isReady:false` and no-op getters (`RS/useReadState.ts:31-33,100-111`).
2. **Manager construction**: loads `client_id`, `slot_id` and extra slots from localStorage (`RS/readStateManager.ts:293-305`).
3. `initialize()` (`RS/readStateManager.ts:307-332`):
   1. `hydrateFromLocalStorage()`: markers, publishable ids and source-created-at, synchronously (`:936-948`);
   2. `await fetchAndMerge()`: REQ `{kinds:[30078], authors:[me], "#t":["read-state"], since: now-7d, limit:500}`, then max-merge, persist and notify (`:435-454`, `RS/readStateFormat.ts:8-9`). On fetch error it continues with local state only (`:445-449`);
   3. `await startLiveSubscription()` on the same filter without `since` (`:531-554`). Incoming blobs from other devices are max-merged, and the manager re-publishes to converge (`:556-616`). Its own echoes are dropped by id (`:564-569`);
   4. schedules a publish if the current contexts differ from the last published blob (`:319-325`). Consequence: if the relay blob fell outside the 7-day fetch window, `lastPublishedContexts` is empty, so the client re-publishes and refreshes the blob's `created_at`.
4. `initialize().finally(...)` sets `initializedPubkey`, so **`isReady` becomes true after the relay fetch has finished (success or failure)** (`RS/useReadState.ts:43-47,96-98`).
5. The observed-unread scope opens (native SQLite snapshot, or localStorage fallback) and sets `scopeLoadedRef` (`CH/useObservedUnreadPersistence.ts:433-497`).
6. **Catch-up** runs only when `isReadStateReady` (`CH/useUnreadChannels.ts:623-626`). The Tauri command `unread_catch_up` sends one REQ per channel: `{kinds, "#h":[channelId], since: readAt+1 (or 0), limit:1000}` (`desktop/src-tauri/src/unread_catch_up.rs:160-190`). `readAt` is the hydrated effective marker (`CH/useUnreadChannels.ts:664`). It classifies the results like this (`unread_catch_up.rs:239-366`):
   - self-authored events discover participation/authorship only;
   - events with `created_at <= read_at` are dropped;
   - a thread reply is dropped unless the user participated, authored, followed or was mentioned;
   - survivors are returned as observed events and `maxTrigger`.
7. **Badges**: the `rawUnread` memo evaluates once both gates are open (§3.2).

### 3.7 What the UI shows before hydration
**Nothing is unread.** Before `isReadStateReady` and the observed scope are loaded, `rawUnread` returns empty sets and zero counts (`CH/useUnreadChannels.ts:792-800`). The catch-up REQ doesn't start either (`:624`). There is no "unread until relay state arrives" window: the gate is an explicit **hydrated gate**. The flip side is that badges appear only after the 30078 relay fetch resolves or fails. Whether `fetchEvents` has a timeout is **NOT VERIFIED IN OLD BUZZ SOURCE** in this audit.

---

## 4. Reconciliation / merge rules
- Per context, the merged value is `max(local, every fetched blob)`. It only grows (`RS/readStateManager.ts:70-109`; `advanceContext` rejects `ts <= current`, `:352-362`).
- Blobs from **every** client_id and slot are merged; the client is not "last writer wins" (`:456-499`; NIP-RS requirement noted at `:459`).
- Own-slot blobs are unioned into `lastPublishedContexts` to suppress no-op republishes (`:513-528`).
- Remote advances are queued in `pendingSyncedAdvances` and drained into the native marker mirror. A remote advance of a channel marker also **clears forced-unread** for that channel (`CH/useUnreadChannels.ts:267-285`).
- Retrograde state ("unread again") cannot be synced. Forced-unread is local only (§7).

## 5. Hierarchical rule and its caveat
- `effective(ctx) = max(own, effective(parent))`, where the parent comes from a resolver that the active `ChannelScreen` installs (`RS/readStateManager.ts:53-68, 400-402`, `CH/ui/ChannelScreen.tsx:229+`).
- The sidebar scan uses **own** thread/msg markers and takes the max with the channel marker per event (`CH/unreadChannelCounts.ts:136-149`). It deliberately avoids `getEffectiveTimestamp` for threads in background channels (`RS/readStateManager.ts:383-393`).

## 6. DM unread specifically
- DMs are channels with `channelType === "dm"` and go through the same `useUnreadChannels` / `ReadStateManager` path, keyed by the DM channel UUID.
- DM-specific differences:
  - catch-up kinds add `KIND_HUDDLE_STARTED` (`unread_catch_up.rs:169-176`, `CH/useUnreadChannels.ts:76-82`);
  - every DM event is high-priority and counts toward the badge and the app badge (`CH/useUnreadChannels.ts:431-435,873`, `CH/unreadChannelCounts.ts:20-29`);
  - forced-unread DMs show count 1 (`CH/useUnreadChannels.ts:839`);
  - the sidebar count badge is DM-only (`SidebarSection.tsx:489-501`).

### Why a read DM stays read after restart (precise chain)
1. Opening the DM calls `markChannelRead(dmId, newestTopLevelCreatedAt)` → `markContextRead`. This writes `effectiveState[dmId]`, flushes to `buzz.channel-read-state.v2:<pubkey>` within 1 s (or immediately on pagehide/hidden), and publishes a NIP-44 30078 blob within 5 s (`CH/ui/useChannelOpenReadState.ts:36`, `RS/readStateManager.ts:334-373, 950-971, 634-643`).
2. Channel keys (including DM ids) are **never pruned** locally (`RS/readStateStorage.ts:112-143`) and never evicted from the blob (`RS/readStateManager.ts:222-269`).
3. On restart, the marker is restored **before** any unread evaluation: first synchronously from localStorage, then max-merged with the relay blob (`RS/readStateManager.ts:313-315`). `isReady` stays false until that finishes, and the badge memo and catch-up are both gated on `isReady` (`CH/useUnreadChannels.ts:624,792`).
4. The catch-up asks the relay only for events with `since = readAt + 1` (`unread_catch_up.rs:188`) and drops anything `<= read_at` (`:283-287`). So old DM messages are never re-fetched as unread evidence.
5. Persisted observed evidence (SQLite/localStorage) is re-evaluated against the markers. Events with `created <= read_at` are skipped (`observed_unread.rs:385-391`; fallback `pruneObservedUnreadByMarkers`, `CH/useObservedUnreadPersistence.ts:529-544`).
6. The user's own DM messages never become evidence (`CH/useLiveChannelUpdates.ts:272-275`, `unread_catch_up.rs:283`).

Failure edges (derived):
- **Fresh device, or cleared localStorage, and the blob `created_at` is older than 7 days.** The marker is not fetched (`since` horizon, `RS/readStateManager.ts:442`), so catch-up runs with `since: 0` and old DM messages (up to 1,000) can appear unread. This is mitigated because every start re-publishes when the contexts differ from the last published blob (`:319-325`), which keeps active users' blobs inside the horizon.
- **App killed within 5 s of reading, before the publish.** The local copy holds the marker. Other devices won't see it until this device next publishes.

## 7. Mark read / mark all / mark unread / forced unread
- **Mark read (explicit: Esc, sidebar, Home):** `markChannelRead(id, lastMessageAt)` without `topLevelOnly` folds in the observed latest and clears observed evidence (`CH/useUnreadChannels.ts:319-363`, `desktop/src/app/useMarkAsReadShortcuts.ts:41-44`).
- **Mark all read (Shift+Esc, menu):** for every currently unread channel, it clears forced-unread and marks at `observedLatest ?? currentMarker`, then `clearAll()` on observed evidence (`CH/useUnreadChannels.ts:909-931`). AppShell also marks the active channel and undoes Home feed-item unread overrides (`AppShell.tsx:431-448`).
- **Mark community read (inactive community):** publishes blobs that set every channel to `now`, in separate slots persisted per `pubkey:relayUrl:index` (`communityMarkRead.ts:76-117`).
- **Mark unread / forced unread:** `markChannelUnread(channelId, source)` stores `{markerAtWhenForced, sources:["manual"|"inbox"]}` in `buzz-forced-unread.v1:<pubkey>`, capped at 500 entries (`CH/forcedUnreadStore.ts:23-85,151-168`).
  - It is **not synced**: NIP-RS markers are monotonic (`CH/forcedUnreadStore.ts:19-20`).
  - It is cleared by opening or explicitly reading the channel (`CH/useUnreadChannels.ts:331-340`), or by a synced remote advance of that channel's marker (`:267-285`).
  - The rail observer ignores a forced entry once the synced marker passes `markerAtWhenForced` (`communityUnreadObserver.ts:241-251`).
  - Per-message forced unread lives in a session ref (`CH/ui/useChannelUnreadState.ts:447-459`).
  - The source does not settle whether forced unread survives on other devices; per the code it does not.
- **Home inbox rows:** local `buzz-home-feed-done.v1:<pubkey>` / `buzz-home-feed-unread.v1:<pubkey>` overrides, plus NIP-RS marker projection (`desktop/src/features/home/useFeedItemState.ts:3-12`, `desktop/src/features/home/useHomeInboxReadState.ts:10-52`).

## 8. What counts as unread
- Only **external** events (author ≠ me) of trigger kinds (§3.1). System messages, reactions and edits are excluded (`CH/useLiveChannelUpdates.ts:268-275`).
- Top-level messages in a channel always count. Thread replies count only when the user participated, authored the root, followed it, or was mentioned (`unread_catch_up.rs:400-438`). Muted channels and muted threads are suppressed.
- The event must be newer than `max(channel, thread:<root>, msg:<id>)` (`CH/unreadChannelCounts.ts:136-149`).
- Huddle backing channels are excluded from the sidebar channel list fed to unread (`AppShell.tsx:266-274,392-394`).

### Channel whose newest message is the user's own
- Own messages are never unread evidence (`CH/useLiveChannelUpdates.ts:272-275`; `unread_catch_up.rs:283`), so an own message never *creates* unread.
- It does **not by itself mark the channel read** either. No send-path `markChannelRead` was found (callers listed via grep: `AppShell.tsx`, `ChannelScreen.tsx`, `useChannelOpenReadState.ts`, `useHuddleReadMarker.ts`, `useMarkAsReadShortcuts.ts`, `useChannelActivityProjection.ts`, `HomeView.tsx`).
- Earlier external messages newer than the marker stay unread until the channel is opened. The exception is when the user posts while viewing the channel: the active channel is excluded from unread (`CH/useUnreadChannels.ts:813`), and the open-state effect re-marks at the newest top-level message, which is the user's own post (`CH/ui/ChannelScreen.tsx:213-224`, `useChannelOpenReadState.ts:36`).
- The result is that the marker equals the own message's `created_at`, which covers everything before it.
- A post from another device while this device is elsewhere leaves prior external unread intact (derived).
- Unread is **not** computed as `lastMessageAt > readAt`. `lastMessageAt` only drives Recent ordering (`CH/useLiveChannelUpdates.ts:251-256`).

## 9. Failure recovery
| Failure | Behaviour | Evidence |
|---|---|---|
| Initial relay fetch fails | continues with local state; `isReady` still set | `RS/readStateManager.ts:445-449`, `useReadState.ts:43-47` |
| Live subscription fails | non-fatal; no cross-device live updates for the session | `RS/readStateManager.ts:550-553` |
| Publish fails | logged; retried only when a later change schedules another debounce | `RS/readStateManager.ts:738-741` |
| Pre-publish fetch fails | proceeds with reachable data | `RS/readStateManager.ts:821-827` |
| Slot conflict | slot id rotated | `RS/readStateManager.ts:500-511` |
| Blob too big | trim msg→thread, then multi-slot split up to 8, else publish suppressed | `RS/readStateManager.ts:842-934` |
| Corrupt localStorage | ignored per key | `RS/readStateStorage.ts:39-43,59-65,85-91` |
| Native observed store fails | localStorage fallback | `CH/useObservedUnreadPersistence.ts:477-491` |
| Catch-up channel error | claim released, retried on next effect run | `CH/useUnreadChannels.ts:680-685,763-766` |

## 10. Expected test cases (derived from source)
1. Read a DM, restart → no DM badge (§6 chain).
2. Receive a DM while the app is closed, restart → badge after hydration. The catch-up returns the event with `created_at > readAt`.
3. Before the read-state fetch resolves → no badges at all (§3.7).
4. Read on device A → device B's badge clears via the live 30078 subscription, and B's forced-unread for that channel clears too.
5. Mark unread on device A → device B still shows it read (forced unread is local).
6. Own message as newest while channel inactive → earlier external unread remains; own message adds nothing.
7. Open a channel whose thread replies are newer than the newest top-level message → the channel's top-level unread clears, but the thread replies stay unread (`topLevelOnly`).
8. Reaction/edit/system message from others → no unread.
