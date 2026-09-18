-- Phase 2 (DECISIONS.md D10): Application User + session identity.
-- Community/channel/invite tables are later phases — not created here.

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    okta_sub TEXT NOT NULL UNIQUE,
    email TEXT,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Never key users by email (D10) — okta_sub is the stable identity; email is
-- display/audit data only and may legitimately change or be null.
CREATE INDEX idx_users_okta_sub ON users (okta_sub);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

-- The raw bearer token is never stored (BACKEND_SESSION_DESIGN.md §2) — only
-- its hash, looked up on every authenticated request.
CREATE INDEX idx_sessions_token_hash ON sessions (token_hash);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);
