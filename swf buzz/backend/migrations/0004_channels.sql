-- Phase 5 (DECISIONS.md D10, OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md §1 rows
-- "Channel creation" / "Channel membership/roles", §3 step 5): channels +
-- channel membership. Messages/threads/DMs remain later phases -- not
-- created here.

-- Only 3 role tiers (owner/admin/member), matching what
-- src/features/channels/channelPermissions.ts actually implements today --
-- NOT old Buzz's 5-tier model (owner/admin/member/guest/bot). Reuses the
-- same `role` TEXT CHECK vocabulary as `community_members` since both
-- planes happen to share the same 3 tiers; they are NOT the same role --
-- see docs/CHANNEL_MEMBERSHIP_DESIGN.md.
CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility IN ('open', 'private')),
    channel_type TEXT NOT NULL DEFAULT 'standard',
    description TEXT,
    created_by_user_id UUID NOT NULL REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channels_community_id ON channels (community_id);

CREATE TABLE channel_members (
    channel_id UUID NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_channel_members_user_id ON channel_members (user_id);
