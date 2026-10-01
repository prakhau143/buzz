# OLD BUZZ: Huddle Lifecycle Audit

This is a source-only audit. Nothing was executed. Every claim cites the OLD BUZZ source.

Source root: `C:\Users\lenovo\New folder (2)\buzz\buzz`. The paths below are relative to that root.
Abbreviations:
- `mod.rs` = `desktop/src-tauri/src/huddle/mod.rs`
- `events.rs` = `desktop/src-tauri/src/events.rs`
- `audio/handler.rs` = `crates/buzz-relay/src/audio/handler.rs`
- `audio/room.rs` = `crates/buzz-relay/src/audio/room.rs`
- `ingest.rs` = `crates/buzz-relay/src/handlers/ingest.rs`
- `side_effects.rs` = `crates/buzz-relay/src/handlers/side_effects.rs`
- `channel.rs` = `crates/buzz-db/src/store/channel.rs`

---

## 0. Summary verdicts

| Feature | Verdict |
|---|---|
| A huddle is backed by a temporary (TTL) private stream channel | SUPPORTED |
| Huddle start and end are announced in the parent channel (48100/48103) | SUPPORTED |
| Relay emits participant join/leave (48101/48102) from the audio socket | SUPPORTED |
| Explicit end archives the backing channel (client sends kind 9002 `archived=true`) | SUPPORTED |
| Relay ends the huddle when the last audio peer leaves (archive plus relay-signed 48103) | SUPPORTED |
| Relay TTL reaper archives expired ephemeral channels | SUPPORTED |
| Ephemeral channel is deleted (kind 9008 / soft delete) | NOT SUPPORTED. It is only archived. |
| History is kept after end | SUPPORTED. Rows are kept and further writes are rejected. Reads: see §8. |
| Sidebar hides huddle backing channels | SUPPORTED. The client hides them (localStorage id set plus the `archivedAt` filter). |
| Server-authoritative end state | PARTIALLY SUPPORTED. The archive flag lives on the relay (DB `archived_at`). Detecting that a huddle is active is done client-side from events. |

---

## 1. Start (creator client, Tauri `start_huddle`)

The start sequence is `mod.rs:181-190` (doc comment and fn):

1. **Allocate an id client-side.** The client creates `ephemeral_uuid = Uuid::new_v4()` (`mod.rs:~221`). The fallback name is `huddle-<first 8 chars>` (`mod.rs:224`). `normalize_huddle_channel_name` collapses whitespace and caps the name at 80 chars (`mod.rs:110-124`).
   - The frontend supplies a friendlier name: `"<channel> huddle"`, or for a DM `"A <> B huddle"` (`desktop/src/features/huddle/lib/huddleChannelName.ts:94-131`).
   - The phase becomes `Creating`, and `parent_channel_id` and `ephemeral_channel_id` are stored (`mod.rs:227-240`).
2. **Create the channel with kind 9007.** The call is `build_create_channel(uuid, name, "private", "stream", None, Some(3600))` (`mod.rs:250-258`).
   - Tags are `h`, `name`, `visibility`, `channel_type` and `ttl` (`events.rs:97-120`).
   - The relay resolves the TTL from the `ttl` tag. The env var `BUZZ_EPHEMERAL_TTL_OVERRIDE` overrides it (`crates/buzz-relay/src/handlers/mod.rs:48-67`, `crates/buzz-relay/src/config.rs:307-312`).
   - The DB insert sets `ttl_deadline = NOW() + ttl` (`channel.rs:130-135`). The creator becomes owner (`side_effects.rs:~1850`).
   - The relay emits the system message `channel_created` and kind 39000 discovery (`side_effects.rs:1860-1878`).
3. **Post guidelines with kind 48106.** The event goes to the *ephemeral* channel (`h` = ephemeral) and is sent before agents are added, so agents see it on EOSE replay. It is best-effort (`mod.rs:261-272`, `events.rs:505-518`).
4. **Add agents with kind 9000.** Tags are `h`, `p` and `role=bot`, one event per invited agent. Only the adds that succeed are kept (`mod.rs:274-285`, `events.rs:222-236`). The maximum is `MAX_HUDDLE_AGENTS` (`mod.rs:198-204`).
5. **Post kind 48100 (HUDDLE_STARTED) to the parent channel.** Tags: `h=<parent>`. Content: `{"ephemeral_channel_id": "<uuid>"}` (`mod.rs:288-290`, `events.rs:467-495`).
   - The relay validates it. The signer must have created the backing channel, and the backing channel must be `stream`, `private`, `ttl_seconds == 3600` (or the override), and not archived (`ingest.rs:83-114`, with the expected TTL at `ingest.rs:77-79`).
6. **Store the state.** The client sets phase `Connected`, `is_creator = true`, and `huddle_thread_event_id` = the 48100 event id. Participants are self plus the agents (`mod.rs:296-321`).
7. **Connect.** `post_connect_setup` opens the audio WebSocket. If that fails, the client calls `emit_end_and_archive` (rollback) (`mod.rs:333-361`).
8. **Roll back on failure.** If creation succeeded and any later step fails, the client sends kind 9002 `archived=true` (`mod.rs:366-377`).

**Huddle id:** there is no separate huddle id. The identity is the ephemeral channel UUID. The "thread" anchor is the 48100 event id (`mod.rs:303`).
**Creator:** the pubkey that signed 9007 (`channels.created_by`). The relay checks it against 48100/48103 (`ingest.rs:101-137`).

## 2. Join and participants

- The client runs `join_huddle(parent, ephemeral, huddle_thread_event_id)`. It sets phase Connecting, then Connected, seeds participants with self, then opens the audio socket (`mod.rs:398-475`). The client does not publish a join event.
- On the relay, `ensure_membership` runs these checks (`audio/handler.rs:1270-1346`):
  - It rejects an archived channel ("auto-ended huddles can't be rejoined") (`:1276-1287`).
  - For a TTL channel it requires parent linkage, which is proven by a creator-signed 48100 in the parent (`huddle_started_link_exists`, `crates/buzz-db/src/store/event.rs:286-330`) (`:1289-1310`).
  - A member of the parent channel is **auto-added** to the private ephemeral channel as `Member` (`:1326-1343`).
- There is a second archived re-check after `get_or_create` of the room, which closes the race with the last leaver (`audio/handler.rs:395-424`).
- **The relay emits kind 48101** (relay-signed, `h=<parent>`, `p=<participant>`). Content carries `ephemeral_channel_id`, `roster_revision`, `admission_id` and `generation` (`audio/handler.rs:701-715`, `:1353-1420`).
  - The event is persisted with `insert_event` so late joiners can rebuild state (`audio/handler.rs:1429-1460`).
- The client detects an active huddle in `HuddleIndicator`. It subscribes to kinds 48100-48103 for the parent channel (`desktop/src/shared/api/relayClientSession.ts:347-357`).
  - It rebuilds state from all events it has seen, sorted by `created_at`, then kind, then id.
  - 48101/48102 read the participant from the `p` tag.
  - 48103 marks the ephemeral id as ended, so late 48101/48102 cannot bring the huddle back (`desktop/src/features/huddle/components/HuddleIndicator.tsx:43-190`).
- Kind 48104 (liveness) is synthesized by the relay on REQ only while the audio room is non-empty (`crates/buzz-relay/src/handlers/req.rs:1227-1262`). It is consumed by `desktop/src/features/huddle/lib/huddlePresenceRuntime.ts:329-338`.
- A card for a 48100 older than 3600 s is treated as stale and not joinable, unless it is the current huddle (`desktop/src/features/huddle/lib/huddleCardState.ts:1-9`, `HuddleAttachment.tsx:212`).

## 3. Leave

`leave_huddle` (`mod.rs:590-649`):

1. The client counts human members (non-`bot` roles) of the ephemeral channel through the relay (`relay_api.rs:662-671`). If the fetch fails it assumes **2**, so a transient error never ends the huddle for everyone (`mod.rs:614-624`).
2. If `humans_remaining <= 1` (only self is left), it calls `emit_end_and_archive` (`mod.rs:626-633`).
3. Otherwise it sends kind 9022 leave for the ephemeral channel (`mod.rs:634-641`, `events.rs:131-134`).
4. It tears down the local pipelines and closes the huddle window (`mod.rs:645-647`).

On the relay, when the audio socket disconnects, it removes the peer and **emits 48102** (`audio/handler.rs:873-927`).

## 4. End

### 4a. Explicit end by the client, `end_huddle`
- End is allowed for the creator only, unless `force=true` (a recovery path gated by a UI confirmation) (`mod.rs:659-688`, check at `:673`).
- `emit_end_and_archive` (`mod.rs:526-556`) does three things, all best-effort:
  1. It posts 48103 to the parent (`events.rs:497-503`).
  2. It removes the bot-role members with kind 9001 (`mod.rs:558-588`).
  3. It sends kind 9002 `["archived","true"]` for the ephemeral channel (`events.rs:196-202`).
- The relay authorizes 48103 only from the creator or the relay, and only with a matching creator-signed 48100 in the named parent (`ingest.rs:115-138`).
- For 9002 `archived`, the actor must be the channel **owner/admin**, or the owner of an owner-role agent in the channel (`side_effects.rs:527-555`).
  - The relay then calls `archive_channel`, emits the system message `channel_archived` (`side_effects.rs:1582-1599`), and **re-emits kind 39000 with `["archived","true"]`** (`side_effects.rs:1662`, tag at `:1108-1112`).
- Consequence: a *non-creator* who is the last human gets a rejected 9002 archive. Joiners are auto-added as `Member` (`audio/handler.rs:1336-1342`), not owner or admin. The end then falls to the relay auto-end (4b) or the reaper (4c).
  - This is inferred from the authorization rule. NOT VERIFIED IN OLD BUZZ SOURCE by a test.

### 4b. Relay auto-end when the audio room empties (server-authoritative)
- `remove_peer_and_check_ended` removes the peer and, under the same lock, sets `ended = true` if the room is empty. Only the first task to see empty wins, which prevents a duplicate archive or 48103 (`audio/room.rs:430-460`).
- When that happens, the relay calls `db.archive_channel(ephemeral)`, then `cleanup_if_empty`, then emits a **relay-signed 48103** to the parent (`audio/handler.rs:929-960`).
  - If the archive fails, it calls `clear_ended()` and the huddle stays alive (`:937-941`).
- Ingress mirrors (a remote pod session) never auto-end. Only the room owner does (`audio/handler.rs:873-881`).
- **Gap:** this path does **not** call `emit_group_discovery_events` or `evict_all_channel_subscriptions`.
  - Grep finds those calls only in `main.rs` (the reaper) and `side_effects.rs`.
  - So kind 39000 is not refreshed with `archived=true` at this point. Clients learn about the end through 48103 in the parent, and through `archived_at` the next time 39000 is emitted or the reaper runs.

### 4c. TTL reaper (relay background task)
- The reaper is spawned in `crates/buzz-relay/src/main.rs:725-800`. It loops every `BUZZ_REAPER_INTERVAL_SECS` (default **60 s**) (`:732-742`).
- Each tick calls `reap_expired_ephemeral_channels` (`channel.rs:776-812`). It runs one SQL `UPDATE channels SET archived_at = NOW()` where:
  - `ttl_seconds IS NOT NULL`
  - `ttl_deadline < NOW()`
  - `archived_at IS NULL`
  - `deleted_at IS NULL`
  - the community is not archived and `community_write_allowed`
  - It returns `(community_id, host, id)`. The query is idempotent and safe across multiple pods (a comment at `main.rs:725-729` notes duplicate system messages are possible).
- For each channel it reaps (`main.rs:757-800`):
  1. It emits the system message `{"type":"channel_auto_archived"}` (kind 40099) in the ephemeral channel (`:768-779`).
  2. It re-emits kind 39000 with `archived=true` and `ttl`/`ttl_deadline` tags (`:781-790`, `side_effects.rs:1108-1119`).
  3. It closes all live subscriptions with `CLOSED "channel access revoked"` (`:792-800`, `side_effects.rs:173-193`).
- **Deadline refresh (the TTL is sliding):** a deferred constraint trigger on `events` INSERT sets `ttl_deadline = clock_timestamp() + ttl_seconds` for any durable event whose `channel_id` is that TTL channel, excluding kind 9007 (`migrations/0022_event_ttl_refresh.sql:1-40`, updated with a shared advisory lock in `migrations/0024_event_ttl_refresh_shared_lock.sql:25-55`).
  - So the channel expires 3600 s after the **last durable event in the ephemeral channel**.
  - The 48101/48102/48103 events are stored with `channel_id = parent` (`audio/handler.rs:1433-1435`), so they do **not** refresh the ephemeral TTL.
  - Unarchive also resets the deadline (`channel.rs:740-745`), and so does a TTL change through 9002 (`channel.rs:545-555`).
- The reaper does not touch `audio_rooms`. Whether a still-connected but silent audio session is torn down when its channel is reaped: NOT VERIFIED IN OLD BUZZ SOURCE. Only new joins are blocked (`audio/handler.rs:1285`, `:402`).

## 5. Cleanup mechanism, exactly

- **Archived, never deleted.** The mechanism is `archived_at = NOW()` in all three paths: client 9002, relay audio auto-end, and the reaper. No huddle path sends kind 9008 or calls `soft_delete_channel` (`channel.rs:754-774` exists, but grep finds no huddle caller).
- **Who does it:**
  - The client does it on explicit end, on last-human leave, or on rollback. This depends on the client being owner.
  - The relay does it when the audio room empties.
  - The relay reaper does it at `ttl_deadline`, which is the backstop.
- **Agents** are removed with 9001 by the ending client (best-effort) (`mod.rs:558-588`). Agents (buzz-acp) skip channels flagged `archived=true` in discovery (`crates/buzz-acp/src/relay.rs:167-200`).

## 6. Edge cases

| Case | Behavior | Evidence |
|---|---|---|
| App crash or disconnect | The audio socket closes, the relay removes the peer and emits 48102, and if that was the last peer it auto-archives and emits 48103. No 9022 is sent, so the membership row stays. | `audio/handler.rs:873-960` |
| Last participant leaves | Client path: 48103 plus 9002 archive if owner. Relay path: auto-end on empty room. | `mod.rs:626-633`; `audio/handler.rs:929-960` |
| Ending while others are offline | The archive is on the relay. Offline clients see `archived=true` in 39000 or 48103 when they reconnect. Agents skip archived channels on discovery. | `side_effects.rs:1108-1112`; `buzz-acp/src/relay.rs:167-200` |
| Rejoin after end | Rejected: `channel is archived` or `huddle has ended`. | `audio/handler.rs:1285`, `:402-413` |
| Writes after end | Rejected `invalid: channel is archived`, except the unarchive 9002. | `ingest.rs:2695-2707`; `side_effects.rs:330-343` |
| Nobody ever joins audio | The reaper archives after 3600 s with no durable event in the ephemeral channel. | `main.rs:725-800` |

## 7. Restart reconciliation and sidebar hiding (client)

- **Channel list:** kind 39000 `["archived","true"]` is converted to `archived_at` (the timestamp is a proxy taken from the event's `created_at`) (`desktop/src-tauri/src/nostr_convert.rs:165-172`). This maps to `Channel.archivedAt` (`desktop/src/shared/api/tauriChannels.ts:88`).
- **Sidebar filter:** `sidebarChannels = memberChannels.filter(c => c.archivedAt === null && shouldShowSidebarChannel(c, huddleBackingChannelIds, revealedHuddleChannelIds))` (`desktop/src/app/AppShell.tsx:264-277`).
- **Backing channels hidden even while active:**
  - `shouldShowSidebarChannel` hides any id in `huddleBackingChannelIds` unless it has been explicitly revealed ("show in main app") (`desktop/src/app/huddleChannelVisibility.ts:1-19`).
  - The ids are persisted in **localStorage `buzz:huddle-backing-channel-ids:v1`**, capped at the last 100, so they stay hidden after a crash or force-quit while the relay archive lags (`desktop/src/app/huddleBackingChannelStorage.ts:1-36`).
  - They are loaded on mount (`desktop/src/app/useHuddlePresentation.ts:40-42`). They are added when the companion window opens, when "show in main app" is used, and on each `get_huddle_state` or `huddle-state-changed` (`useHuddlePresentation.ts:165-176, 245-249, 305-310, 381-400`).
  - Limitation: only ids that *this device* observed are tracked. Another member's device learns the id only when it joins or views that huddle. Before the archive, a private backing channel is visible only to members, which is the auto-added joiners and agents.
- **Notifications:** backing channels are passed as `silentChannelIds` (`AppShell.tsx:362`).
- **Unread:** 48100-48103 are excluded from unread counts (`desktop/src/shared/constants/kinds.ts:155-169`).

## 8. Open items

- Whether REQ reads of an archived channel's history are denied: no `archived_at` check exists in `crates/buzz-relay/src/handlers/req.rs` (grep). The reaper evicts live subscriptions. Whether a fresh REQ for history succeeds is NOT VERIFIED IN OLD BUZZ SOURCE.
- Whether the relay audio auto-end ever publishes 39000 `archived=true` for that channel before the next unrelated 39000 emission is NOT VERIFIED IN OLD BUZZ SOURCE. No call exists in `audio/handler.rs:929-960`.
