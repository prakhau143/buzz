# Known Limitations

Consolidated from this session's work plus prior sessions' `docs/DECISIONS.md`. Each item says
whether it's an environment blocker (fixable by getting access to something), a real code gap
(fixable in this repo), or a documented protocol-inherent limitation (not really "fixable" so much
as expected behavior worth knowing about).

## Environment blockers (this development environment specifically)

- **No Docker** → the real `buzz-relay` (and therefore the real `examples/countdown-bot` test
  agent, which authenticates against it) could not be started or tested against in this
  environment. See `docs/E2E_TEST_RESULTS.md` for exactly what this did and didn't block. Not a
  code problem — `../buzz`'s own `scripts/dev-setup.sh` hard-requires Docker. **Confirmed as the
  sole remaining blocker**: `just bootstrap` was run directly on this Windows machine (after fixing
  two separate Windows/tooling issues — see `docs/LOCAL_DEVELOPMENT.md` "Windows: use Git Bash, not
  PowerShell") and failed with exactly `Error: Docker is required but not installed`, after
  `cargo`/`node` resolved successfully. Installing Docker Desktop is the only remaining step.
- **`just` doesn't work out of the box on Windows** (fixed this pass, not a remaining limitation —
  noted here for context): `../buzz/bin/*` Hermit tool shims (including `just` itself) are inert
  placeholder files in a Windows git checkout (Hermit's symlink-based shim mechanism doesn't
  materialize without Unix symlink support), and even with `just` installed separately
  (`cargo install just`), running it from PowerShell/cmd fails because `just`'s Windows shebang
  handling needs Git for Windows' `cygpath`, which isn't on PowerShell's PATH by default. Both are
  worked around by installing `just` via `cargo install just` and running `../buzz` commands from
  Git Bash instead of PowerShell — see `docs/LOCAL_DEVELOPMENT.md` for the full explanation.
- **No GUI** → `npm run tauri dev` was verified to compile and launch (background process, no
  crash observed), but no interactive/visual testing of the native window was performed. Browser
  UI (`npm run dev`) was not driven interactively either this pass — see `docs/E2E_TEST_RESULTS.md`.

## Community role/moderation/platform-admin (this session)

- **Platform Admin console is code-complete but not live-verified.** `AdminConsoleService`,
  `usePlatformAdmin`, and `PlatformAdminView` (docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §11) were
  built and unit-tested (typecheck/lint/build all pass), but this project's own local dev relay
  does not expose `/api/admin/v1/*` at all — confirmed by a 404 on `GET /api/admin/v1/probe`
  against `http://localhost:3000` (no `BUZZ_ADMIN_HOST` configured in the running
  `buzz-relay` container). This is an **environment blocker**, not a code gap — exactly analogous
  to the existing Okta/NIP-46-bunker entries below. Needs a relay deployment with
  `BUZZ_ADMIN_HOST`/`BUZZ_ADMIN_AUTH` configured (and `VITE_ADMIN_URL` pointed at it) before it can
  be exercised interactively.
- **Kick is gated by community role here, not channel role — a deliberate deviation from the
  reference.** `ModerationQueuePanel`'s "Kick" resolution action (`ModerationService.kickFromChannel`)
  authorizes on community owner/admin. The reference Buzz instead gates kick purely by the target
  *channel's own* role roster (see docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md §3's "Kick" finding) —
  itself a known architectural gap in the reference (its own `moderation_authz.rs` doc comment
  concedes community-wide kick authority is "the bridge `validate_admin_event` is missing today").
  SWF Buzz's community-role gate is simpler and was a conscious choice rather than a blind copy;
  revisit if/when channel-level roles are modeled here.
- **Reports missing an author pubkey field require an extra relay round trip.**
  `ModerationService.resolveReportAuthorPubkey` fetches the original kind:1984 report event by id
  and reads its own `p` tag when `targetKind !== "pubkey"`, since `GET /moderation/reports` rows
  don't carry the reported author's pubkey directly. Adds one `fetchEventsOnce` call before a
  ban/timeout/kick resolution — not a correctness issue, just worth knowing about for future
  performance work if queues get large.
- **Community ownership transfer has no UI, deliberately.** The reference has no member-initiated
  transfer flow either (owner-fallback config or the Operator-only `/operator/communities/transfer`
  HTTP endpoint are the only paths) — see docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md Open Question 8.
- **Real invite enforcement (`POST /api/invites`) is not implemented** — see
  docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md Open Question 10. The existing `InviteService`
  (kind:9009) remains a confirmed no-op, unchanged this session.

## Real code gaps, not yet fixed

- **Presence snapshots typically start empty** (`src/features/presence/PresenceService.ts`).
  kind:20001 is ephemeral ("never persisted" per `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` §5),
  so a relay is unlikely to replay history to a fresh subscription — presence fills in only as each
  member's 60s heartbeat happens to land while you're connected. The reference names a
  `kind:40902` "bulk-presence sidecar" that sounds like the fix, but its payload shape isn't
  documented anywhere source-verified in this project's protocol research — implementing against
  it would be guessing, which the project's own rules explicitly prohibit. Needs the payload shape
  confirmed from `buzz-relay` source before it can be built.
- **Agent "finished" detection is an unverified heuristic**
  (`src/features/agents/useAgentObserverFeed.ts`). The regex matching `type` values like
  `"complete"`/`"error"`/`"result"` is a guess — the protocol reference only confirms one real
  example (`"turn_started"`). Could misclassify real observer-frame types until verified against a
  live `buzz-acp` instance.
- **Join-then-refetch race** (`src/features/channels/useJoinChannel.ts`). Invalidating the members
  query immediately after a 9021 `OK` may run ahead of the relay's async 39001/39002 re-emission,
  occasionally showing "not a member yet" right after a successful join until the next natural
  refetch.
- **Mention candidate list can be stale** (`src/features/agents/useMentionCandidates.ts`, already
  self-documented in its own code comment) — reads the profile cache via a non-reactive snapshot,
  so a profile that finishes loading after the mention dropdown first renders won't update the
  displayed name until something else triggers a recompute.
- **No unhide UI for DMs** — `Kind41010Transport`/`DmService` support unhiding by re-publishing
  `kind:41010` with the same participants, but `DmView.vue` only exposes "Hide," not "Unhide."

## Protocol-inherent (documented, not really fixable client-side)

- **Presence is best-effort, not guaranteed multi-node-consistent** — documented as local-node
  Redis pub/sub in the protocol reference; don't expect cross-node accuracy from a multi-instance
  relay deployment.
- **Invites have no server-side enforcement** — `kind:9009`'s relay-side handler is a confirmed
  no-op (see `docs/DECISIONS.md` D4). The UI says so explicitly rather than implying otherwise.
- **DM privacy model** — `kind:41010` DMs are as private as the relay operator is trusted (same
  trust model as channel messages); see `docs/DECISIONS.md` D1.G.

## Production-path gaps (untouched this session, tracked in `docs/DECISIONS.md`)

- **Okta ID token signature is not verified against Okta's JWKS** (D9) — only decoded for display.
- **No NIP-46 bunker exists anywhere** to pair `Nip46SigningService` against — confirmed absent in
  `../buzz`, not just unconfigured (see `docs/BUZZ_INFRASTRUCTURE_DISCOVERY.md` §5).
- **Okta ↔ Nostr identity linkage is unresolved** (D3).
- **No Windows code-signing** (D7).

## Testing gaps

- `Nip46SigningService` and `src-tauri/src/auth/oidc.rs` have no automated tests, and — more
  importantly — have never been exercised against a real bunker/Okta tenant.
- No test drives the actual Vue UI (component tests or a browser-automation pass) — everything
  passing today is service/protocol/store-level logic plus one real WebSocket integration test for
  `RelayConnectionService`'s own plumbing (not Buzz-specific business logic — see
  `docs/E2E_TEST_RESULTS.md`).
