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
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
pub struct InMemoryRepo {
    users: Mutex<Vec<User>>,
    sessions: Mutex<Vec<Session>>,
    communities: Mutex<Vec<Community>>,
    community_members: Mutex<Vec<CommunityMember>>,
    invites: Mutex<Vec<Invite>>,
    channels: Mutex<Vec<Channel>>,
    channel_members: Mutex<Vec<ChannelMember>>,
    messages: Mutex<Vec<Message>>,
    dm_conversations: Mutex<Vec<DmConversation>>,
    /// (conversation_id, user_id) pairs -- no per-participant data beyond
    /// membership itself, so a plain pair is enough (unlike
    /// `channel_members`, which also carries a role).
    dm_participants: Mutex<Vec<(Uuid, Uuid)>>,
    dm_messages: Mutex<Vec<DmMessage>>,
}

impl InMemoryRepo {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl UserRepo for InMemoryRepo {
    async fn upsert_by_okta_sub(
        &self,
        okta_sub: &str,
        email: Option<&str>,
        display_name: Option<&str>,
    ) -> Result<User, sqlx::Error> {
        let mut users = self.users.lock().expect("users lock poisoned");
        if let Some(existing) = users.iter_mut().find(|u| u.okta_sub == okta_sub) {
            existing.email = email.map(str::to_string);
            existing.display_name = display_name.map(str::to_string);
            existing.updated_at = Utc::now();
            return Ok(existing.clone());
        }
        let now = Utc::now();
        let user = User {
            id: Uuid::new_v4(),
            okta_sub: okta_sub.to_string(),
            email: email.map(str::to_string),
            display_name: display_name.map(str::to_string),
            created_at: now,
            updated_at: now,
        };
        users.push(user.clone());
        Ok(user)
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, sqlx::Error> {
        let users = self.users.lock().expect("users lock poisoned");
        Ok(users.iter().find(|u| u.id == id).cloned())
    }
}

#[async_trait]
impl CommunityRepo for InMemoryRepo {
    async fn create_community(
        &self,
        name: &str,
        owner_user_id: Uuid,
    ) -> Result<Community, sqlx::Error> {
        let community = Community {
            id: Uuid::new_v4(),
            name: name.to_string(),
            created_at: Utc::now(),
        };
        self.communities
            .lock()
            .expect("communities lock poisoned")
            .push(community.clone());
        self.community_members
            .lock()
            .expect("community_members lock poisoned")
            .push(CommunityMember {
                community_id: community.id,
                user_id: owner_user_id,
                role: Role::Owner,
                joined_at: Utc::now(),
            });
        Ok(community)
    }

    async fn community_exists(&self, community_id: Uuid) -> Result<bool, sqlx::Error> {
        let communities = self.communities.lock().expect("communities lock poisoned");
        Ok(communities.iter().any(|c| c.id == community_id))
    }

    async fn find_role(
        &self,
        community_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<Role>, sqlx::Error> {
        let members = self
            .community_members
            .lock()
            .expect("community_members lock poisoned");
        Ok(members
            .iter()
            .find(|m| m.community_id == community_id && m.user_id == user_id)
            .map(|m| m.role))
    }

    async fn list_members(&self, community_id: Uuid) -> Result<Vec<CommunityMember>, sqlx::Error> {
        let members = self
            .community_members
            .lock()
            .expect("community_members lock poisoned");
        Ok(members
            .iter()
            .filter(|m| m.community_id == community_id)
            .cloned()
            .collect())
    }

    async fn add_member(
        &self,
        community_id: Uuid,
        user_id: Uuid,
        role: Role,
    ) -> Result<CommunityMember, sqlx::Error> {
        let member = CommunityMember {
            community_id,
            user_id,
            role,
            joined_at: Utc::now(),
        };
        self.community_members
            .lock()
            .expect("community_members lock poisoned")
            .push(member.clone());
        Ok(member)
    }

    async fn update_role(
        &self,
        community_id: Uuid,
        user_id: Uuid,
        new_role: Role,
    ) -> Result<Option<CommunityMember>, sqlx::Error> {
        let mut members = self
            .community_members
            .lock()
            .expect("community_members lock poisoned");
        let Some(member) = members
            .iter_mut()
            .find(|m| m.community_id == community_id && m.user_id == user_id)
        else {
            return Ok(None);
        };
        member.role = new_role;
        Ok(Some(member.clone()))
    }

    async fn remove_member(&self, community_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error> {
        let mut members = self
            .community_members
            .lock()
            .expect("community_members lock poisoned");
        let before = members.len();
        members.retain(|m| !(m.community_id == community_id && m.user_id == user_id));
        Ok(members.len() != before)
    }
}

#[async_trait]
impl InviteRepo for InMemoryRepo {
    async fn create_invite(
        &self,
        community_id: Uuid,
        token_hash: &str,
        created_by_user_id: Uuid,
        expires_at: DateTime<Utc>,
        max_uses: Option<i32>,
    ) -> Result<Invite, sqlx::Error> {
        let invite = Invite {
            id: Uuid::new_v4(),
            community_id,
            token_hash: token_hash.to_string(),
            created_by_user_id,
            expires_at,
            max_uses,
            used_count: 0,
            created_at: Utc::now(),
            revoked_at: None,
        };
        self.invites
            .lock()
            .expect("invites lock poisoned")
            .push(invite.clone());
        Ok(invite)
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<Invite>, sqlx::Error> {
        Ok(self
            .invites
            .lock()
            .expect("invites lock poisoned")
            .iter()
            .find(|i| i.id == id)
            .cloned())
    }

    async fn revoke(&self, id: Uuid, community_id: Uuid) -> Result<bool, sqlx::Error> {
        let mut invites = self.invites.lock().expect("invites lock poisoned");
        let Some(invite) = invites
            .iter_mut()
            .find(|i| i.id == id && i.community_id == community_id)
        else {
            return Ok(false);
        };
        if invite.revoked_at.is_none() {
            invite.revoked_at = Some(Utc::now());
        }
        Ok(true)
    }

    async fn preview_by_token_hash(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<(InviteState, String)>, sqlx::Error> {
        let invites = self.invites.lock().expect("invites lock poisoned");
        let Some(invite) = invites.iter().find(|i| i.token_hash == token_hash) else {
            return Ok(None);
        };
        let state = invite_state(invite, now);
        let communities = self.communities.lock().expect("communities lock poisoned");
        let name = communities
            .iter()
            .find(|c| c.id == invite.community_id)
            .map(|c| c.name.clone())
            .expect("invite references a community that must exist");
        Ok(Some((state, name)))
    }

    /// Holds the `invites` mutex for the whole critical section (lookup,
    /// state check, membership check, and -- on success -- both the
    /// `community_members` insert and the `used_count` increment) so a
    /// concurrent claim against the same token cannot interleave. This is a
    /// synchronous std-mutex critical section with no `.await` inside it,
    /// which is sufficient for deterministic tests but is not the same
    /// mechanism as the Postgres impl's real row lock -- see
    /// docs/INVITE_DESIGN.md for what that distinction does and doesn't
    /// prove.
    async fn claim(
        &self,
        token_hash: &str,
        claiming_user_id: Uuid,
        now: DateTime<Utc>,
    ) -> Result<ClaimOutcome, sqlx::Error> {
        let mut invites = self.invites.lock().expect("invites lock poisoned");
        let Some(invite) = invites.iter_mut().find(|i| i.token_hash == token_hash) else {
            return Ok(ClaimOutcome::NotFound);
        };

        let state = invite_state(invite, now);
        if state != InviteState::Valid {
            return Ok(ClaimOutcome::Invalid(state));
        }

        let community = self
            .communities
            .lock()
            .expect("communities lock poisoned")
            .iter()
            .find(|c| c.id == invite.community_id)
            .cloned()
            .expect("invite references a community that must exist");

        let mut members = self
            .community_members
            .lock()
            .expect("community_members lock poisoned");
        if let Some(existing) = members
            .iter()
            .find(|m| m.community_id == invite.community_id && m.user_id == claiming_user_id)
        {
            return Ok(ClaimOutcome::AlreadyMember {
                community,
                role: existing.role,
            });
        }

        let membership = CommunityMember {
            community_id: invite.community_id,
            user_id: claiming_user_id,
            role: Role::Member,
            joined_at: now,
        };
        members.push(membership.clone());
        invite.used_count += 1;

        Ok(ClaimOutcome::Joined {
            community,
            membership,
        })
    }
}

#[async_trait]
impl ChannelRepo for InMemoryRepo {
    async fn create_channel(
        &self,
        community_id: Uuid,
        name: &str,
        visibility: ChannelVisibility,
        description: Option<&str>,
        creator_user_id: Uuid,
    ) -> Result<Channel, sqlx::Error> {
        let channel = Channel {
            id: Uuid::new_v4(),
            community_id,
            name: name.to_string(),
            visibility,
            description: description.map(str::to_string),
            created_by_user_id: creator_user_id,
            created_at: Utc::now(),
        };
        self.channels
            .lock()
            .expect("channels lock poisoned")
            .push(channel.clone());
        self.channel_members
            .lock()
            .expect("channel_members lock poisoned")
            .push(ChannelMember {
                channel_id: channel.id,
                user_id: creator_user_id,
                role: Role::Owner,
                joined_at: Utc::now(),
            });
        Ok(channel)
    }

    async fn find_channel(&self, channel_id: Uuid) -> Result<Option<Channel>, sqlx::Error> {
        Ok(self
            .channels
            .lock()
            .expect("channels lock poisoned")
            .iter()
            .find(|c| c.id == channel_id)
            .cloned())
    }

    async fn list_visible_channels(
        &self,
        community_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<Channel>, sqlx::Error> {
        let channels = self.channels.lock().expect("channels lock poisoned");
        let members = self
            .channel_members
            .lock()
            .expect("channel_members lock poisoned");
        Ok(channels
            .iter()
            .filter(|c| c.community_id == community_id)
            .filter(|c| {
                c.visibility == ChannelVisibility::Open
                    || members
                        .iter()
                        .any(|m| m.channel_id == c.id && m.user_id == caller_id)
            })
            .cloned()
            .collect())
    }

    async fn find_channel_role(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<Role>, sqlx::Error> {
        let members = self
            .channel_members
            .lock()
            .expect("channel_members lock poisoned");
        Ok(members
            .iter()
            .find(|m| m.channel_id == channel_id && m.user_id == user_id)
            .map(|m| m.role))
    }

    async fn list_channel_members(
        &self,
        channel_id: Uuid,
    ) -> Result<Vec<ChannelMember>, sqlx::Error> {
        let members = self
            .channel_members
            .lock()
            .expect("channel_members lock poisoned");
        Ok(members
            .iter()
            .filter(|m| m.channel_id == channel_id)
            .cloned()
            .collect())
    }

    async fn add_channel_member(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
        role: Role,
    ) -> Result<ChannelMember, sqlx::Error> {
        let member = ChannelMember {
            channel_id,
            user_id,
            role,
            joined_at: Utc::now(),
        };
        self.channel_members
            .lock()
            .expect("channel_members lock poisoned")
            .push(member.clone());
        Ok(member)
    }

    async fn update_channel_role(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
        new_role: Role,
    ) -> Result<Option<ChannelMember>, sqlx::Error> {
        let mut members = self
            .channel_members
            .lock()
            .expect("channel_members lock poisoned");
        let Some(member) = members
            .iter_mut()
            .find(|m| m.channel_id == channel_id && m.user_id == user_id)
        else {
            return Ok(None);
        };
        member.role = new_role;
        Ok(Some(member.clone()))
    }

    async fn remove_channel_member(
        &self,
        channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let mut members = self
            .channel_members
            .lock()
            .expect("channel_members lock poisoned");
        let before = members.len();
        members.retain(|m| !(m.channel_id == channel_id && m.user_id == user_id));
        Ok(members.len() != before)
    }

    async fn list_channel_ids_for_user(&self, user_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
        let members = self
            .channel_members
            .lock()
            .expect("channel_members lock poisoned");
        Ok(members
            .iter()
            .filter(|m| m.user_id == user_id)
            .map(|m| m.channel_id)
            .collect())
    }
}

#[async_trait]
impl MessageRepo for InMemoryRepo {
    async fn create_message(
        &self,
        channel_id: Uuid,
        sender_user_id: Uuid,
        content: &str,
        parent_message_id: Option<Uuid>,
    ) -> Result<Message, CreateMessageError> {
        // Single lock over the whole insert-plus-counter-update sequence --
        // this is what makes it atomic for the in-memory repo, mirroring
        // what a Postgres transaction gives `PostgresRepo`.
        let mut messages = self.messages.lock().expect("messages lock poisoned");
        let now = Utc::now();

        let (parent_id, root_id, depth) = match parent_message_id {
            None => (None, None, 0),
            Some(parent_id) => {
                let parent = messages
                    .iter()
                    .find(|m| m.id == parent_id)
                    .cloned()
                    .ok_or(CreateMessageError::ParentNotFound)?;
                if parent.channel_id != channel_id {
                    return Err(CreateMessageError::CrossChannelParent);
                }
                let depth = parent.depth + 1;
                if depth > THREAD_DEPTH_LIMIT {
                    return Err(CreateMessageError::DepthLimitExceeded);
                }
                let root_id = parent.root_message_id.unwrap_or(parent.id);
                (Some(parent.id), Some(root_id), depth)
            }
        };

        let message = Message {
            id: Uuid::new_v4(),
            seq: messages.len() as i64 + 1,
            channel_id,
            sender_user_id,
            content: content.to_string(),
            parent_message_id: parent_id,
            root_message_id: root_id,
            depth,
            reply_count: 0,
            descendant_count: 0,
            last_reply_at: None,
            created_at: now,
            updated_at: now,
        };
        messages.push(message.clone());

        if let Some(parent_id) = parent_id {
            if let Some(parent) = messages.iter_mut().find(|m| m.id == parent_id) {
                parent.reply_count += 1;
            }
        }
        if let Some(root_id) = root_id {
            if let Some(root) = messages.iter_mut().find(|m| m.id == root_id) {
                root.descendant_count += 1;
                root.last_reply_at = Some(now);
            }
        }

        Ok(message)
    }

    async fn list_messages(
        &self,
        channel_id: Uuid,
        before_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<Message>, sqlx::Error> {
        let messages = self.messages.lock().expect("messages lock poisoned");
        let mut matching: Vec<Message> = messages
            .iter()
            .filter(|m| m.channel_id == channel_id)
            .filter(|m| match before_seq {
                Some(before) => m.seq < before,
                None => true,
            })
            .cloned()
            .collect();
        matching.sort_by_key(|m| std::cmp::Reverse(m.seq)); // newest-first
        matching.truncate(limit.max(0) as usize);
        Ok(matching)
    }

    async fn find_message(&self, message_id: Uuid) -> Result<Option<Message>, sqlx::Error> {
        let messages = self.messages.lock().expect("messages lock poisoned");
        Ok(messages.iter().find(|m| m.id == message_id).cloned())
    }

    async fn list_thread_replies(
        &self,
        root_message_id: Uuid,
        after_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<Message>, sqlx::Error> {
        let messages = self.messages.lock().expect("messages lock poisoned");
        let mut matching: Vec<Message> = messages
            .iter()
            .filter(|m| m.root_message_id == Some(root_message_id))
            .filter(|m| match after_seq {
                Some(after) => m.seq > after,
                None => true,
            })
            .cloned()
            .collect();
        matching.sort_by_key(|m| m.seq); // oldest-first
        matching.truncate(limit.max(0) as usize);
        Ok(matching)
    }

    async fn thread_summaries(
        &self,
        root_message_ids: &[Uuid],
    ) -> Result<Vec<ThreadSummary>, sqlx::Error> {
        let messages = self.messages.lock().expect("messages lock poisoned");
        Ok(root_message_ids
            .iter()
            .filter_map(|id| messages.iter().find(|m| m.id == *id))
            .map(|m| ThreadSummary {
                root_message_id: m.id,
                reply_count: m.reply_count,
                descendant_count: m.descendant_count,
                last_reply_at: m.last_reply_at,
            })
            .collect())
    }
}

#[async_trait]
impl SessionRepo for InMemoryRepo {
    async fn create(
        &self,
        user_id: Uuid,
        token_hash: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<Session, sqlx::Error> {
        let session = Session {
            id: Uuid::new_v4(),
            user_id,
            token_hash: token_hash.to_string(),
            created_at: Utc::now(),
            expires_at,
            revoked_at: None,
        };
        self.sessions
            .lock()
            .expect("sessions lock poisoned")
            .push(session.clone());
        Ok(session)
    }

    async fn find_valid_by_token_hash(
        &self,
        token_hash: &str,
    ) -> Result<Option<(Session, User)>, sqlx::Error> {
        let sessions = self.sessions.lock().expect("sessions lock poisoned");
        let Some(session) = sessions
            .iter()
            .find(|s| s.token_hash == token_hash && s.is_valid(Utc::now()))
            .cloned()
        else {
            return Ok(None);
        };
        let users = self.users.lock().expect("users lock poisoned");
        let user = users
            .iter()
            .find(|u| u.id == session.user_id)
            .cloned()
            .expect("session references a user that must exist");
        Ok(Some((session, user)))
    }

    async fn revoke_by_token_hash(&self, token_hash: &str) -> Result<(), sqlx::Error> {
        let mut sessions = self.sessions.lock().expect("sessions lock poisoned");
        if let Some(session) = sessions.iter_mut().find(|s| s.token_hash == token_hash) {
            session.revoked_at = Some(Utc::now());
        }
        Ok(())
    }
}

#[async_trait]
impl DmRepo for InMemoryRepo {
    async fn open(&self, participant_ids: &[Uuid]) -> Result<DmConversation, sqlx::Error> {
        let key = dm_participant_key(participant_ids);
        // Held for the whole find-or-insert -- this is what makes two
        // concurrent `open()` calls for the same participant set resolve
        // to the same conversation for this in-memory repo, mirroring what
        // the Postgres impl's `ON CONFLICT` gives it.
        let mut conversations = self
            .dm_conversations
            .lock()
            .expect("dm_conversations lock poisoned");
        let conversation =
            if let Some(existing) = conversations.iter().find(|c| c.participant_key == key) {
                existing.clone()
            } else {
                let conversation = DmConversation {
                    id: Uuid::new_v4(),
                    participant_key: key,
                    created_at: Utc::now(),
                };
                conversations.push(conversation.clone());
                conversation
            };
        drop(conversations);

        let mut participants = self
            .dm_participants
            .lock()
            .expect("dm_participants lock poisoned");
        for &user_id in participant_ids {
            if !participants
                .iter()
                .any(|(c, u)| *c == conversation.id && *u == user_id)
            {
                participants.push((conversation.id, user_id));
            }
        }

        Ok(conversation)
    }

    async fn list_conversations_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<DmConversation>, sqlx::Error> {
        let conversation_ids: std::collections::HashSet<Uuid> = self
            .dm_participants
            .lock()
            .expect("dm_participants lock poisoned")
            .iter()
            .filter(|(_, u)| *u == user_id)
            .map(|(c, _)| *c)
            .collect();
        let conversations = self
            .dm_conversations
            .lock()
            .expect("dm_conversations lock poisoned");
        let mut result: Vec<DmConversation> = conversations
            .iter()
            .filter(|c| conversation_ids.contains(&c.id))
            .cloned()
            .collect();
        result.sort_by_key(|c| std::cmp::Reverse(c.created_at));
        Ok(result)
    }

    async fn find_conversation(
        &self,
        conversation_id: Uuid,
    ) -> Result<Option<DmConversation>, sqlx::Error> {
        let conversations = self
            .dm_conversations
            .lock()
            .expect("dm_conversations lock poisoned");
        Ok(conversations
            .iter()
            .find(|c| c.id == conversation_id)
            .cloned())
    }

    async fn is_participant(
        &self,
        conversation_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let participants = self
            .dm_participants
            .lock()
            .expect("dm_participants lock poisoned");
        Ok(participants
            .iter()
            .any(|(c, u)| *c == conversation_id && *u == user_id))
    }

    async fn list_conversation_ids_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<Uuid>, sqlx::Error> {
        let participants = self
            .dm_participants
            .lock()
            .expect("dm_participants lock poisoned");
        Ok(participants
            .iter()
            .filter(|(_, u)| *u == user_id)
            .map(|(c, _)| *c)
            .collect())
    }

    async fn create_dm_message(
        &self,
        conversation_id: Uuid,
        sender_user_id: Uuid,
        content: &str,
    ) -> Result<DmMessage, sqlx::Error> {
        let mut messages = self.dm_messages.lock().expect("dm_messages lock poisoned");
        let now = Utc::now();
        let message = DmMessage {
            id: Uuid::new_v4(),
            seq: messages.len() as i64 + 1,
            conversation_id,
            sender_user_id,
            content: content.to_string(),
            created_at: now,
            updated_at: now,
        };
        messages.push(message.clone());
        Ok(message)
    }

    async fn list_dm_messages(
        &self,
        conversation_id: Uuid,
        before_seq: Option<i64>,
        limit: i64,
    ) -> Result<Vec<DmMessage>, sqlx::Error> {
        let messages = self.dm_messages.lock().expect("dm_messages lock poisoned");
        let mut matching: Vec<DmMessage> = messages
            .iter()
            .filter(|m| m.conversation_id == conversation_id)
            .filter(|m| match before_seq {
                Some(before) => m.seq < before,
                None => true,
            })
            .cloned()
            .collect();
        matching.sort_by_key(|m| std::cmp::Reverse(m.seq));
        matching.truncate(limit.max(0) as usize);
        Ok(matching)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn upsert_by_okta_sub_reuses_the_same_row_across_logins() {
        let repo = InMemoryRepo::new();
        let first = repo
            .upsert_by_okta_sub("okta-sub-1", Some("a@example.com"), Some("A"))
            .await
            .unwrap();
        let second = repo
            .upsert_by_okta_sub("okta-sub-1", Some("a-changed@example.com"), Some("A2"))
            .await
            .unwrap();
        assert_eq!(
            first.id, second.id,
            "same okta_sub must reuse the same users.id"
        );
        assert_eq!(second.email.as_deref(), Some("a-changed@example.com"));
    }

    #[tokio::test]
    async fn different_okta_subs_never_collide() {
        let repo = InMemoryRepo::new();
        let a = repo.upsert_by_okta_sub("sub-a", None, None).await.unwrap();
        let b = repo.upsert_by_okta_sub("sub-b", None, None).await.unwrap();
        assert_ne!(a.id, b.id);
    }

    #[tokio::test]
    async fn expired_session_is_treated_as_not_found() {
        let repo = InMemoryRepo::new();
        let user = repo.upsert_by_okta_sub("sub-c", None, None).await.unwrap();
        repo.create(user.id, "hash-1", Utc::now() - chrono::Duration::seconds(1))
            .await
            .unwrap();
        let found = repo.find_valid_by_token_hash("hash-1").await.unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn revoked_session_is_treated_as_not_found() {
        let repo = InMemoryRepo::new();
        let user = repo.upsert_by_okta_sub("sub-d", None, None).await.unwrap();
        repo.create(user.id, "hash-2", Utc::now() + chrono::Duration::hours(1))
            .await
            .unwrap();
        assert!(repo
            .find_valid_by_token_hash("hash-2")
            .await
            .unwrap()
            .is_some());
        repo.revoke_by_token_hash("hash-2").await.unwrap();
        assert!(repo
            .find_valid_by_token_hash("hash-2")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn claiming_the_same_invite_twice_is_already_member_not_a_second_join() {
        let repo = InMemoryRepo::new();
        let owner = repo.upsert_by_okta_sub("owner", None, None).await.unwrap();
        let joiner = repo.upsert_by_okta_sub("joiner", None, None).await.unwrap();
        let community = repo.create_community("C", owner.id).await.unwrap();
        let invite = repo
            .create_invite(
                community.id,
                "tok-1",
                owner.id,
                Utc::now() + chrono::Duration::hours(1),
                None,
            )
            .await
            .unwrap();

        let first = repo.claim("tok-1", joiner.id, Utc::now()).await.unwrap();
        assert!(matches!(first, ClaimOutcome::Joined { .. }));

        let second = repo.claim("tok-1", joiner.id, Utc::now()).await.unwrap();
        assert!(matches!(second, ClaimOutcome::AlreadyMember { .. }));

        let stored = InviteRepo::find_by_id(&repo, invite.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.used_count, 1,
            "already_member must not increment used_count a second time"
        );
    }

    #[tokio::test]
    async fn claim_reports_correct_invalid_state_for_revoked_expired_and_exhausted() {
        let repo = InMemoryRepo::new();
        let owner = repo.upsert_by_okta_sub("owner2", None, None).await.unwrap();
        let community = repo.create_community("C2", owner.id).await.unwrap();

        // Revoked.
        let revoked_invite = repo
            .create_invite(
                community.id,
                "tok-revoked",
                owner.id,
                Utc::now() + chrono::Duration::hours(1),
                None,
            )
            .await
            .unwrap();
        repo.revoke(revoked_invite.id, community.id).await.unwrap();
        let user_a = repo.upsert_by_okta_sub("a", None, None).await.unwrap();
        assert!(matches!(
            repo.claim("tok-revoked", user_a.id, Utc::now())
                .await
                .unwrap(),
            ClaimOutcome::Invalid(InviteState::Revoked)
        ));

        // Expired.
        repo.create_invite(
            community.id,
            "tok-expired",
            owner.id,
            Utc::now() - chrono::Duration::seconds(1),
            None,
        )
        .await
        .unwrap();
        let user_b = repo.upsert_by_okta_sub("b", None, None).await.unwrap();
        assert!(matches!(
            repo.claim("tok-expired", user_b.id, Utc::now())
                .await
                .unwrap(),
            ClaimOutcome::Invalid(InviteState::Expired)
        ));

        // Exhausted: max_uses = 1, already used once by a third user.
        repo.create_invite(
            community.id,
            "tok-exhausted",
            owner.id,
            Utc::now() + chrono::Duration::hours(1),
            Some(1),
        )
        .await
        .unwrap();
        let user_c = repo.upsert_by_okta_sub("c", None, None).await.unwrap();
        let user_d = repo.upsert_by_okta_sub("d", None, None).await.unwrap();
        let first = repo
            .claim("tok-exhausted", user_c.id, Utc::now())
            .await
            .unwrap();
        assert!(matches!(first, ClaimOutcome::Joined { .. }));
        assert!(matches!(
            repo.claim("tok-exhausted", user_d.id, Utc::now())
                .await
                .unwrap(),
            ClaimOutcome::Invalid(InviteState::Exhausted)
        ));

        // Unknown token.
        assert!(matches!(
            repo.claim("tok-does-not-exist", user_a.id, Utc::now())
                .await
                .unwrap(),
            ClaimOutcome::NotFound
        ));
    }
}
