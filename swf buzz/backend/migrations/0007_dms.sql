-- Phase 8 (DECISIONS.md D10, OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md §1 row
-- "Direct messages", §3 step 5): direct messages -- the last backend
-- phase of the no-Nostr migration. See docs/DM_DESIGN.md for the schema
-- choice (a separate table, not a reuse of `messages`) and the race-safe
-- idempotent-open mechanism.
--
-- `participant_key` is the canonical, sorted, comma-joined list of every
-- participant's `users.id` (e.g. "11111111-...,22222222-..."). It is not a
-- secret -- no hashing -- just a deterministic dedup key: the same
-- participant set always produces the same key regardless of call order,
-- so `INSERT ... ON CONFLICT (participant_key) DO NOTHING` is what makes
-- "open a DM with the same people twice" race-safe under concurrency,
-- without a transaction or row lock (see docs/DM_DESIGN.md §2).
CREATE TABLE dm_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_dm_conversations_participant_key ON dm_conversations (participant_key);

CREATE TABLE dm_participants (
    conversation_id UUID NOT NULL REFERENCES dm_conversations (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_dm_participants_user ON dm_participants (user_id);

-- A separate table from `messages`, not a reuse -- DMs have no channel,
-- no thread columns, and no community-membership authorization path;
-- folding them into `messages` would mean a nullable `channel_id` and
-- unused thread columns on every DM row. `seq` is scoped the same way as
-- `messages.seq` -- a monotonic pagination key, not a timestamp.
CREATE TABLE dm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGSERIAL NOT NULL,
    conversation_id UUID NOT NULL REFERENCES dm_conversations (id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users (id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_dm_messages_seq ON dm_messages (seq);
CREATE INDEX idx_dm_messages_conversation_seq ON dm_messages (conversation_id, seq DESC);
