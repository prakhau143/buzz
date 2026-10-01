# Architectural Decisions

## D1. DM protocol: `kind:41010` + plain `kind:9`, not NIP-17 gift wrap

**Decision**: SWF Buzz's DM feature is built against `kind:41010` (open) → a DM is a `channels` row → messages are plain `kind:9` tagged `#h=<dm-channel-uuid>`, exactly as verified in `PROTOCOL_IMPLEMENTATION_REFERENCE.md` §8.

### A. Current Buzz DM implementation

Kind:41010 opens/finds a DM channel (participants as `p` tags); the relay creates a `channels` table row with `channel_type = "dm"`; all subsequent traffic (messages, reactions, edits, deletions) is the identical event kind set used by regular channels, scoped by `h`. Hide/unhide via `kind:41012` / re-`41010`. A relay-signed `kind:30622` gives each viewer their own hidden-DM list. This is fully wired end-to-end and is what Buzz's own React client actually renders.

### B. NIP-17 gift-wrap approach

`kind:1059` (gift wrap) is implemented at the relay ingest layer (validated, `#p`-gated, excluded from search) and covered by conformance tests — but purely as **interop surface for third-party NIP-17 clients**, not Buzz's own feature. No client in the `buzz` monorepo (desktop, mobile, web) contains gift-wrap/seal _sending_ code. Content, sender identity, and timestamp are hidden from the relay by design (double-wrapped: rumor → seal → gift wrap), which is the standard NIP-17 privacy model.

### C. Advantages / disadvantages

|                                                              | `kind:41010` + `kind:9`                                                                                    | NIP-17 gift wrap                                                                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wired today                                                  | Yes, fully                                                                                                 | Relay-side only; no client sender exists                                                                                                                  |
| Privacy from relay operator                                  | None — relay sees plaintext content, participants, timestamps (relay is trusted, same as channel messages) | Strong — relay sees only that _a_ wrapped event was delivered to a pubkey                                                                                 |
| Reuses existing message features (threads, reactions, edits) | Yes, automatically (same kind set)                                                                         | No — would need parallel implementations of threading/reactions inside encrypted rumors                                                                   |
| Implementation cost for SWF Buzz                             | Low — pure client work against an already-correct relay path                                               | High — relay ingest exists, but SWF Buzz would be the _first_ real sender in this ecosystem; more surface for bugs, no reference client behavior to match |
| Interop with generic Nostr clients                           | No (Buzz-specific `channels`/`h`-tag model)                                                                | Yes, in principle                                                                                                                                         |

### D. Security implications

`kind:41010` DMs are only as private as the relay operator is trusted — identical trust model to channel messages. This is consistent with the product framing ("self-hosted Buzz backend" run by the same organization as the client), so it is an acceptable default for an internal employee tool, but it is **not** end-to-end private against the relay operator. If a future requirement needs DMs hidden even from the relay operator (e.g. legal/HR conversations), NIP-17 is the correct primitive.

### E. Compatibility implications

Choosing 41010 ties SWF Buzz DMs to the Buzz-specific relay/channel model — this is expected and fine since SWF Buzz only ever talks to a Buzz relay. It does mean SWF Buzz DMs are not interoperable with a generic Nostr DM client; that is out of scope for this product anyway.

### F. What SWF Buzz implements

Build `DmService` → `DmTransport` (interface), with a `Kind41010Transport` as the only concrete implementation for now. `DmTransport` exposes `open(participants)`, `send(conversationId, content, tags)`, `hide(conversationId)`, `subscribe(conversationId)` — nothing UI-facing references `41010` directly. This makes swapping in (or adding, per-conversation) a NIP-17 transport later a `DmTransport` implementation, not a UI rewrite.

### G. Must be confirmed with the team before production

- Whether relay-operator-visible DM content is acceptable for all intended DM use cases at this company, or whether some conversations need NIP-17-level privacy from day one.
- Group-DM behavior: `kind:41011` (add member) has no confirmed live handler — confirm whether group DMs (>2 participants) are actually supported by the deployed relay before exposing that UI, or ship 1:1 DMs only initially.

---

## D2. NIP-46 signing — new work, not a port; local key never touches the frontend

The reference Buzz Desktop does not implement NIP-46 (feature not even enabled in its `nostr` crate dependency); its device-pairing protocol only transports an opaque secret string between the user's own devices without consuming it as a live remote signer. SWF Buzz's product requirement is strict: **never store a raw private key in the desktop client**, and use NIP-46 bunker signing.

**Decision**: implement `SigningService` as an interface from day one (see `ARCHITECTURE.md` §6), with:

- A NIP-46 client implementation using a mature Nostr client library's existing bunker-client support (avoid hand-rolling the NIP-46 RPC/encryption). This requires a real NIP-46-compatible signer service to exist somewhere the client can reach (a "bunker") — **this does not exist yet anywhere in the Buzz stack** and is a genuine infrastructure gap, not just a client-side task.
- A development-mode mock signer, clearly labeled as non-production (see `SECURITY.md`), for local UI development before bunker infrastructure exists.

**Must be confirmed with the team**: which NIP-46 bunker implementation SWF Buzz should target (a self-hosted bunker service, a per-employee hardware/software signer, or something else), and how Okta identity maps to a specific bunker/Nostr identity (see D3).

## D3. Okta ↔ Nostr identity linkage is unresolved

Okta OIDC authenticates the employee to the company; NIP-46 authorizes Nostr actions for a specific Nostr keypair. **Open question, not resolvable from source**: how does a successful Okta login select/provision the correct bunker connection for that employee? Options include (a) an Okta custom claim carrying a bunker URI, (b) a company directory service mapping employee → bunker, (c) first-login pairing flow where the employee scans/pastes a `bunker://` URI issued out-of-band. Implement `AuthService` and `SigningService` as independent interfaces so this can be decided later without coupling them.

## D4. Invite feature is a stub until the relay implements acceptance

`kind:9009` create-invite is accepted and stored by the relay but its side-effect handler is a no-op today (confirmed in source, `PROTOCOL_IMPLEMENTATION_REFERENCE.md` §7). **Decision**: ship `InviteService` capable of creating/publishing invites and listing ones a user created, but do not build an "accept invite" UI that implies server enforcement (expiry, single-use, revocation) until the backend team confirms this is implemented. Flag this clearly in the invites UI (e.g. as a "coming soon" state for acceptance) rather than presenting a false affordance.

## D5. Relay connection ownership: frontend, not Rust

The reference Buzz Desktop routes the raw WebSocket through a generic Rust Tauri plugin while implementing all Nostr protocol logic (filters, reconnect, backoff) in TypeScript. **Decision**: SWF Buzz keeps the raw WebSocket in the frontend as well (browser-native `WebSocket`, matching Buzz's own `web/` client), since the reasons for Buzz Desktop's split (surviving webview reloads across a much larger, longer-lived session with many background communities) don't apply at SWF Buzz's intentionally small scope. Signing stays in the abstraction described in D2 regardless of where the socket lives. Revisit only if a concrete need for Rust-owned transport emerges (e.g. background sync while the webview is suspended).

## D6. Agent observer-frame decryption depends on the eventual NIP-46 bunker's capabilities

`kind:24200` agent observer frames are NIP-44-encrypted from the agent's key to the owner. A NIP-46-signing client (which never holds the private key) can only decrypt these if the chosen bunker exposes a `nip44_decrypt` RPC method for arbitrary sender pubkeys (not just its own identity's outgoing encryption). **Must be confirmed** once a bunker implementation is chosen (D2); until then, the agent "working" status UI should be built to degrade gracefully to the `kind:20002` typing-indicator fallback (which requires no decryption) rather than assuming observer-frame access.

## D7. Windows code signing

No Windows code-signing step exists anywhere in the reference repo's CI (`windows-canary.yml` produces an unsigned NSIS installer). **Must be confirmed with the team** before a production release: whether SWF Buzz needs a code-signing certificate for distribution (unsigned installers trigger SmartScreen warnings on employee machines).

## D8. Vite pinned to 7.x, not 8.x — environment-specific, not an architectural choice

The reference Buzz Desktop uses Vite `^8.0.0` (`RECONNAISSANCE.md` §2), and SWF Buzz was initially scaffolded the same way. Vite 8's default bundler engine (`rolldown`) ships a native `.node` binding per platform; on this development machine, `@rolldown/binding-win32-x64-msvc`'s native binary was blocked outright by a local Windows Application Control policy (`node_modules/rolldown/... Error: An Application Control policy has blocked this file`), while other native addons in the same `node_modules` (Tauri CLI, lightningcss) loaded fine — i.e. this is a targeted block of one specific new/unsigned binary, not a blanket policy against native code in this folder.

**Decision**: pin `vite` to `^7.3.6` (the last pre-rolldown-default major, using the long-established Rollup+esbuild pipeline) so `npm run build`/`npm run dev` work on this machine without requiring an IT policy exception. This is a build-tooling accommodation, not a product/architecture decision — nothing in `src/` depends on which Vite major is used. **Revisit**: if the target deployment/CI machine doesn't hit the same Application Control block, upgrading back to Vite 8 (matching the reference repo) is safe to do at any time; re-run the full `npm run typecheck && npm run lint && npm run test && npm run build` sequence after doing so.

## D9. Okta OIDC flow — ID token signature verification (RESOLVED)

**Status as originally written (stale as of a later, unrecorded edit — corrected below in this
pass, 2026-09-17)**: this entry originally described `src-tauri/src/auth/oidc.rs` as using a
`127.0.0.1:0` loopback `tiny_http` listener with signature verification skipped. **Both of those
are no longer true of the current source** and the entry was never updated to say so — a docs/code
drift caught while auditing D10, not a new decision. Corrected facts, verified against the current
file this pass:

- The redirect mechanism is a **custom URL scheme deep link**
  (`com.okta.trial-7050986:/callback`, via `tauri-plugin-deep-link` +
  `tauri-plugin-single-instance`), not a loopback HTTP listener — necessary because the configured
  Okta application's only registered redirect URI is the custom scheme. See the module doc comment
  at the top of `oidc.rs` and `docs/OKTA_PKCE_SETUP.md`.
- `verify_id_token` in `oidc.rs` **does** fetch Okta's JWKS (`{issuer}/v1/keys`) and verify the ID
  token's RS256 signature, `iss`, `aud`, `exp` (via `jsonwebtoken`'s built-in checks), and `nonce`
  (checked manually). A token that merely decodes is never trusted. This closes the gap this entry
  was originally tracking.

**Not yet exercised against a real Okta tenant's live callback-to-token-verified-success path in
this environment** (see project memory `project-swf-buzz-okta-verification`, 2026-09-16 — PKCE,
deep-link delivery, and the exact authorize-request shape were all confirmed correct against a real
trial tenant, but the test user was blocked by Okta's own "not assigned" policy before an
authorization code was ever issued, so the token-exchange/JWKS-verification code path itself has
still never run against a real Okta response).

**Follow-up from D10**: the new `swf-buzz-backend` service (Phase 2) performs its **own**,
independent JWKS fetch and verification of the same ID token at its own trust boundary — see
`docs/BACKEND_SESSION_DESIGN.md` §3 for why this is intentional defense-in-depth, not redundant
duplication. That backend-side verification has unit and integration test coverage (valid, expired,
wrong-issuer, wrong-audience, tampered-signature, unknown-`kid` cases) using a synthetic RSA
keypair — real cryptographic verification, not a mock, though still not exercised against Okta's
actual live JWKS response (no network access to a real Okta tenant from this session either).

## D10. Human Nostr identity removed; new `okta_sub`-keyed session/membership backend, extending buzz-relay's architecture

**Supersedes D1 (DM protocol choice), D2 (NIP-46 signing), D3 (Okta↔Nostr linkage)** for human
users. Decided 2026-09-17: SWF Buzz's human authentication/authorization no longer resolves Okta
identity to a Nostr keypair at all. The Okta `sub` claim itself is the human identity primitive.

**New architecture**: `Okta OIDC (PKCE) → JWKS-verified ID token → swf_session (httpOnly cookie) →
Application User (users table, keyed by okta_sub) → Community Membership (community_members,
role: owner/admin/member) → Permissions → Communities/Channels/Messages/Threads/DMs`. No pubkey,
nsec, npub, NIP-42, NIP-46, bunker, or NIP-98 anywhere in this path. Community invites move to a
plain HTTP create/claim/revoke flow with a SHA-256-hashed opaque token (never store the raw token)
and an atomic `SELECT ... FOR UPDATE` claim transaction — see
`OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` for the full endpoint/schema spec.

**Why this is a much bigger change than a protocol swap**: audited in `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md`
(Phase 1, no code changed to produce it). SWF Buzz has no HTTP backend, session, or database of its
own today — every mutation (roles, invites, channel membership, messages, threads, DMs) is
currently a signed Nostr event over WebSocket to `buzz-relay`; Okta today only supplies a display
name, while the real authorization identity downstream is a Nostr pubkey (either a real NIP-46
bunker, or the current default: a keypair deterministically SHA-256-derived from the Okta `sub`,
`signingService.dev.ts:44-59`). ~75 of ~95 source files reference pubkey/NIP-46/bunker/signing
concepts. This decision requires standing up a new backend, not just re-pointing an existing one.

**Backend ownership — decided**: the new session/user/membership HTTP service is built **as a new
service architected like `buzz-relay`** (Rust/Axum/Postgres, reusing its already-correct
`community_members`/`channel_members`/role-check *logic* — ported and re-keyed from `pubkey` to
`okta_sub`/`users.id`, not copy-pasted) rather than (a) a wholly unrelated sibling stack or (b) SWF
Buzz growing an ad-hoc backend with no architectural relationship to Old Buzz's proven design.
**This is a new codebase living under the SWF Buzz project, not an edit to `../buzz`** — `../buzz`
(including its `buzz-relay` crate) remains strictly read-only reference per the project's standing
rule; nothing in `../buzz` is modified, forked, or run in-place as part of this work. Where this
new backend crate/service physically lives inside the SWF Buzz repo is an implementation detail
for Phase 2, not a further open question.

**Non-human/agent Nostr participants are explicitly out of scope for removal** — agents remain
ordinary Nostr participants on the existing relay per `ARCHITECTURE.md` §10; only the *human*
auth/authz path is being migrated off Nostr identity. Platform-admin (Operator/Moderator plane,
pubkey-based) and moderation's NIP-98 dependency are real sibling gaps under the same "no NIP-98"
rule but are out of scope for this decision's community/invite/channel/message/DM focus — tracked,
not silently carried forward.

**Migration sequencing**: build the new `userId`-keyed HTTP paths alongside the existing
pubkey-keyed ones, migrate each feature's UI to the new service, verify, *then* delete the old
protocol/service/store code — not delete-first. Full feature-by-feature gap table and file
classification: `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md`.

## D11. D10 superseded: human identity is local Nostr again, not Okta/`okta_sub`

**Decided 2026-09-21** (`PHASE_1_OLD_BUZZ_IDENTITY_IMPLEMENTATION.md`, following
`SWF_BUZZ_OLD_BUZZ_IDENTITY_MIGRATION_PLAN.md`). D10 above is **historical record of a decision
that was later reversed, not current architecture** — left as originally written per this
project's rule against silently rewriting past decisions; this entry is the correction, not an
edit to D10's text.

**Current architecture**: local Nostr identity (generated/imported client-side, NIP-49-encrypted
backup, OS keyring storage) is the human identity primitive again — restored in Phase 1, then
built on directly by Phase 2 (Operator/Owner/Admin/Member via `RELAY_OPERATOR_PUBKEYS`/
`relay_members`, NIP-42/NIP-98, see `PHASE_2_1_OPERATOR_TERMINOLOGY_AND_HARDENING_AUDIT.md` and
`SWF_ROLE_MODEL.md`) and Phase 3 (`ChannelService.ts`/`MessageService.ts`/`ThreadService.ts`/
`ReactionService.ts`/`RelayConnectionService.ts`, all NIP-29 over the same relay — see
`PHASE_3_OLD_BUZZ_PROTOCOL_AUDIT.md` and `PHASE_3_IMPLEMENTATION_AUDIT.md`). Okta/`okta_sub` is
**not** the active human-auth path.

**What's left of D10's build**: the `swf-buzz-backend` Rust service (Okta JWKS verification,
`okta_sub`-keyed `users`/session tables) and the frontend's `*ServiceHttp.ts` /
`CommunityChannelsView.vue` track still exist in the repository, still compile, and are reachable
behind a separate route — but they are a second, currently-unused-by-default track, not the live
one. This decision does not resolve whether that track should eventually be deleted, merged, or
kept as a genuinely separate deployment mode (e.g. a future non-Nostr enterprise SSO story) —
that is an open question for whoever next touches identity architecture, tracked here so it isn't
mistaken for dead code and removed by accident, and not silently decided by this entry.

**Why record this now, in Phase 3**: `PHASE_3_OLD_BUZZ_PROTOCOL_AUDIT.md` §0 found that
`DECISIONS.md` had never been updated after the Phase 1 reversal, which meant this file — the
project's own architecture-decision record — was actively wrong about which identity system is
live. Fixed as part of Phase 3's documentation requirements rather than left for a future phase,
since an incorrect decisions log is worse than an incomplete one.

## D12. Identity is an explicit application session; "active" means signer + session pubkey + verified NIP-42 AUTH pubkey

**Decided 2026-09-22** (`IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md`,
`PHASE_3_IMPLEMENTATION_AUDIT.md` §19). Triggered by the P0 bug: sign out as member A → import
operator B → app still rendered A's channels/roster/role. Root causes were entirely in the
webview (global, never-cleared Vue Query keys; import teardown gated on a signed-in session;
"connected" treated as "authenticated"; a connect-generation race) — Rust's `replace_identity`
was already correct.

**Decisions**

1. **One lifecycle, two functions.** `endIdentitySession()` is the *only* teardown (disconnect →
   clear signer → clear session/access/connection/ui/read/agent stores → `queryClient.clear()`);
   `beginIdentitySession()` is the *only* way to become an identity on the relay. Sign-out,
   sign-in, import/switch and silent resume all go through them; no code path may partially reset.
2. **Active identity is three things that must agree**: `session.pubkey`, the signer in
   `signingServiceRegistry`, and `connection.authenticatedPubkey` — the pubkey taken from the
   signed NIP-42 AUTH event itself. `beginIdentitySession` refuses the session if they differ.
   `status === "connected"` is never evidence of who is authenticated.
3. **Every Vue Query key is identity-scoped** (`["identity", <pubkey|"anonymous">, …]`,
   `queryKeys.ts`) *and* the cache is cleared on teardown. Scoping alone would leave A's data
   resident in memory; clearing alone would leave a window for B to read A's keys. Both.
4. **Sign-out keeps the key in secure storage** (OLD BUZZ semantics: the *session* ends, the
   *identity* stays; the login screen then says "Existing identity found"). No reset/delete
   command was added; switching goes through the existing `replace_identity` (archive, never
   delete) and recovery through NIP-49 backup import.
5. **Two role planes, stored separately, never derived from each other**: `session.platformRole`
   (operator — the relay's answer to NIP-98 on `/operator/*`) and `session.communityRole`
   (owner/admin/member — `relay_members` after NIP-42). Guarded by `identitySecurity.spec.ts`.
6. **The relay connection singleton is session-resettable**, not identity-bound: `disconnect()`
   bumps a connect generation (in-flight handshakes from the previous identity discard their
   socket), clears the reconnect URL and the authenticated pubkey.

**Not decided here**: whether a future "forget this device" action should delete the archived
keys from the keyring (today nothing is ever deleted); representation of the relay's Moderator
platform role (no client probe exists; deliberately absent rather than guessed).

## D13. D12 §4 superseded: SWF sign-out removes the local identity from the device (shared-device policy)

**Decided 2026-09-22**, the same day as D12 (`IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md` §3a,
§3b, §16; `PHASE_3_IMPLEMENTATION_AUDIT.md` §20). D12 §4 kept OLD BUZZ semantics — "sign out ends
the session, the key stays" — and its "not decided" note left device-forgetting open. SWF Buzz is
used on shared/work machines: after user A signs out, user B must be able to open the login screen
and import their own identity without seeing, continuing with, or recovering A's. That is a
product/security requirement, so it is decided now. **This is a deliberate SWF decision and not
OLD BUZZ parity** — OLD BUZZ's sign-out keeps the identity; ours removes it.

**Decisions**

1. **Sign out = end the session + securely remove the current identity from this device**, in that
   order, and it is complete only after Rust re-resolves to "no identity". Implemented as
   `endIdentitySessionAndRemoveIdentity()`; the session-only `endIdentitySession()` remains the
   teardown half for the non-sign-out transitions (begin, switch community, switch/replace).
2. **Deletion is Rust-only**, through the existing identity storage abstraction (`KeyStore` +
   `secure_store`), by a new `delete_identity` command: keyring entry, `identity.key` (if it holds
   this key), the identity's archive, every archive recorded in the `identity.archives` manifest,
   every `identity.previous-*.key` file, the keyring marker and the manifest — then verify. Files
   are zero-filled before unlinking. Never a frontend-side secret deletion; never returns key
   material. An environment-supplied identity cannot be removed and says so.
3. **Failure is never hidden.** If Rust cannot remove the identity, the session is still ended (a
   safe logged-out state) but the login screen shows "Couldn't remove this identity from this
   device. Please try again." with a retry; the app never claims the device is clean.
4. **The user is warned first** (`SignOutDialog`): "Signing out will remove this identity's private
   key from this device. Make sure you have your nsec, hex private key, or ncryptsec backup if you
   want to use this identity again." — Cancel / Sign out & remove identity. Informs, never blocks.
5. **Login state after sign-out is always STATE 1** ("No identity is stored on this device." /
   Import existing identity / Create new identity / Development only). "Identity found on this
   device." + Continue exists only for a stored identity not yet signed out (relaunch).
6. **Archived copies made by "Switch / Import another identity" are removed on the next sign-out**
   (manifest-tracked). Archives predating the manifest are left alone rather than deleted
   unrecorded. The switch screen says the archive lasts "until the next sign-out".
7. **`npub1…` is refused as import input** with one exact message, in the form and in Rust; nothing
   is derived from a public key. nsec / 64-hex / ncryptsec unchanged.
8. **No multi-identity picker.** One active identity per device; sign out removes it; the next
   person imports their own.

Everything else in D12 stands (single lifecycle, three consistency checks, identity-scoped query
keys + `queryClient.clear()`, separate role planes, session-resettable connection singleton).

## D14. Operator status is evidence, not a boolean: the probe reports its signer, and a mismatch is an error

**Date**: 2026-09-22. Extends D12/D13; supersedes nothing.

**Context.** A user reported importing the operator key and landing in the member UI. The code could
not distinguish the possible causes: `operatorService.isOperator()` returned `true`/`false` and
swallowed every failure, so "the relay said 403", "the request never completed" and "the request was
signed by a different key than the one signing in" all collapsed into "not an operator" — which
renders as the member UI. Nothing recorded which key had signed the probe, so the report could not
be diagnosed from outside the process.

**Decision.**
1. **The operator probe returns evidence.** `OperatorService.probeOperator(relay, forPubkey)` returns
   `{status, signerPubkey, error, origin}`; `isOperator()` is now `status === 200` over it.
   `buildNip98Auth` exposes the signed event's pubkey for this purpose.
2. **A signer/identity mismatch is an explicit failure.** If the probe was signed by a pubkey other
   than the identity being signed in, `resolveAccess` returns `{kind:"mismatch"}`: an auth error is
   shown, the signer is cleared, and **nothing is routed**. Routing on another key's answer would
   sign the wrong person in. Previously this fell through to the member UI.
3. **Every identity state change is logged with its PUBLIC key** (Rust `log_identity`), so
   `tauri dev` output is an audit trail of which identity the device holds.
4. **A development-only diagnostics panel** surfaces Rust identity / session pubkey / signer / NIP-42
   AUTH pubkey / last probe (status + signer) / both roles / decision / route / cache identities /
   "stale previous identity". Public information only; tree-shaken from production builds.
5. **Capabilities come from one place.** `features/access/capabilities.ts` maps the two role planes
   to UI capabilities; components stop comparing role strings. Operator ≠ owner stays structural.
6. **Community selection is per identity.** The persisted active community is cleared on session
   teardown so the next identity's community is resolved for its own pubkey.

**Consequences.** The original report was then diagnosed from the audit line in minutes: the imported
backup derives to `7e13d4f6…` (the member), not the configured operator `0f61e5e4…` — a key/config
fact, not a UI bug. No operator was provisioned and `RELAY_OPERATOR_PUBKEYS` was not permanently
changed (a temporary throwaway key used for E2E was reverted and verified byte-identical). The
create-identity flow additionally gained a mandatory backup checkpoint — generate → show
npub/nsec/ncryptsec → two acknowledgements → only then authenticate — so a new identity can never be
signed in before its owner has had the chance to save it (`PHASE_3_FINAL_IMPLEMENTATION_REPORT.md` §5).


## D15. The old operator identity was retired, not recovered: a public key is not a login secret

**Date**: 2026-09-22. Extends D14. Full record: `DEV_RESET_2026_09_22.md`.

**Context.** Sign-in as the configured operator `0f61e5e4…320029` kept landing on
a member view. D14's diagnostics established why: that value is the operator's
**public** key, and pasting it into the import field (where a 64-character hex
is a private key by definition — a public key is the same length) made the app
parse it as a secret scalar and derive `7e13d4f6…`, a member. The operator's
actual private key is not available on this machine, and a private key cannot be
recovered from a public one.

**Decision.** Retire the old operator and provision a new one, rather than
weaken authentication.

1. **Never map a public key to a private key.** No `publicKey → secretKey`
   lookup anywhere, no special case for the old operator, no hardcoded operator
   role in the client. Authentication stays: private key → signature → public
   key → relay authorization.
2. **The local development dataset was reset** (all communities, memberships,
   channels, events, invites and scoped records) in one FK-ordered transaction,
   after a full `pg_dump` backup outside the repository. Schema, migrations,
   relay implementation and application source untouched.
3. **A fresh operator keypair (OPERATOR_A) was generated**; only its PUBLIC key
   went into `RELAY_OPERATOR_PUBKEYS`. The private key and its NIP-49 encrypted
   backup live outside the repository and are not in any document or log.
4. **`communities` cannot be zero** and that is by design, not a failed reset:
   the relay selects a tenant by HTTP `Host` and fails closed on an unknown one,
   so it recreates four bare host-binding rows (no owner, no members) on boot.
   Documented rather than forced away.
5. **Import is a two-step flow** (D14) and its wording now states what is
   accepted — nsec · private hex · ncryptsec — and that an npub or public hex
   cannot sign in. Because raw 64-char public and private hex are
   indistinguishable by format, the Check-key identity preview is mandatory: it
   is the only thing that can catch this class of mistake.

**Consequences.** Verified against the real relay with the real credentials:
OPERATOR_A's private key → NIP-98 200 → `platformRole: operator` → `/operator`;
MEMBER_A's private key → 403 → NIP-42 → `communityRole: member` → chat UI;
OPERATOR_A's public key misused as a secret → derives an unrelated identity →
403. Operator and community roles remain independent planes (`SWF_ROLE_MODEL.md`).
The old `0f61e5e4…` and `7e13d4f6…` identities have no membership anywhere in
the reset dataset.


## D16. Raw 64-character hex is not a login credential

**Date**: 2026-09-22. Supersedes the import contract in D14 §1 (which accepted
raw hex behind a preview). Full account: `PHASE_3_FINAL_IMPLEMENTATION_REPORT.md` §24.

**Context.** Twice, an operator's PUBLIC key pasted into the import field
silently signed the user in as a different identity (`0f61e5e4…`→`7e13d4f6…`,
then `38eb252a…`→`ff93c238…`). A Nostr private key is 64 hex characters and so
is a public key: they are **indistinguishable by format**, so no validation can
tell which one the user meant. D14's identity preview made the mistake visible,
but the app still happily imported the wrong identity if the preview was not
read carefully.

**Decision.** Remove the ambiguity from the credential contract instead of
trying to detect it.

1. **Normal import accepts `nsec` and `ncryptsec` only.** Both are
   self-describing, so there is nothing to guess.
2. **Raw 64-char hex is refused** with an explanation, *before* anything is
   decoded — no Rust call, no preview, no keyring write. An `npub` is refused
   the same way.
3. **Enforced in Rust, not only the UI.** `recover_keys_from_input` takes
   `allow_raw_hex` (default false via the commands) and returns
   `RAW_HEX_REJECTED`, so the rule survives any caller that skips the form.
4. **A developer-only opt-in** re-enables raw private hex, shown only when the
   input is bare hex, with an explicit warning, and still subject to Check key →
   preview → Import.
5. **Check key stays a pure validation step**: decode → derive public key →
   preview. It never stores, connects, assigns a role or routes.

**Consequences.** The failure mode is now unreachable on the normal path: the
one thing a user could paste that would silently become someone else is no
longer accepted. Verified live — OPERATOR_A's public hex is refused at the form;
OPERATOR_A's private key gives NIP-98 200 → `platformRole: operator` →
`/operator`; MEMBER_A's gives 403 → `communityRole: member`. Authentication is
unchanged: private key → signature → public key → relay authorization. No
public→private mapping exists anywhere (D15 §1 still holds).

**Also** (same pass): `probeMembership` now distinguishes a relay 404 ("no
community at this address") from 403 ("exists, you are not a member"), and
`discoverMemberships` forgets 404 addresses. Stale address-book entries left by
the reset were being re-probed on every sign-in, producing a 404 per dead host
in the console; they are dropped rather than suppressed.

