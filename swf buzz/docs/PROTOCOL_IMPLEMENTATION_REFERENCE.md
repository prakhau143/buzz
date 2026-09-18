# Protocol Implementation Reference

**Status: source-verified against `../buzz` on 2026-09-11.** Authoritative kind registry: `buzz/crates/buzz-core/src/kind.rs` (has a compile-time no-duplicate-kind test). Every kind below was confirmed against relay handler code and/or a live client builder — not inferred from vision docs. Items not confirmed against source are explicitly marked `UNVERIFIED — DO NOT IMPLEMENT BASED ON ASSUMPTION`.

This document is what `src/protocol/` in SWF Buzz must implement against. Do not add kinds or tag shapes here without a source citation.

---

## 1. Channel metadata

| Kind  | Const                       | Direction                                  | Purpose         |
| ----- | --------------------------- | ------------------------------------------ | --------------- |
| 9007  | `KIND_NIP29_CREATE_GROUP`   | client → relay                             | Create channel  |
| 9002  | `KIND_NIP29_EDIT_METADATA`  | client → relay                             | Edit metadata   |
| 39000 | `KIND_NIP29_GROUP_METADATA` | relay → client (relay-signed, replaceable) | Discovery/state |

- **Create (9007)**: requires `name` tag. Optional `visibility` tag (default `"open"`), `channel_type` tag (default `"stream"`), `about` tag.
  Source: `buzz/crates/buzz-relay/src/handlers/side_effects.rs:1769` (`handle_create_group`).
- **Edit (9002)**: requires `h` tag (channel id). Per-tag effects: `name`/`about` (doc says owner/admin only — see Open Questions #1), `topic`/`purpose` (any member per `NOSTR.md:56`; emits a `40099` system message `{"type":"topic_changed",...}`), `visibility` (evicts non-members' subs on open→private), `ttl` (seconds, or empty to clear).
  Source: `side_effects.rs:1436` (`handle_edit_metadata`).
- **Discovery event (39000)**: relay-authored, addressable (`d = channel-uuid`). Confirmed tag set:
  ```
  ["d", <channel-uuid>]
  ["name", <name>]
  ["about", <desc>]        // if non-empty
  ["private"] | ["public"] // mutually exclusive
  ["hidden"]                // DM channels only
  ["p", <pubkey-hex>]...    // DM channels only, one per participant
  ["closed"]                 // always present — Buzz requires explicit membership
  ["t", <channel_type>]       // "stream" / "forum" / "dm" / etc.
  ["topic", <topic>]           // if non-empty
  ["purpose", <purpose>]       // if non-empty
  ["archived", "true"]          // if archived
  ["ttl", <seconds>]             // if ephemeral
  ["ttl_deadline", <rfc3339>]
  ```
  Source: `side_effects.rs:1051-1129` (`emit_group_discovery_events`).
- `KIND_CHANNEL_METADATA = 41` exists in the registry but is annotated **"Not used by Buzz today"** — do not implement against it.
- `KIND_NIP29_GROUP_ROLES = 39003` is registered but **confirmed not emitted** by the relay (`NOSTR.md:82`) — do not build a roles UI against it.

## 2. Channel membership

| Kind  | Const                              | Purpose                            |
| ----- | ---------------------------------- | ---------------------------------- |
| 9000  | `KIND_NIP29_PUT_USER`              | Add/update member (client → relay) |
| 9001  | `KIND_NIP29_REMOVE_USER`           | Remove member (client → relay)     |
| 9021  | `KIND_NIP29_JOIN_REQUEST`          | Self-join (client → relay)         |
| 9022  | `KIND_NIP29_LEAVE_REQUEST`         | Self-leave (client → relay)        |
| 39001 | `KIND_NIP29_GROUP_ADMINS`          | Relay-signed admin/owner list      |
| 39002 | `KIND_NIP29_GROUP_MEMBERS`         | Relay-signed full member list      |
| 44100 | `KIND_MEMBER_ADDED_NOTIFICATION`   | Relay-signed, `#p`-gated           |
| 44101 | `KIND_MEMBER_REMOVED_NOTIFICATION` | Relay-signed, `#p`-gated           |

- 9000 requires `h` + `p` tags; optional `role` tag (`member`/`admin`/`owner`) — absent role preserves existing role, new members default to `Member`.
  Source: `side_effects.rs:1292` (`handle_put_user`), tag rules at lines 1297-1315.
- 9001 requires `h`+`p`; blocks self-removal if it would orphan the channel (last-owner guard).
  Source: `side_effects.rs:1367` (`handle_remove_user`), guard at 1377-1386.
- 9021 only succeeds when channel `visibility == "open"`; error otherwise: `"channel is private — request an invitation"`. Idempotent if already a member.
  Source: `side_effects.rs:1950` (`handle_join_request`), check at 1965-1969.
- 9022 is functionally identical to a self-issued 9001.
  Source: `side_effects.rs:2029` (`handle_leave_request`).
- 39001 tags: `d=<uuid>`, `p=<pubkey>,<role>` for owner/admin only. 39002 tags: `d=<uuid>`, `p=<pubkey>` for all members.
  Source: `side_effects.rs:1131-1149`.
- 44100/44101 tags: `p=<target>`, `h=<channel-uuid>`. Client-submitted 44100/44101 are rejected. Reads require an exact `#p` filter match to the authenticated pubkey (`P_GATED_KINDS`, `kind.rs:159-169`).
  Source: `NOSTR.md:138-144`, `kind.rs:532-546`.
- Every add/remove re-emits the 39000/39001/39002 discovery triad.

## 2a. Community (relay-wide) membership — NIP-43, distinct from §2 above

This is a **separate role plane** from channel membership: `owner`/`admin`/`member` scoped to the
whole community (one relay = one community in Buzz's tenancy model), stored server-side in
`relay_members`, not `channel_members`. See `docs/ROLE_PERMISSION_AUDIT.md` §1 and
`docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §1 for the full role-hierarchy write-up this
implements — a community owner/admin is not automatically an owner/admin of any specific channel,
and vice versa.

| Kind  | Const                          | Purpose                                      |
| ----- | ------------------------------ | --------------------------------------------- |
| 9030  | `KIND_RELAY_ADMIN_ADD_MEMBER`  | Add a community member (client → relay)       |
| 9031  | `KIND_RELAY_ADMIN_REMOVE_MEMBER` | Remove a community member (client → relay)  |
| 9032  | `KIND_RELAY_ADMIN_CHANGE_ROLE` | Promote/demote a community member (client → relay) |
| 13534 | `KIND_NIP43_MEMBERSHIP_LIST`   | Relay-signed roster snapshot (relay → client) |

- 9030/9032 tags: `["p", pubkey]` + `["role", "owner"\|"admin"\|"member"]`. 9031 tags: `["p", pubkey]` only.
  Source (exact tag shape, confirmed against the reference desktop client, not guessed):
  `../buzz/desktop/src/shared/api/relayMembers.ts:148-169` (`publishRelayAdminEvent`).
- Server-side authorization (enforced relay-side — the client never enforces this, only mirrors it
  for fast-fail UX, see `docs/DECISIONS.md`): admin/owner may add a `member`; **only owner** may
  grant `admin` (9030) or change any role (9032); admin may remove only `role="member"` targets;
  owner may remove admin/member but never another owner; nobody can self-target 9032; `role="owner"`
  is rejected on both 9030 and 9032 (ownership only changes via a separate, not-yet-implemented
  transfer path — see Open Questions). Source: `../buzz/crates/buzz-relay/src/handlers/relay_admin.rs:313-441`.
- **kind:13534 is a plain NIP-01 replaceable event** (10000-19999 range) — no `#d` tag, only the
  newest per-relay-signing-pubkey survives. Tags are `["member", <pubkey>, <role>]` for every
  current member, plus a leading `["-"]` NIP-70 protected-event marker. Source:
  `../buzz/crates/buzz-db/src/store/relay_members.rs:1013-1031`.
- **Absence of a kind:13534 snapshot is normal, not an error** — it means this relay does not
  require/enforce community membership (an "open" relay/community). `docs/E2E_TEST_RESULTS.md`
  confirms the local dev relay in this environment is configured this way (no
  `RELAY_OWNER_PUBKEY`/`BUZZ_REQUIRE_RELAY_MEMBERSHIP` set, NIP-11 `supported_nips` omits 43) — the
  Community Members panel must degrade gracefully to "no community roster on this relay" rather
  than showing an error. Fetch it the same way as any other one-shot snapshot: `{kinds:[13534],
  limit:1}`, no author filter needed (only the relay itself ever signs it).
- 9030/9031/9032 are **not** re-emitted through the 39000/39001/39002 channel-discovery triad —
  they only trigger a fresh kind:13534 publication. Do not confuse the two roster systems.

## 3. Channel messages

**`KIND_STREAM_MESSAGE = 9`** — `buzz/crates/buzz-core/src/kind.rs:479`. Confirmed as the real, primary chat-message kind.

- Requires an `h` tag naming the channel UUID (`requires_h_channel_scope()`, `buzz/crates/buzz-relay/src/handlers/ingest.rs:707-722`). Missing `h` → `"invalid: channel-scoped events must include an h tag"`.
- Reply/thread tags built as described in §9 below.
- Sibling kinds registered but **Buzz-only extensions, not standard NIP-29** — do not assume interoperability: `40002` (`KIND_STREAM_MESSAGE_V2`, rich content), `40003` (`KIND_STREAM_MESSAGE_EDIT`), `40004` pinned, `40005` bookmarked, `40006` scheduled, `40007` reminder, `40008` diff/patch.
- `40099` `KIND_SYSTEM_MESSAGE` — relay-emitted, e.g. `{"type":"member_joined","actor":...,"target":...}` or `{"type":"topic_changed",...}`. Render distinctly from user messages (system/info style), never attribute to a user.
- Agent shutdown convention: content `"!shutdown"` + a `#p` mention tag for the agent — a **content convention on a normal kind:9**, not a distinct kind.
- SWF Buzz's canonical "renderable message kind set" (mirrors `desktop/src/shared/constants/kinds.ts:91-96`): `[9, 40002]` at minimum. Skip `45001`/`45003` (forum post/comment) unless a forum feature is explicitly requested — not in the in-scope feature list.

## 4. Reactions

**`KIND_REACTION = 7`** (NIP-25) — `kind.rs:58`.

- Channel is derived **server-side** from the target event's stored `channel_id`, using the **last** valid 64-hex `e` tag as the target (`derive_reaction_channel`, `buzz/crates/buzz-relay/src/handlers/ingest.rs:573-611`). A client must still include an `e` tag pointing at the target message; do not also assume the client needs to add an `h` tag to a reaction (the client conventionally does not add one — channel scoping happens on the server from the target).
- Missing `e` tag → `"invalid: reaction must reference a target event via e tag"`. Unknown target → `"invalid: reaction target event not found"`.
- Content: ≤ 64 chars accepted as-is (covers `+`/`-`/single emoji). Custom-emoji shortcode form `:shortcode:` (>64 chars) requires a matching `["emoji", <shortcode>, <url>]` tag; shortcode must be canonicalized lowercase.
  Source: `validate_reaction_emoji`, `ingest.rs:160-192`.
- **Subscription quirk**: reactions are NOT delivered on a bare `{"kinds":[7]}` filter — subscribe `{"kinds":[7],"#h":["<channel-uuid>"]}` (`NOSTR.md:192-198`). Build the reaction query hook (`useChannelReactions`) with this filter shape from the start.

## 5. Presence

**`KIND_PRESENCE_UPDATE = 20001`** — ephemeral (20000-29999 range; never persisted, Redis pub/sub only, local-node fan-out).

- Client publish shape: `{kind: 20001, content: <status string>, tags: []}` — no tags, community-global scope.
  Source: `desktop/src/shared/api/relayClientSession.ts:281-295`.
- Relay accepts a bare status string ("online") or legacy JSON `{"status":"online"}`; truncates content to 128 bytes on a UTF-8 boundary.
  Source: `buzz/crates/buzz-relay/src/handlers/event.rs:813-828`.
- `40902` `KIND_PRESENCE_SNAPSHOT` is a relay-only bulk-presence sidecar kind — read-only for clients.
- **Caveat for a small client**: presence fan-out is documented as _local-node_ pub/sub (not confirmed multi-instance-safe) — do not assume presence is reliable across a multi-node relay deployment; treat as best-effort UI.

## 6. Typing indicators

**`KIND_TYPING_INDICATOR = 20002`** — ephemeral, Redis pub/sub (multi-node capable, unlike presence).

- Client publish shape: `{kind: 20002, content: "", tags: buildThreadReferenceTags(...)}`.
  Source: `relayClientSession.ts:297-318` (`sendTypingIndicator`).
- Tag shape (`buildThreadReferenceTags`, `desktop/src/features/messages/lib/threading.ts:130-149`):
  - Always `["h", channelId]`.
  - Direct reply to root (`parentEventId === rootEventId`): add `["e", parentEventId, "", "reply"]`.
  - Nested reply: add `["e", rootEventId, "", "root"]` + `["e", parentEventId, "", "reply"]`.
  - Typing indicators are therefore **thread-scoped**, not only channel-scoped.
- Throttle to once per 3s per (channel, thread) scope on the client, matching the reference implementation.
- Typing indicators double as the **fallback** "agent is working" signal when observer frames (kind 24200, §10) aren't available — see §10.

## 7. Invites

**`KIND_NIP29_CREATE_INVITE = 9009`**.

- The event is accepted and stored by ingest validation, but **the side-effect handler is an explicit no-op**:
  ```rust
  // buzz/crates/buzz-relay/src/handlers/side_effects.rs:211-217
  9009 => {
      warn!(kind = kind, "NIP-29 kind 9009 handler deferred to future phase");
      Ok(())
  }
  ```
- There is **no invite-acceptance kind**. Self-join to an _open_ channel works via `9021` without any invite; private channels reject `9021` outright.
- **UNVERIFIED — DO NOT IMPLEMENT BASED ON ASSUMPTION**: do not build an invite feature that assumes any server-side enforcement (expiry, single-use, revocation) beyond "the event got stored." Ship, at most, a thin `InviteService` that publishes 9009 and is explicit in its UI that acceptance has no server-side effect today; flag this to the backend team (see `DECISIONS.md`).

## 8. Direct messages — verified dual implementation, only one is Buzz's own live path

### 8a. `kind:41010` family — THE LIVE PATH. Build SWF Buzz's DM feature against this.

```rust
// buzz/crates/buzz-core/src/kind.rs:505-513
pub const KIND_DM_OPEN: u32 = 41010;        // Open/create DM (p-tags = participants)
pub const KIND_DM_ADD_MEMBER: u32 = 41011;  // UNVERIFIED — no confirmed live handler
pub const KIND_DM_HIDE: u32 = 41012;        // Hide DM from sidebar
pub const KIND_DM_CREATED: u32 = 41001;     // UNVERIFIED — no confirmed live handler
```

- **Open a DM**: publish `kind:41010`, content `""`, one `["p", <pubkey>]` tag per _other_ participant (1-8 others, 2-9 total). Relay replies via `OK` with `response:{channel_id}`.
  Source: `desktop/src-tauri/src/events.rs:737-751` (`build_dm_open`); relay: `buzz/crates/buzz-relay/src/handlers/command_executor.rs:297-390` (`handle_dm_open`); DB: `buzz/crates/buzz-db/src/store/dm.rs:358-390` (`open_dm`) — a DM is literally a `channels` table row with `channel_type = "dm"`.
- **After opening, all message/reaction/edit/delete traffic is the exact same kind set as a normal channel** (`kind:9`, `kind:7`, edits, deletions), tagged `["h", <dm-channel-uuid>]`. There is no DM-specific message kind.
  Source: `desktop/src/features/channels/isDmNotifiableKind.ts:1-19` (comment: "matches every h-tagged event in the channel").
- **Hide/unhide**: publish `kind:41012` to hide; re-publish `kind:41010` (open) on the same participant set to unhide (`unhide_dm`, `buzz-db/src/store/dm.rs:380-384`).
- **Visibility read model**: `kind:30622` `KIND_DM_VISIBILITY` (parameterized-replaceable, relay-only write, `#p`-gated read). `d = viewer-pubkey-hex`, `p = viewer-pubkey-hex`, one `["h", <hidden-dm-channel-id>]` tag per hidden DM. Query: `{kinds:[30622], "#p":[<my-pubkey>], limit:1}`.
  Full spec: `buzz/docs/nips/NIP-DV.md`.
- DM discovery: opening a DM also emits a `kind:39000` (with `["hidden"]` + participant `p` tags) and `kind:44100` membership notifications, so DMs surface through the same discovery flow as channels.
- `kind:41001`/`kind:41011` are registered constants with **no confirmed relay handler or client builder** found. **UNVERIFIED — DO NOT IMPLEMENT** group-DM-add-member or a separate "DM created" listener against these without re-checking the deployed relay version.

### 8b. `kind:1059` NIP-17 gift wrap — real, server-tested, but NOT used by Buzz's own client UI

```rust
// buzz/crates/buzz-core/src/kind.rs:59-60
pub const KIND_GIFT_WRAP: u32 = 1059;
```

- Fully supported at relay ingest: `#p`-gated (`P_GATED_KINDS`), stored community-globally (no `channel_id`), excluded from search. Test coverage exists only in the interop/conformance suite (`buzz/crates/buzz-test-client/tests/e2e_nostr_interop.rs`: `test_nip17_gift_wrap_accepted`, `_requires_p_filter`, `_recipient_receives`, `_not_searchable`).
- **No gift-wrap/seal _sending_ code exists in any client** (desktop, mobile, web) — confirmed by repo-wide search. `NOSTR.md:83`: "NIP-04/NIP-44 [DM encryption schemes] not implemented" for DMs; NIP-17 gift-wrap support exists purely for third-party Nostr client interoperability with the relay, not for Buzz's own DM feature.

### Decision for SWF Buzz

Use **8a (`kind:41010` + plain `kind:9`)** for the primary DM feature — it is what actually renders in Buzz's own UI and is the only DM path with a working end-to-end round trip today. See `DmService`/`DmTransport` abstraction in `ARCHITECTURE.md` §Protocol Layer and `DECISIONS.md` for how the door is kept open to a NIP-17 transport later without a UI rewrite.

## 9. Threads / replies

Single shared parser: `buzz/crates/buzz-core/src/nip10.rs`.

```rust
pub struct ThreadMarkers { pub root: Option<String>, pub reply: Option<String> }
```

- Only `e` tags with ≥4 elements and a valid 64-hex event id in position 1 are considered; the marker word is element 3 (`"root"` or `"reply"`); last valid occurrence of each marker wins.
- **Resolution rule** (`ThreadMarkers::resolve()`, `nip10.rs:38-44`) — implement exactly this in the frontend model:
  - `root` + `reply` both present → `(root, reply)` (nested reply).
  - `reply` only → `(reply, reply)` (direct reply to root — the reply target _is_ the root).
  - `root` only, or neither → not a reply (top-level message). A lone `root` tag never anchors a reply.
- **Compose tags** (mirror `desktop/src/features/messages/lib/threading.ts:101-128`, `buildReplyTags`):
  ```
  ["p", authorPubkey], ["h", channelId], ["p", mentionedPubkey]...
  // direct reply to root:
  ["e", rootEventId, "", "reply"]
  // nested reply:
  ["e", rootEventId, "", "root"], ["e", parentEventId, "", "reply"]
  ```
- **Server validates**: parent must exist (`"reply parent not found"`), parent must be in the same channel (`"parent event belongs to a different channel"`), client-supplied root must match server-computed ancestry (`"root tag does not match thread ancestry"`), depth capped at 100 (`"thread depth limit exceeded"`).
  Source: `resolve_nip10_thread_meta`, `buzz/crates/buzz-relay/src/handlers/ingest.rs:816-921`.
- A "thread id" is not a separate tag — it is the **root event's id**. There is no client-invented thread identifier.
- `["broadcast", "1"]` marks a reply that should be excluded from normal thread-nesting UI (still a reply, just flagged not to nest visually).
- Read-side overlays (relay-synthesized, parameterized-replaceable, never client-submitted):
  - `39005` `KIND_THREAD_SUMMARY` — `e`/`d` = root event id; content `{reply_count, descendant_count, last_reply_at, participants}`. Use this to render reply counts/participant avatars without walking every reply.
  - `39006` `KIND_WINDOW_BOUNDS` — pagination cursor overlay.

## 10. Agent-related events

- **No pubkey-level "is agent" flag exists in the protocol.** An agent is an ordinary Nostr keypair; agent-ness is established by separate metadata events a client must resolve and cache:
  - `kind:0` — standard profile (same as any user).
  - `kind:10100` `KIND_AGENT_PROFILE` (replaceable, **agent-authored**) — `{"channel_add_policy": "..."}` only.
  - `kind:30175` `KIND_PERSONA` (parameterized-replaceable, `d = persona-slug`, **owner-authored**) — the persona "blueprint" (`system_prompt, display_name, avatar_url, runtime, model, provider, name_pool`). Author-only read unless tagged `["shared","true"]`.
  - `kind:30177` `KIND_MANAGED_AGENT` (parameterized-replaceable, `d = agent's own pubkey`, **owner-authored**) — binds an agent pubkey to its instance/definition. Never carries secrets.
  - **Client rule**: to display "this participant is Agent X", resolve `kind:0` for the display name/avatar, and separately check for a `kind:30177` (or `kind:30175`) event naming that pubkey to badge it as an agent. Cache these lookups (Vue Query), do not refetch per message.
- **Mentions**: identical mechanism to human mentions — a plain `["p", <agent-pubkey-hex>]` tag on a `kind:9` message. No special mention syntax at the protocol level (an `@agent-name` UI affordance is purely a client-side autocomplete convenience that resolves to this tag).
  Source: `threading.ts:59-75, 101-128`; agent harness subscribes with `"#p": [agent_pubkey_hex]` when `require_mention` is true (`buzz/crates/buzz-acp/src/relay.rs:3362-3365`).
- **Agent replies are wire-identical `kind:9` events** — there is no distinct "agent message" kind. A client distinguishes an agent message only via the author-pubkey → persona/managed-agent lookup above.
  Source: `buzz/crates/buzz-acp/src/lib.rs` (checks/builds `KIND_STREAM_MESSAGE` for both trigger and reply).
- **Agent activity/"thinking" signal — NOT a chat message.** `kind:24200` `KIND_AGENT_OBSERVER_FRAME` (ephemeral, never stored):
  - Content is **NIP-44 v2 encrypted** JSON, agent↔owner. Tag: `["p", <recipient-pubkey>]`. Additional tags: `frame = "telemetry"` (agent→owner) or `"control"` (owner→agent); `agent = <agent-pubkey>`.
  - Example decrypted payload: `{"type": "turn_started", "turnId": "turn-1"}`.
  - `#p`-gated (`P_GATED_KINDS`) — only the addressed reader can even receive the ciphertext via subscription; decrypting further requires the recipient's private key (see `DECISIONS.md` §NIP-46 + observer frames — this has a real implication for a NIP-46-signing client).
  - **UI rule, confirmed from source**: this is the _primary_ "agent is working" signal, with `kind:20002` typing indicators as a documented **fallback** when the observer stream is absent.
    Source: `desktop/src/features/agents/agentWorkingSignal.ts:11-28`.
  - **Do not render observer frames as chat messages.** Drive a status/typing-style UI element ("SWF Agent is working…") instead, per product requirement §19.
- Adjacent agent-job kinds registered (not required for the in-scope feature list, note only): `43001-43006` job request/accepted/progress/result/cancel/error; `44200` `KIND_AGENT_TURN_METRIC` (durable, NIP-44-to-owner, token usage); `30174` `KIND_AGENT_ENGRAM` (agent memory).

## 11. Deployment-wide admin console (`/api/admin/v1/*`) — a separate role plane and a separate host

Unlike everything above (Nostr events over the relay's own WebSocket), this is a plain HTTP REST
API, NIP-98-signed, served on a **separate host** from the community's own relay origin
(`VITE_ADMIN_URL`, optional — most deployments never expose this). It authenticates a deployment-
wide `Operator`/`Moderator` role plane, entirely independent of the community owner/admin/member
role in §2a. See `docs/ROLE_PERMISSION_AUDIT.md` §6/§7 and
`docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §5/§6 for the full authorization write-up.

All request/response JSON is `camelCase`, verified against
`../buzz/crates/buzz-relay/src/api/admin/mod.rs` and
`../buzz/crates/buzz-db/src/store/admin_moderation.rs` field-by-field — not guessed.

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/probe` | any resolved principal | `{status, authMode, role, source, canAct, canStaff}` — call this **before** rendering anything else; `admin-web` in the reference never does (confirmed gap, see ROLE_PERMISSION_AUDIT.md §15) |
| GET | `/reports` | Operator or Moderator | No `status` param ⇒ escalated-only backstop; `scope=all` restores full visibility |
| POST | `/reports/{id}/resolve` | Operator or Moderator | Body `{action, requestId, expirationSecs?, reason?}` — `action ∈ {delete,kick,ban,timeout,dismiss,escalate}` |
| POST | `/reports/{id}/reopen` | Operator or Moderator | Body `{requestId, reason?}` — 409 if the report isn't terminal |
| POST | `/reports/{id}/cancel` | Operator or Moderator | Body `{actionId}` — only recovers a pre-mutation `failed` action |
| GET | `/feedback` | Operator or Moderator | No server-side filters; deployment-wide |
| PATCH | `/feedback/{id}` | any authenticated principal | Body `{status}`, `status ∈ {new,reviewed,archived}` |
| GET | `/operators` | **Operator only** | `{pubkey, effectiveRole, sources}[]` — union of config + DB grants |
| PUT | `/operators/{pubkey}` | **Operator only** | Body `{role}` — 409 if the target is config-backed |
| DELETE | `/operators/{pubkey}` | **Operator only** | 409 if it would remove the last operator |

**Not implemented client-side, deliberately**: `POST /operator/communities*` (community provisioning
— a third, separate role check against `RELAY_OPERATOR_PUBKEYS` config directly, not this
`AdminRole` resolution at all) and `POST /api/invites` (community-scoped, already covered by the
existing `InviteService`/kind:9009 path — note the reference's real invite mint endpoint is this
HTTP route with owner/admin community-role auth, not kind:9009's no-op path; see Open Question 10
below).

**Environment note**: this project's own local dev relay does **not** expose this API —
`GET /api/admin/v1/probe` 404s there (no `BUZZ_ADMIN_HOST` configured). `AdminConsoleService`/
`PlatformAdminView` are code-complete and unit-tested at the protocol/permission layer, but have
**not** been exercised against a live admin-console-enabled relay in this environment — see
`docs/KNOWN_LIMITATIONS.md`.

---

## Kind quick-reference table (everything above, one place)

| Kind  | Name                                     | Scope                         | Client-submittable?                                    |
| ----- | ---------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| 0     | Profile metadata                         | global                        | yes                                                    |
| 7     | Reaction                                 | derived from target's channel | yes                                                    |
| 9     | Stream message (channel + DM)            | `#h`                          | yes                                                    |
| 9000  | Put user (membership)                    | `#h`                          | yes                                                    |
| 9001  | Remove user                              | `#h`                          | yes                                                    |
| 9002  | Edit channel metadata                    | `#h`                          | yes                                                    |
| 9007  | Create group/channel                     | none (creates)                | yes                                                    |
| 9009  | Create invite (**no-op server effect**)  | `#h`                          | yes (stored only)                                      |
| 9021  | Join request (open channels only)        | `#h`                          | yes                                                    |
| 9022  | Leave request                            | `#h`                          | yes                                                    |
| 9030  | Add community member (NIP-43)            | global (community-wide)       | owner/admin only                                       |
| 9031  | Remove community member (NIP-43)         | global (community-wide)       | owner/admin only                                       |
| 9032  | Change community member role (NIP-43)    | global (community-wide)       | owner only                                              |
| 13534 | Community membership snapshot (NIP-43)   | global (community-wide)       | **relay-only**                                         |
| 20001 | Presence (ephemeral)                     | global                        | yes                                                    |
| 20002 | Typing indicator (ephemeral)             | `#h` (+ thread `e` tags)      | yes                                                    |
| 24200 | Agent observer frame (ephemeral, NIP-44) | `#p`-gated                    | agent/owner only                                       |
| 30174 | Agent engram (memory)                    | owner/agent                   | n/a (agent-authored)                                   |
| 30175 | Persona definition                       | author-only or `shared`       | owner-authored                                         |
| 30177 | Managed agent binding                    | public                        | owner-authored                                         |
| 30622 | DM visibility                            | `#p`-gated                    | **relay-only**                                         |
| 39000 | Group/channel metadata (discovery)       | addressable                   | **relay-only**                                         |
| 39001 | Group admins list                        | addressable                   | **relay-only**                                         |
| 39002 | Group members list                       | addressable                   | **relay-only**                                         |
| 39005 | Thread summary overlay                   | addressable                   | **relay-only**                                         |
| 39006 | Window bounds (pagination overlay)       | addressable                   | **relay-only**                                         |
| 40099 | System message                           | `#h`                          | **relay-only**                                         |
| 41010 | DM open                                  | none (creates)                | yes                                                    |
| 41012 | DM hide                                  | `#h` (dm channel)             | yes                                                    |
| 44100 | Member added notification                | `#p`-gated                    | **relay-only**                                         |
| 44101 | Member removed notification              | `#p`-gated                    | **relay-only**                                         |
| 1059  | NIP-17 gift wrap                         | `#p`-gated                    | yes (not used by Buzz's own DM UI — interop path only) |

---

## OPEN QUESTIONS / UNVERIFIED (do not implement past these without re-checking source or asking the team)

1. Exact authorization gate for _who_ may submit `name`/`about` vs `topic`/`purpose` edits (9002) — described in `NOSTR.md:56` as owner/admin vs. any-member, but the effect-application code read during research applies per-tag effects uniformly; the upstream authz gate itself was not individually traced. Treat the split as doc-sourced, not code-verified.
2. `kind:41001` (`KIND_DM_CREATED`) and `kind:41011` (`KIND_DM_ADD_MEMBER`) — registered, not confirmed wired to any handler.
3. `is_relay_only_kind()` (`kind.rs:833-843`) does not enumerate the full set of kinds that are relay-only in practice (e.g. 39000-series, 44100/44101 are relay-only via a different enforcement path). Do not use that function alone as a complete client-side "is this kind allowed to publish" check.
4. `kind:9009` invite acceptance has no implementation — confirm with the backend team whether/when this will be built before investing UI effort beyond a stub.
5. Multi-node reliability of presence (`kind:20001`) fan-out is unconfirmed — documented as local-node Redis pub/sub for presence vs. multi-node for typing; verify against the actual deployed relay topology before promising cross-node presence accuracy.
6. Full JSON schema of `kind:30175` persona content beyond the fields listed above — read `buzz/docs/nips/NIP-AP.md` in full before building a persona-detail UI.
7. Decrypting `kind:24200` observer frames under a NIP-46 signing model (client never holds the private key) requires the remote signer to support a `nip44_decrypt` request against the _agent's_ pubkey as sender — this is an interaction between §10 and the auth/signing design that must be confirmed as supported by whatever NIP-46 bunker SWF Buzz ends up using. See `DECISIONS.md`.
8. **Community ownership transfer is deliberately not implemented in SWF Buzz's §2a.** In the reference, changing who holds `owner` happens only via a deployment-config bootstrap (`RELAY_OWNER_PUBKEY`) or the relay-operator-only `/operator/communities/transfer` HTTP endpoint (`docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` §6) — kind:9032 explicitly rejects `role="owner"`. There is no in-app, member-initiated ownership-transfer flow to build against; do not invent one.
9. §2a's client-side pre-flight checks (`src/composables/useCommunityPermission.ts`) mirror the relay's `relay_admin.rs` rules for fast-fail UX only. They are not a security boundary — verify any change to the server-side rules against `docs/ROLE_PERMISSION_AUDIT.md`/`docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` before assuming the client-side mirror is still accurate.
10. **Two different "invite" mechanisms exist in the reference, and SWF Buzz currently implements only one.** `src/protocol/invites.ts`'s kind:9009 create-invite is a confirmed no-op server-side (D4) — it's stored but never enforced. The reference's *real*, enforced invite mechanism is an HTTP endpoint, `POST /api/invites` (owner/admin community-role auth, mints a bearer code hashed server-side, redeemed via `POST /api/invites/claim`), which is a **separate HTTP surface from both `/api/admin/v1/*` (§11) and the relay's own WebSocket/event path** — not yet implemented in SWF Buzz. If real invite enforcement becomes a priority, build against this HTTP contract, not kind:9009.
