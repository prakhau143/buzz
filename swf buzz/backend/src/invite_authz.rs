//! Pure invite-validity decisions (master prompt §11-§14): whether a
//! presented invite may be claimed/previewed right now. No I/O, no locking
//! -- the atomicity guarantee against over-claiming a `max_uses`-limited
//! invite under concurrency (master prompt §12) is the repo layer's job
//! (`InviteRepo::claim`, a `SELECT ... FOR UPDATE`-locked transaction in the
//! Postgres impl); this module only answers "given this row's current
//! state, is it usable," so both repo implementations and both HTTP
//! surfaces (public preview, authenticated claim) share one rule set.

use crate::models::Invite;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InviteState {
    Valid,
    Revoked,
    Expired,
    Exhausted,
}

pub fn invite_state(invite: &Invite, now: DateTime<Utc>) -> InviteState {
    if invite.revoked_at.is_some() {
        return InviteState::Revoked;
    }
    if invite.expires_at <= now {
        return InviteState::Expired;
    }
    if let Some(max_uses) = invite.max_uses {
        if invite.used_count >= max_uses {
            return InviteState::Exhausted;
        }
    }
    InviteState::Valid
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn base_invite() -> Invite {
        Invite {
            id: Uuid::new_v4(),
            community_id: Uuid::new_v4(),
            token_hash: "hash".to_string(),
            created_by_user_id: Uuid::new_v4(),
            expires_at: Utc::now() + chrono::Duration::hours(1),
            max_uses: None,
            used_count: 0,
            created_at: Utc::now(),
            revoked_at: None,
        }
    }

    #[test]
    fn fresh_unlimited_invite_is_valid() {
        assert_eq!(invite_state(&base_invite(), Utc::now()), InviteState::Valid);
    }

    #[test]
    fn revoked_beats_everything_else() {
        let mut invite = base_invite();
        invite.revoked_at = Some(Utc::now());
        assert_eq!(invite_state(&invite, Utc::now()), InviteState::Revoked);
    }

    #[test]
    fn past_expiry_is_expired() {
        let mut invite = base_invite();
        invite.expires_at = Utc::now() - chrono::Duration::seconds(1);
        assert_eq!(invite_state(&invite, Utc::now()), InviteState::Expired);
    }

    #[test]
    fn used_count_at_max_uses_is_exhausted() {
        let mut invite = base_invite();
        invite.max_uses = Some(3);
        invite.used_count = 3;
        assert_eq!(invite_state(&invite, Utc::now()), InviteState::Exhausted);
    }

    #[test]
    fn used_count_below_max_uses_is_still_valid() {
        let mut invite = base_invite();
        invite.max_uses = Some(3);
        invite.used_count = 2;
        assert_eq!(invite_state(&invite, Utc::now()), InviteState::Valid);
    }

    #[test]
    fn none_max_uses_is_never_exhausted_regardless_of_used_count() {
        let mut invite = base_invite();
        invite.max_uses = None;
        invite.used_count = 1_000_000;
        assert_eq!(invite_state(&invite, Utc::now()), InviteState::Valid);
    }
}
