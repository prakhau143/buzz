-- Phase 7 (DECISIONS.md D10, OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md §1 row
-- "Threads/replies", §3 step 5): activates the `parent_message_id`/
-- `root_message_id` columns Phase 6 already created (always NULL until
-- now) and adds the counters old Buzz's `thread_metadata` table tracks
-- (OLD_BUZZ_COMMUNITY_CHANNEL_DM_BEHAVIOR_AUDIT.md §14, `thread.rs:138-261`)
-- -- see docs/THREADS_DESIGN.md for the exact semantics.
--
-- `depth` is stored (not recomputed by walking ancestors on every write)
-- so the depth-cap check is O(1): `depth = parent.depth + 1`, same as old
-- Buzz's own `thread_metadata.depth` column.
ALTER TABLE messages
    ADD COLUMN depth INT NOT NULL DEFAULT 0,
    ADD COLUMN reply_count INT NOT NULL DEFAULT 0,
    ADD COLUMN descendant_count INT NOT NULL DEFAULT 0,
    ADD COLUMN last_reply_at TIMESTAMPTZ;

CREATE INDEX idx_messages_root_seq ON messages (root_message_id, seq ASC);
