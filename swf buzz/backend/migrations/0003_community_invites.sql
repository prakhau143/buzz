-- Phase 4 (DECISIONS.md D10, OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md §1 rows 6-8):
-- community invites (create/claim/revoke). Channels/messages/threads/DMs
-- remain later phases -- not created here.

-- The raw invite token is never stored -- only its SHA-256 hash, same
-- convention as `sessions.token_hash` (see docs/BACKEND_SESSION_DESIGN.md
-- §2 and docs/INVITE_DESIGN.md).
CREATE TABLE community_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_by_user_id UUID NOT NULL REFERENCES users (id),
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_community_invites_community_id ON community_invites (community_id);
