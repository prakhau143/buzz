//! Real Postgres-backed repository implementations. Exercised against a
//! live `swf_buzz` Postgres database via a manual HTTP smoke test as of
//! Phase 6 (session bootstrap through community/channel/message/invite
//! flows, run directly against this crate's compiled binary — see project
//! memory) — but not by this crate's own automated `cargo test` suite,
//! which still runs against `memory::InMemoryRepo` only; treat any given
//! query here as "compiles and matches the schema" rather than
//! "covered by an automated regression test" until it has one. Uses
//! runtime-checked `sqlx::query`/`query_as` rather than the compile-time
//! `query!`/`query_as!` macros, deliberately (§4 of
//! docs/BACKEND_SESSION_DESIGN.md) — switching to compile-time-checked
//! queries is a mechanical follow-up once `cargo sqlx prepare` is run
//! against a live database in CI.

use super::{
    dm_participant_key, ChannelRepo, ClaimOutcome, CommunityRepo, CreateMessageError, DmRepo,
    InviteRepo, MessageRepo, SessionRepo, UserRepo, THREAD_DEPTH_LIMIT,
};
use crate::invite_authz::{invite_state, InviteState};
use crate::models::{
    Channel, ChannelMember, ChannelVisibility, Community, CommunityMember, DmConversation,
    DmMessage, Invite, Message, Role, Session, ThreadSummary, User,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row};
use std::str::FromStr;
use uuid::Uuid;

pub struct PostgresRepo {
    pool: PgPool,
}

impl PostgresRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UserRepo for PostgresRepo {
    async fn upsert_by_okta_sub(
        &self,
        okta_sub: &str,
        email: Option<&str>,
        display_name: Option<&str>,
    ) -> Result<User, sqlx::Error> {
        let row = sqlx::query(
            r#"
            INSERT INTO users (okta_sub, email, display_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (okta_sub) DO UPDATE
                SET email = EXCLUDED.email,
                    display_name = EXCLUDED.display_name,
                    updated_at = now()
            RETURNING id, okta_sub, email, display_name, created_at, updated_at
            "#,
        )
        .bind(okta_sub)
        .bind(email)
        .bind(display_name)
        .fetch_one(&self.pool)
        .await?;

        Ok(User {
            id: row.try_get("id")?,
            okta_sub: row.try_get("okta_sub")?,
            email: row.try_get("email")?,
            display_name: row.try_get("display_name")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, okta_sub, email, display_name, created_at, updated_at FROM users WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        Ok(Some(User {
            id: row.try_get("id")?,
            okta_sub: row.try_get("okta_sub")?,
            email: row.try_get("email")?,
            display_name: row.try_get("display_name")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        }))
    }
}

/// Parses the `TEXT` `role` column back into `Role`. A row containing
/// anything other than the three values the `CHECK` constraint allows is a
/// data-integrity bug, not a recoverable runtime condition -- surfaced as a
/// decode error via `sqlx::Error::Decode` rather than silently defaulting to
/// a role (defaulting here could silently under- or over-grant authority).
fn parse_role(s: &str) -> Result<Role, sqlx::Error> {
    Role::from_str(s).map_err(|e| sqlx::Error::Decode(e.into()))
}

fn community_member_from_row(row: &sqlx::postgres::PgRow) -> Result<CommunityMember, sqlx::Error> {
    Ok(CommunityMember {
        community_id: row.try_get("community_id")?,
        user_id: row.try_get("user_id")?,
        role: parse_role(row.try_get::<String, _>("role")?.as_str())?,
        joined_at: row.try_get("joined_at")?,
    })
}

#[async_trait]
impl CommunityRepo for PostgresRepo {
    async fn create_community(
        &self,
        name: &str,
        owner_user_id: Uuid,
    ) -> Result<Community, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "INSERT INTO communities (name) VALUES ($1) RETURNING id, name, created_at",
        )
        .bind(name)
        .fetch_one(&mut *tx)
        .await?;
        let community = Community {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            created_at: row.try_get("created_at")?,
        };
        sqlx::query(
            "INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, 'owner')",
        )
        .bind(community.id)
        .bind(owner_user_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(community)
    }

    async fn community_exists(&self, community_id: Uuid) -> Result<bool, sqlx::Error> {
        let row = sqlx::query("SELECT 1 AS present FROM communities WHERE id = $1")
            .bind(community_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.is_some())
    }

    async fn find_role(
        &self,
        community_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<Role>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2",
        )
        .bind(community_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|r| parse_role(r.try_get::<String, _>("role")?.as_str()))
            .transpose()
    }

    async fn list_members(&self, community_id: Uuid) -> Result<Vec<CommunityMember>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT community_id, user_id, role, joined_at FROM community_members WHERE community_id = $1",
        )
        .bind(community_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(community_member_from_row).collect()
    }

    async fn add_member(
        &self,
        community_id: Uuid,
        user_id: Uuid,
        role: Role,
    ) -> Result<CommunityMember, sqlx::Error> {
        let row = sqlx::query(
            r#"
            INSERT INTO community_members (community_id, user_id, role)
            VALUES ($1, $2, $3)
            RETURNING community_id, user_id, role, joined_at
            "#,
        )
        .bind(community_id)
        .bind(user_id)
        .bind(role.as_str())
        .fetch_one(&self.pool)
        .await?;
        community_member_from_row(&row)
    }

    async fn update_role(
        &self,
        community_id: Uuid,
        user_id: Uuid,
        new_role: Role,
    ) -> Result<Option<CommunityMember>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            UPDATE community_members SET role = $3
            WHERE community_id = $1 AND user_id = $2
            RETURNING community_id, user_id, role, joined_at
            "#,
        )
        .bind(community_id)
        .bind(user_id)
        .bind(new_role.as_str())
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(community_member_from_row).transpose()
    }

    async fn remove_member(&self, community_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error> {
        let result =
            sqlx::query("DELETE FROM community_members WHERE community_id = $1 AND user_id = $2")
                .bind(community_id)
                .bind(user_id)
                .execute(&self.pool)
                .await?;
        Ok(result.rows_affected() > 0)
    }
}

fn parse_visibility(s: &str) -> Result<ChannelVisibility, sqlx::Error> {
    ChannelVisibility::from_str(s).map_err(|e| sqlx::Error::Decode(e.into()))
}

fn channel_from_row(row: &sqlx::postgres::PgRow) -> Result<Channel, sqlx::Error> {
    Ok(Channel {
        id: row.try_get("id")?,
        community_id: row.try_get("community_id")?,
        name: row.try_get("name")?,
        visibility: parse_visibility(row.try_get::<String, _>("visibility")?.as_str())?,
        description: row.try_get("description")?,
        created_by_user_id: row.try_get("created_by_user_id")?,
        created_at: row.try_get("created_at")?,
    })
}

fn channel_member_from_row(row: &sqlx::postgres::PgRow) -> Result<ChannelMember, sqlx::Error> {
    Ok(ChannelMember {
        channel_id: row.try_get("channel_id")?,
        user_id: row.try_get("user_id")?,
        role: parse_role(row.try_get::<String, _>("role")?.as_str())?,
        joined_at: row.try_get("joined_at")?,
    })
}

/// **Not exercised against a live database in this environment** (same
/// disclosed gap as the rest of `PostgresRepo`).
#[async_trait]
impl ChannelRepo for PostgresRepo {
    async fn create_channel(
        &self,
        community_id: Uuid,
        name: &str,
        visibility: ChannelVisibility,
        description: Option<&str>,
        creator_user_id: Uuid,
    ) -> Result<Channel, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            r#"
            INSERT INTO channels (community_id, name, visibility, description, created_by_user_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, community_id, name, visibility, description, created_by_user_id, created_at
            "#,
        )
        .bind(community_id)
        .bind(name)
        .bind(visibility.as_str())
        .bind(description)
        .bind(creator_user_id)
        .fetch_one(&mut *tx)
        .await?;
        let channel = channel_from_row(&row)?;
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'owner')",
        )
        .bind(channel.id)
        .bind(creator_user_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(channel)
    }

    async fn find_channel(&self, channel_id: Uuid) -> Result<Option<Channel>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT id, community_id, name, visibility, description, created_by_user_id, created_at
            FROM channels WHERE id = $1
            "#,
        )
        .bind(channel_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(channel_from_row).transpose()
    }

    async fn list_visible_channels(
        &self,
        community_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<Channel>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT DISTINCT c.id, c.community_id, c.name, c.visibility, c.description,
                   c.created_by_user_id, c.created_at
            FROM channels c
            LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2
            WHERE c.community_id = $1
              AND (c.visibility = 'open' OR cm.user_id IS NOT NULL)
            "#,
        )
        .bind(community_id)
        .bind(caller_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(channel_from_row).collect()
    }

    async fn find_channel_role(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<Role>, sqlx::Error> {
        let row =
            sqlx::query("SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2")
                .bind(channel_id)
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?;
        row.map(|r| parse_role(r.try_get::<String, _>("role")?.as_str()))
            .transpose()
    }

    async fn list_channel_members(
        &self,
        channel_id: Uuid,
    ) -> Result<Vec<ChannelMember>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT channel_id, user_id, role, joined_at FROM channel_members WHERE channel_id = $1",
        )
        .bind(channel_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(channel_member_from_row).collect()
    }

    async fn add_channel_member(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
        role: Role,
    ) -> Result<ChannelMember, sqlx::Error> {
        let row = sqlx::query(
            r#"
            INSERT INTO channel_members (channel_id, user_id, role)
            VALUES ($1, $2, $3)
            RETURNING channel_id, user_id, role, joined_at
            "#,
        )
        .bind(channel_id)
        .bind(user_id)
        .bind(role.as_str())
        .fetch_one(&self.pool)
        .await?;
        channel_member_from_row(&row)
    }

    async fn update_channel_role(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
        new_role: Role,
    ) -> Result<Option<ChannelMember>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            UPDATE channel_members SET role = $3
            WHERE channel_id = $1 AND user_id = $2
            RETURNING channel_id, user_id, role, joined_at
            "#,
        )
        .bind(channel_id)
        .bind(user_id)
        .bind(new_role.as_str())
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(channel_member_from_row).transpose()
    }

    async fn remove_channel_member(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let result =
            sqlx::query("DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2")
                .bind(channel_id)
                .bind(user_id)
                .execute(&self.pool)
                .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_channel_ids_for_user(&self, user_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
        let rows = sqlx::query("SELECT channel_id FROM channel_members WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(|r| r.try_get("channel_id")).collect()
    }
}

fn message_from_row(row: &sqlx::postgres::PgRow) -> Result<Message, sqlx::Error> {
    Ok(Message {
        id: row.try_get("id")?,
        seq: row.try_get("seq")?,
        channel_id: row.try_get("channel_id")?,
        sender_user_id: row.try_get("sender_user_id")?,
        content: row.try_get("content")?,
        parent_message_id: row.try_get("parent_message_id")?,
        root_message_id: row.try_get("root_message_id")?,
        depth: row.try_get("depth")?,
        reply_count: row.try_get("reply_count")?,
        descendant_count: row.try_get("descendant_count")?,
        last_reply_at: row.try_get("last_reply_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// **Not exercised against a live database in this environment** (same
/// disclosed gap as the rest of `PostgresRepo`).
#[async_trait]
impl MessageRepo for PostgresRepo {
    async fn create_message(
        &self,
        channel_id: Uuid,
        sender_user_id: Uuid,
        content: &str,
        parent_message_id: Option<Uuid>,
    ) -> Result<Message, CreateMessageError> {
        let Some(parent_id) = parent_message_id else {
            // No thread invariants to enforce for a top-level message --
            // no transaction needed, a plain autocommit insert is enough.
            let row = sqlx::query(
                r#"
                INSERT INTO messages (channel_id, sender_user_id, content)
                VALUES ($1, $2, $3)
                RETURNING id, seq, channel_id, sender_user_id, content,
                          parent_message_id, root_message_id, depth, reply_count,
                          descendant_count, last_reply_at, created_at, updated_at
                "#,
            )
            .bind(channel_id)
            .bind(sender_user_id)
            .bind(content)
            .fetch_one(&self.pool)
            .await?;
            return Ok(message_from_row(&row)?);
        };

        let mut tx = self.pool.begin().await?;

        // Row lock on the parent: a concurrent reply to the same parent
        // (or a concurrent update to the parent's own counters, e.g. two
        // simultaneous replies) serializes here, same "lock, validate,
        // mutate, commit" shape as `InviteRepo::claim` above.
        let parent_row = sqlx::query(
            "SELECT id, channel_id, root_message_id, depth FROM messages WHERE id = $1 FOR UPDATE",
        )
        .bind(parent_id)
        .fetch_optional(&mut *tx)
        .await?;

        let Some(parent_row) = parent_row else {
            return Err(CreateMessageError::ParentNotFound);
        };
        let parent_channel_id: Uuid = parent_row.try_get("channel_id")?;
        if parent_channel_id != channel_id {
            return Err(CreateMessageError::CrossChannelParent);
        }
        let parent_depth: i32 = parent_row.try_get("depth")?;
        let depth = parent_depth + 1;
        if depth > THREAD_DEPTH_LIMIT {
            return Err(CreateMessageError::DepthLimitExceeded);
        }
        let parent_root: Option<Uuid> = parent_row.try_get("root_message_id")?;
        let root_id = parent_root.unwrap_or(parent_id);

        let row = sqlx::query(
            r#"
            INSERT INTO messages
                (channel_id, sender_user_id, content, parent_message_id, root_message_id, depth)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, seq, channel_id, sender_user_id, content,
                      parent_message_id, root_message_id, depth, reply_count,
                      descendant_count, last_reply_at, created_at, updated_at
            "#,
        )
        .bind(channel_id)
        .bind(sender_user_id)
        .bind(content)
        .bind(parent_id)
        .bind(root_id)
        .bind(depth)
        .fetch_one(&mut *tx)
        .await?;
        let message = message_from_row(&row)?;

        // Direct-children-only counter, on the immediate parent.
        sqlx::query("UPDATE messages SET reply_count = reply_count + 1 WHERE id = $1")
            .bind(parent_id)
            .execute(&mut *tx)
            .await?;
        // All-descendants counter, on the top-level root -- a no-op-free
        // second UPDATE against the same row when parent_id == root_id
        // (a direct reply to a top-level message), which is correct: that
        // message is both "the parent" (reply_count) and "the root"
        // (descendant_count) at once.
        sqlx::query(
            "UPDATE messages SET descendant_count = descendant_count + 1, last_reply_at = now() WHERE id = $1",
        )
        .bind(root_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(message)
    }

    async fn list_messages(
        &self,
        channel_id: Uuid,
        before_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<Message>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT id, seq, channel_id, sender_user_id, content,
                   parent_message_id, root_message_id, depth, reply_count,
                   descendant_count, last_reply_at, created_at, updated_at
            FROM messages
            WHERE channel_id = $1
              AND ($2::BIGINT IS NULL OR seq < $2)
            ORDER BY seq DESC
            LIMIT $3
            "#,
        )
        .bind(channel_id)
        .bind(before_seq)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(message_from_row).collect()
    }

    async fn find_message(&self, message_id: Uuid) -> Result<Option<Message>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT id, seq, channel_id, sender_user_id, content,
                   parent_message_id, root_message_id, depth, reply_count,
                   descendant_count, last_reply_at, created_at, updated_at
            FROM messages
            WHERE id = $1
            "#,
        )
        .bind(message_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(message_from_row).transpose()
    }

    async fn list_thread_replies(
        &self,
        root_message_id: Uuid,
        after_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<Message>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT id, seq, channel_id, sender_user_id, content,
                   parent_message_id, root_message_id, depth, reply_count,
                   descendant_count, last_reply_at, created_at, updated_at
            FROM messages
            WHERE root_message_id = $1
              AND ($2::BIGINT IS NULL OR seq > $2)
            ORDER BY seq ASC
            LIMIT $3
            "#,
        )
        .bind(root_message_id)
        .bind(after_seq)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(message_from_row).collect()
    }

    async fn thread_summaries(
        &self,
        root_message_ids: &[Uuid],
    ) -> Result<Vec<ThreadSummary>, sqlx::Error> {
        if root_message_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query(
            "SELECT id, reply_count, descendant_count, last_reply_at FROM messages WHERE id = ANY($1)",
        )
        .bind(root_message_ids)
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|r| {
                Ok(ThreadSummary {
                    root_message_id: r.try_get("id")?,
                    reply_count: r.try_get("reply_count")?,
                    descendant_count: r.try_get("descendant_count")?,
                    last_reply_at: r.try_get("last_reply_at")?,
                })
            })
            .collect()
    }
}

fn invite_from_row(row: &sqlx::postgres::PgRow) -> Result<Invite, sqlx::Error> {
    Ok(Invite {
        id: row.try_get("id")?,
        community_id: row.try_get("community_id")?,
        token_hash: row.try_get("token_hash")?,
        created_by_user_id: row.try_get("created_by_user_id")?,
        expires_at: row.try_get("expires_at")?,
        max_uses: row.try_get("max_uses")?,
        used_count: row.try_get("used_count")?,
        created_at: row.try_get("created_at")?,
        revoked_at: row.try_get("revoked_at")?,
    })
}

/// **Not exercised against a live database in this environment** (same
/// disclosed gap as the rest of `PostgresRepo` -- see the crate-root doc
/// comment). `claim` in particular is the one method whose correctness
/// under concurrency depends on `SELECT ... FOR UPDATE` actually locking the
/// row against a second concurrent transaction; that guarantee is a
/// property of real Postgres row locking, reasoned about here but not
/// proven by any test that ran in this session -- see docs/INVITE_DESIGN.md.
#[async_trait]
impl InviteRepo for PostgresRepo {
    async fn create_invite(
        &self,
        community_id: Uuid,
        token_hash: &str,
        created_by_user_id: Uuid,
        expires_at: DateTime<Utc>,
        max_uses: Option<i32>,
    ) -> Result<Invite, sqlx::Error> {
        let row = sqlx::query(
            r#"
            INSERT INTO community_invites
                (community_id, token_hash, created_by_user_id, expires_at, max_uses)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, community_id, token_hash, created_by_user_id, expires_at,
                      max_uses, used_count, created_at, revoked_at
            "#,
        )
        .bind(community_id)
        .bind(token_hash)
        .bind(created_by_user_id)
        .bind(expires_at)
        .bind(max_uses)
        .fetch_one(&self.pool)
        .await?;
        invite_from_row(&row)
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<Invite>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT id, community_id, token_hash, created_by_user_id, expires_at,
                   max_uses, used_count, created_at, revoked_at
            FROM community_invites WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(invite_from_row).transpose()
    }

    async fn revoke(&self, id: Uuid, community_id: Uuid) -> Result<bool, sqlx::Error> {
        let row = sqlx::query(
            r#"
            UPDATE community_invites
            SET revoked_at = COALESCE(revoked_at, now())
            WHERE id = $1 AND community_id = $2
            RETURNING id
            "#,
        )
        .bind(id)
        .bind(community_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some())
    }

    async fn preview_by_token_hash(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<(InviteState, String)>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT ci.expires_at, ci.max_uses, ci.used_count, ci.revoked_at,
                   c.name AS community_name
            FROM community_invites ci
            JOIN communities c ON c.id = ci.community_id
            WHERE ci.token_hash = $1
            "#,
        )
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        // Only the fields `invite_state` actually reads are populated --
        // id/community_id/created_by_user_id/created_at are irrelevant to
        // that decision and are never returned to a public, unauthenticated
        // caller anyway.
        let synthetic = Invite {
            id: Uuid::nil(),
            community_id: Uuid::nil(),
            token_hash: token_hash.to_string(),
            created_by_user_id: Uuid::nil(),
            expires_at: row.try_get("expires_at")?,
            max_uses: row.try_get("max_uses")?,
            used_count: row.try_get("used_count")?,
            created_at: now,
            revoked_at: row.try_get("revoked_at")?,
        };
        let state = invite_state(&synthetic, now);
        let community_name: String = row.try_get("community_name")?;
        Ok(Some((state, community_name)))
    }

    async fn claim(
        &self,
        token_hash: &str,
        claiming_user_id: Uuid,
        now: DateTime<Utc>,
    ) -> Result<ClaimOutcome, sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        // Row lock: a second concurrent claim against the same token blocks
        // here until this transaction commits or rolls back, which is what
        // makes the used_count increment below race-free under a
        // max_uses-limited invite (master prompt §12).
        let row = sqlx::query(
            r#"
            SELECT id, community_id, token_hash, created_by_user_id, expires_at,
                   max_uses, used_count, created_at, revoked_at
            FROM community_invites
            WHERE token_hash = $1
            FOR UPDATE
            "#,
        )
        .bind(token_hash)
        .fetch_optional(&mut *tx)
        .await?;

        let Some(row) = row else {
            return Ok(ClaimOutcome::NotFound);
        };
        let invite = invite_from_row(&row)?;

        let state = invite_state(&invite, now);
        if state != InviteState::Valid {
            return Ok(ClaimOutcome::Invalid(state));
        }

        let community_row =
            sqlx::query("SELECT id, name, created_at FROM communities WHERE id = $1")
                .bind(invite.community_id)
                .fetch_one(&mut *tx)
                .await?;
        let community = Community {
            id: community_row.try_get("id")?,
            name: community_row.try_get("name")?,
            created_at: community_row.try_get("created_at")?,
        };

        let existing_role_row = sqlx::query(
            "SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2",
        )
        .bind(invite.community_id)
        .bind(claiming_user_id)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(existing) = existing_role_row {
            let role = parse_role(existing.try_get::<String, _>("role")?.as_str())?;
            tx.commit().await?;
            return Ok(ClaimOutcome::AlreadyMember { community, role });
        }

        let member_row = sqlx::query(
            r#"
            INSERT INTO community_members (community_id, user_id, role)
            VALUES ($1, $2, 'member')
            RETURNING community_id, user_id, role, joined_at
            "#,
        )
        .bind(invite.community_id)
        .bind(claiming_user_id)
        .fetch_one(&mut *tx)
        .await?;
        let membership = community_member_from_row(&member_row)?;

        sqlx::query("UPDATE community_invites SET used_count = used_count + 1 WHERE id = $1")
            .bind(invite.id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(ClaimOutcome::Joined {
            community,
            membership,
        })
    }
}

#[async_trait]
impl SessionRepo for PostgresRepo {
    async fn create(
        &self,
        user_id: Uuid,
        token_hash: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<Session, sqlx::Error> {
        let row = sqlx::query(
            r#"
            INSERT INTO sessions (user_id, token_hash, expires_at)
            VALUES ($1, $2, $3)
            RETURNING id, user_id, token_hash, created_at, expires_at, revoked_at
            "#,
        )
        .bind(user_id)
        .bind(token_hash)
        .bind(expires_at)
        .fetch_one(&self.pool)
        .await?;

        Ok(Session {
            id: row.try_get("id")?,
            user_id: row.try_get("user_id")?,
            token_hash: row.try_get("token_hash")?,
            created_at: row.try_get("created_at")?,
            expires_at: row.try_get("expires_at")?,
            revoked_at: row.try_get("revoked_at")?,
        })
    }

    async fn find_valid_by_token_hash(
        &self,
        token_hash: &str,
    ) -> Result<Option<(Session, User)>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT
                s.id AS session_id, s.user_id, s.token_hash, s.created_at AS session_created_at,
                s.expires_at, s.revoked_at,
                u.id AS user_id_dup, u.okta_sub, u.email, u.display_name,
                u.created_at AS user_created_at, u.updated_at AS user_updated_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1
              AND s.revoked_at IS NULL
              AND s.expires_at > now()
            "#,
        )
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let session = Session {
            id: row.try_get("session_id")?,
            user_id: row.try_get("user_id")?,
            token_hash: row.try_get("token_hash")?,
            created_at: row.try_get("session_created_at")?,
            expires_at: row.try_get("expires_at")?,
            revoked_at: row.try_get("revoked_at")?,
        };
        let user = User {
            id: row.try_get("user_id_dup")?,
            okta_sub: row.try_get("okta_sub")?,
            email: row.try_get("email")?,
            display_name: row.try_get("display_name")?,
            created_at: row.try_get("user_created_at")?,
            updated_at: row.try_get("user_updated_at")?,
        };
        Ok(Some((session, user)))
    }

    async fn revoke_by_token_hash(&self, token_hash: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
        )
        .bind(token_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

fn dm_conversation_from_row(row: &sqlx::postgres::PgRow) -> Result<DmConversation, sqlx::Error> {
    Ok(DmConversation {
        id: row.try_get("id")?,
        participant_key: row.try_get("participant_key")?,
        created_at: row.try_get("created_at")?,
    })
}

fn dm_message_from_row(row: &sqlx::postgres::PgRow) -> Result<DmMessage, sqlx::Error> {
    Ok(DmMessage {
        id: row.try_get("id")?,
        seq: row.try_get("seq")?,
        conversation_id: row.try_get("conversation_id")?,
        sender_user_id: row.try_get("sender_user_id")?,
        content: row.try_get("content")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

#[async_trait]
impl DmRepo for PostgresRepo {
    async fn open(&self, participant_ids: &[Uuid]) -> Result<DmConversation, sqlx::Error> {
        let key = dm_participant_key(participant_ids);

        // `ON CONFLICT (participant_key) DO NOTHING` is what makes this
        // race-safe without a transaction/row lock: the UNIQUE index on
        // `participant_key` is the single source of truth for "does this
        // conversation already exist," enforced by Postgres itself, so two
        // concurrent inserts for the same key can never both succeed --
        // see docs/DM_DESIGN.md §2.
        let inserted = sqlx::query(
            r#"
            INSERT INTO dm_conversations (participant_key)
            VALUES ($1)
            ON CONFLICT (participant_key) DO NOTHING
            RETURNING id, participant_key, created_at
            "#,
        )
        .bind(&key)
        .fetch_optional(&self.pool)
        .await?;

        let conversation = match inserted {
            Some(row) => dm_conversation_from_row(&row)?,
            None => {
                // Someone else won the race (or this conversation already
                // existed from an earlier `open` call) -- fetch it.
                let row = sqlx::query(
                    "SELECT id, participant_key, created_at FROM dm_conversations WHERE participant_key = $1",
                )
                .bind(&key)
                .fetch_one(&self.pool)
                .await?;
                dm_conversation_from_row(&row)?
            }
        };

        // Idempotent regardless of which caller's `open` actually inserted
        // the conversation row -- every caller ensures every participant
        // it was given is present.
        for &user_id in participant_ids {
            sqlx::query(
                "INSERT INTO dm_participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(conversation.id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        }

        Ok(conversation)
    }

    async fn list_conversations_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<DmConversation>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT c.id, c.participant_key, c.created_at
            FROM dm_conversations c
            JOIN dm_participants p ON p.conversation_id = c.id
            WHERE p.user_id = $1
            ORDER BY c.created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(dm_conversation_from_row).collect()
    }

    async fn find_conversation(
        &self,
        conversation_id: Uuid,
    ) -> Result<Option<DmConversation>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id, participant_key, created_at FROM dm_conversations WHERE id = $1",
        )
        .bind(conversation_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(dm_conversation_from_row).transpose()
    }

    async fn is_participant(
        &self,
        conversation_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let row = sqlx::query(
            "SELECT 1 AS present FROM dm_participants WHERE conversation_id = $1 AND user_id = $2",
        )
        .bind(conversation_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some())
    }

    async fn list_conversation_ids_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<Uuid>, sqlx::Error> {
        let rows = sqlx::query("SELECT conversation_id FROM dm_participants WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(|r| r.try_get("conversation_id")).collect()
    }

    async fn create_dm_message(
        &self,
        conversation_id: Uuid,
        sender_user_id: Uuid,
        content: &str,
    ) -> Result<DmMessage, sqlx::Error> {
        let row = sqlx::query(
            r#"
            INSERT INTO dm_messages (conversation_id, sender_user_id, content)
            VALUES ($1, $2, $3)
            RETURNING id, seq, conversation_id, sender_user_id, content, created_at, updated_at
            "#,
        )
        .bind(conversation_id)
        .bind(sender_user_id)
        .bind(content)
        .fetch_one(&self.pool)
        .await?;
        dm_message_from_row(&row)
    }

    async fn list_dm_messages(
        &self,
        conversation_id: Uuid,
        before_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<DmMessage>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT id, seq, conversation_id, sender_user_id, content, created_at, updated_at
            FROM dm_messages
            WHERE conversation_id = $1
              AND ($2::BIGINT IS NULL OR seq < $2)
            ORDER BY seq DESC
            LIMIT $3
            "#,
        )
        .bind(conversation_id)
        .bind(before_seq)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(dm_message_from_row).collect()
    }
}
