# Messaging design (Phase 6, DECISIONS.md D10)

**Decision record, not an essay.** Covers channel messages (HTTP write + history read) and the
realtime fan-out over `/ws`. This is the single largest subsystem in the no-Nostr migration — it
replaces `buzz-relay`'s entire Nostr transport for messaging (`kind:9`/WebSocket-to-relay) with a
native HTTP + WebSocket path. Thread-specific behavior (depth cap, reply/descendant counters,
thread-fetch endpoints) is explicitly out of scope here — `parent_message_id`/`root_message_id`
exist as nullable columns on `messages` but every Phase 6 write leaves them `NULL`; Phase 7 owns
giving them meaning.

## 1. Transport: WebSocket, not SSE

Chose a WebSocket (`GET /ws`, axum's built-in upgrade) over Server-Sent Events. Reasoning: this
`/ws` connection is the natural place to add bidirectional realtime features already in the
product scope but not yet built (typing indicators, presence) — building it as SSE now would mean
a second, different transport later just for those. Nothing in Phase 6 itself needs
client→server messages over the socket (posting still goes through the plain `POST` endpoint), but
the connection already reads incoming frames in its select loop (`routes/realtime.rs`) so it's
ready to grow a client→server protocol without a transport change.

## 2. Realtime auth: session token in the query string

The browser `WebSocket` constructor cannot set an `Authorization` header on the handshake request
— there is no way around this in a browser client. **Decision**: `GET /ws?token=<session_token>`,
validated with the exact same `token::hash` + `SessionRepo::find_valid_by_token_hash` lookup every
other endpoint uses (no weaker check for this one path).

**Tradeoff, stated plainly**: the token now appears in one additional place — the URL, and
therefore in any access/proxy logs that record request paths — beyond the `Authorization` header
it uses everywhere else. This is not a new secret or a new privilege, only the same bearer secret
in an additional location. Mitigations available if this needs hardening later (not built in
Phase 6, noted so it isn't forgotten): a short-lived, single-use realtime ticket minted via an
authenticated `POST` and exchanged for the `/ws` connection instead of the long-lived session token
itself; or configuring the reverse proxy/load balancer in front of this service to exclude query
strings from access logs for the `/ws` path specifically.

## 3. Fan-out mechanism and its real limitation

A single process-wide `tokio::sync::broadcast` channel (`src/realtime.rs`). Every `POST
.../messages` publishes a `NewMessageEvent` to it; every connected `/ws` socket subscribes and
filters events down to the channels it belongs to. That channel membership is **a snapshot taken
once at connect time** (`list_channel_ids_for_user` at upgrade), not a live-updating set — **a
client that joins a new channel after connecting will not receive that channel's messages until it
reconnects.** This is a real, tested limitation
(`tests/messages_flow.rs::websocket_does_not_receive_events_for_a_channel_joined_after_connecting`),
not an oversight: the frontend's obvious mitigation is to reconnect `/ws` whenever the client's own
channel membership list changes (e.g. right after a successful "join channel" or invite-claim
action), which is cheap and simple compared to maintaining a live per-socket subscription set
server-side for a first cut. Revisit if reconnect-on-join proves annoying in practice.

A slow/lagging consumer (`broadcast::error::RecvError::Lagged`) is handled by skipping the missed
events and continuing, not by dropping the connection — the client can always catch up via the
`GET .../messages` history endpoint, so losing a socket over a transient lag would be a worse
tradeoff than a client occasionally needing to notice a gap and re-fetch.

**This is proven by a real test, not just reasoned about**: `tests/messages_flow.rs` spins up the
actual Axum router on a real TCP listener, connects a real WebSocket client
(`tokio_tungstenite::connect_async`) to `/ws`, posts a message over plain HTTP from a different
user, and asserts the connected socket actually receives the `message.created` event — this is an
end-to-end proof of the fan-out working, not a unit test of `Broadcaster::publish`/`subscribe` in
isolation. A companion test proves an invalid token is rejected at the upgrade (`connect_async`
itself fails, since axum returns a non-101 response).

## 4. Message length bound

`MAX_CONTENT_LEN = 8_000` characters (`routes/messages.rs`). Not derived from any old-Buzz source
value (none was found for this) — chosen to be generous for a chat message while ruling out
pathological payloads. Empty/whitespace-only content is rejected (422) as well as anything over the
bound.

## 5. Pagination: `seq`, not `created_at`, newest-first

Every message gets a monotonically increasing per-row `seq` (`BIGSERIAL` in Postgres,
process-local `AtomicI64` in `InMemoryRepo`) alongside its `created_at` timestamp. `GET
/api/channels/:id/messages` is newest-first; pass `before_seq=<seq of the last item you saw>` to
fetch the next (older) page, `limit` (default 50, max 200) bounds the page size. `seq` is used
instead of `created_at` as the pagination cursor because timestamps are not guaranteed unique or
strictly ordered under concurrent writes (two messages in the same millisecond, or ever-so-slight
clock skew across future horizontally-scaled instances of this service) — an integer sequence
has neither problem and gives an unambiguous, gap-free cursor. Tested directly
(`history_paginates_newest_first_with_no_duplicates_or_gaps`): 12 messages, two pages of 5, no
overlap or gap between them.

## 6. Authorization: channel membership, not community membership

Posting and reading both require the caller to hold an actual `channel_members` row for that
channel — a community owner/admin who hasn't joined the channel gets 403, exactly as `channel_authz`
established in Phase 5 (community role never substitutes for channel role). `sender_user_id` is
always the authenticated caller's id; a request body that tries to set a different
`sender_user_id` is silently ignored (the field isn't even deserialized from the request), covered
by `member_posts_a_message_and_sender_id_comes_from_session_not_the_body`.

## 7. What's still unverified against real infrastructure

Same gap as every prior phase in this crate — Docker was down this session, so none of
`PostgresRepo`'s new message-table SQL (including the `BIGSERIAL`/`seq` column and its ordering)
has run against a real Postgres instance, only `InMemoryRepo` behind identical route-handler logic.
The realtime fan-out itself, by contrast, **is** proven end-to-end within this environment (§3) —
that part doesn't depend on Postgres at all, only on the in-process broadcast channel, which is the
same code that will run in production.
