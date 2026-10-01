# Phase 4 — OLD BUZZ Protocol Audit (source-grounded)

**Date:** 2026-09-23
**Status:** AUDIT ONLY. Nothing in this document has been implemented.
**OLD BUZZ tree audited:** `../buzz` (relay `crates/`, `desktop/src`, `desktop/src-tauri/src`, `mobile/lib`)
**SWF tree compared:** `swf buzz/src`

## How to read this document

Every claim carries a `file:line` reference into OLD BUZZ. Where OLD BUZZ's own
documentation contradicts OLD BUZZ's code, **the code wins** and the conflict is
recorded in §7. Claims that could not be established are marked UNVERIFIED
rather than filled in from general knowledge.

Two corrections to *our own* prior audits are recorded in §0.2. They matter more
than anything else here, because both were previously stated as verified.

---

## §0. PART 0 — CURRENT OWNER BUG

### 0.1 Root cause

**There is no defect in SWF's owner resolution code. The relay's source of truth
says the identity in question is not an owner of any community.**

`relay_members`, read directly from Postgres on 2026-09-23:

| Community | Pubkey | Role |
|---|---|---|
| `ab019095…` (`swf-development-1790079628466.localhost:3000`) | `38eb252a…` | **owner** |
| | `07227e7a…` | admin |
| | `2dffa5eb…` | member |
| `cd5b1cab…` (`swf-development-1790092956925.localhost:3000`) | `38eb252a…` | **owner** |
| | `2dffa5eb…` | admin |
| | `eb71ab85…` | member |

`38eb252a…` is the **operator** key (`RELAY_OPERATOR_PUBKEYS`, `../buzz/.env`).
No `RELAY_OWNER_PUBKEY` bootstrap is configured. Both communities were
provisioned with `initial_owner_pubkey` defaulting to the operator, so the
operator became the owner of both. The kind:13534 roster snapshots (3 and 5
respectively) agree with the table above.

The resolution chain was traced end to end and is correct and relay-driven:

| Step | Location | Behavior |
|---|---|---|
| NIP-42 identity binding | `src/features/auth/identitySession.ts:301-311` | Session refused unless the AUTH-signing pubkey equals the identity being established |
| Membership fetch | `src/features/auth/identitySession.ts:318` | `relayMembersService.fetchMembershipList()` against the connected tenant |
| Role resolution | `src/features/community-members/permissions.ts:26-32` | Role read from the roster snapshot; nothing inferred from name, profile, invite or local state |
| Session write | `src/features/auth/identitySession.ts:324` | `setCommunityRole(role)` |
| Capabilities | `src/features/access/capabilities.ts:49-64` | Derived only from `platformRole` + `communityRole` |

So a `member` badge on `2dffa5eb…` in `ab019095…` is the system telling the
truth. The expected chain in the task description is exactly what the code does.

**Structural consequence worth noting:** `src/features/auth/useAuth.ts:214`
routes any operator to the operator dashboard *before* memberships are
considered. Because the only `owner` rows belong to the operator key, that
identity can never be observed "as owner" inside community UI — it is routed
away first. Ownership and operator authority are currently held by one key,
which the role model says should be two.

### 0.2 Corrections to prior SWF audits

**(a) OLD BUZZ *does* have a read-state protocol.** `docs/PHASE_3_OLD_BUZZ_PROTOCOL_AUDIT.md:154`
states "NOT IMPLEMENTED IN OLD BUZZ. No `unread`, `last_read`, or read-marker
table, event kind, or field was found anywhere in `crates/buzz-db`,
`crates/buzz-core/src/kind.rs`, or `NOSTR.md`." That claim propagated into
shipped source as `src/stores/readState.ts:5-8` ("confirmed, not assumed").

It is false:

- `crates/buzz-core/src/kind.rs:75` — `pub const KIND_READ_STATE: u32 = 30078;`
- `docs/nips/NIP-RS.md` — 796-line protocol specification
- `desktop/src/features/channels/readState/` — 9 files
- `mobile/lib/shared/read_state/` — 7 files

The narrow part that was correct: the relay never *interprets* read state. It
stores a NIP-44-encrypted blob it cannot read and computes no unread verdict
(`crates/buzz-db/src/store/replaceable.rs:143-193` handles it structurally only).
"No relay-computed read receipt" is true; "no event kind, no field" is not.

**(b) `kind:41011` is a real relay feature.** `src/protocol/dm.ts:1-9` and
`src/features/dm/Kind41010Transport.ts:1-9` call it "UNVERIFIED — no confirmed
relay handler". `crates/buzz-relay/src/handlers/command_executor.rs:431-566`
(`handle_dm_add_member`) is a real transactional handler, and
`crates/buzz-core/src/kind.rs:823` includes it in `is_command_kind()`. A working
CLI sender exists (`crates/buzz-cli/src/commands/dms.rs:111-126`).
Our treatment of `kind:41001` as dead **is** correct — it is declared but no
code anywhere emits it.

### 0.3 Second, latent defect found during the trace

`src/features/access/communityDiscovery.ts:100`:

```ts
return { status: "member", role: role ?? "member" };
```

An **unresolved** role is reported as a definite `"member"`. The relay only
publishes a kind:13534 roster snapshot after the first membership change, so on
a freshly provisioned community a real owner is labelled "member" here. It also
contradicts `identitySession.ts:324`, which correctly stores `null` when
unresolved — two code paths giving different answers to the same question.

Not the cause of the current symptom (snapshots exist), but it reproduces the
symptom exactly under a condition we will hit again.

---

## §1. CHANNEL MESSAGES

| Item | Finding | Source | Conf. |
|---|---|---|---|
| Kinds | `KIND_STREAM_MESSAGE=9`, `_V2=40002`, `_EDIT=40003`, `_PINNED=40004`, `_BOOKMARKED=40005`, `_SCHEDULED=40006`, `REMINDER=40007`, `_DIFF=40008` | `crates/buzz-core/src/kind.rs:479-493` | VERIFIED |
| `h` tag | Required for all channel-scoped kinds, parsed as UUID; rejection `"invalid: channel-scoped events must include an h tag"` | `ingest.rs:550-561`, `:2470-2474` | VERIFIED |
| Other tags | `p` (mentions), `e` (NIP-10 markers), `imeta` (verified against blob store), `link-preview` (kind:9 only) | `ingest.rs:314-370`, `:2987-2999` | VERIFIED |
| Storage order | Newest-first: `ORDER BY created_at DESC, id ASC` | `crates/buzz-db/src/store/event.rs:685-694` | VERIFIED |
| Older pagination | **`before_id`** keyset extension on top of `until`: `created_at < until OR (created_at = until AND id > before_id)` | `crates/buzz-relay/src/protocol.rs:108-141`, `event.rs:621-641` | VERIFIED |
| Authoritative exhaustion | HTTP bridge channel-window does a `limit+1` probe and returns a relay-signed **`kind:39006`** (`KIND_WINDOW_BOUNDS`) — "the only authority on exhaustion; clients must not infer `has_more` from row counts" | `api/bridge.rs:508-690`, `:668-670`, `kind.rs:437-438` | VERIFIED |
| Live delivery | ONE persistent REQ, no `since`, broad kind set so reactions/edits/deletions for future messages arrive on the same subscription | `desktop/src/shared/api/relayChannelFilters.ts:27-43` | VERIFIED |
| Reconnect | Not a plain re-REQ: re-issues with `since = lastSeenCreatedAt − skew`, **plus** a dedicated `get_channel_reconnect_repair` backfill walking a `(created_at,id)` cursor until caught up | `relayReconnectReplay.ts:104-179`, `:181-413` | VERIFIED |
| Dedup | `seenEventIds` per subscription; store-level merge matches confirmed events against pending optimistic entries | `relayClosedRecovery.ts:198-206`, `messageMerge.ts:34-71` | VERIFIED |
| Send ack | `pendingEvents: Map<eventId,…>` keyed by signed event id; `["OK", id, ok, msg]` resolves the entry | `relayEventPublisher.ts:17-84`, `relayClientSession.ts:878-914` | VERIFIED |
| Failed send | Optimistic row **rolled back** and removed; drafted text restored to composer | `desktop/src/features/messages/hooks.ts:726-740` | VERIFIED |

---

## §2. THREADS

| Item | Finding | Source | Conf. |
|---|---|---|---|
| Root vs reply | No separate kind — both `kind:9`, distinguished purely by NIP-10 markers | `crates/buzz-db/src/store/thread.rs:610-621` | VERIFIED |
| Tag shape | **Marked, never positional**: `["e", <id>, "<hint>", "root"\|"reply"]`. Direct reply = one `"reply"`; nested = `"root"` + `"reply"` pair | `crates/buzz-core/src/nip10.rs:26-81`, `buzz-sdk/src/builders.rs:177-187` | VERIFIED |
| Depth | Arbitrary nesting; hard cap **100** enforced at ingest | `ingest.rs:879-882`, `:1091-1093` | VERIFIED |
| Unknown parent | Hard rejection at ingest | `ingest.rs:829-843` | VERIFIED |
| Retrieval | Nostr-filter-shaped POST to bridge `/query` with non-standard `depth_limit` / `thread_cursor(_id)` | `api/bridge.rs:310-349`, `:1299-1343` | VERIFIED |
| Reply counts | **Server-computed**, maintained in `thread_metadata` in the *same transaction* as the insert; served as synthesized **`kind:39005`** overlays | `event.rs:1467-1527`, `bridge.rs:643-666` | VERIFIED |
| Pagination | Keyset `(created_at, event_id)`, cap `BRIDGE_THREAD_MAX_LIMIT=500` | `bridge.rs:271` | VERIFIED |
| Realtime | Piggybacked on the **single channel-level subscription** — no per-thread sub; 39005 emitted on the same `EventTopic::Channel` | `side_effects.rs:744-828`, `hooks.ts:318-394` | VERIFIED |
| Thread reconnect | No thread-panel-specific repair found; relies on generic refetch | — | UNVERIFIED |

---

## §3. REACTIONS

| Item | Finding | Source | Conf. |
|---|---|---|---|
| Creation | Kind 7, content = emoji, **single `["e", target]` tag — no `p`, no `k`** despite NIP-25 | `buzz-sdk/src/builders.rs:492-501` | VERIFIED |
| Content validation | Length cap ≤64 chars (or `:shortcode:` shape) only — **not** verified to be an emoji, despite the doc comment at `kind.rs:57`. Empty content defaults to `"+"` | `ingest.rs:160-192`, `:3059-3063` | VERIFIED |
| Channel association | **Server-derived** from the target event's stored `channel_id`; a client `h` tag is neither read nor stripped. Fail-closed if target missing | `ingest.rs:572-611`, `:2405-2414` | VERIFIED |
| Live filter | A `{"kinds":[7]}` sub without `#h` registers as `Global` and **never** receives channel-scoped reactions | `handlers/req.rs:98`, `subscription.rs:379-556` | VERIFIED |
| Historical query | Without `#h` a `/query` expands to all accessible channels — so `{"kinds":[7],"#e":[id]}` works for one-shot lookups | `req.rs:1084-1107` | VERIFIED |
| Counts | DB aggregation helpers exist but have **zero call sites** — dead code; both CLI and desktop aggregate client-side | `store/reaction.rs:401-549` | VERIFIED |
| Repeat reaction | Deduplicated at DB level by PK `(community_id, event_created_at, event_id, pubkey, emoji)`; duplicate kind:7 is **not stored** | `schema/schema.sql:541-557`, `reaction.rs:88-96` | VERIFIED |
| Removal | **kind:5** (NIP-09) with `e` tag = the *reaction event's own id*. No dedicated unreact kind | `buzz-sdk/src/builders.rs:523-527` | VERIFIED |
| Removal realtime | kind:5 fans out on the same channel subscription; desktop's `CHANNEL_EVENT_KINDS` includes both kind:7 and kind:5 | `relayChannelFilters.ts` | VERIFIED |

---

## §4. EDITS, DELETION, SEARCH

### 4.1 Editing

| Item | Finding | Source | Conf. |
|---|---|---|---|
| Kind | `KIND_STREAM_MESSAGE_EDIT = 40003` | `kind.rs:483` | VERIFIED |
| Target | `e` tag holding the target event id | `ingest.rs:1154-1170` | VERIFIED |
| Authorization | **Relay-enforced**: editor must be the target's author, or the NIP-OA owning human of the authoring agent. Channel membership re-checked at edit time | `ingest.rs:1147-1227`, called `:2726-2730` | VERIFIED |
| Admin edit | **Does not exist.** `is_admin_kind()` covers only 9000-9022; 40003 has no admin path | `side_effects.rs:27-29` | VERIFIED (absence) |
| History | Original **retained** — edits are separate rows; latest-`created_at` authorized edit wins at render. No history UI | `formatTimelineMessages.ts:257-298` | VERIFIED |

### 4.2 Deletion

| Item | Finding | Source | Conf. |
|---|---|---|---|
| Self-delete | `KIND_DELETION = 5` (NIP-09), exactly one target via `e` or `a` | `kind.rs:56`, `ingest.rs:2710-2724` | VERIFIED |
| Admin delete | **A different kind — `KIND_NIP29_DELETE_EVENT = 9005`**, not kind:5 + role check. Author OR channel owner/admin OR agent-owning human | `side_effects.rs:569-655` | VERIFIED |
| Enforcement | Both server-side before storage; 9005 also verifies the target belongs to the `h` channel (blocks cross-channel deletion) | `side_effects.rs:228-286`, `:569-655` | VERIFIED |
| Storage | **Soft-delete tombstone**: `UPDATE events SET deleted_at = NOW()`; thread counters decremented in the same transaction. Reads filter `deleted_at IS NULL` | `store/event.rs:913-1019` | VERIFIED |
| Audit trail | 9005 additionally emits a relay-signed `kind:40099` system message `{"type":"message_deleted",…}`; kind:5 does not | `side_effects.rs:1730-1766`, `:2269-2287` | VERIFIED |
| Rendering | Deleted events filtered out of the timeline entirely — no placeholder row | `formatTimelineMessages.ts:68-78` | VERIFIED |

### 4.3 Search

| Item | Finding | Source | Conf. |
|---|---|---|---|
| API | Real **NIP-50** (`search` filter field) over Postgres FTS (`websearch_to_tsquery`/`ts_rank_cd`). Two surfaces: WS `REQ` and bridge `/query` (`search_mode`, `search_page`) | `handlers/req.rs:596-760`, `api/bridge.rs:1911-2053`, `crates/buzz-search/src/query.rs:200-340` | VERIFIED |
| Permissions | FTS returns ids only; relay refetches and re-runs full filter + per-event access gate before returning | `bridge.rs:1879-1909`, `:2029-2041` | VERIFIED |
| Privacy | `search_tsv` is NULL for sensitive kinds (1059, 30179, 30300, 30350, 30622, 44100, 44101, 44200) | `schema/schema.sql:211-227` | VERIFIED |
| Ordering | `ORDER BY rank DESC, created_at DESC, id`; `page`/`per_page` max 500 | `query.rs:200-317` | VERIFIED |
| Highlighting | **None** — no `ts_headline`. Full content returned; client truncates to 180 chars and does its own match highlighting | `query.rs:244-336`, `SearchResultItem.tsx:179-190` | VERIFIED |
| Opening a result | Server returns `channel_id`/`channel_name` + raw event, **no thread-root id**; client derives navigation, with an extra `getEventById` round-trip for forum comments | `resolveSearchHitDestination.ts` | VERIFIED |

---

## §5. UNREAD, MENTIONS, INBOX, COMPOSER

### 5.1 Unread / read state — server-hosted but relay-blind

| Plane | Mechanism | Source |
|---|---|---|
| **Server-side protocol** | `kind:30078` (`KIND_READ_STATE`), NIP-78 addressable, spec'd in `docs/nips/NIP-RS.md` (796 lines). Content NIP-44-encrypted to the user's own key. Relay stores/replicates/replays it like any event | `kind.rs:75` |
| Relay's structural handling | Recognizes the `d`-tag shape `read-state:<32-hex>` + `t=read-state` to hard-delete superseded versions and track a watermark. **Never decrypts, never computes an unread verdict** | `store/replaceable.rs:143-193`, `ingest.rs:441`, `:632` |
| **Client-local only** | The read/unread verdict itself, CRDT max-register merge, mention→unread linkage, thread/channel frontier | `desktop/src/features/channels/readState/readStateManager.ts:53-109`, `:334-373` |
| localStorage role | Hydration cache **only** — every `initialize()` re-fetches from the relay | `readStateManager.ts:435-454`, `:936-948` |

Unread is computed from **timestamps merged by `max()`**, never seq numbers or
server counters. The frontier survives a full reinstall on the same identity
because it is relay-hosted and keyed by pubkey; only the device's CRDT
`client_id` is regenerated.

**Mentions:** a plain `["p", "<pubkey>"]` tag on the message — no content
parsing. Decided client-side at compose time, then **indexed server-side** into a
dedicated `event_mentions` table (`crates/buzz-db/src/runtime/mod.rs:38-118`).

### 5.2 Inbox — a real, server-aggregated feature

A relay-computed aggregation across four categories (`mentions`, `needsAction`,
`activity`, `agentActivity`), served through a `feed` extension flag on a filter
rather than a REST route (`api/bridge.rs:1206-1297`). `mentions` is an
`INNER JOIN event_mentions` (`store/feed.rs:86-150`). Every returned event is
re-checked by `reader_authorized_for_event` before delivery (`bridge.rs:1287`).

Unread counts are **not** server-provided — the badge is computed client-side by
diffing each item's `createdAt` against NIP-RS read-state timestamps
(`homeBadge.ts:81-127`). DMs are deliberately excluded from the feed poll to
avoid duplicate toasts (`notifications/lib/feed.ts:66-75`). Deep-link identifiers
are **channel UUID + event id + thread-root id** (`notifications/lib/target.ts:11-44`).

### 5.3 Composer — what actually exists

| Feature | Status | Source |
|---|---|---|
| Rich text (TipTap: bold/italic/code/lists/blockquote/links) | EXISTS — serialized to markdown at submit | `useRichTextEditor.ts:188-217`, `MessageComposer.tsx:318-320` |
| Enter submits / Shift+Enter newline | EXISTS via custom ProseMirror keymap | `useRichTextEditor.ts:310-327`, `:219-308` |
| Mentions → `["p", hex]` tags | EXISTS, with paste-binding and ambiguous-alias contracts | `hooks.ts:877`, `docs/mention-editor.md` |
| Custom emoji (kind:30030/10030) | EXISTS — `:shortcode:` inserts an image atom node | `MessageComposer.tsx:510-540` |
| Voice notes | **GENUINELY EXISTS** — recorder, duration cap, uploaded as an ordinary media attachment, mutually exclusive with other attachments | `useComposerVoiceNote.tsx:57-81` |
| Attachments (paperclip + drag/drop) | EXISTS | `MessageComposer.tsx:817-819`, `:859-878` |
| Per-message "failed, tap to retry" | **NOT FOUND IN SOURCE** — failure rolls the optimistic row back and restores the draft instead | `hooks.ts:726-740` |

---

## §6. MEDIA, PROFILES, DMs, PRESENCE

### 6.1 Media / attachments

Upload is **Blossom**: `PUT /upload` (BUD-02) with a legacy `PUT /media/upload`
alias, one handler (`api/media.rs:320-483`). Auth is a **kind:24242 Blossom
event** (`Authorization: Nostr <base64>`), *not* NIP-98 kind:27235, with a
mandatory `X-SHA-256` header matched against the event's `x` tag
(`media.rs:140-239`). MIME is never trusted from the client — it is byte-sniffed
via `infer::get()` (`media.rs:394-397`). Limits: video 500 MB
(`default_max_video_bytes = 524_288_000`), generic file 100 MB, range chunk cap
16 MiB (`crates/buzz-media/src/config.rs:36-42`, `media.rs:618`).

Attachments live in the message as **NIP-92 `imeta` tags** — not a separate kind,
not a bare content URL. `url`/`m`/`x`/`size` are mandatory
(`handlers/imeta.rs:161-163`), and ingest cross-checks each against the stored
blob before accepting the message (`ingest.rs:2987-2999`). SVG is never served
inline (`media.rs:785-796`).

### 6.2 Profiles — per-community, and no designation field

kind:0 writes exactly **`display_name`, `name`, `picture`, `about`, `nip05`**
(`desktop/src-tauri/src/events.rs:428-453`). The relay resolves four fields into
storage: `display_name ?? name`, `picture ?? image`, `about`, canonicalized
`nip05` (`side_effects.rs:1201-1290`).

**Scoping is definitively per-community.** The `users` table is keyed
`(community_id, pubkey)` and every read/write is scoped by it
(`crates/buzz-db/src/store/user.rs:76-299`). `NOSTR.md:16-20` agrees with the
code: *"profiles… are global only inside the connected community… DMs and
profiles do not inherit across community domains."*

**No designation / job-title / role-label field exists anywhere in profile data.**
Checked `UserProfile` (`store/user.rs:10-23`), the kind:0 handler, desktop
`Profile`/`UpdateProfileInput` types (`desktop/src/shared/api/types.ts:104-154`),
and the profile panel field builder. `about` is a free-text bio and is never
conflated with a title. A designation field would be **new protocol**, not a
rename.

kind:0 is **absolute-state replaceable**: fields absent from a new event are
cleared to NULL (`store/user.rs:113-183`).

### 6.3 DMs — the decisive area

> **VERDICT: the shipping DM path is the custom command-kind path —
> kind:41010 open (+41012 hide, +30622 visibility) with ordinary kind:9 messages
> inside. NOT NIP-17 gift-wrap.**

Evidence at the call-site level, in both clients:

- Desktop: `desktop/src-tauri/src/commands/dms.rs:36-84` → `events.rs:741-750`
  builds `EventBuilder::new(Kind::Custom(41010), "")`
- Mobile: `mobile/lib/features/channels/channel_management_actions.dart:59-78`, `kind: 41010`
- **No client anywhere constructs a kind:1059 gift-wrap.** The only 1059
  constructions in the repo are `crates/buzz-test-client/tests/e2e_nostr_interop.rs`
  and a desktop *mock relay* (`desktop/src/testing/e2eBridge.ts:5546`).

| Item | Finding | Source |
|---|---|---|
| Creation | kind:41010 `p` tags = other participants; relay unions with signer, persists for idempotency, calls `open_dm`, emits system message + discovery + notifications | `command_executor.rs:297-429` |
| Response | OK reason `response:{"channel_id":"…","created":bool}` | `command_executor.rs:418-427` |
| Conversation id | **Server-assigned** `Uuid::new_v4()` for the `channels.id` PK. A client-side `d`-tag UUID is only per-event idempotency | `store/dm.rs:166`, `buzz-cli/src/commands/dms.rs:58` |
| Dedup | SHA-256 of the sorted, deduplicated participant set → `participant_hash` lookup; found row is returned and un-hidden rather than duplicated | `store/dm.rs:45-60`, `:358-390` |
| Receiver discovery | Relay-signed **kind:44100** to each participant; desktop subscribes `{kinds:[44100,44101],"#p":[me]}` and invalidates channel caches | `side_effects.rs:837-897`, `useMembershipNotifications.ts:48-65` |
| Messages inside | Ordinary **kind:9** with `h` = DM channel id — DM is a `channels` row with `channel_type='dm'` | `events.rs:279-314`, `docs/nips/NIP-DV.md:19` |
| 1:1 vs group | Not a protocol distinction — participant count only; naming `"DM"` vs `"Group DM (N)"` is cosmetic. Cap 9 total | `store/dm.rs:159-164`, `:114-118` |
| Hide / visibility | kind:41012 sets `hidden_at`; relay republishes a `#p`-gated, relay-signed **kind:30622** snapshot of hidden ids | `command_executor.rs:568-639`, `side_effects.rs:3453-3533` |
| Tenant scoping | Every DM query/insert scoped `WHERE community_id = $1` | `store/dm.rs:67-94`, `:521-599` |
| kind:41011 | **Real handler** — merges participants (cap 9) and creates a *new* DM, since participant sets are immutable | `command_executor.rs:431-566` |
| kind:41001 | **Dead constant** — declared, never emitted by any code | `kind.rs:513` |

**Profile → DM flow (both clients):** build kind:41010 → sign → submit → await OK
→ parse `channel_id` from `response:{…}` → fetch kind:39000 metadata → navigate
to that channel's feed. Desktop: `useProfileInteractionActions.ts:150-162` →
`tauriChannels.ts:193-195` → `commands/dms.rs:36-83`.

### 6.4 Presence / typing

- **Presence** kind:20001, ephemeral (never stored in Postgres), Redis key
  `buzz:{community}:presence:{pubkey}` with `EX 180` — a 180 s TTL against a 60 s
  heartbeat (`crates/buzz-pubsub/src/presence.rs:16-44`). `offline` clears the key
  immediately (`handlers/event.rs:832-836`).
- **Typing** kind:20002, ephemeral, channel-scoped via `h`, membership-checked,
  no dedicated handler beyond the generic ephemeral path
  (`event.rs:848-903`). Desktop throttles to 3 s (`useTypingBroadcast.ts`).
- **Custom status** is a *separate* feature: NIP-38 **kind:30315**,
  parameterized-replaceable with `d="general"` (`kind.rs:70`).
- Delivery is Redis pub/sub for cross-node **plus** direct local WS fan-out
  (`event.rs:794-906`).

---

## §7. DOC/CODE CONFLICTS IN OLD BUZZ

| # | Conflict | Reality |
|---|---|---|
| 1 | `NOSTR.md:71,83` and `BUZZ_PROJECT_ARCHITECTURE_AND_REQUIREMENTS.md` (8 sites) present **NIP-17 gift-wrap as the shipping DM feature** | No client sends 1059. Relay acceptance exists for generic Nostr interop only. Already flagged in OLD BUZZ's own `docs/buzz-kind-registry-analysis.md` and `docs/BUZZ_REPO_IMPLEMENTATION_CONTEXT.md` |
| 2 | `api/bridge.rs:2035-2037` comment claims FTS indexes an **allowlist** `[0,9,40002,45001,45003]` | Schema uses a **denylist** (`schema.sql:223-227`). The cited set is the desktop client's self-imposed search scope |
| 3 | `kind.rs:57` doc comment implies reaction content is validated as an emoji | Only a ≤64-char length cap is enforced |
| 4 | `NOSTR.md` calls thread retrieval "REST thread queries" | It is a Nostr-filter-shaped bridge `/query` with non-standard extensions |
| 5 | `NOSTR.md` omits kinds 40004/40005/40006/40008 and the `before_id`/window/reconnect-repair mechanics entirely | Implemented in `kind.rs`/`ingest.rs` |

---

## §8. PROTOCOL TABLE

| Feature | OLD BUZZ kind/API | Tags | Storage | Read path | Write path | Authorization | Realtime | Reconnect | SWF status |
|---|---|---|---|---|---|---|---|---|---|
| Messages | 9, 40002 | `h`, `p`, `e`, `imeta` | `events`, newest-first | REQ `#h` + `before_id`; bridge window + 39006 | EVENT | NIP-42 + channel membership | one broad REQ | `since−skew` + cursor repair | PARTIAL |
| Threads | 9 + NIP-10 | `e` root/reply markers | `thread_metadata` (txn-atomic) | bridge `/query` + `depth_limit`/cursor | EVENT | as messages; depth ≤100 | 39005 on channel sub | generic | PARTIAL |
| Reactions | 7 | `e` only (+`emoji`) | `reactions`, PK-deduped | REQ `#h`; `/query` `#e` | EVENT | membership on target's channel | channel sub | generic | PARTIAL |
| Reaction removal | 5 | `e` = reaction id | soft-delete | same | EVENT | self / agent-owner | channel sub | generic | **INCORRECT** |
| Edits | 40003 | `e` = target | new row, original kept | client overlay | EVENT | relay-enforced authorship | channel sub | replay | **MISSING** |
| Deletion (self) | 5 | `e`/`a` | `deleted_at` tombstone | filtered | EVENT | self / agent-owner | channel sub | replay | **MISSING** |
| Deletion (admin) | **9005** | `e` + `h` | tombstone + 40099 | filtered | EVENT | author / channel owner / admin | channel sub | replay | **MISSING** |
| Search | NIP-50 `search` | — | `search_tsv` FTS | WS REQ or bridge `/query` | — | re-gated per event | n/a | n/a | **MISSING** |
| Unread | **30078** (NIP-RS) | `d=read-state:<hex>`, `t` | encrypted blob | filter by author+`#t` | EVENT | self only | live sub | re-fetch+merge | **MISSING** |
| Mentions | `p` tag on 9 | `p` | `event_mentions` index | feed join | with message | — | with message | with message | PARTIAL |
| Inbox | bridge `feed` flag | — | computed | `/query` + feed | — | `reader_authorized_for_event` | poll | poll | **MISSING** |
| Attachments | Blossom + `imeta` | `imeta` | blob store + sidecar | `GET /media/{hash}` | `PUT /upload` kind:24242 | membership + rate limit | n/a | n/a | **MISSING** |
| Profiles | 0 | — | `users(community_id,pubkey)` | REQ kind 0 | EVENT | self | live | re-fetch | PARTIAL |
| DMs | **41010**/41011/41012/30622 + 9 | `p`, `d`, `h` | `channels(type=dm)` | discovery + `#h` | EVENT | membership, tenant-scoped | 44100 + channel sub | generic | **PASS (shape)** |
| Presence | 20001 | — | Redis, TTL 180 s | ephemeral sub | EVENT | membership | Redis + local | heartbeat | PARTIAL |
| Typing | 20002 | `h`, `e` | none | ephemeral sub | EVENT | membership | Redis + local | n/a | PASS |

---

## §9. GAP MATRIX (OLD BUZZ → CURRENT SWF)

| Feature | OLD BUZZ | Current SWF | Status | Gap | Required | Risk |
|---|---|---|---|---|---|---|
| Message kinds | 8 kinds | 9, 40002 only (`protocol/kinds.ts`) | PARTIAL | no edit/pin/bookmark/schedule/diff | add 40003 at minimum | Low |
| Older pagination | `before_id` keyset + 39006 authority | bare `until`; exhaustion inferred from empty page (`useChannelMessages.ts:35-61`) | INCORRECT | same-timestamp burst can drop/repeat; false "end of history" | adopt `before_id`; consume 39006 | **High** |
| Live delivery | one combined REQ | separate `since:now()` sub (`MessageService.ts:95-109`) | PARTIAL | window between fetch and subscribe | single REQ | Medium |
| Reconnect repair | `since−skew` + cursor backfill | re-runs original filter unchanged (`RelayConnectionService.ts:290-292`) | MISSING | **silent message loss across a drop** | port repair | **High** |
| Optimistic failure | rollback + restore draft | `status:"failed"` retained (`useSendMessage.ts:66-74`) | DIVERGENT | arguably better than OLD BUZZ | keep; document | Low |
| Threads | bridge `/query` + depth/cursor + 39005 | unbounded `#e` fetch; per-thread sub; **two parallel impls** | PARTIAL | no pagination, no server counts, duplicate stacks | consolidate | **High** |
| Reaction removal live | kind:5 fans out normally | sub is `kinds:[7]` only; comment claims a relay limitation (`ReactionService.ts:152-166`) | **INCORRECT** | removals never arrive live; **the stated cause is false** | add kind:5 to filter; fix comment | Medium |
| Edits | 40003, relay-enforced | absent entirely | MISSING | whole feature | 4B | Medium |
| Deletion | 5 + 9005 | kind:5 used only for reaction retraction | MISSING | no message delete, no admin delete | 4B | Medium |
| Search | NIP-50 | no `features/search` at all | MISSING | whole feature | 4C | Medium |
| Unread | 30078 relay-synced | localStorage only (`stores/readState.ts`) | INCORRECT | no cross-device/reinstall continuity; **comment states a false premise** | 4C | Medium |
| Inbox | server-aggregated feed | none | MISSING | whole feature | 4C | Medium |
| Composer | rich text, emoji, custom emoji, voice, attachments | plain `<textarea>` + minimal mention dropdown | PARTIAL | most of it | 4D | Medium |
| Attachments | Blossom + imeta | none | MISSING | whole feature | 4D | Medium |
| Profiles | per-community rows; 5 fields | replicated across communities; no `nip05` | DIVERGENT | deliberate UX choice; `nip05` genuinely missing | document + add nip05 | Low |
| Designation field | **does not exist** | does not exist | n/a | would be NEW protocol | decide explicitly | Medium |
| DMs | 41010 + 9 | 41010 + 9 (`protocol/dm.ts`) | **PASS (shape)** | receiver discovery via 44100 not wired; 41011 mislabelled | 4E | Low |
| Presence | 20001 + Redis | 20001, self-flagged best-effort | PARTIAL | multi-node unverified | 4F | Low |
| Typing | 20002, 3 s throttle | same, same throttle | PASS | — | — | Low |
| Custom status | 30315 | absent | MISSING | whole feature | optional | Low |

**Cross-cutting theme:** SWF reproduces OLD BUZZ's **wire shapes** faithfully but
consistently drops the relay's **authoritative pagination and gap-repair
signals**, substituting heuristics (empty-page-means-done, fixed `since` at
mount, plain re-subscribe). That is the single highest-risk pattern in the
matrix and it is why 4A comes first.
