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
