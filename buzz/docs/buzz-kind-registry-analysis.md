# Buzz Kind Registry & Protocol Implementation Analysis

**Purpose:** ground-truth reference for the SWF Tauri Client, based entirely on evidence read from this repository (`C:\Users\Pranshul\Downloads\buzz2.0\buzz`) as of 2026-09-10. No kind numbers, tag shapes, or flows in this document are assumed from generic Nostr NIPs — every claim below is traced to a specific file. Uncertain or unverified points are called out explicitly under **⚠️ Uncertain**.

---

## 1. Source of Truth

The authoritative kind registry is **`crates/buzz-core/src/kind.rs`**. It is the single file all other crates and clients import constants from:

- All kind values are declared as `pub const KIND_*: u32 = <n>;`.
- `ALL_KINDS: &[u32]` — flat list of every registered constant, checked for duplicates by a unit test (`no_duplicate_kind_values`).
- Range predicates: `is_ephemeral()` (20000–29999), `is_replaceable()` (0, 3, 41, 10000–19999), `is_parameterized_replaceable()` (30000–39999).
- Access-control sets: `AUTHOR_ONLY_KINDS`, `RESULT_GATED_KINDS`, `P_GATED_KINDS`, `SHARED_GATED_KINDS` — these determine relay-side read visibility per kind, independent of channel membership.
- Behavioral predicates: `is_moderation_command_kind()`, `is_relay_admin_kind()`, `is_identity_archive_request_kind()`, `is_command_kind()`, `is_relay_only_kind()`, `is_workflow_execution_kind()`.
- Downstream mirrors (must stay in sync per `AGENTS.md`):
  - `desktop/src/shared/constants/kinds.ts` — TypeScript mirror used by the desktop app, plus UI-only groupings (`CHANNEL_EVENT_KINDS`, `CHANNEL_TIMELINE_CONTENT_KINDS`, `CHANNEL_AUX_EVENT_KINDS`, `NON_CONVERSATIONAL_UNREAD_KINDS`).
  - `mobile/lib/shared/relay/nostr_models.dart` — Flutter mirror.
  - `crates/buzz-sdk/src/builders.rs` — typed `EventBuilder` constructors used by real clients (desktop Tauri backend, `buzz-cli`, `buzz-acp`).

Per `AGENTS.md`: *"Event kinds: All event kind integers are defined in `buzz-core/src/kind.rs`. New features get new kind integers — add them here first, then implement handling in the relay."* New feature work is modeled as new Nostr kinds, not new HTTP endpoints (HTTP is reserved for media, webhooks, git, NIP-11/05, health checks, and the generic bridge: `POST /events`, `POST /query`, `POST /count`).

Custom protocol extensions ("NIPs") beyond standard Nostr NIPs are documented under `docs/nips/`: `NIP-AA`, `NIP-AE` (agent engram), `NIP-AM` (agent turn metric), `NIP-AO`, `NIP-AP` (agent persona), `NIP-CW`, `NIP-DV` (DM visibility), `NIP-ER` (event reminder), `NIP-FI`, `NIP-GS`, `NIP-IA` (identity archival), `NIP-MP` (multi-repo project), `NIP-OA` (owner attestation for agents), `NIP-PL` (push lease), `NIP-PMA` (private managed agent), `NIP-RS`, `NIP-WP`.

**⚠️ Uncertain:** `NOSTR.md` (repo root) contains a hand-maintained implementation-status table that in places disagrees with the code (see §6, DMs). Treat `kind.rs` and the actual handler code as authoritative over `NOSTR.md`'s prose when they conflict, and treat `NOSTR.md` as a leads-only pointer, not a verified source.

---

## 2. Complete Kind Registry Table

Extracted verbatim from `crates/buzz-core/src/kind.rs`. "Used By" is inferred from where the kind is actually constructed/handled (Relay = `crates/buzz-relay`, Desktop = `desktop/`, Mobile = `mobile/`, SDK = `crates/buzz-sdk`, ACP = `crates/buzz-acp`/`buzz-agent`, CLI = `crates/buzz-cli`).

### Standard NIP kinds

| Kind | Constant | Purpose | Used By | File |
|---|---|---|---|---|
| 0 | `KIND_PROFILE` | NIP-01 user profile metadata | Relay, Desktop, Mobile | `kind.rs:9` |
| 1 | `KIND_TEXT_NOTE` | NIP-01 short text note | Relay | `kind.rs:11` |
| 3 | `KIND_CONTACT_LIST` | NIP-02 contact/follow list | Relay | `kind.rs:13` |
| 5 | `KIND_DELETION` | NIP-09 event deletion request | Relay, Desktop | `kind.rs:56` |
| 7 | `KIND_REACTION` | NIP-25 reaction (emoji/+/-) | SDK, Relay, Desktop | `kind.rs:58` |
| 41 | `KIND_CHANNEL_METADATA` | NIP-01 channel metadata — **not used by Buzz today** | — | `kind.rs:54` |
| 1059 | `KIND_GIFT_WRAP` | NIP-17 outer envelope for private DMs | Relay (protocol plumbing only) | `kind.rs:60` |
| 1063 | `KIND_FILE_METADATA` | NIP-94 file metadata attachment | Relay | `kind.rs:62` |
| 10000 | `KIND_MUTE_LIST` | NIP-51 mute list (replaceable) | Relay, Desktop | `kind.rs:17` |
| 10001 | `KIND_PIN_LIST` | NIP-51 pin list (replaceable) | Relay, Desktop | `kind.rs:22` |
| 10002 | `KIND_NIP65_RELAY_LIST_METADATA` | NIP-65 relay list metadata | Relay | `kind.rs:27` |
| 10003 | `KIND_BOOKMARK_LIST` | NIP-51 bookmark list | Relay, Desktop | `kind.rs:32` |
| 10030 | `KIND_EMOJI_LIST` | NIP-51 emoji list | Relay, Desktop | `kind.rs:34` |
| 22242 | `KIND_AUTH` | NIP-42 auth event — never stored | Relay | `kind.rs:77` |
| 24242 | `KIND_BLOSSOM_AUTH` | BUD-01 Blossom upload auth — never stored | Relay | `kind.rs:79` |
| 24243 | `KIND_NOSTR_IDENTITY_BINDING` | Buzz one-time identity binding proof — ephemeral, not stored | Relay | `kind.rs:81` |
| 27235 | `KIND_HTTP_AUTH` | NIP-98 HTTP auth — never stored | Relay (bridge) | `kind.rs:83` |
| 30000 | `KIND_FOLLOW_SET` | NIP-51 follow set (param. replaceable) | Relay | `kind.rs:39` |
| 30003 | `KIND_BOOKMARK_SET` | NIP-51 bookmark set | Relay | `kind.rs:43` |
| 30023 | `KIND_LONG_FORM` | NIP-23 long-form content | Relay | `kind.rs:66` |
| 30030 | `KIND_EMOJI_SET` | NIP-51/30 emoji set (per-member palette) | Relay, Desktop | `kind.rs:52` |
| 30078 | `KIND_READ_STATE` | NIP-78 read-state blob (and other d-tag-keyed app data: channel-sections, channel-mutes, channel-stars, channel-sort, theme) — NIP-44-encrypted to self | Relay, Desktop | `kind.rs:75`, `desktop/src/shared/constants/kinds.ts:45-54` |
| 30315 | `KIND_USER_STATUS` | NIP-38 user status | Relay | `kind.rs:70` |
| 1984 | `KIND_REPORT` | NIP-56 report (event/pubkey/blob) | Relay | `kind.rs:327` |

### Buzz stream messaging (channels)

| Kind | Constant | Purpose | Used By | File |
|---|---|---|---|---|
| 9 | `KIND_STREAM_MESSAGE` | NIP-29 group chat message — **the actual wire kind published for every channel/DM message today**; also the agent-shutdown convention (`!shutdown` content + `#p` mention) | SDK, Relay, Desktop, ACP | `kind.rs:479` |
| 40002 | `KIND_STREAM_MESSAGE_V2` | Successor kind; fully registered, validated, stored, and subscribed-to, but **no construction call-site was found anywhere in this repo** (desktop, mobile, SDK, CLI, ACP) — see §4/§6.1 | Relay (read/validate/store only) | `kind.rs:481` |
| 40003 | `KIND_STREAM_MESSAGE_EDIT` | Message edit | Relay, Desktop | `kind.rs:483` |
| 40004 | `KIND_STREAM_MESSAGE_PINNED` | Pinned message | Relay | `kind.rs:485` |
| 40005 | `KIND_STREAM_MESSAGE_BOOKMARKED` | Bookmarked message | Relay | `kind.rs:487` |
| 40006 | `KIND_STREAM_MESSAGE_SCHEDULED` | Scheduled message | Relay | `kind.rs:489` |
| 40007 | `KIND_STREAM_REMINDER` | Reminder attached to a message/time | Relay | `kind.rs:491` |
| 40008 | `KIND_STREAM_MESSAGE_DIFF` | Diff/patch message (unified diff) | Relay, Desktop | `kind.rs:493` |
| 40099 | `KIND_SYSTEM_MESSAGE` | System row (join/leave/rename/channel-created) | Relay, Desktop | `kind.rs:497` |
| 40100 | `KIND_CANVAS` | Shared document/canvas for a channel | Relay | `kind.rs:495` |
| 39005 | `KIND_THREAD_SUMMARY` | Relay-synthesized thread overlay (never client-submitted) | Relay | `kind.rs:435` |
| 39006 | `KIND_WINDOW_BOUNDS` | Relay-synthesized pagination overlay (never client-submitted) | Relay | `kind.rs:439` |
| 40901 | `KIND_CHANNEL_SUMMARY` | Relay-only sidecar: channel metadata w/ computed fields | Relay | `kind.rs:501` |
| 40902 | `KIND_PRESENCE_SNAPSHOT` | Relay-only sidecar: bulk presence — **declared but no code path emits an event actually tagged 40902**; see §8 | Relay (filter-alias only) | `kind.rs:503` |

### NIP-29 group state & admin

| Kind | Constant | Purpose | Used By | File |
|---|---|---|---|---|
| 9000 | `KIND_NIP29_PUT_USER` | Add user to a group (channel) | Relay | `kind.rs:335` |
| 9001 | `KIND_NIP29_REMOVE_USER` | Remove user from a group | Relay | `kind.rs:337` |
| 9002 | `KIND_NIP29_EDIT_METADATA` | Edit group metadata | Relay | `kind.rs:339` |
| 9005 | `KIND_NIP29_DELETE_EVENT` | Delete an event from a group | Relay, Desktop | `kind.rs:341` |
| 9007 | `KIND_NIP29_CREATE_GROUP` | Create a new group (channel) | Relay | `kind.rs:343` |
| 9008 | `KIND_NIP29_DELETE_GROUP` | Delete a group | Relay | `kind.rs:345` |
| 9009 | `KIND_NIP29_CREATE_INVITE` | Create invite — **accepted/stored, side-effect handler deferred (no-op with warning log)**; real invites are relay-only HTTP (see §6.3) | Relay (accept, no-op) | `kind.rs:347`; `NOSTR.md:81` |
| 9021 | `KIND_NIP29_JOIN_REQUEST` | Request to join a group | Relay | `kind.rs:349` |
| 9022 | `KIND_NIP29_LEAVE_REQUEST` | Request to leave a group | Relay | `kind.rs:351` |
| 39000 | `KIND_NIP29_GROUP_METADATA` | Addressable group metadata (d=channel id) | Relay, Desktop | `kind.rs:422` |
| 39001 | `KIND_NIP29_GROUP_ADMINS` | Addressable group admins list | Relay | `kind.rs:424` |
| 39002 | `KIND_NIP29_GROUP_MEMBERS` | Addressable group members list — **source of truth for "what channels am I in"** via `d`-tag + `#p` filter | Relay, Desktop | `kind.rs:426` |
| 39003 | `KIND_NIP29_GROUP_ROLES` | Addressable group roles — **defined but not emitted by the relay** | — | `kind.rs:428`; `NOSTR.md:82` |

### NIP-43 relay/community membership

| Kind | Constant | Purpose | Used By | File |
|---|---|---|---|---|
| 9030 | `RELAY_ADMIN_ADD_MEMBER` | Add pubkey to relay member list (workspace-wide) | Relay | `kind.rs:389` |
| 9031 | `RELAY_ADMIN_REMOVE_MEMBER` | Remove pubkey from relay member list | Relay | `kind.rs:391` |
| 9032 | `RELAY_ADMIN_CHANGE_ROLE` | Change role of existing relay member (owner-only) | Relay | `kind.rs:393` |
| 9033 | `RELAY_ADMIN_SET_WORKSPACE_PROFILE` | Set workspace profile/icon | Relay | `kind.rs:395` |
| 8000 | `KIND_NIP43_MEMBER_ADDED` | Relay-signed member-added announcement | Relay, Desktop | `kind.rs:400` |
| 8001 | `KIND_NIP43_MEMBER_REMOVED` | Relay-signed member-removed announcement | Relay | `kind.rs:402` |
| 13534 | `KIND_NIP43_MEMBERSHIP_LIST` | Relay-signed full membership snapshot (relay-only, addressable by convention) | Relay | `kind.rs:398` |
| 28936 | `KIND_NIP43_LEAVE_REQUEST` | User leave request (ephemeral) | Relay | `kind.rs:404` |

### Identity archival (NIP-IA)

| Kind | Constant | Purpose | Used By | File |
|---|---|---|---|---|
| 9035 | `KIND_IA_ARCHIVE_REQUEST` | Request to archive an identity | Relay | `kind.rs:408` |
| 9036 | `KIND_IA_UNARCHIVE_REQUEST` | Request to unarchive an identity | Relay | `kind.rs:410` |
| 8002 | `KIND_IA_ARCHIVED` | Relay-signed archived-identity delta | Relay | `kind.rs:414` |
| 8003 | `KIND_IA_UNARCHIVED` | Relay-signed unarchived-identity delta | Relay | `kind.rs:416` |
| 13535 | `KIND_IA_ARCHIVED_LIST` | Relay-signed archived-identities snapshot | Relay | `kind.rs:418` |

### Community moderation

| Kind | Constant | Purpose | Used By | File |
|---|---|---|---|---|
| 9040 | `KIND_MODERATION_BAN` | Ban a pubkey (command, never stored) | Relay | `kind.rs:358` |
| 9041 | `KIND_MODERATION_UNBAN` | Lift a ban | Relay | `kind.rs:360` |
| 9042 | `KIND_MODERATION_TIMEOUT` | Timeout (write-block) a pubkey | Relay | `kind.rs:363` |
| 9043 | `KIND_MODERATION_UNTIMEOUT` | Clear a timeout early | Relay | `kind.rs:365` |
| 9044 | `KIND_MODERATION_RESOLVE_REPORT` | Resolve a report | Relay | `kind.rs:370` |
| 42000 | `KIND_PRODUCT_FEEDBACK` | Product feedback — accepted, sidecarred, never fanned out | Relay | `kind.rs:331` |

### Direct messages (41000–41999)

| Kind | Constant | Purpose | Used By | File |
|---|---|---|---|---|
| 41001 | `KIND_DM_CREATED` | Signal: new DM conversation was created | Relay | `kind.rs:513` |
| 41010 | `KIND_DM_OPEN` | Open/create DM (`p` tags = participants) — **the real DM creation kind** | SDK, Relay, Desktop | `kind.rs:507` |
| 41011 | `KIND_DM_ADD_MEMBER` | Add member to group DM (creates a **new** DM — sets are immutable) | Relay, Desktop | `kind.rs:509` |
| 41012 | `KIND_DM_HIDE` | Hide DM from sidebar | Relay, Desktop | `kind.rs:511` |
| 30622 | `KIND_DM_VISIBILITY` | NIP-DV: relay-signed, per-viewer DM-hidden snapshot (param. replaceable, d=viewer pubkey) | Relay | `kind.rs:449` |

### Agent identity, memory, and job protocol

| Kind | Constant | Purpose | Used By | File |
|---|---|---|---|---|
| 10100 | `KIND_AGENT_PROFILE` | Agent metadata + owner reference (replaceable) | Relay, Desktop | `kind.rs:87` |
| 24200 | `KIND_AGENT_OBSERVER_FRAME` | Ephemeral owner-scoped encrypted observer/control frame | Relay | `kind.rs:469` |
| 30174 | `KIND_AGENT_ENGRAM` | NIP-AE encrypted agent memory (param. replaceable, d=HMAC of conversation key) | ACP, Relay | `kind.rs:94`; `docs/nips/NIP-AE.md` |
| 30175 | `KIND_PERSONA` | NIP-AP agent persona definition (owner-authored, shared-tag-gated reads) | ACP, Desktop, Relay | `kind.rs:196`; `docs/nips/NIP-AP.md` |
| 30176 | `KIND_TEAM` | NIP-AP team definition (owner-private reads — deliberately NOT shared-gated) | Desktop, Relay | `kind.rs:282` |
| 30177 | `KIND_MANAGED_AGENT` | NIP-AP managed-agent definition (opt-in allowlist projection) | Desktop, Relay | `kind.rs:291` |
| 30178 | `KIND_TEAM_CATALOG` | NIP-AP shareable team-catalog projection (shared-tag-gated) | Desktop, Relay | `kind.rs:319`; `docs/nips/NIP-AP.md:227-234` |
| 30179 | `KIND_PRIVATE_MANAGED_AGENT` | NIP-PMA owner-encrypted private managed-agent aggregate | Relay | `kind.rs:118` |
| 44200 | `KIND_AGENT_TURN_METRIC` | NIP-AM durable per-turn token-usage record, NIP-44-encrypted to owner | ACP, Relay | `kind.rs:545`; `docs/nips/NIP-AM.md` |
| 43001 | `KIND_JOB_REQUEST` | Agent job requested — **reserved; no construction/handling code found anywhere in the repo** | — (unimplemented) | `kind.rs:518` |
| 43002 | `KIND_JOB_ACCEPTED` | Job accepted — unimplemented | — | `kind.rs:520` |
| 43003 | `KIND_JOB_PROGRESS` | Job progress update — unimplemented | — | `kind.rs:522` |
| 43004 | `KIND_JOB_RESULT` | Job result — unimplemented | — | `kind.rs:524` |
| 43005 | `KIND_JOB_CANCEL` | Job cancellation — unimplemented | — | `kind.rs:526` |
| 43006 | `KIND_JOB_ERROR` | Job error — unimplemented | — | `kind.rs:528` |
| 44100 | `KIND_MEMBER_ADDED_NOTIFICATION` | Relay-signed: target was added to a channel (`p`=target, `h`=channel) | Relay, Desktop | `kind.rs:532` |
| 44101 | `KIND_MEMBER_REMOVED_NOTIFICATION` | Relay-signed: target was removed from a channel | Relay, Desktop | `kind.rs:536` |

### Ephemeral (20000–29999, never stored)

| Kind | Constant | Purpose | Used By | File |
|---|---|---|---|---|
| 20001 | `KIND_PRESENCE_UPDATE` | User presence update (online/away/offline) | Relay, Desktop | `kind.rs:463` |
| 20002 | `KIND_TYPING_INDICATOR` | Typing indicator for a channel | Relay, Desktop | `kind.rs:467` |
| 24134 | `KIND_PAIRING` | NIP-AB device pairing event | Relay | `kind.rs:465` |
| 24810 | `KIND_HUDDLE_REACTION` | Huddle emoji reaction burst | Relay | `kind.rs:472` |

### Other (workflow, huddle, git, misc — listed for completeness, not detailed further)

| Kind | Constant | Purpose |
|---|---|---|
| 30300 | `KIND_EVENT_REMINDER` | NIP-ER encrypted, author-only reminder |
| 30350 | `KIND_PUSH_LEASE` | NIP-PL encrypted push lease (author-only) |
| 30620 | `KIND_WORKFLOW_DEF` | Workflow definition |
| 46001–46012 | `KIND_WORKFLOW_*` | Workflow execution lifecycle events |
| 45001–45003 | `KIND_FORUM_*` | Forum post/vote/comment |
| 48001 | `KIND_AUDIT_ENTRY` | Audit log entry |
| 48100–48106 | `KIND_HUDDLE_*` | Huddle (audio/video) lifecycle |
| 49001 | `KIND_MEDIA_UPLOAD` | Internal media-upload audit (not a relay event kind) |
| 1617–1633 | `KIND_GIT_*` | NIP-34 git repo/patch/PR/issue events |
| 30617, 30618, 30621 | `KIND_GIT_REPO_ANNOUNCEMENT`, `KIND_GIT_REPO_STATE`, `KIND_PROJECT` | NIP-34/NIP-MP repo & project state |

---

## 3. Feature-by-Feature Detail

### Channel Messages

**Kind Number:** 9 (`KIND_STREAM_MESSAGE`) — confirmed as the kind actually emitted by every traced send path.
**Constant:** `KIND_STREAM_MESSAGE` (`crates/buzz-core/src/kind.rs:479`)
**Payload Structure:** `content` is plain text (validated, not JSON) — `check_content` in the relay ingest path.
**Required Tags:** `["h", <channel_uuid>]` — every channel message must carry the channel/group id as an `h` tag (NIP-29 style). `requires_h_channel_scope()` in `crates/buzz-relay/src/handlers/ingest.rs` enforces this for kind 9 and 40002.
**Optional Tags:** NIP-10 thread tags (`["e", <root>, "", "root"]` / `["e", <parent>, "", "reply"]`), `p` mention tags, `imeta` media tags, NIP-30 custom-emoji tags, mention-reference tags, link-preview tags, a client-provenance tag, a `broadcast` tag.
**Signing Requirements:** Standard NIP-01 Schnorr signature over the serialized event; signed by the sending user's (or agent's) own keypair. On desktop, signing happens **inside the Rust Tauri backend**, not in the JS/React layer.
**Publishing Flow:** see §4 below.
**Relay Validation Flow:** `ingest_event` → `ingest_event_inner` (`crates/buzz-relay/src/handlers/ingest.rs:2110, 2170`) → scope check (`required_scope_for_kind` → `Scope::MessagesWrite`) → `requires_h_channel_scope` → channel-membership check → NIP-10 thread resolution (`resolve_nip10_thread_meta`) → storage.
**Files Referenced:**
- Builder: `crates/buzz-sdk/src/builders.rs:231-263` (`build_message`)
- Desktop builder: `desktop/src-tauri/src/events.rs:285-313` (`build_message_with_client_tags`)
- Desktop command: `desktop/src-tauri/src/commands/messages.rs:409-526` (`send_channel_message`, kind defaults to 9 at line 450)
- Relay ingest: `crates/buzz-relay/src/handlers/ingest.rs`
- Storage: `crates/buzz-db/src/store/event.rs:1334-1510` (`insert_event_with_thread_metadata`)
- Fan-out: `crates/buzz-relay/src/handlers/event.rs:396` (`dispatch_persistent_event_inner`), `crates/buzz-pubsub/src/publisher.rs:22`, `crates/buzz-pubsub/src/topic.rs:43`

**⚠️ Uncertain:** `KIND_STREAM_MESSAGE_V2` (40002) is the "documented successor" per the code comment at `kind.rs:474` ("V1 used kind:10001 ... then 40001"), and it is fully wired into the relay's validation/storage/read paths and the desktop's timeline-rendering kind sets (`CHANNEL_TIMELINE_CONTENT_KINDS` in `kinds.ts:138-150`). But **no construction call site for kind 40002 was found** in `desktop/`, `mobile/`, `crates/buzz-sdk`, `crates/buzz-cli`, or `crates/buzz-acp`. Every live send path (`events.rs:313`, `messages.rs:450`) hardcodes/defaults to kind **9**. Treat kind 9 as the current production wire format for channel and DM messages; do not assume 40002 is live without re-verifying against the current desktop code at implementation time.

### Thread Replies

**Kind Number:** same event kinds as channel messages (9 / 40002) — a "thread reply" is a regular message event carrying NIP-10 tags, not a distinct kind. `KIND_THREAD_SUMMARY` (39005) is a separate relay-synthesized *overlay* kind, never a message itself.
**Constant:** N/A (uses `KIND_STREAM_MESSAGE`); overlay is `KIND_THREAD_SUMMARY`.
**Payload Structure:** identical to a normal message.
**Required Tags (for a reply):** exactly the NIP-10 marker shape produced by `thread_tags()` (`crates/buzz-sdk/src/builders.rs:177-190`), given a `ThreadRef { root_event_id, parent_event_id }`:
```rust
if root == parent {
    tags.push(tag(&["e", &root, "", "reply"])?);       // direct reply to the root
} else {
    tags.push(tag(&["e", &root, "", "root"])?);          // nested reply
    tags.push(tag(&["e", &parent, "", "reply"])?);
}
```
Parsing/resolution mirrors this in `crates/buzz-core/src/nip10.rs` (`parse_thread_markers` / `resolve()`): `root`+`reply` markers → `(root, reply)`; `reply`-only → `(reply, reply)`; anything else → not a threaded reply. Event ids must be 64-hex-char.
**Optional Tags:** none beyond the standard message tag set.
**Signing Requirements:** same as channel messages.
**Publishing Flow:** identical to channel messages; the only difference is the extra `e` tag(s) supplied by the composer when replying.
**Relay Validation Flow:** `resolve_nip10_thread_meta` (`crates/buzz-relay/src/handlers/ingest.rs:816-921`) parses the markers, looks up the parent's `thread_metadata` row, validates same-channel membership and a depth cap of ≤100, then the insert transaction updates counters.
**Files Referenced:**
- Tag builder: `crates/buzz-sdk/src/builders.rs:177-190` (tests: `message_direct_reply`, `message_nested_reply`, lines 2499-2543)
- Parser: `crates/buzz-core/src/nip10.rs`
- Relay resolution: `crates/buzz-relay/src/handlers/ingest.rs:816-921`
- Counter materialization: `crates/buzz-db/src/store/thread.rs:129-261` (`insert_thread_metadata`) — runs both `reply_count` and `descendant_count` `UPDATE`s in the same transaction as the insert, guarded by `ON CONFLICT DO NOTHING` + `rows_affected() > 0` to prevent double counting.
- Schema: `schema/schema.sql:514-536`, table `thread_metadata` (`event_id, channel_id, parent_event_id, root_event_id, depth, reply_count, descendant_count, last_reply_at, broadcast`).
- Live overlay: `emit_live_thread_summary` (`crates/buzz-relay/src/handlers/side_effects.rs:744-815`) — re-reads counts post-commit (never increments directly), content `{reply_count, descendant_count, last_reply_at, participants}`, tags `["e", root], ["d", root], ["h", channel_id]`, signed by the relay keypair.
- Query-time overlay: `crates/buzz-relay/src/api/bridge.rs:643-666`, gated by an `include_summaries` extension flag; also documented in `docs/bridge-channel-window.md:98-101`.
- Pagination overlay `KIND_WINDOW_BOUNDS` (39006): `bridge.rs:668-687`, content `{has_more, next_cursor: {created_at, id}}`, tags `["d", "<channel_id>:<cursor>"], ["h", channel_id]` — query-time only, no live-push equivalent.

Note: `AGENTS.md` "Thread counters" gotcha is confirmed directly in code: any handler that inserts a reply must update `reply_count`/`descendant_count` — `insert_thread_metadata` is the single chokepoint that does this atomically with the insert.

### Reactions

**Kind Number:** 7 (`KIND_REACTION`)
**Constant:** `KIND_REACTION` (`crates/buzz-core/src/kind.rs:58`, NIP-25)
**Payload Structure:** `content` is the emoji (or `+`/`-`), max 64 chars, or a NIP-30 `:shortcode:` referencing an `emoji` tag. Empty content defaults to `"+"` at ingest (`ingest.rs:3059-3063`).
**Required Tags:** `["e", <target_event_id>]` only.
**Optional Tags:** `["emoji", <shortcode>, <url>]` for custom emoji (content becomes `":shortcode:"`).
**Signing Requirements:** standard, signed by the reacting user's keypair.
**Publishing Flow:** UI (`MessageReactions.tsx`, `InlineReactionPicker`/`EmojiPicker`) → `useReactionHandler.ts` (optimistic) → `desktop/src/features/messages/hooks.ts:769-796` (`useToggleReactionMutation`) → `desktop/src/shared/api/tauri.ts:581-594` (`addReaction`/`removeReaction`) → Rust `desktop/src-tauri/src/commands/messages.rs:815-867` builds via `buzz_sdk::build_reaction`/`build_custom_emoji_reaction` and submits.
**Relay Validation Flow:** no client `h` tag is required or sent — `derive_reaction_channel` (`crates/buzz-relay/src/handlers/ingest.rs:573-611`) looks up the target event and reuses **its** `channel_id`; `requires_h_channel_scope` explicitly excludes `KIND_REACTION`. `validate_reaction_emoji` (`ingest.rs:160-190`) enforces the length cap / NIP-30 shape.
**Files Referenced:**
- Builder: `crates/buzz-sdk/src/builders.rs:491-525` (`build_reaction`, `build_custom_emoji_reaction`, and `build_remove_reaction` which issues a kind-5 deletion referencing the reaction event id)
- Relay: `crates/buzz-relay/src/handlers/ingest.rs:160-190, 573-611, 3059-3063`
- Storage/aggregation: `crates/buzz-db/src/store/reaction.rs:171-236` (`insert_reaction_event_with_thread_metadata`) — upserts into a dedicated `reactions` aggregation table (`schema/schema.sql:541-557`, PK `(community_id, event_created_at, event_id, pubkey, emoji)`), soft-deleting via `removed_at`; duplicate active reactions are short-circuited before the raw event is stored.
- UI aggregation for rendering: `desktop/src/features/messages/lib/formatTimelineMessages.ts:300-354` (client-side grouping by `${targetId}:${actorPubkey}:${emoji}` — the relay does not appear to pre-aggregate a reaction summary for timeline consumption; not confirmed as a REST endpoint).

**⚠️ Uncertain:** no REST endpoint returning a pre-aggregated `ReactionGroup`/count structure was located; reaction counts appear to be computed client-side from the raw kind-7 event stream. If the SWF client needs server-aggregated counts, this needs a follow-up check against `crates/buzz-relay/src/api/`.

### Direct Messages

**Kind Numbers:** `KIND_DM_OPEN` (41010) for conversation creation; **plain `KIND_STREAM_MESSAGE` (kind 9)** for actual message content, scoped by `h` tag to the DM's private channel row — the identical mechanism used for group channels.
**Constant:** `KIND_DM_OPEN`, `KIND_DM_ADD_MEMBER` (41011), `KIND_DM_HIDE` (41012), `KIND_DM_VISIBILITY` (30622).
**Payload Structure:** `KIND_DM_OPEN` content: none required beyond `p` tags of participants; relay replies with the created/found channel id. Message content: plain text, identical to channel messages.
**Required Tags:** `KIND_DM_OPEN`: one `p` tag per participant (2–9 total participants: self + 1–8 others, validated in `handle_dm_open`). Messages: `["h", <dm_channel_id>]`.
**Optional Tags:** thread/mention/media tags, same set as channel messages.
**Signing Requirements:** standard; **no NIP-44/NIP-17 encryption is applied to DM message content anywhere in the traced code.**
**Publishing Flow:** `desktop/src/features/messages/ui/NewMessageScreen.tsx` → `openDmMutation` → Tauri `open_dm` command (`desktop/src-tauri/src/commands/dms.rs:57-59`, builds via `buzz_sdk::events::build_dm_open`) → relay `handle_dm_open` (`crates/buzz-relay/src/handlers/command_executor.rs:297-353`) validates participant count, calls `state.db.open_dm(...)` (`crates/buzz-db/src/store/dm.rs`) which inserts a `channels` row with `channel_type='dm'`, `visibility='private'`. Subsequent messages use the exact same `sendChannelMessage` path as any channel (`desktop/src/features/messages/hooks.ts:591`).
**Relay Validation Flow:** `handle_dm_add_member` (`command_executor.rs:431-509`) validates caller membership in a `channel_type=='dm'` channel, then re-runs `open_dm` with the expanded participant set (comment: *"DM sets are immutable — adding a member creates a NEW DM"*). `handle_dm_hide` (`command_executor.rs:568`) validates and calls `state.db.hide_dm(...)`.
**Files Referenced:**
- Command handlers: `crates/buzz-relay/src/handlers/command_executor.rs:297-509, 568`
- DB layer: `crates/buzz-db/src/store/dm.rs` (doc comment lines 1-4: *"DMs are channels with channel_type='dm' and visibility='private'. Participant sets are immutable — adding a member creates a NEW DM."*); insert statement lines 170-172.
- Schema: `migrations/0001_initial_schema.sql:28` — `CREATE TYPE channel_type AS ENUM ('stream', 'forum', 'dm', 'workflow');` — DM is a discriminator value on the same `channels` table, not a separate table.
- Desktop builders: `desktop/src-tauri/src/commands/dms.rs:57-59`; message send default kind: `desktop/src-tauri/src/commands/messages.rs:450`.
- Mobile cross-check: `mobile/lib/shared/relay/nostr_models.dart:31-33, 54, 328-333` — same channel-based model, infers `channelType` from tag shape.

#### 🔴 A/B/C Determination — proof included

**Answer: B — `KIND_DM_OPEN` (41010) + normal `KIND_STREAM_MESSAGE` (kind 9) events, scoped as a private channel.** This is definitive, not a guess:

- No `gift_wrap`/`GiftWrap`/1059 builder exists anywhere in `crates/buzz-sdk` (the crate all real client event construction goes through).
- The only place `Kind::Custom(1059)` is ever constructed in the entire repo is `crates/buzz-test-client/tests/e2e_nostr_interop.rs` (lines 585-1044) — and even there it is used purely to test **generic relay protocol behavior** (acceptance despite pubkey mismatch, `#p`-filter-gated subscription visibility, NIP-50 search exclusion), never to send an actual DM through any channel/DM UI or API.
- `crates/buzz-relay` treats kind 1059 as **transport-protocol plumbing**: it is exempted from the "event.pubkey must equal auth pubkey" check, excluded from HTTP submission (WebSocket-only), excluded from workflow-trigger dispatch, and is one of the `P_GATED_KINDS` (`kind.rs:159-169`) so it can never leak existence to non-participants. `crates/buzz-relay/src/push_runtime.rs:317-330` has a dedicated note: *"Kind 1059 is globally stored and leaks recipient activity through wake timing"* — i.e. the relay supports **receiving** gift-wrapped events as a generic Nostr relay would, but nothing in Buzz's own feature code produces them.
- No `nip44`/`ChaCha`/`ConversationKey`/`encrypt` call exists anywhere in the DM-related desktop files (`events.rs`, `dms.rs`, `messages.rs`). The repo's actual NIP-44 usage is confined to unrelated features: NIP-AB device pairing (`crates/buzz-core/src/pairing/`), agent observer frames/engrams, and the private-managed-agent aggregate.

**⚠️ Uncertain / documentation discrepancy:** `NOSTR.md:83` states *"DMs: ⚠️ NIP-17 gift wraps supported; NIP-04/NIP-44 not implemented."* This is contradicted by the actual code evidence above — no client-side gift-wrap producer exists, and no DM feature (creation, sending, receiving) ever touches kind 1059. Treat `NOSTR.md`'s DM row as stale/aspirational and rely on the `KIND_DM_OPEN` + kind-9 flow described here. **DM message content is currently unencrypted plaintext at the Nostr-event level** (privacy is enforced only by relay-side channel-membership/`h`-tag scoping, not by client-side encryption) — the SWF client should not assume any E2E confidentiality guarantee beyond what the relay's access control provides.

### Invites

**Kind Number:** `KIND_NIP29_CREATE_INVITE` (9009) exists in the registry but is a **no-op** — accepted and stored, but the relay's side-effect handler is deferred (confirmed by `NOSTR.md:81`: *"Accepted and stored, but side-effect handler is deferred (no-op with warning log)"*, and by the absence of any handler for it in `crates/buzz-relay/src/handlers/`).
**Actual mechanism:** invites are a **relay-only HTTP + Postgres feature**, entirely separate from the Nostr event stream:
- Table: `relay_invites` (`migrations/0025_relay_invites.sql`) — `(community_id, id)` keyed, stores `token_hash` (SHA-256 of the bearer token, never the secret itself), `max_uses`/`use_count`, `expires_at`, `role` (pinned to `'member'`).
- Endpoints (`crates/buzz-relay/src/api/invites.rs`): `POST /api/invites` (`mint_invite`, line 284, requires owner/admin role, NIP-98-authed), `POST /api/invites/claim` (`claim_invite`, line 361, NIP-98-authed by the joining pubkey) — routes by token prefix: `v2.`-prefixed tokens use the DB-backed path (`claim_relay_invite`); other tokens use a legacy v1 stateless HMAC verifier (`crates/buzz-relay/src/invite_token.rs`, doc: *"no server-side invite storage is required"*).
- On successful claim, the relay publishes `KIND_NIP43_MEMBER_ADDED` (8000) + `KIND_NIP43_MEMBERSHIP_LIST` (13534) — i.e. invites grant **relay/community membership (NIP-43)**, not channel membership directly.
- No `invites` subcommand exists in `buzz-cli` — invite minting/claiming is desktop-only.
- Desktop: `desktop/src/shared/api/invites.ts` (`mintInvite`, `claimInvite`, both NIP-98-authed HTTP POSTs), UI in `desktop/src/features/community-members/ui/{InviteLinkSection,CommunityInviteDialog}.tsx` and `desktop/src/features/onboarding/{useClaimInvite.ts, ui/InviteRedeemForm.tsx}`.
**Files Referenced:** `migrations/0025_relay_invites.sql`; `crates/buzz-relay/src/api/invites.rs`; `crates/buzz-relay/src/invite_token.rs`; `desktop/src/shared/api/invites.ts`.

**For the SWF client: invites are an HTTP feature, not a Nostr event the client constructs and publishes.** Kind 9009 should not be relied upon.

### Presence

**Kind Number:** `KIND_PRESENCE_UPDATE` (20001) — client-published, ephemeral, never stored in Postgres. `KIND_PRESENCE_SNAPSHOT` (40902) is declared but **never actually emitted** (see below).
**Constant:** `KIND_PRESENCE_UPDATE`
**Payload Structure:** `content` is a bare status string: `"online" | "away" | "offline"` (legacy JSON content is also tolerated on ingest per the relay's parsing code, but the desktop client sends a bare string). `tags: []`.
**Required Tags:** none — presence is channel-less.
**Optional Tags:** none observed.
**Signing Requirements:** standard, signed by the user's own key.
**Publishing Flow:** Desktop `usePresenceSession` (`desktop/src/features/presence/hooks.ts:405-422`) heartbeats every `PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000` ms while status ≠ offline; idle→away transition after `PRESENCE_IDLE_TIMEOUT_MS = 10 * 60_000` ms via OS-level idle detection + activity-event fallback (deliberately **not** driven by window focus/blur alone). Publish call: `relayClientSession.sendPresence(status)` (`desktop/src/shared/api/relayClientSession.ts:281-295`) signs and publishes `kind: 20001`.
**Relay Ingest Flow:** `crates/buzz-relay/src/handlers/event.rs:~800-900` — on `KIND_PRESENCE_UPDATE`, content `"offline"` triggers `state.pubsub.clear_presence(...)` (Redis `DEL`); anything else triggers `state.pubsub.set_presence(...)` (Redis `SET key status EX 180`). The event then falls through to the standard **channel-less** ephemeral fan-out path (`state.pubsub.publish_event(tenant, EventTopic::Global, &event)` + local WS fan-out). **No database write occurs anywhere in this path** — confirmed against `schema/schema.sql` and all `migrations/*.sql`, which contain zero presence-related tables.
**Storage Location:** Redis only. Key scheme (`crates/buzz-pubsub/src/presence.rs`): `buzz:{community}:presence:{pubkey_hex}`, `SET ... EX 180` (TTL = 3× the 60s heartbeat interval, "so a single missed heartbeat doesn't cause presence flap"). This is a plain TTL'd key, distinct from the pub/sub topic scheme (`buzz:{community}:channel:{id}` / `buzz:{community}:global`, `crates/buzz-pubsub/src/topic.rs`) used for live event fan-out.
**Redis/Pubsub Involvement:** Redis is used two ways for presence: (1) a `SET`/`DEL` TTL'd key per pubkey as the durable "current status" store, queried via `get_presence`/`get_presence_bulk` (`MGET`); (2) the standard global pub/sub `PUBLISH` used for live fan-out of the raw kind-20001 event to connected WS subscribers.
**Bulk snapshot (40902):** `synthesize_presence` (`crates/buzz-relay/src/api/bridge.rs:2253-2330`) intercepts `/query` filters targeting kind 20001 or 40902 with non-empty `authors`, does a bulk Redis lookup, and **signs a synthetic event with the relay's own keypair — but hardcodes the output kind to `KIND_PRESENCE_UPDATE` (20001) regardless of which kind was queried.** No code anywhere constructs an event actually tagged 40902.
**Files Referenced:**
- Relay ingest: `crates/buzz-relay/src/handlers/event.rs:~800-900`
- Redis layer: `crates/buzz-pubsub/src/presence.rs` (`presence_key`, `set_presence`, `clear_presence`, `PRESENCE_TTL_SECS`)
- Snapshot synthesis: `crates/buzz-relay/src/api/bridge.rs:2253-2330`
- Desktop publish: `desktop/src/features/presence/hooks.ts`, `desktop/src/shared/api/relayClientSession.ts:281-295`
- Desktop read: `desktop/src/shared/api/tauri.ts:341` (`getPresence`) → Tauri `get_presence` (`desktop/src-tauri/src/commands/profile.rs:338-393`, an actual `PresenceStatus` enum at lines 376-379) → queries `{"kinds":[20001], "authors": [...]}` directly, **not** 40902.
- Desktop live subscription: `desktop/src/shared/api/presenceRelaySubscription.ts` — REQ `{kinds:[20001], authors, limit:0}`.
- Rendering: `desktop/src/features/presence/lib/presence.ts`, `desktop/src/features/presence/ui/PresenceBadge.tsx`.
- Typing indicators (comparison): channel-scoped ephemeral kind 20002, no Redis TTL key — expiry is purely client-side (`desktop/src/features/messages/useChannelTyping.ts`, `TYPING_INDICATOR_TTL_MS = 8_000`).

**⚠️ Uncertain:** No relay-side background sweep/cron was found that explicitly announces "went offline" when a presence TTL expires — absence of a Redis key is interpreted client-side as offline, not pushed as an event. `KIND_PRESENCE_SNAPSHOT` (40902)'s divergence from its own doc comment ("Bulk presence state (relay-signed sidecar)") vs. actual code (always emits kind 20001) should be confirmed with the Buzz team before the SWF client is built around it — it currently appears to be an unused/aliased kind number.

### Community Membership

Buzz has **two distinct, non-overlapping membership systems** — this distinction is load-bearing for the SWF client's data model:

| Aspect | Channel membership (NIP-29) | Community/relay membership (NIP-43) |
|---|---|---|
| Scope | One channel | Entire relay/community (tenant-wide) |
| Command kinds | 9000 (PUT_USER), 9001 (REMOVE_USER), 9021 (JOIN_REQUEST), 9022 (LEAVE_REQUEST) | 9030 (ADD_MEMBER), 9031 (REMOVE_MEMBER), 9032 (CHANGE_ROLE), 9033 (SET_WORKSPACE_PROFILE) |
| Storage | `channel_members` table; mirrored as channel-scoped Nostr events 39000/39001/39002/39003 | `relay_members` table; **not** stored as ordinary Nostr events — processed directly |
| Relay-signed announcements | 39000/39001/39002 (channel-scoped, historical-REQ-only, no live global fan-out) | 8000 (member-added delta), 8001 (member-removed delta), 13534 (full list snapshot) — globally fanned out |
| Handler | `crates/buzz-relay/src/handlers/side_effects.rs` (`handle_put_user`, `handle_remove_user`) + pure policy in `channel_authz.rs` | `crates/buzz-relay/src/handlers/relay_admin.rs` |
| User-facing notification | 44100/44101, `p`=target, `h`=channel UUID | Indirect only, via the 8000/13534 announcements |
| Client resolution | `get_channels` resolves the user's channel list from the `d`-tag of kind:39002 events `#p`-filtered to the user | `require_relay_membership` gates connection/invite-claim eligibility |

**Files Referenced:**
- Channel-level: `crates/buzz-relay/src/handlers/side_effects.rs` (`handle_put_user` ~L1292, `handle_remove_user` ~L1367, `group_members_tags`/`store_group_members_event` ~L980-990, `emit_group_discovery_events` ~L1051, `emit_membership_notification` ~L837); `crates/buzz-relay/src/handlers/channel_authz.rs` (pure decision logic: `decide_put_user`, `decide_self_departure`, `is_sole_owner`).
- Relay-level: `crates/buzz-relay/src/handlers/relay_admin.rs` (module doc: permission matrix for 9030-9033); writes to a `relay_members` Postgres table via `state.db.add_relay_member(...)`.
- Client resolution: `desktop/src-tauri/src/commands/channels/fetch.rs:219-240` — queries `{"kinds":[39002], "#p":[my_pubkey]}`, extracts each event's `d` tag as a channel id, then fetches kind:39000 metadata for those ids. This is the exact mechanism `AGENTS.md` documents.
- Notification consumption: `desktop/src/features/channels/useMembershipNotifications.ts` subscribes to `{kinds:[44100,44101], "#p":[myPubkey]}` live and invalidates channel/member caches.

### Agent Interaction

**How agents appear in channels:** an AI agent posts into a channel using the **exact same event shape as a human** — `KIND_STREAM_MESSAGE` (kind 9), built via the shared `crates/buzz-sdk/src/builders.rs:231-263` `build_message`, signed with the agent's own Nostr keypair. **There is no special tag on the message event itself marking it as agent-authored.**

**Mechanism (not a relay-internal bypass):** `buzz-acp` is a first-class Nostr client using the agent's own keypair (`BUZZ_PRIVATE_KEY` env var, parsed via `Keys::parse` at `crates/buzz-acp/src/pool.rs:933`), communicating over two channels:
1. **WebSocket** (`crates/buzz-acp/src/relay.rs`) — NIP-01 + NIP-42 auth (`HarnessRelay::connect`, lines 758-810), used for subscribing to live channel events and publishing ephemeral events (typing indicators).
2. **HTTP bridge** (`RestClient` in the same file, lines 250-579) — `POST /query`/`POST /count` for reads, `POST /events` for publishing signed events, all NIP-98-authed. Most agent-authored publishes (replies, reactions, turn metrics) go through this path.

**The actual reply is produced by the sub-agent process, not buzz-acp's Rust code directly:** the LLM-driven agent (`crates/buzz-agent/src/agent.rs`) is nudged via a `REPLY_GUARD_NAG` constant (lines 89-92) to invoke the `buzz` CLI as a shell tool call (`is_buzz_reply_call`/`is_reply_shaped`, lines 106-141, recognizing `*__shell` calls containing `"messages send"` or `"reactions add"`). `buzz messages send` (`crates/buzz-cli/src/commands/messages.rs:701-757`) calls `buzz_sdk::build_message`, signs, and submits via `POST /events` — i.e. the agent process is just another Nostr client publishing kind 9, identically to a human using the CLI.

**Identity marker for the frontend (not on the message event):**
- NIP-OA owner-attestation `auth` tag on the agent's own **kind:0 profile** event: `profile_valid_oa_owner_pubkey` (`desktop/src-tauri/src/nostr_convert.rs:58-79`) — requires exactly one `auth` tag, parsed via `nip_oa::parse_auth_tag`, plus signature verification. Presence of this tag ⇒ `is_agent: true`, `owner_pubkey: Some(...)`.
- Channel-membership role `"bot"` (`nostr_convert.rs:282-288`).
- `KIND_AGENT_PROFILE` (10100) runtime-profile event (`desktop/src-tauri/src/nostr_convert/agent_directory.rs:44,73`).
- Desktop render logic joins the message's author pubkey against these profile/membership records: `desktop/src/features/messages/lib/formatTimelineMessages.ts:476-487` (`isAgent = role === "bot" || authorProfile?.isAgent === true`), consumed in `desktop/src/features/messages/ui/MessageRow.tsx:265,548,929`.

**Agent shutdown convention:** a plain kind-9 message with content `"!shutdown"` and a `#p` tag mentioning the agent — a convention, not a distinct kind (`kind.rs:477`).

**Job protocol (43001–43006):** **reserved but unimplemented.** No construction or handling code exists anywhere in `buzz-acp`, `buzz-workflow`, `buzz-sdk`, `buzz-cli`, or `crates/buzz-relay`. The only appearances are cosmetic: generic "activity feed" SQL `kind IN (...)` lists in `crates/buzz-db/src/store/feed.rs`, a one-line gloss in `ARCHITECTURE.md:136` ("Agent job request"), and UI kind constants in `desktop/src/shared/constants/kinds.ts`. No `docs/nips/` file describes this protocol. **The SWF client should not build against this protocol until it is actually implemented** — the `kind.rs:516` comment ("Not using NIP-90 kinds ... Buzz requires auth chains depth ≤ 3, breadth ≤ 10") describes an intended design, not a shipped one.

**KIND_AGENT_TURN_METRIC (44200) publish path** — fully implemented, `crates/buzz-acp/src/pool.rs:5021-5109` (`publish_agent_turn_metric`):
```rust
let ciphertext = buzz_core::agent_turn_metric::encrypt_agent_turn_metric(
    &ctx.agent_keys, owner_pk, &payload,
)?; // NIP-44 v2
let event = EventBuilder::new(Kind::Custom(KIND_AGENT_TURN_METRIC as u16), ciphertext)
    .tags([
        Tag::parse(["p", &owner_hex])?,
        Tag::parse(["agent", &agent_hex])?,
    ])
    .sign_with_keys(&ctx.agent_keys)?;
ctx.rest_client.submit_event(&event).await; // POST /events, best-effort, 3s timeout
```
Matches `docs/nips/NIP-AM.md:45-73` exactly: exactly one `p` (owner) and one `agent` (== event pubkey) tag, **no `h` tag** (channel id is inside the encrypted payload, deliberately, to avoid leaking per-channel activity to the relay operator), content is NIP-44 v2 ciphertext ≤65,535 bytes.

**Files Referenced:**
- `crates/buzz-sdk/src/builders.rs:231-263` (`build_message`)
- `crates/buzz-acp/src/pool.rs` (relay/HTTP client, turn-metric publish, `post_failure_notice` L5174-5223)
- `crates/buzz-acp/src/relay.rs` (`HarnessRelay`, `RestClient`)
- `crates/buzz-agent/src/agent.rs:89-141` (reply-guard nag, reply-shape detection)
- `crates/buzz-cli/src/commands/messages.rs:701-757` (`buzz messages send`)
- `desktop/src-tauri/src/nostr_convert.rs:58-79, 282-288`; `desktop/src-tauri/src/nostr_convert/agent_directory.rs:44,73`
- `desktop/src/features/messages/lib/formatTimelineMessages.ts:476-487`
- `docs/nips/NIP-AM.md`, `docs/nips/NIP-AE.md`, `docs/nips/NIP-AP.md`

---

## 4. Actual Message Flow — Channel Messages

```
User types in composer
  │  desktop/src/features/messages/ui/MessageComposer.tsx, useMentionSendFlow.ts
  ▼
React hook calls mutation
  │  desktop/src/features/messages/hooks.ts:591  (sendChannelMessage)
  ▼
Tauri IPC invoke
  │  desktop/src/shared/api/tauriMessages.ts:5   → invokeTauri("send_channel_message", ...)
  ▼
Rust Tauri command: build event
  │  desktop/src-tauri/src/commands/messages.rs:409-526  (send_channel_message)
  │  desktop/src-tauri/src/events.rs:285-313  (build_message_with_client_tags)
  │    → EventBuilder::new(Kind::Custom(9), content).tags([h, e(thread), p(mentions), ...])
  ▼
Signing (Rust, in-process — not JS)
  │  desktop/src-tauri/src/commands/messages.rs — EventBuilder.sign_with_keys(local Keys)
  ▼
Relay publish (WebSocket EVENT or HTTP POST /events)
  │  desktop/src-tauri/src/commands/messages.rs:526  (submit_event_at_created_at)
  ▼
Relay ingest & validation
  │  crates/buzz-relay/src/handlers/ingest.rs:2110 ingest_event
  │    → ingest_event_inner:2170
  │    → required_scope_for_kind() → Scope::MessagesWrite
  │    → requires_h_channel_scope() → must carry `h`
  │    → channel membership check
  │    → resolve_nip10_thread_meta() if `e` tags present
  ▼
Relay storage
  │  crates/buzz-db/src/store/event.rs:1334-1510  insert_event_with_thread_metadata
  │    → INSERT INTO events (partitioned monthly, schema/schema.sql:203)
  │    → if threaded: UPDATE thread_metadata (reply_count, descendant_count)
  ▼
Relay broadcast / fan-out
  │  crates/buzz-relay/src/handlers/event.rs:396  dispatch_persistent_event_inner
  │    → state.pubsub.publish_event(tenant, EventTopic::Channel(channel_id), &event)
  │        crates/buzz-pubsub/src/publisher.rs:22 — Redis PUBLISH on
  │        "buzz:{community}:channel:{channel_id}"  (crates/buzz-pubsub/src/topic.rs:43)
  │    → state.sub_registry.fan_out_scoped(...)  (in-process local WS subscribers)
  ▼
Other client receives
  │  desktop/src/shared/api/relayClientSession.ts:320  subscribeToChannel
  │    (REQ filter built by relayChannelFilters.ts: {kinds: CHANNEL_EVENT_KINDS, "#h":[channelId]})
  ▼
Render
  │  desktop/src/features/messages/lib/formatTimelineMessages.ts:52  isTimelineContentEvent
  │  desktop/src/features/messages/ui/MessageRow.tsx
```

---

## 5. Thread Implementation Summary

- Threads are **not** a distinct kind — they are regular `KIND_STREAM_MESSAGE` (9) events carrying NIP-10-style `e`-tag markers.
- NIP-10 **is** used, with the standard `root`/`reply` marker vocabulary, produced by `crates/buzz-sdk/src/builders.rs:177-190` and parsed by `crates/buzz-core/src/nip10.rs`.
- Tag shapes (real examples from `builders.rs`):
  - Direct reply to the root: `["e", "<root-id>", "", "reply"]`
  - Nested reply (reply-to-a-reply): `["e", "<root-id>", "", "root"]` **and** `["e", "<parent-id>", "", "reply"]`
- Note: plain kind:1 text notes in this repo use a simpler flat tag only — "full NIP-10 threading deferred" per an inline code comment — so NIP-10 markers are a Buzz-channel-message-specific convention, not applied uniformly to every kind.
- Materialized counters (`reply_count`, `descendant_count`) live on the **root** event's row in the `thread_metadata` table and are updated transactionally on every reply insert (`crates/buzz-db/src/store/thread.rs`).
- `KIND_THREAD_SUMMARY` (39005) and `KIND_WINDOW_BOUNDS` (39006) are relay-synthesized, never client-submitted, and exist purely as query/live overlays for pagination and thread-summary UI — see `docs/bridge-channel-window.md`.

---

## 6. Direct Message Implementation Summary

See the full DM section (§3) for evidence. Summary:

- **Answer: B.** `KIND_DM_OPEN` (41010) creates a private `channels` row (`channel_type='dm'`); messages are ordinary unencrypted `kind 9` events scoped by `h` tag, identical to group-channel messages.
- Gift wrap (kind 1059 / NIP-17) has **zero production code path** for DMs — no SDK builder, no desktop/mobile producer; it appears only in relay protocol-conformance handling and interop tests.
- No NIP-44/NIP-04 encryption is applied to DM content at the client level. Confidentiality is enforced entirely by relay-side access control (channel membership + `h`-tag scoping), not by end-to-end encryption.
- `KIND_DM_VISIBILITY` (30622) is a relay-signed, per-viewer snapshot of which DMs the viewer has hidden — re-published by the relay on every hide/unhide.

---

## 7. Presence Implementation Summary

See §3 for full evidence. Summary: presence is entirely Redis-based, never persisted to Postgres. `KIND_PRESENCE_UPDATE` (20001) is client-published (bare status string, no tags), ingested by the relay into a TTL'd Redis key (`EX 180`) and fanned out live over the channel-less `global` pub/sub topic. `KIND_PRESENCE_SNAPSHOT` (40902) is declared as a "relay-only sidecar" kind but no code was found that emits an event actually tagged 40902 — bulk presence queries are synthesized on demand and returned as kind-20001 events regardless.

---

## 8. Architecture Diagrams

### Channel Messaging

```
┌──────────┐   invoke    ┌───────────────┐  sign+publish  ┌─────────────┐
│  React   │ ──────────▶ │ Tauri backend │ ─────────────▶ │    Relay    │
│ Composer │             │ (Rust, signs) │   POST/WS      │ ingest.rs   │
└──────────┘             └───────────────┘                └──────┬──────┘
                                                                  │ validate (h-tag, scope,
                                                                  │ NIP-10 thread resolve)
                                                                  ▼
                                                          ┌───────────────┐
                                                          │  buzz-db      │
                                                          │  events table │
                                                          │ +thread_meta  │
                                                          └───────┬───────┘
                                                                  │
                                                                  ▼
                                                     ┌────────────────────────┐
                                                     │ buzz-pubsub (Redis)     │
                                                     │ PUBLISH channel:<id>    │
                                                     └────────────┬───────────┘
                                                                  │
                          ┌───────────────────────────────────────┴────────────┐
                          ▼                                                    ▼
                 other relay nodes' WS subs                        local WS subs (this node)
                          │                                                    │
                          ▼                                                    ▼
                  Desktop/Mobile client REQ {kinds:[9,40002,...], "#h":[id]}  → render
```

### Direct Messaging

```
User picks recipients
  │
  ▼
open_dm (Tauri) → build_dm_open() → kind:41010 [p,p,...] ──▶ Relay handle_dm_open
                                                                   │
                                                                   ▼
                                                        buzz-db.open_dm()
                                                        INSERT channels(channel_type='dm')
                                                                   │
                                                                   ▼
                                                        return channel_id to client
                                                                   │
                                     ┌─────────────────────────────┘
                                     ▼
                    sendChannelMessage(dm_channel_id, text)   [IDENTICAL to a normal channel]
                                     │
                                     ▼
                    kind:9, tags=[["h", dm_channel_id]], content = plaintext
                                     │
                                     ▼
                              same ingest/storage/fan-out pipeline as §Channel Messaging
```

### Thread Replies

```
Reply composer has {rootId?, parentId}
        │
        ▼
thread_tags(ThreadRef{root, parent})
        │
        ├─ root == parent → [ ["e", root, "", "reply"] ]
        └─ root != parent → [ ["e", root, "", "root"], ["e", parent, "", "reply"] ]
        │
        ▼
kind:9 event with extra e-tags ──▶ relay ingest
        │
        ▼
resolve_nip10_thread_meta() looks up parent's thread_metadata row
        │
        ▼
insert_event_with_thread_metadata() — one transaction:
   INSERT events
   UPDATE thread_metadata SET reply_count += 1        (on root)
   UPDATE thread_metadata SET descendant_count += 1    (on ancestor, if nested)
        │
        ▼
emit_live_thread_summary() re-reads counts, publishes kind:39005 overlay (relay-signed)
```

### Reactions

```
User clicks emoji on a message
        │
        ▼
build_reaction(target_event_id, emoji) → kind:7, tags=[["e", target_id]], content=emoji
        │
        ▼
Relay ingest: derive_reaction_channel() looks up target event's channel_id
   (no client-supplied h tag needed/allowed)
        │
        ▼
insert_reaction_event_with_thread_metadata()
   UPSERT reactions(community_id, event_id, pubkey, emoji) — soft-delete via removed_at
   if newly-active: also store raw kind:7 event
        │
        ▼
fan-out via same channel pub/sub topic as the target message
        │
        ▼
Desktop: formatTimelineMessages.ts groups raw kind:7 events client-side by
   (targetId, actorPubkey, emoji) to render reaction pills
```

### Agent Messaging

```
Channel event arrives (WS or poll)
        │
        ▼
buzz-acp: HarnessRelay (WS, NIP-42) or RestClient (HTTP bridge, NIP-98)
   crates/buzz-acp/src/relay.rs
        │
        ▼
buzz-acp session/prompt (ACP JSON-RPC) → spawned agent subprocess (buzz-agent)
        │
        ▼
Agent process decides to reply → issues shell tool call:
   `buzz messages send ...`   (recognized by is_buzz_reply_call / REPLY_GUARD_NAG)
        │
        ▼
buzz-cli: buzz_sdk::build_message() → kind:9, tags=[h, ...] (agent's OWN pubkey/signature)
        │
        ▼
POST /events (NIP-98 HTTP bridge) → same ingest/storage/fan-out as any human message
        │
        ▼
Desktop renders message; separately looks up author pubkey's kind:0 profile
   for an "auth" (NIP-OA) tag or channel role=="bot" → sets isAgent=true, shows owner badge

(Side channel, not part of the reply)
buzz-acp also independently publishes, via RestClient.submit_event (POST /events):
  - kind:44200 (NIP-44-encrypted turn metrics, tags: p=owner, agent=self)
  - kind:7 reactions
  - kind:9 failure notices (post_failure_notice)
```

---

## 9. SWF Client Required Event Kinds

| Kind(s) | Feature | Why SWF Needs It | Mandatory? | Backend Component That Consumes It |
|---|---|---|---|---|
| **9** (`KIND_STREAM_MESSAGE`) | Channels, DM messages, thread replies | The **actual** wire kind for every message published today (channel or DM) — confirmed as the only kind emitted by all traced send paths | **Mandatory** | `crates/buzz-relay/src/handlers/ingest.rs` (validation/storage), `buzz-pubsub` (fan-out) |
| 40002 (`KIND_STREAM_MESSAGE_V2`) | Channels (read path) | Registered as a valid message kind in every relay/desktop read-side filter and timeline classifier; SWF should **subscribe to and render** this kind alongside kind 9 even though no current client emits it, in case it becomes the active write kind or is emitted by another client/version | Recommended (read-only) | Same as kind 9 |
| 40003, 40008, 40099 | Message edits, diffs, system rows | Needed to render the full channel timeline correctly (edits overlay, diff messages render their own row, system rows show join/leave/rename) | Mandatory for full-fidelity timeline | `crates/buzz-relay/src/handlers/ingest.rs`; desktop mirrors in `formatTimelineMessages.ts` |
| **39000, 39002** (`KIND_NIP29_GROUP_METADATA`, `KIND_NIP29_GROUP_MEMBERS`) | Channels (discovery) | `d`-tag of a `#p`-filtered kind:39002 query is the **only** way to resolve "what channels is this user in" — there is no other API for this | **Mandatory** | `crates/buzz-relay/src/handlers/side_effects.rs` (`emit_group_discovery_events`); consumed via historical REQ, not live fan-out |
| **9000, 9001, 9021, 9022** | Channel membership admin | Needed if SWF supports adding/removing/joining/leaving a channel from the client (not just reading) | Mandatory if membership management is in scope | `crates/buzz-relay/src/handlers/side_effects.rs`, `channel_authz.rs` |
| **e-tags with root/reply markers on kind 9** | Threads | Threads are not a separate kind — SWF must construct/parse NIP-10 `root`/`reply` markers exactly as `crates/buzz-sdk/src/builders.rs:177-190` does, to interoperate with the desktop client's thread view | **Mandatory** | `crates/buzz-relay/src/handlers/ingest.rs` (`resolve_nip10_thread_meta`), `crates/buzz-db/src/store/thread.rs` |
| 39005, 39006 | Thread summaries, pagination | Relay-synthesized overlays needed for efficient thread-count display and windowed pagination without re-deriving counts client-side | Recommended (perf/UX), not strictly required — SWF could recompute from raw messages | `crates/buzz-relay/src/api/bridge.rs`, `side_effects.rs` |
| **41010** (`KIND_DM_OPEN`) | DMs (creation) | The only way to create/find a DM conversation — returns a `channel_id` that DM messages are then sent against | **Mandatory** for DM support | `crates/buzz-relay/src/handlers/command_executor.rs::handle_dm_open`, `crates/buzz-db/src/store/dm.rs` |
| 41011, 41012 | DMs (add member / hide) | Needed for group-DM expansion and sidebar hide/unhide | Mandatory if those DM features are in scope | `command_executor.rs::handle_dm_add_member/handle_dm_hide` |
| 30622 (`KIND_DM_VISIBILITY`) | DMs (hidden-state sync across devices) | Relay-authoritative source of which DMs are currently hidden for this viewer | Recommended for multi-device parity | Relay-signed, re-published on hide/unhide |
| **7** (`KIND_REACTION`) | Reactions | The only reaction kind; required `e` tag references the target message | **Mandatory** if reactions are in scope | `crates/buzz-relay/src/handlers/ingest.rs` (`derive_reaction_channel`, `validate_reaction_emoji`), `crates/buzz-db/src/store/reaction.rs` |
| **20001** (`KIND_PRESENCE_UPDATE`) | Presence | The only kind for publishing/reading live online/away/offline state; no DB persistence, purely Redis+live-fanout | Mandatory if presence indicators are in scope | `crates/buzz-relay/src/handlers/event.rs`, `crates/buzz-pubsub/src/presence.rs` |
| 40902 (`KIND_PRESENCE_SNAPSHOT`) | Presence (bulk query alias) | Query-filter alias only — **do not build parsing logic around events actually carrying kind 40902**; the relay always returns kind 20001 events regardless. Flagged uncertain above. | Not mandatory / unreliable | `crates/buzz-relay/src/api/bridge.rs::synthesize_presence` |
| 20002 (`KIND_TYPING_INDICATOR`) | Presence (typing) | Channel-scoped ephemeral event for typing state; client-side TTL only (no server Redis key) | Recommended if typing indicators are in scope | Relay ephemeral channel-scoped fan-out path |
| **HTTP `/api/invites`, `/api/invites/claim`** (not a kind) | Invites | Invites are implemented as relay-only HTTP+DB, not a Nostr event the client publishes; kind:9009 exists but is a no-op | **Mandatory (as HTTP, not event)** if invite flows are in scope | `crates/buzz-relay/src/api/invites.rs` |
| 8000, 8001, 13534 | Community/relay membership announcements | Relay-signed announcements of workspace-wide (not per-channel) membership changes, delivered via global fan-out | Recommended for community-member-list UI | `crates/buzz-relay/src/handlers/relay_admin.rs` |
| 44100, 44101 | Membership notifications | `#p`-filtered live notification that "you were added/removed" from a channel — drives cache invalidation | Recommended | `emit_membership_notification` in `side_effects.rs` |
| **10100** (`KIND_AGENT_PROFILE`), kind:0 `auth` tag (NIP-OA) | Agent conversations (identity) | Required to distinguish an agent-authored message from a human one for UI purposes — this is **not** a tag on the message event; SWF must join the author pubkey against these records | Mandatory if agent-authored messages must be visually distinguished | `desktop/src-tauri/src/nostr_convert.rs` (reference implementation, not a required backend dependency) |
| 44200 (`KIND_AGENT_TURN_METRIC`) | Agent conversations (usage/cost display, if any) | NIP-44-encrypted to the owner; only decryptable/readable by the owner's own key | Optional — only needed if SWF surfaces per-turn token/cost metrics to the agent's owner | `crates/buzz-acp/src/pool.rs::publish_agent_turn_metric` |
| 43001–43006 | Agent job protocol | **Not implemented anywhere in the current codebase** — no relay handler, no client builder. Do not build SWF features against this protocol without first confirming with the Buzz team whether/when it ships | **Not mandatory — unimplemented** | None currently |
| 24200 (`KIND_AGENT_OBSERVER_FRAME`) | Agent conversations (owner-side telemetry) | Ephemeral, `P_GATED`, owner-only frame — likely out of scope for a general chat client unless SWF also functions as an agent-operator console | Optional | `crates/buzz-relay` (P_GATED_KINDS enforcement) |

---

## Appendix: Cross-Reference Notes for SWF Implementers

1. **Channel scoping rule** (from `AGENTS.md`, confirmed by code): events *inside* a channel (messages, reactions, edits) use an `h` tag holding the channel UUID. Events that *describe* a channel (metadata, admins, members, roles — kinds 39000–39003) use a `d` tag holding the channel id instead, and are addressable/replaceable, not `h`-scoped.
2. **Relay queries must specify `kinds`** — an omitted `kinds` filter triggers a 403 p-gate (per `AGENTS.md` and confirmed by the `P_GATED_KINDS`/`RESULT_GATED_KINDS` enforcement in `kind.rs`). SWF's relay client must always pass explicit kind lists.
3. **Every accepted event kind should be cross-checked against `crates/buzz-core/src/kind.rs` at SWF implementation time**, since this document is a snapshot as of 2026-09-10 and the registry is actively evolving (per `ALL_KINDS`' size and the density of recently-added agent/DM/moderation kinds).
4. **Discrepancies found between documentation and code** that SWF implementers should resolve with the Buzz team before relying on them:
   - `NOSTR.md`'s DM row claims NIP-17 gift wrap support; code shows no such production path (§3, DMs).
   - `KIND_STREAM_MESSAGE_V2` (40002) is fully wired for reads but has no confirmed writer (§2, §4).
   - `KIND_PRESENCE_SNAPSHOT` (40902)'s doc comment vs. actual behavior (always emits kind 20001) (§3, Presence).
   - `KIND_NIP29_CREATE_INVITE` (9009) and `KIND_NIP29_GROUP_ROLES` (39003) are registered but have no relay-side effect (§2).
