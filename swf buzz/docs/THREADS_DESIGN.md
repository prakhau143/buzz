# Threaded replies design (Phase 7, DECISIONS.md D10)

**Decision record, not an essay.** Covers: the root-flattening rule, the depth cap, and the
reply_count/descendant_count semantics. See `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §1 row
"Threads/replies" for the original scope and `docs/MESSAGING_DESIGN.md` for the plain-message
design this phase extends.

## 1. Schema: activates columns Phase 6 already created, adds counters

`parent_message_id`/`root_message_id` existed since migration `0005_messages.sql` (always `NULL`
until now). Migration `0006_threads.sql` adds `depth INT`, `reply_count INT`, `descendant_count
INT`, `last_reply_at TIMESTAMPTZ` — all on the `messages` table itself, not a separate
`thread_metadata` table (unlike old Buzz's own `thread_metadata`,
`OLD_BUZZ_COMMUNITY_CHANNEL_DM_BEHAVIOR_AUDIT.md` §14) — the plan doc explicitly allows either
shape ("no separate thread_metadata table needed if using self-referencing FKs"), and folding the
columns into `messages` avoids a second table with a 1:1 relationship to maintain in every query.

## 2. `root_message_id` always flattens to the top-level ancestor

Old Buzz's own rule (`derive_ancestry_from_parent_tags`, §14): a reply's root is never the
immediate parent when the parent is itself a reply — it's the parent's own root. Implemented
identically here: if the parent has `root_message_id = NULL` (parent is top-level), the new
message's root is the parent's id; if the parent already has a `root_message_id`, the new
message's root is *that* value, never the parent's own id. This means `root_message_id` is a
single hop away from any message in the thread, regardless of nesting depth — reading a thread
never requires walking a chain. Tested explicitly (`reply_to_a_reply_has_root_pointing_at_...`,
`tests/threads_flow.rs`) — this is the single most likely place for a flattening bug.

## 3. Depth: stored, not recomputed

`depth = parent.depth + 1`, stored on every row (not walked from ancestry on every write) so the
cap check is O(1). Cap is `THREAD_DEPTH_LIMIT = 100` (`src/repo/mod.rs`), matching old Buzz's own
hard limit (`ingest.rs:879-882`). A chain of exactly 100 replies succeeds; the 101st-deep reply is
rejected with `422` (mapped from `CreateMessageError::DepthLimitExceeded`).

## 4. `reply_count` vs `descendant_count` — deliberately different numbers

Mirrors old Buzz's own distinction (`thread.rs:138-261`): `reply_count` is incremented only on the
**immediate parent** (direct children only); `descendant_count` is incremented only on the
**root** (every descendant at every depth). A depth-2 reply increments its own parent's
`reply_count` by 1 and the root's `descendant_count` by 1 — these are two different rows unless the
parent happens to be the root itself (a direct reply to a top-level message), in which case both
updates land on the same row and both counters increase together. Both updates run inside the same
transaction as the insert (Postgres: `BEGIN` → row-lock the parent via `SELECT ... FOR UPDATE` →
insert → two `UPDATE`s → `COMMIT`; in-memory: a single `Mutex` guard over the whole sequence).

**Not ported**: old Buzz's `broadcast` flag (a reply that also appears in the main channel
timeline, not just the thread panel) — out of scope for this phase; SWF's UI already renders
threads flat by design per the existing gap-table entry, and nothing in the master prompt or the
plan doc's row asked for a broadcast mechanism. If a future phase wants it, it's an additive
column, not a rework of anything here.

## 5. Same-channel invariant

A reply's parent must be in the same `channel_id` as the reply itself — enforced inside the same
transaction that locks the parent row (Postgres) / the same mutex-guarded lookup (in-memory), not
pre-checked by the caller and then trusted. Cross-channel attempt → `422` (`CreateMessageError::
CrossChannelParent`). Parent doesn't exist at all → `404` (`ParentNotFound`).

## 6. Reading a thread: two endpoints, two orderings, deliberately

- `GET /api/messages/:rootId/thread?after_seq=&limit=` — the root message and its replies,
  **oldest-first** (`seq ASC`). This is the natural reading order for a thread panel (read top to
  bottom, chronologically) — the opposite direction from `GET /api/channels/:id/messages`'s
  newest-first channel timeline (`docs/MESSAGING_DESIGN.md`). Authorization: resolved via the
  root's own `channel_id` — the same-channel invariant on every reply means this is sufficient for
  the whole thread, no per-reply check needed.
- `GET /api/messages/thread-summaries?ids=id1,id2,...` — batched `{reply_count,
  descendant_count, last_reply_at}` per id, for rendering "💬 N replies" badges across a channel's
  message list without an N+1 query. **Best-effort, not all-or-nothing**: an id that doesn't
  exist, or belongs to a channel the caller isn't a member of, is silently omitted from the
  response rather than failing the whole request — this lets a caller pass every message id
  currently rendered in a channel and just get back summaries for the ones that are actually
  thread roots/parents, without pre-filtering client-side.

## 7. What's unverified

Same disclosure as every other phase in this crate: the Postgres transaction (row lock, two
`UPDATE`s, same-channel/depth validation) is implemented and reasoned about but not exercised by
this crate's own automated `cargo test` suite (which runs against `InMemoryRepo` only). It *has*
been exercised manually via the Phase 6 HTTP smoke test's underlying session/community/channel
machinery, but not the thread-specific queries added in this phase — those are new since that
smoke test ran.
