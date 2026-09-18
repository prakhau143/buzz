-- Phase 6 (DECISIONS.md D10, OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md §1 row "Messages",
-- §3 step 5): channel messages -- HTTP write + history read + realtime
-- fan-out, replacing buzz-relay's Nostr transport for messaging entirely.
--
-- `parent_message_id`/`root_message_id` exist at the schema level now (per
-- the plan doc's "columns folded into messages table" design) but are
-- unused by this phase's handlers -- every message this phase writes has
-- both NULL. Thread validation/invariants (same-channel check, depth cap,
-- reply_count/descendant_count maintenance) are Phase 7, not here -- see
-- docs/MESSAGING_DESIGN.md.
--
-- `seq` is a separate monotonically-increasing pagination key from `id`
-- (a random UUID, which does not sort chronologically). Keyset pagination
-- on `seq` is race-free and gap/duplicate-free regardless of clock
-- resolution or concurrent inserts -- see docs/MESSAGING_DESIGN.md.
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGSERIAL NOT NULL,
    channel_id UUID NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users (id),
    content TEXT NOT NULL,
    parent_message_id UUID REFERENCES messages (id),
    root_message_id UUID REFERENCES messages (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_messages_seq ON messages (seq);
CREATE INDEX idx_messages_channel_seq ON messages (channel_id, seq DESC);
