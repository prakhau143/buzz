-- Phase 3 (DECISIONS.md D10, OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md §1 rows 3-4):
-- community membership + roles. Channels/invites/messages/threads/DMs are
-- later phases -- not created here.

-- Minimal communities table. Community creation itself isn't one of the
-- master prompt's Phase 3 endpoints, but membership can't be tested or used
-- without *some* community to be a member of -- see
-- docs/COMMUNITY_MEMBERSHIP_DESIGN.md §1 for why a bare-bones
-- `POST /api/communities` was added in this phase.
CREATE TABLE communities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE community_members (
    community_id UUID NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'active',
    PRIMARY KEY (community_id, user_id)
);

CREATE INDEX idx_community_members_user_id ON community_members (user_id);
