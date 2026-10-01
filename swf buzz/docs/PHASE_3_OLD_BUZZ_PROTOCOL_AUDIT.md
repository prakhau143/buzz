# Phase 3 — OLD BUZZ Protocol Audit (Audit A)

Read-only. No file under `buzz/buzz` was modified. Scope: trace exactly how OLD BUZZ's relay (`buzz/buzz/crates/buzz-relay`, `buzz-db`, `buzz-core`) implements channels, messages, threads, reactions, realtime delivery, unread state, pagination, and the agent boundary, and how far current SWF Buzz already reuses it. Follows `PHASE_2_1_OPERATOR_TERMINOLOGY_AND_HARDENING_AUDIT.md`; identity architecture (Operator/Owner/Admin/Member, NIP-42/NIP-98) is fixed and out of scope here.

## 0. Executive summary — read this first

**The single most important finding of this audit: SWF Buzz already has a working, routed Phase 3 implementation.** `src/views/ChannelsView.vue` (route `/channels`, and per `app/router/index.ts` the destination an existing local identity resolves to by default) already wires channel discovery, open/join, read-only + live message history, send, reactions, thread summaries + a `ThreadPanel`, typing indicators, member management, mentions, and an agent-activity bottom bar (`AgentActivityBar.vue`) — all speaking the same Nostr/NIP-29 protocol documented below. This is not a green field. See §13 for the file-by-file mapping and §14 for what genuinely still needs work (pagination/reconnect hardening, unread/mentions, responsive/a11y polish).

**A second load-bearing finding:** `docs/DECISIONS.md` D10 (2026-09-17) records a decision to *remove* Nostr human identity in favor of Okta+`okta_sub`. `docs/PHASE_1_OLD_BUZZ_IDENTITY_IMPLEMENTATION.md` (2026-09-21) then reversed that for the identity layer, restoring local Nostr identity per `SWF_BUZZ_OLD_BUZZ_IDENTITY_MIGRATION_PLAN.md`, and Phase 2/2.1 built Operator/Owner/Admin/Member on top of it. **`DECISIONS.md` was never updated with the reversal** — D10 still reads as current. The Okta-era code (`swf-buzz-backend/`, `CommunityChannelsView.vue`, the `*ServiceHttp.ts` files) was not deleted; it is a second, currently-unused-by-default track behind a separate route. Treat `ChannelService.ts`/`MessageService.ts` (non-`Http`) as the live track and the `*Http` siblings as legacy unless told otherwise — this audit does not resolve which track SWF intends to keep long-term; it only reports what exists.

---

## 1. Channel discovery

| | |
|---|---|
| FILE | `crates/buzz-relay/src/handlers/ingest.rs`, `crates/buzz-cli/src/commands/channels.rs:29-116` |
| EVENT KIND | `39000` (group/channel metadata, NIP-29 addressable), `39001` (admins), `39002` (members) — constants at `crates/buzz-core/src/kind.rs:422,424,426` |
| REQUEST | WS `REQ`: `{"kinds":[39000]}` for all visible channels, or two-step for "my channels": `{"kinds":[39002],"#p":[<my-hex-pubkey>]}` → collect `d` tags → `{"kinds":[39000],"#d":[<channel-uuids>]}` (`channels.rs:37-69`) |
| RESPONSE | One `39000` event per channel, tags: `d`=channel UUID, `name`, `closed` (always), `about` (if non-empty description), `private`/`public` (membership model), `hidden` (DM channels only), `archived` (`NOSTR.md:109`, `channels.rs:186-207`) |
| DATABASE | `channels` table (relay-signed metadata events are derived from/kept in sync with it; see `buzz-db/src/store/channel.rs`) |

- **Protocol**: Nostr WebSocket (NIP-01 `REQ`/`EVENT`), not HTTP. `GET /` with `Accept: application/nostr+json` returns the NIP-11 document (confirmed live: `supported_nips` includes 1,2,10,11,16,17,23,25,29,33,38,42,50,56).
- **Ordering**: none server-imposed; `channels.rs` and SWF's `ChannelService.ts` (`src/features/channels/ChannelService.ts:34-56`) both de-dupe into a `Map` keyed by channel id, no server-side sort.
- **Visibility**: `public`/`private` tag presence, `NOSTR.md:109` and `channels.rs:196-199`; open (public) channels are still readable/writable by non-members at runtime — the `closed` tag reflects the NIP-29 membership model, not enforcement.
- **Archived/deleted**: `archived` tag (`channels.rs:204`); soft-delete via `state.db.soft_delete_channel` (`ingest.rs:3186-3195`, used as create-failure compensation).
- **Membership requirement to discover**: private channels are filtered server-side to members only (access control happens before the event reaches `REQ`); open channels are discoverable by anyone authenticated.
- **Live discovery**: relay does not fan out `39000` on a bare `{"kinds":[39000]}` live subscription — clients must re-`REQ` historically (`NOSTR.md:124-126`). SWF's `ChannelService.subscribeToChannelUpdates` (`ChannelService.ts:45-56`) works around this by subscribing with `since: now()`, which only catches events published *after* the subscription opens, not a true live discovery feed — consistent with the documented limitation.

## 2. Channel creation

| | |
|---|---|
| FILE | `crates/buzz-relay/src/handlers/ingest.rs:2830-2853` (visibility/type validation), `:2525` (ownership comment), `:2531-2536` (membership-gate skip) |
| EVENT KIND | `9007` (`KIND_NIP29_CREATE_GROUP`, `kind.rs:343`) |
| REQUIRED TAGS | `name` (required); optional `visibility` (`open`/`closed`\*, default `open`), `channel_type` (default `stream`) |
| CREATOR/OWNER | **Any authenticated community member can create a channel; the creator becomes that channel's owner** (`ingest.rs:2525`: "creator becomes owner in step 16"). This is **not** restricted to community-level owner/admin — confirmed, not assumed, per the explicit `skip_membership` list at `ingest.rs:2531-2536` which includes `KIND_NIP29_CREATE_GROUP` precisely because the channel doesn't exist yet to check membership against. |
| VALIDATION | Server-side: `name` presence, `visibility`/`channel_type` enum validation (`ingest.rs:2830-2861`); on later-stage failure the pre-created channel row is soft-deleted as compensation (`ingest.rs:3184-3195`). |
| DB | `channels` table row inserted; on failure, `soft_delete_channel` |

\* NIP-29's `closed` tag is always emitted per Buzz's convention regardless of `visibility` (see §1) — `visibility`/`channel_type` are Buzz's own tags layered on top.

**SWF reuse**: `useCreateChannel.ts` + `CreateChannelDialog.vue` (`src/features/channels/`) call this directly — already implemented, not a Phase 3 gap.

## 3. Channel permissions (channel-level, distinct from community owner/admin/member)

| Action | Owner | Admin | Member |
|---|---|---|---|
| View (open channel) | ✅ | ✅ | ✅ (even non-members, per §1) |
| View (private channel) | ✅ | ✅ | ✅ members only |
| Create a channel | ✅ (any community member, see §2) | ✅ | ✅ |
| Send (kind:9) | ✅ | ✅ | ✅ (subject to membership/open gate) |
| Edit own message | ✅ | ✅ | ✅ (self only, `KIND_NIP29_DELETE_EVENT`/edit self-authored) |
| Delete own message | ✅ | ✅ | ✅ |
| Delete others' message (kind:9005 admin-delete) | ✅ | ✅ | ❌ (owner/admin required, `NOSTR.md:57`) |
| Edit channel `name`/`about` (kind:9002) | ✅ | ✅ | ❌ (`NOSTR.md:56`) |
| Edit channel `topic`/`purpose` (kind:9002) | ✅ | ✅ | ✅ (any member, `NOSTR.md:56`) |
| Add member — open channel (kind:9000) | ✅ | ✅ | ✅ unless `channel_add_policy` is `owner_only`/`nobody` (`NOSTR.md:54`) |
| Add member — private channel | ✅ | ✅ | ❌ |
| Remove member (kind:9001) — others | ✅ | ✅ | ❌; self-remove always allowed (last-owner guard) |
| Delete channel (kind:9008) | ✅ | ❌ | ❌ (owner only, `NOSTR.md:58`) |
| Grant/transfer channel ownership | Not exposed as a distinct action in the direct NIP-29 surface found — role changes go through `9032` at the **relay-membership** (community) level, not a channel-ownership-transfer event. **Flagging, not assuming**: no `channel-ownership-transfer` kind was found in `kind.rs`; if this is needed for SWF it is new protocol, not reuse. |

Community-level roles (owner/admin/member via `relay_members`, NIP-42, per Phase 2.1) are kept separate here as instructed — this table is channel-scoped (`channel_members`/`39001`/`39002`), which is a distinct membership space from `relay_members`.

## 4. Message model

| | |
|---|---|
| KIND | `9` (`KIND_STREAM_MESSAGE`, `kind.rs:479`) — the base chat message. Variants: `40002` `KIND_STREAM_MESSAGE_V2` (rich content, Buzz-only), `40003` `KIND_STREAM_MESSAGE_EDIT`, `40008` `KIND_STREAM_MESSAGE_DIFF` (code-diff messages, `buzz-cli/src/commands/messages.rs:775-846`), `45001`/`45003` `KIND_FORUM_POST`/`KIND_FORUM_COMMENT` (forum-style, separate from stream chat) |
| TAGS | `h` = channel UUID (**required** for kind:9 — `NOSTR.md:348`, `ingest.rs`); `e` = NIP-10 reply/root markers (`["e", "<id>", "", "root"\|"reply"]`); `p` = mentions |
| AUTHOR | `event.pubkey` (the sender's Nostr identity) |
| CONTENT | Plain text (kind:9) or media-annotated text (image/video markdown appended by the CLI's uploader, `messages.rs:659-666`); `imeta` tags for attachments |
| PERSISTENCE | `events` table (partitioned, `crates/buzz-db/src/store/event.rs`) |
| EDIT/DELETE | Edit: `40003`, self-authored only unless owner/admin per §3. Delete: kind `5` (NIP-09), self-authored only via `#e`; admin delete via kind `9005`. |

**Sanitized example** (from `NOSTR.md:154-156`, `154`, shape confirmed against `messages.rs` builders):

```json
{
  "id": "<64-char-hex-event-id>",
  "pubkey": "<64-char-hex-author-pubkey>",
  "kind": 9,
  "created_at": 1758512345,
  "tags": [["h", "<channel-uuid>"]],
  "content": "Hello from NIP-29!",
  "sig": "<128-char-hex-signature>"
}
```

Reply variant adds `["e", "<parent-event-id>", "", "reply"]` (and a `root` marker if nested — see `buzz-core/src/nip10.rs`, `messages.rs:15-56`).

## 5. Message history

| | |
|---|---|
| QUERY | WS `REQ` filter, e.g. `{"kinds":[9,40002,40008,45001,45003],"#h":["<channel-uuid>"],"limit":50}` (`buzz-cli/src/commands/messages.rs:368-372`) |
| PAGINATION | `until`/`since` (Unix seconds) — `before`/`since` CLI flags map directly onto them (`messages.rs:382-387`); no opaque cursor, timestamp-based |
| LIMIT | CLI default 50, capped at 200 (`messages.rs:366`) |
| ORDERING | Server returns unordered/EOSE-terminated; caller sorts by `created_at` ascending (`messages.rs:391`, matches SWF's `useChannelMessages.ts:27`) |
| INITIAL LOAD | One `REQ` with a `limit`, no `since`/`until` |
| OLDER MESSAGES | Re-`REQ` with `until` = oldest loaded message's `created_at` |
| NEWER MESSAGES | Re-`REQ` with `since`, or rely on live subscription (§6) |
| EMPTY STATE | Empty array + `EOSE` — no special-cased empty-channel event |

**SWF status**: `MessageService.fetchMessages` performs the initial fetch; `useChannelMessages.ts` (`src/features/messages/`) does **not** currently expose an older-messages/`until` pagination call — single fixed-window fetch only. **This is a real, unimplemented Phase 3.4 gap**, not something to assume exists.

## 6. Realtime messages

```
buzz-relay (event ingested)
  → in-process fan-out to local subscribers matching the filter
  → Redis pub/sub (`buzz-pubsub`) for cross-node fan-out
  → client's open `REQ` subscription (WebSocket)
  → SWF: RelayConnectionService.subscribe(...) (src/services/RelayConnectionService.ts)
  → ChannelService/MessageService onEvent callback
  → Vue Query cache update (useChannelMessages.ts:23-29)
  → ChannelsView.vue / MessageList.vue re-render
```

- **Subscription filter**: channel-scoped `{"kinds":[9,...],"#h":["<uuid>"],"since":<now>}` for live tail (matches `ChannelService.subscribeToChannelUpdates` pattern).
- **Dedup**: server does not dedupe across reconnects; **client-side** dedup confirmed in SWF: `useChannelMessages.ts:26` (`current.some(m => m.id === message.id)`).
- **Reconnect / missed-event handling**: not found as a documented server feature — this is a client responsibility (Nostr convention: on reconnect, re-`REQ` with `since` = last-seen `created_at`). Whether `RelayConnectionService` actually does this on WebSocket drop was **not traced in this pass** (out of the files read) — flagging as **needs verification**, not assuming it's handled.
- **Ordering**: delivery order is not guaranteed identical to `created_at` order across a reconnect gap; clients must sort (as `useChannelMessages.ts` does for the initial page, but the live-append path in the same file does re-sort on each insert).

## 7. Threads

| | |
|---|---|
| REPLY FORMAT | NIP-10 `e` tags with explicit markers: `["e","<root>","","root"]`, `["e","<parent>","","reply"]`. Positional/markerless `e` tags are explicitly **not** treated as thread markers (`buzz-core/src/nip10.rs`; test at `messages.rs:1264-1269` "unmarked_e_tag_ignored") |
| PARENT REFERENCE | Root marker wins over reply marker when both present (`messages.rs:1222-1230`); reply-only parent → its target is treated as root (`messages.rs:1250-1255`) — i.e. **not depth-limited to one level in the data model**: nested replies collapse to their thread's true root via `thread_ref_from_parent_tags`/`find_root_from_tags`, so arbitrarily deep reply chains still resolve to a single root. Confirmed, not assumed. |
| THREAD LOADING | `{"kinds":[9,40002,40003,40008,45003],"#h":["<channel>"],"#e":["<root-id>"],"limit":100}` + a separate 1-event fetch for the root itself, merged and sorted (`messages.rs:440-462`) |
| REPLY COUNT | Not a server-computed field; caller counts returned events. SWF's `useThreadSummaries.ts` computes this client-side from the loaded message set. |
| REALTIME REPLIES | Same mechanism as §6, filtered by `#e` |
| STORAGE | `thread_metadata` table, populated atomically on ingest (`NOSTR.md:70`); unknown parents rejected at ingest |

**SWF status**: `ThreadService.ts`, `useThread.ts`, `useThreadSummaries.ts`, and `ThreadPanel.vue` already exist and are wired into `ChannelsView.vue` — already implemented.

## 8. Reactions

| | |
|---|---|
| KIND | `7` (`KIND_REACTION`, `kind.rs:58`, standard NIP-25) |
| TARGET/CHANNEL DERIVATION | Channel is derived from the target event's own `#e`/stored channel, **not** from a client-supplied `#h` tag, which is ignored for this purpose (`NOSTR.md:50,192-198`) |
| ADD | `nak event -k 7 -c "+" --tag "e=<target-id>"` shape; content is the reaction glyph (e.g. `"+"`) |
| REMOVE | Not a distinct "unreact" kind found — standard Nostr pattern is a `kind:5` deletion of one's own reaction event. Not explicitly documented in `NOSTR.md`'s reaction section; **flagging as unconfirmed** rather than assuming. |
| AGGREGATION | Client-side — relay stores individual reaction events; no aggregate-count endpoint found |
| REALTIME | Subscribe with `{"kinds":[7],"#h":["<channel-uuid>"]}` — a kinds-only `{"kinds":[7]}` subscription receives **none** of these; `#h` is required for live fan-out even though it's ignored for the write-time channel derivation (`NOSTR.md:192-198`, easy footgun, worth calling out for SWF's implementer) |

**SWF status**: `ReactionService.ts`, `useAddReaction.ts`, `useChannelReactions.ts` exist and are wired in — already implemented (remove/unreact path not independently verified against the gap noted above).

## 9. Unread / read state

> ⚠️ **THIS SECTION WAS WRONG AND IS SUPERSEDED.** See
> `docs/PHASE_4_OLD_BUZZ_PROTOCOL_AUDIT.md` §0.2 and §5.1 (2026-09-23).
> The original text is kept below, struck through, because it was quoted as
> "confirmed" in shipped source (`src/stores/readState.ts`) and the record of
> the error matters more than a clean edit.

**Correct finding:** OLD BUZZ **does** have a read-state protocol —
`KIND_READ_STATE = 30078` (`crates/buzz-core/src/kind.rs:75`), specified in
`docs/nips/NIP-RS.md` (796 lines), implemented in
`desktop/src/features/channels/readState/` (9 files) and
`mobile/lib/shared/read_state/` (7 files). It is NIP-78 addressable, its content
is NIP-44-encrypted to the author's own key, and devices converge by CRDT
max-merge on per-context timestamps.

The relay stores and replicates it but **never interprets it** — it recognizes
only the `d`-tag shape for compaction
(`crates/buzz-db/src/store/replaceable.rs:143-193`). So "there is no
relay-computed read receipt" was right; "no event kind, no field" was not.
Because the frontier is relay-hosted and keyed by pubkey, it converges across
devices and survives a reinstall — which SWF's localStorage-only store does not.
Adopting NIP-RS is Phase 4C.

~~**NOT IMPLEMENTED IN OLD BUZZ.** No `unread`, `last_read`, or read-marker table, event kind, or field was found anywhere in `crates/buzz-db`, `crates/buzz-core/src/kind.rs`, or `NOSTR.md`. There is no channel-level or mention-level unread primitive in the protocol. Do not invent one — SWF's Phase 3.7 unread/mention counts must be **local-only client state** (e.g. last-seen `created_at` per channel, persisted client-side) or entirely new protocol, not a reuse of an OLD BUZZ feature.~~ Mentions themselves (the `p` tag) do exist and are usable as a mention-detection signal (`SWF: useMentionCandidates.ts`), which is different from unread *counts*.

## 10. Pagination / performance

- **Batch size**: CLI default 50 (messages), capped 200; thread default 100, capped 500 (`messages.rs:366,438`).
- **Mechanism**: `since`/`until` Unix-timestamp filters, not offset/cursor (§5).
- **DB indexes**: not traced in this pass (would require reading `buzz-db` migration SQL in `migrations/`); not claiming specifics not verified.
- **Relay query limits**: NIP-11 advertises `max_limit: 1000`, `max_filters: 10`, `max_subscriptions: 1024` (live NIP-11 fetch, confirmed this session).
- **Client caching**: SWF uses Vue Query (`@tanstack/vue-query`) for the message/channel cache (`useChannelMessages.ts:2,11-15`).
- **Virtualized rendering**: not found in `src/components/MessageList.vue` in the portion inspected — **not verified either way**, would need a dedicated look at that component for Phase 3.4/3.9 planning.

## 11. Agent message boundary

- OLD BUZZ has a dedicated **managed-agent** primitive: `KIND_MANAGED_AGENT = 30177` (parameterized-replaceable, `crates/buzz-core/src/kind.rs:291`), plus `KIND_PERSONA`/`KIND_PRIVATE_MANAGED_AGENT` (`crates/buzz-core/src/private_managed_agent.rs`). Agents are first-class identities (their own pubkey), not a message flag.
- Agent **chat participation**: an agent sends normal `kind:9` messages like any member — no separate "agent message" kind was found for ordinary chat content.
- Agent **activity/status**, distinct from chat: the closest existing primitives are `KIND_TYPING_INDICATOR = 20002` and `KIND_PRESENCE_UPDATE = 20001` (both ephemeral, not stored, Redis-fanned-out — `kind.rs:463,467`, `NOSTR.md:64-65`). OLD BUZZ does **not** appear to have a distinct "verbose agent execution log" protocol separate from typing/presence — SWF's requirement ("Poseidon is analyzing…", bottom status bar, not flooding the timeline) is **already partially built on the client side**: `src/features/agents/useAgentActivity.ts` + `src/components/AgentActivityBar.vue`, composed from `agentPubkeysInScope` (agent identities among channel mentions/members) and `typingPubkeys` (`ChannelsView.vue:74-80`). Whether that activity text comes from the typing-indicator's free-form status string or a separate channel was **not traced to its source in this pass** — worth a follow-up read of `PresenceService.ts`/`TypingService.ts` before Phase 3.8 implementation, since `NOSTR.md:64` says presence status is "an arbitrary status string (truncated to 128 chars)", which is a plausible carrier for "Poseidon is working…" but this exact wiring was not confirmed line-by-line.

## 12. SWF reuse map

| Feature | OLD BUZZ implementation | Current SWF | Reuse | New SWF work |
|---|---|---|---|---|
| Channel discovery | kind:39000/39001/39002, WS REQ | `ChannelService.ts`, `useChannels.ts` — **implemented** | Full | Live-discovery push is a documented OLD BUZZ gap (§1) — SWF must live with re-REQ polling or add its own |
| Channel creation | kind:9007, any member → owner | `useCreateChannel.ts`, `CreateChannelDialog.vue` — **implemented** | Full | — |
| Permissions | kind:9000/9001/9002/9005/9008, §3 table | `channelPermissions.ts` — **implemented**, not independently verified against the table in §3 | Mostly | Verify ownership-transfer gap (§3) is actually not needed, or design new protocol |
| Message history | REQ + since/until, §5 | `MessageService.fetchMessages` — **initial fetch only** | Partial | **Older-message pagination (`until`) is not implemented** — real Phase 3.4 work |
| Send message | kind:9 (+40002/40008), §4 | `useSendMessage.ts`, `optimisticMessage.ts` — **implemented** (optimistic send) | Full | — |
| Realtime | fan-out + Redis pub/sub, §6 | `RelayConnectionService` + per-feature `subscribe*` — **implemented**, dedup confirmed | Mostly | Reconnect/missed-event behavior **not verified** — check before calling 3.4 done |
| Threads | NIP-10 markers, §7 | `ThreadService.ts`, `ThreadPanel.vue` — **implemented** | Full | — |
| Reactions | kind:7, §8 | `ReactionService.ts` — **implemented** | Mostly | Remove/unreact path unconfirmed both sides (§8) |
| Unread | **NOT IMPLEMENTED in OLD BUZZ** | Not found in `features/` | None | Must be new, client-local (or new protocol) — §9 |
| Pagination | since/until, limits, §5/§10 | Single-page fetch only | Partial | Older/newer pagination, virtualization check |
| Agent activity | kind:20001/20002 (typing/presence), kind:30177 (managed agent identity) | `useAgentActivity.ts`, `AgentActivityBar.vue` — **implemented**, wiring to protocol not fully traced | Mostly | Confirm typing/presence is the actual carrier (§11) before extending |

---

## 13. File-by-file: what already exists in SWF (do not re-implement)

`src/views/ChannelsView.vue` (route `/channels`) already composes: `useChannels`, `useChannelMembers`, `useJoinChannel`, `useChannelMessages`, `useSendMessage`, `useChannelReactions`, `useAddReaction`, `useThreadSummaries`, `useTypingIndicator`, `useMentionCandidates`, `useAgentActivity`, plus UI: `ChannelHeader.vue`, `ChannelMenu.vue`, `MembersModal.vue`, `UserProfilePanel.vue`, `ChannelDetailsPanel.vue`, `MessageList.vue`, `MessageComposer.vue`, `ThreadPanel.vue`, `TypingIndicator.vue`, `AgentActivityBar.vue`, `ReportMessageDialog.vue`.

A second, parallel track exists at route naming `community-channels` → `CommunityChannelsView.vue`, backed by the `*ServiceHttp.ts` files and the Okta-era `swf-buzz-backend` (D10, now not the default per Phase 1). Do not build Phase 3 against this track without an explicit decision to do so — see §0.

## 14. What genuinely still needs work (real gaps, not assumptions)

1. Older-message pagination (`until`-based) — not implemented (§5, §10).
2. Reconnect / missed-event resubscription behavior — not traced to source, needs verification (§6).
3. Unread counts / mention badges — no protocol exists; needs a client-local design (§9).
4. Reaction removal — unconfirmed on both OLD BUZZ and SWF sides (§8).
5. Message virtualization for long histories — not confirmed present (§10).
6. Agent-activity text source (typing-status vs. something else) — not traced to its origin (§11).
7. Responsive/accessibility behavior of the existing `ChannelsView.vue` at the breakpoints in Audit B §8 — not assessed here (that's Audit B's job).
8. `DECISIONS.md` has no entry recording the Phase 1 reversal of D10 — a documentation gap, not a code gap; flagged for whoever owns that file, out of scope to fix in a read-only audit.

## 15. Security considerations

- kind:9 messages without `#h` are rejected fail-closed (`NOSTR.md:348`).
- Reactions fail-closed on an unknown target event (`NOSTR.md:349`).
- Deletions require self-authorship, verified via `#e` target lookup (`NOSTR.md:350`).
- Membership notifications (`44100`/`44101`) can only be signed by the relay keypair — client-submitted ones are rejected (`NOSTR.md:351`).
- p-gated global subscriptions (mentions, DMs) require the `#p` filter to match the connecting pubkey exactly — prevents eavesdropping (`NOSTR.md:141-144`).
- None of this was modified or tested by this audit; cited as read from source/docs only.

## 16. Exact source references

- `crates/buzz-core/src/kind.rs:56,58,60,291,335-351,398,422-426,463,467,479-493,532-554` — kind registry.
- `crates/buzz-relay/src/handlers/ingest.rs:2478-2536,2830-2861,3181-3204` — ingest gating, channel creation, compensation.
- `crates/buzz-cli/src/commands/messages.rs:356-465` — history/thread query shapes (ground truth for filters).
- `crates/buzz-cli/src/commands/channels.rs:29-250` — discovery/search/get.
- `NOSTR.md:47-373` — protocol reference, event kind table, security notes.
- `docs/DECISIONS.md:87-130` (D10 and its follow-up) — Okta/D10 architecture, now superseded per Phase 1 (§0).
- `docs/PHASE_1_OLD_BUZZ_IDENTITY_IMPLEMENTATION.md:1-40` — the reversal of D10.
- SWF: `src/views/ChannelsView.vue:1-120`, `src/features/channels/ChannelService.ts:1-80`, `src/features/messages/useChannelMessages.ts`, `src/app/router/index.ts:33-56,149-205`.

---

PHASE 3 PROTOCOL AUDIT: COMPLETE
PHASE 3 UI DESIGN AUDIT: see `PHASE_3_CHAT_UI_DESIGN.md`
IMPLEMENTATION: NOT STARTED

Recommended Phase 3 order (unchanged from the user's vertical-slice plan, but re-scoped by §0/§14 — most of 3.1/3.2/3.3/3.5/3.6/3.8 are verification-and-gap-fill, not from-scratch builds):

1. **3.1** Verify existing channel discovery/sidebar/open-channel/read-only-history against a live Operator→Owner→Member flow (it already exists — confirm it, don't rebuild it).
2. **3.2** Verify Create Channel end-to-end (already exists).
3. **3.3** Verify Send + Realtime, including the reconnect gap in §14.2.
4. **3.4** Implement older-message pagination (real gap) + resolve reconnect/missed-event behavior.
5. **3.5** Verify Threads (already exists).
6. **3.6** Verify Reactions, resolve remove/unreact (§14.4).
7. **3.7** Design and implement unread/mentions from scratch (no protocol exists, §9).
8. **3.8** Trace and confirm the agent-activity data source (§14.6), extend as needed.
9. **3.9** Responsive + accessibility + UI polish per Audit B.
