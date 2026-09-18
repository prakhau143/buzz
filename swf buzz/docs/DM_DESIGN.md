# DM design (Phase 8, DECISIONS.md D10)

**Decision record, not an essay.** Last backend phase of the no-Nostr migration — see
`OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §1 rows "Direct messages" and "Profile -> DM" for the full
endpoint/schema spec this phase implements, and `MESSAGING_DESIGN.md`/`THREADS_DESIGN.md` for the
sibling channel-message design this reuses conventions from rather than reinventing.

## 1. Separate tables, not a reuse of `messages`

`dm_conversations`/`dm_participants`/`dm_messages`, not `channel_id` made nullable on the existing
`messages` table. A DM has no channel, no community-membership authorization path, and (this
phase) no threading — folding it into `messages` would mean a nullable `channel_id` and unused
`parent_message_id`/`root_message_id`/`depth`/`reply_count`/`descendant_count` columns on every DM
row, and would tangle DM authorization (participant-based) with channel authorization
(membership-based) in the same query paths. Two small tables are simpler than one table with two
authorization models bolted on.

## 2. Race-safe idempotent `open` — `ON CONFLICT`, not a transaction/row lock

`dm_conversations.participant_key` is a deterministic, sorted, comma-joined list of every
participant's `users.id` (`repo::dm_participant_key`), with a `UNIQUE` index. `open()` does
`INSERT ... ON CONFLICT (participant_key) DO NOTHING RETURNING ...`; if nothing came back (someone
else's concurrent `open()` already won, or the conversation already existed), a plain `SELECT` by
the same key fetches it. This is a different mechanism from the invite-claim transaction
(`InviteRepo::claim`'s `SELECT ... FOR UPDATE`) deliberately: there's no multi-step validation to
serialize here (no expiry, no usage count, no role check) — "does a row with this exact key exist"
is a single fact Postgres's own unique index already enforces atomically, so a transaction would
add ceremony without adding safety. `participant_key` is not a secret (no hashing) — it's a pure
dedup key, and the model's `#[serde(skip)]` keeps it out of every API response regardless.

Participant-set order never matters: `[A, B]` and `[B, A]` always sort to the same key, so either
participant opening "a DM with the other" always lands on the same conversation, whoever calls
first.

## 3. Conversation ordering: newest-created, not most-recently-active

`GET /api/dm` returns the caller's conversations ordered by `dm_conversations.created_at DESC`.
"Most recently active" (last message time) would need a denormalized `last_message_at` column
maintained on every send, the same pattern `messages.last_reply_at` uses for threads — deliberately
not built this phase; newest-created is a correct, simple default for a personal DM list that
won't have hundreds of conversations, and upgrading to activity-ordering later is a additive
migration (`ALTER TABLE ... ADD COLUMN last_message_at`, backfill, update on send), not a redesign.

## 4. Realtime: same `Broadcaster`, extended, not duplicated

Phase 6's `RealtimeEvent`/`Broadcaster` (`src/realtime.rs`) already exists for channel messages;
Phase 8 adds a second variant (`RealtimeEvent::NewDmMessage`) to the same enum and the same
single process-wide broadcast channel, rather than standing up a second WebSocket route or a
second broadcaster. `GET /ws`'s `upgrade` handler now snapshots both `channel_members` and
`dm_participants` membership at connect time (`member_channel_ids`/`member_conversation_ids`) and
filters incoming events against whichever set applies to the event's variant. Same connect-time-
snapshot limitation as channels: a DM opened (or a channel joined) after the socket connects isn't
retroactively subscribed until the client reconnects — proven by a real WebSocket test for both
the "receives" and "does not retroactively receive" cases, not just asserted in prose.

## 5. Authorization

Every DM endpoint requires a valid bearer session. `sender_user_id` on every DM message always
comes from the session, never the request body (no field exists for the client to even set it).
Every read/send action requires an actual `dm_participants` row for that conversation — checked
fresh per request (`require_participant`), never cached or inferred from `open`'s own response.
The one endpoint that takes a participant list from the client is `POST /api/dm/open` itself, and
even there the caller must be one of the ids they submit — `open` can never be used to create or
join a conversation the caller isn't themselves part of, and every id in the set is verified to be
a real `users` row before the conversation is created (fail fast on a typo'd/garbage id rather
than creating a conversation with a dangling participant).

## 6. Content bound

Same 8,000-character limit as channel messages (`routes::messages::MAX_CONTENT_LEN`) — one
consistent rule across both message stores, not two numbers to keep in sync by hand.
