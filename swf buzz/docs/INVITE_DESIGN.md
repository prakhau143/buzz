# Invite design (Phase 4, DECISIONS.md D10)

Decision record, not an essay. Extends `swf buzz/backend/` (Phases 2-3) with `community_invites`
and four endpoints. See `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §1 rows 6-8 for the endpoint spec this
phase implements, `BACKEND_SESSION_DESIGN.md` for the session/auth layer, and
`COMMUNITY_MEMBERSHIP_DESIGN.md` for the community/role layer this builds on.

## 1. Public preview uses real HTTP status codes, not a `200 {valid: false}` wrapper

The master prompt's own general error-handling section (§14) specifies distinct codes per invite
state (404 invalid, 410 expired/revoked, 409 exhausted) as this backend's one API convention —
every other endpoint in this crate already follows it. `GET /api/invites/:token/preview` follows
the same convention rather than inventing a second one just because it's public.

The tradeoff this raises — does distinguishing "doesn't exist" (404) from "expired"/"revoked" (410)
leak information to an unauthenticated caller — is judged acceptable here specifically because
invite tokens are 256-bit CSPRNG values (`token::generate()`, shared with session tokens): there is
no adjacent-guessing or enumeration risk the way there is for e.g. usernames or sequential IDs.
Knowing that *a* token in that keyspace once existed and is now expired reveals nothing about any
other token. The response body itself still leaks nothing beyond `community_name` on success.

## 2. `ttl_secs` / `max_uses` bounds

The master prompt gives a UI example ("72 hours ▾", "Unlimited ▾") but no exact numeric bounds —
this backend's own call: `ttl_secs` must be between 1 hour and 30 days inclusive (default 72 hours
when omitted); `max_uses`, when provided, must be ≥ 1 (omitted = unlimited). Both are validated
server-side (`422`) in `routes/invites.rs::create_invite` — never trust the frontend's own bounds.

## 3. Revoke is a genuine SWF addition, not old-Buzz parity

`OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` notes old Buzz's source never confirmed a revoke endpoint
exists. `POST /api/invites/:id/revoke` here is new, owner/admin-gated the same way as create
(`community_authz::can_manage_invites`, not ported from `permissions.ts` since invites weren't in
that file's original scope), and idempotent (revoking an already-revoked invite still returns 200).

## 4. Atomicity: what's actually proven vs. reasoned about

`InviteRepo::claim` is the one method with a real concurrency requirement (master prompt §12: a
`max_uses`-limited invite must never be over-claimed under concurrent requests). Two different
mechanisms back the two repo implementations:

- **`PostgresRepo::claim`**: a single transaction that does `SELECT ... FOR UPDATE` on the invite
  row before validating state, checking membership, inserting, and incrementing `used_count`, then
  commits. Postgres's row lock is what actually prevents a second concurrent transaction from
  reading a stale `used_count`. **Not exercised against a live database in this environment** — no
  Postgres instance was available (same gap as Phases 2-3). This is reasoned about, not proven, in
  this session.
- **`InMemoryRepo::claim`**: holds a single `std::sync::Mutex` for the entire critical section
  (lookup → state check → membership check → insert/increment), with no `.await` inside it. This is
  sufficient to make `tests/invite_flow.rs`'s
  `a_max_uses_one_invite_is_never_over_claimed_under_concurrent_requests` test deterministic — it
  drives two real concurrent HTTP requests at the live Axum router and asserts exactly one succeeds
  — but it proves the *handler/routing/authz wiring and outcome contract*, not Postgres's own
  locking mechanism. Run 8 times in a row with no flakes this session.

**Net**: the concurrency *behavior* (one winner, one `409`) is verified end-to-end over real HTTP.
The specific claim "a `SELECT ... FOR UPDATE` row lock prevents this under real Postgres" remains
unverified against real infrastructure — flag before relying on it in production without first
running the equivalent test against a live database.

## 5. What's deliberately out of scope for this phase

The frontend invite landing page (`/invite/:token` route, Okta-redirect-then-claim flow) and
rewiring `InviteService.ts`/`useChannelInvites.ts` to call this new HTTP API instead of publishing
`kind:9009` — backend-only per the plan doc's scope, follow-up work. Channel membership, messages,
threads, DMs remain Phase 5+.

## 6. Verification status

All 46 backend tests pass (`cargo test`): 29 unit (7 new `invite_authz` state-machine cases, 4 new
`community_authz`/`repo::memory` invite cases), 9 new integration tests in
`tests/invite_flow.rs` (create authz + validation, claim success/idempotency/concurrency, expired,
revoked + revoke authz, unknown-token 404, public-preview info-leak surface, unauthenticated
rejection), 5 + 3 pre-existing Phase 3/2 tests unaffected. `cargo clippy --all-targets` and
`cargo fmt --check` clean. Frontend/`src-tauri` untouched this phase, so their gates weren't
re-run (green as of Phase 3's last check). Same unverified-against-real-Postgres gap as every prior
phase (Docker was down this session) — see §4 above for the specific claim that matters most here.
