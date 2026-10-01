# OLD BUZZ — Inbox Agent Scoping Audit (source-derived)

Scope: how OLD BUZZ decides that an agent-authored message belongs in *this* user's Inbox, and what stops agent messages from other users' threads showing up. This is a source audit only. The app was not run.

Related, not duplicated: `swf buzz/docs/OLD_BUZZ_INBOX_AUDIT.md`. See §11, §14 and §26 there for the general Inbox layout, the empty `activity`/`agent_activity` arrays, and the storage key.

Path prefixes:
- `D/` = `buzz/desktop/src`
- `T/` = `buzz/desktop/src-tauri/src`
- `C/` = `buzz/crates`

Status legend: **SUPPORTED** / **NOT SUPPORTED** / **PARTIALLY SUPPORTED** / **NOT VERIFIED** ("NOT VERIFIED IN OLD BUZZ SOURCE").

---

## 0. TL;DR

1. **OLD BUZZ has no "agent message → Inbox" feed of its own.** The desktop never sends relay `feed_types`. `get_feed` issues two `#p = me` REQ-style queries (mentions and approvals) and returns `activity: []` and `agent_activity: []` (`T/commands/messages.rs:49-163`, empties at `:156-157`).
2. An agent message reaches the Inbox only through a **user-scoped** path:
   - (a) it `p`-tags me: a mention (relay `#p` filter);
   - (b) it is a threaded reply, or a DM, that passes the client notify gate `shouldNotifyForEvent`. That gate requires one of: a `p`-tag to me, `broadcast=1`, or a root that I participated in, authored, or followed. Such events are captured into `buzz-thread-activity.v1`;
   - (c) it is a workflow approval or reminder `p`-tagged to me.
3. The **"Agents" filter** is only a display predicate. It keeps rows already in the Inbox whose representative sender is in `ownedAgentPubkeys`, meaning agents *I* own (`D/features/home/lib/inboxViewHelpers.ts:68-73`). It never adds rows.
4. **The relay `activity` feed_type is NOT user-scoped.**
   - It returns every non-deleted kind 9 / 40002 / 45001 / 43001 / 43002 / 43003 event in the tenant community whose channel is "accessible" (`C/buzz-db/src/store/feed.rs:261-283`).
   - "Accessible" means channels I am a member of **∪ every `visibility='open'` channel in the community** (`C/buzz-db/src/store/channel_members.rs:817-827`).
   - There is no pubkey, `#p`, thread or authorship predicate.
   - `agent_activity` is an alias for the same query (`C/buzz-relay/src/api/bridge.rs:1227-1231`).
   - A client that treats relay `activity` or `agent_activity` as "my Inbox" **will leak** other users' agent threads in open and shared channels.

---

## 1. Owned agents vs known agents

| Set | Definition | Source | Used for |
|---|---|---|---|
| `ownedAgentPubkeys` | Local managed agents ∪ every profile whose **verified NIP-OA** `ownerPubkey` equals my pubkey | `D/features/agents/knownAgentPubkeys.ts:27-52`; hook `D/features/home/useOwnedAgentPubkeys.ts:7-17`; used at `D/features/home/ui/HomeView.tsx:330-334` | Inbox "Agents" filter and "All" view predicate |
| Managed agents | `list_managed_agents` Tauri command. Reads the local managed-agents store on this machine. | `D/features/agents/hooks.ts:389-404`; `T/commands/agents.rs:293-308` | Owned set (always counted as mine) |
| Profile `ownerPubkey` | Set only when the kind:0 carries exactly one valid NIP-OA `auth` tag, the signature verifies, and the conditions apply | `T/nostr_convert.rs:64-104`, `:323`, `:352` | Owned set |
| `knownAgentPubkeys` / `useKnownAgentPubkeys` | Managed ∪ relay agent directory. This includes **other users' agents**. | `D/features/agents/knownAgentPubkeys.ts:12-24` | Display only: agent badge on Inbox rows (`D/features/home/ui/InboxMessageRow.tsx:97-106`) and mention autocomplete. **Not** used for Inbox eligibility. |
| `inboxAgentPubkeys` | `knownAgentPubkeys` ∪ profiles with `isAgent` | `D/features/home/ui/HomeView.tsx:346-357` | Row avatar/badge only |

Status:
- Owned-agent determination: **SUPPORTED** (client-side). It depends on the feed profiles batch (`HomeView.tsx:310-329`). An agent whose profile is not in that batch and that is not managed locally is not treated as owned.
- The observer-relay `knownAgentPubkeys` set in `D/features/agents/observerRelayStore.ts:153-186, 558` gates agent observer frames. It is unrelated to the Inbox.

---

## 2. What the desktop Inbox actually fetches (server side)

`useHomeFeedQuery` calls `get_feed` with `types: "mentions,needs_action,activity,agent_activity"` and `limit: 50`, then polls every 30 s (`D/features/home/hooks.ts:18-39`).

`get_feed` (`T/commands/messages.rs:49-163`):
- **Mentions:** kinds `[9, 40002, 1, 45001, 45003, git PR / issue / status kinds]` with `"#p": [my_pubkey]` (`:75-91`).
- **Needs action:** kinds `[46010, 46011, 46012]` with `"#p": [my_pubkey]`, limit 20 (`:97-103`).
- **`activity` and `agent_activity`:** always `Vec::new()` (`:156-157`). The requested types are ignored for these two.
- Neither filter carries `feed_types`. Both go through the relay bridge's generic path (`POST /query` via `T/relay.rs:360-389`).

How the relay handles the `#p` query:
- **Channel access:** the event must be in a channel I can access, or be channel-less (`C/buzz-relay/src/api/bridge.rs:1146-1149`, `:1410-1427`, `:1490`; helper at `:692-697`).
- **Tag match:** the event must actually match the `#p` filter (`bridge.rs:1492`).
- **Private kinds:** reader-private kinds are dropped (`bridge.rs:1500`).
- **Result:** the mention path is strictly user-scoped. An agent reply appears only if the agent put `["p", <me>]` on it.

Status:
- Mentions of me by any agent (owned or not) in an accessible channel: **SUPPORTED**.
- Server-side agent activity feed in the desktop: **NOT SUPPORTED**. It is always empty.

---

## 3. Relay feed extension (`feed_types`) — what `activity` returns

Used by `buzz-cli feed` (`C/buzz-cli/src/commands/feed.rs:6, 59`). **Not used by the OLD BUZZ desktop.**

Bridge dispatch (`C/buzz-relay/src/api/bridge.rs:1204-1289`):
- `agent_activity` is canonicalised to `activity`, and a duplicate type is skipped (`:1227-1234`).
- Types are processed in request order and share one `limit` budget (default 20, capped at `BRIDGE_FEED_MAX_LIMIT`). The `seen` set de-duplicates by event id across types (`:1215-1239`, `:1275-1277`).
- Each event is re-checked with `event_in_accessible_channel` and `reader_authorized_for_event` (`:1278-1286`).
- The response is a **flat JSON array with no category marker**. The client cannot tell a mention from an activity row except by re-inspecting tags.

`activity` query (`C/buzz-db/src/store/feed.rs:261-283`, doc comment `:285-290`):

```sql
SELECT … FROM events WHERE community_id = $c AND deleted_at IS NULL
  AND kind IN (9, 40002, 45001, 43001, 43002, 43003)   -- stream msg, v2, forum post, job req/progress/result
  AND (channel_id IS NULL OR channel_id IN (<accessible>))
  [AND created_at >= since] ORDER BY created_at DESC LIMIT n
```

- There is **no pubkey, `#p`, author, thread-root or participation predicate.**
- Its documented purpose is "recent activity across accessible channels (for watched topics / agent activity)" (`feed.rs:285`).
- An empty accessible list means "global only", not "all channels" (`feed.rs:56-73`; test `:740-805` confirms tenant isolation).

`accessible_channel_ids` (`C/buzz-db/src/store/channel_members.rs:807-832`) is the union of:
- channels where I am an active member;
- **all channels with `visibility = 'open'` in the community**, member or not.

By contrast, `mentions` (`feed.rs:86-116`) and `needs_action` (`feed.rs:175-205`) both join `event_mentions` on `m.pubkey_hex = <me>`. **They are user-scoped.**

Verdict: relay `activity` is **community-wide accessible-channel activity, NOT user-scoped**. That includes every agent reply in every open channel, including replies in other people's threads.

---

## 4. Client-side thread and DM capture (`buzz-thread-activity.v1`)

This is the only source of `activity` rows in the desktop Inbox. `HomeScreen` appends `threadActivityFeedItems` to `feed.activity` (`D/features/home/ui/HomeScreen.tsx:33-49`).

### 4.1 Live capture

`D/features/channels/useLiveChannelUpdates.ts:232-313`:

1. **Channel filter.** The event's `h` channel must be in the live channel set (`:238-243`).
2. **Kind filter.** The kind must be an unread-trigger kind (`:86-90`, `:246-249`).
3. **Own messages.** They are never captured. They only feed `onSelfChannelMessage`, which records participation or authorship (`:259-266`; `D/features/channels/useUnreadChannels.ts:486-527`).
4. **External events.** They go through `shouldNotifyForEvent` (`D/features/notifications/lib/shouldNotify.ts:28-76`). The checks run in this order; the first match decides:
   - `broadcast` reply → true
   - `p`-tag == me → true
   - channel muted → false
   - top-level (no parent) → true
   - root muted → false
   - root ∈ participated → true
   - root ∈ followed → true
   - root ∈ authored → true
   - otherwise → **false**
5. **Capture into activity.** If `shouldNotify` is true **and** `isHomeActivityEvent` (threaded reply **or** DM channel, `:92-97`), then `onThreadReplyNotification` → `handleThreadReplyNotification` appends the event to the buffer (`useLiveChannelUpdates.ts:305-313`; `useUnreadChannels.ts:540-570`).
   - Top-level channel messages that do not `p`-tag me are therefore never captured, even from my own agent.
   - Broadcast replies are not "threaded" (`D/features/messages/lib/threading.ts:20-23`), so they do not enter activity.
6. **Candidate hook.** A threaded reply that fails the gate only goes to `onThreadReplyCandidate` (`useLiveChannelUpdates.ts:301-304`). It is not captured.

### 4.2 Catch-up capture (startup / reconnect)

`T/unread_catch_up.rs:238-360`, `should_notify` at `:400-438`.

- It mirrors the same gate: broadcast or `p`=me → true; muted channel → false; top-level → true; muted root → false; else participated, followed or authored.
- Own events are skipped (`:283-296`).
- Events at or before the channel `read_at` are skipped (`:283-296`).
- **Only threaded replies become `activity_rows`** (`:320-331`). DMs are not added by catch-up. They are added only live.
- Rows are capped globally at `ACTIVITY_LIMIT` (`:333-349`).
- Pass one derives participated, authored and mentioned roots from fetched history (`:252-273`).

### 4.3 Root membership sets

These are per pubkey, persisted in stores, and maintained in `D/features/channels/useUnreadChannels.ts`.

| Set | How a root enters | Where |
|---|---|---|
| participated | I posted a reply whose root is R | `:486-515`; catch-up `T/unread_catch_up.rs:256-261` |
| authored | I posted a top-level message (its own id) | `:486-515`; `T/unread_catch_up.rs:262-264` |
| followed | Explicit follow thread | `D/features/messages/lib/useThreadFollows.ts:94`; `D/app/AppShell.tsx:364-369` |
| mentioned | An external reply `p`-tagged me | `:378-393`; `T/unread_catch_up.rs:265-270` |
| participated (interaction) | `recordThreadInteraction(rootId)` | `:517-535` |

Note: `mentioned` roots are used in the thread badge gate (`D/app/AppShell.tsx:474-481`). They are **not** part of `shouldNotifyForEvent`, nor of the Rust `should_notify`. A later agent reply in a thread where I was mentioned once, and that does not itself `p`-tag me, is not captured unless I participated, authored or followed.

### 4.4 Storage and scoping

- **Key:** `buzz-thread-activity.v1:<normalizedRelayUrl>:<pubkey>`.
- **Cap:** 100 items, de-duplicated by id and sorted by `createdAt` (`D/features/channels/threadActivityStorage.ts:14-21`, `:97-120`).
- **Legacy key:** the pubkey-only key is never read (`:17-18`, `:130-136`).
- **Scope fence:** `projectActivityForScope` / `isScopeLoaded` (`:47-54`; `useUnreadChannels.ts:544`).
- **Render fence:** rows whose `channelId` is not in the active community's channel list are dropped. Rows under a muted root are dropped (`D/app/useThreadActivityFeedItems.ts:14-24`).

Status: thread capture limited to threads I participate in, authored or follow, or replies that `p`-tag me: **SUPPORTED**. Capture for threads where I was only mentioned earlier: **NOT SUPPORTED**.

---

## 5. Grouping and channel/DM relationship

- **Conversation key** (`D/features/home/lib/inbox.ts:371-395`):
  - project → `project:<repo>:<root>`;
  - DM → `dm:<channelId>`;
  - otherwise the NIP-10 root, then the parent, then the event id.
- **Grouping** (`buildInboxItems`, `inbox.ts:462-627`): mentions, needs-action, activity and agent-activity rows merge into one row per conversation key. Category priority is needs_action > mention > agent_activity > activity (`:326-337`).
- **Representative item:** the oldest unread item, otherwise the latest (`:566-581`).
- **Hidden DMs:** marked via `markHiddenDmFeedItems` (`HomeScreen.tsx:48`).

---

## 6. Filter predicates

From `D/features/home/lib/inboxViewHelpers.ts`:

- **Agents** (`agent_activity`), `:68-73`: the representative pubkey (`item.item`, or the last group item) ∈ `ownedAgentPubkeys`.
  - It only filters rows that already reached the Inbox by §2 or §4.
  - An agent owned by someone else never matches, even when it replied in my thread. That row stays visible under All and Threads.
- **All**, `:78-102`, when `ownedAgentPubkeys` is supplied (it always is, `HomeView.tsx:424`). The row qualifies if any of these holds:
  - it is a DM;
  - it has the mention category;
  - it has thread-reply tags;
  - it is a project item;
  - it is needs-action;
  - its representative sender is an owned agent.
- **Threads**, `:56-60`: any group item has thread-reply tags.
- **Everything else:** `categories.includes(filter)` (`:75`).

---

## 7. Cross-user leakage guards (inventory)

| Guard | Where | Effect |
|---|---|---|
| Desktop never uses relay `activity` / `agent_activity` | `T/commands/messages.rs:156-157` | Avoids the unscoped feed entirely |
| `#p = me` on mention and approval queries, plus relay `filters_match` | `messages.rs:90, 99`; `bridge.rs:1492` | Only events addressed to me |
| Relay accessible-channel filter | `bridge.rs:692-697, 1278, 1490`; `feed.rs:61-73` | No events from channels I cannot read (open channels still count as readable) |
| `reader_authorized_for_event` / `event_visible_to_reader` | `C/buzz-core/src/filter.rs:23-33`; `bridge.rs:1283, 1500` | Private kinds (DM visibility, agent turn metrics, author-only kinds) stay with their owner |
| `shouldNotifyForEvent` participation/authorship/follow gate | `shouldNotify.ts:28-76`; `T/unread_catch_up.rs:400-438` | **Main guard:** replies in other people's threads are not captured unless they `p`-tag me |
| Own-event exclusion | `useLiveChannelUpdates.ts:268-273`; `unread_catch_up.rs:283-284` | My own messages never become activity |
| Relay+pubkey storage scope and scope fences | `threadActivityStorage.ts:19-54, 176-192` | No cross-account or cross-relay rows |
| Active-community channel fence | `useThreadActivityFeedItems.ts:14-21` | No rows from another community |
| Owned-agent predicate uses verified NIP-OA only | `T/nostr_convert.rs:64-104` | A forged `ownerPubkey` cannot claim an agent as mine |

Residual leakage vectors:
- Any **top-level message that `p`-tags me** appears in the Inbox, regardless of whose agent sent it. This is by design.
- Top-level messages in channels pass `shouldNotify` (`parentId === null` → true). They are excluded from Inbox activity only by `isHomeActivityEvent` (`useLiveChannelUpdates.ts:92-97`). Removing that check would leak all channel traffic.

---

## 8. Feature matrix

| Feature | Status | Evidence |
|---|---|---|
| Agent reply that `p`-tags me → Inbox (mention) | SUPPORTED | `messages.rs:75-91` |
| Agent reply in a thread I started (authored root) → Inbox | SUPPORTED | `shouldNotify.ts:71`; `useUnreadChannels.ts:486-515` |
| Agent reply in a thread I replied to → Inbox | SUPPORTED | `shouldNotify.ts:63` |
| Agent reply in a thread I follow → Inbox | SUPPORTED | `shouldNotify.ts:67` |
| Agent reply in someone else's thread (no participation, no `p`) → hidden | SUPPORTED (hidden) | `shouldNotify.ts:75` |
| Agent DM to me → Inbox | SUPPORTED (live) / PARTIALLY (catch-up adds DM unread events but no activity rows) | `useLiveChannelUpdates.ts:92-97`; `unread_catch_up.rs:320` |
| Top-level agent post in a channel, not mentioning me → Inbox | NOT SUPPORTED (by design) | `isHomeActivityEvent` |
| "Agents" filter = my owned agents only | SUPPORTED | `inboxViewHelpers.ts:68-73` |
| Server-side agent activity feed in the desktop | NOT SUPPORTED | `messages.rs:157` |
| Relay `activity` feed_type user-scoped | NOT SUPPORTED (community-wide over accessible, including all open channels) | `feed.rs:261-283`; `channel_members.rs:817-827` |
| Agent reply in a thread where I was only mentioned earlier (reply lacks `p`) | NOT SUPPORTED | `mentioned` set absent from `shouldNotify.ts:28-76` |
| Whether agents auto-`p`-tag the parent author when replying | NOT VERIFIED IN OLD BUZZ SOURCE (agent runtime behaviour not traced) | — |
| Job kinds 43001–43006 reaching the desktop Inbox | NOT VERIFIED IN OLD BUZZ SOURCE. They are not in the mention kinds; captured only if they are threaded unread-trigger kinds, and `CHANNEL_MESSAGE_EVENT_KINDS` membership was not traced. | `inbox.ts:149-160` |

---

## 9. Expected test cases (derived from source)

Terms: U = me, V = another user, A_U = an agent owned by U (managed, or verified NIP-OA owner = U), A_V = an agent owned by V, C = an open channel both can read.

| # | Scenario | Expected Inbox | Expected under "Agents" filter |
|---|---|---|---|
| 1 | U posts a root in C. A_U replies (no `p`). | Shown (authored root) | Shown |
| 2 | U posts a root in C. A_V replies (no `p`). | Shown (authored root) | Hidden (A_V not owned) |
| 3 | V posts a root in C. A_V replies. U never interacted. | **Hidden** | Hidden |
| 4 | V posts a root in C. A_U replies, but U never participated and there is no `p`. | **Hidden** (the gate is on U's participation, not agent ownership) | Hidden |
| 5 | Same as 3, but U previously replied in that thread. | Shown (participated) | Hidden |
| 6 | Same as 3, but U followed the thread. | Shown | Hidden |
| 7 | A_V replies in V's thread with `["p", U]`. | Shown (mention; live gate and relay `#p` query) | Hidden |
| 8 | A_U posts top-level in C mentioning U. | Shown (mention) | Shown |
| 9 | A_U posts top-level in C without mentioning U. | Hidden | Hidden |
| 10 | A_U sends a DM to U. | Shown (DM row `dm:<channel>`) | Shown |
| 11 | U muted the thread root, then A_U replies (no `p`). | Hidden | Hidden |
| 12 | U muted the thread root, then A_V replies with `p`=U. | Shown (mention precedes mute, `shouldNotify.ts:47-49`) | Hidden |
| 13 | U muted channel C, then A_V replies in U's thread (no `p`). | Hidden | Hidden |
| 14 | U's own reply in any thread. | Never an Inbox row (own-event exclusion) | — |
| 15 | Switching relay or account. | Previous scope's thread activity is not shown | — |
| 16 | A thread row from a channel not in the active community. | Dropped | — |
| 17 | Relay `feed_types:["activity"]` requested as U in a community with open channel C where A_V replied to V. | **The relay returns it.** The desktop does not use it. A client using it must apply the §4 gate itself. | — |
| 18 | Profile claims `ownerPubkey`=U without a valid NIP-OA `auth` tag. | Not in the owned set | Hidden |
