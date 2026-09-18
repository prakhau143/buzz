# E2E Test Results

## Update — real Docker + real buzz-relay + real native Tauri window (this session)

Unlike every prior pass (see the rest of this document, preserved below), Docker Desktop **was**
available this session, with `buzz-relay-local:latest` plus Postgres/Redis/MinIO already running
(restored by Docker Desktop from a prior session — no rebuild performed, per the standing "don't
rebuild the expensive relay" instruction). This unblocks the first genuinely
**"Verified locally"**-labeled results this project has ever had:

- **`npm run tauri dev` launches a real native window and it renders correctly.** Verified via a
  native Win32 screenshot (`PrintWindow`, DPI-corrected) of the actual `SWF Buzz` desktop window
  (not the browser dev server) — title bar, connection badge showing "Connected" (a real WebSocket
  session to `ws://localhost:3000`), and the full sidebar/details-pane UI all rendered.
- **Dev-mode login → real relay connection**: confirmed via CDP network-frame inspection (see
  below) that clicking "Continue in Development Mode" produces a genuine NIP-42 `AUTH` frame sent
  to the real relay, captured with the actual dev-session pubkey inside it.
- **Community member management (§2a) — verified against the real relay, both role tiers**:
  1. Seeded a captured dev-session pubkey directly into `relay_members` as `owner` (this
     deployment's relay has no `RELAY_OWNER_PUBKEY`/`BUZZ_REQUIRE_RELAY_MEMBERSHIP` configured, so
     there was no owner to bootstrap through normal invite/config flow — a one-time seed was the
     only way to exercise the gated path at all).
  2. Called the real `relayMembersService.addMember()` as that owner — the relay's own
     `relay_admin.rs` authorized it, wrote the row, and published a real kind:13534 snapshot with
     the exact `["member", pubkey, role]` tag shape this project's parser expects (confirmed by
     querying Postgres directly: `SELECT tags FROM events WHERE kind=13534`).
  3. Seeded a second pubkey as `admin`, added a third member as that admin, and drove the actual
     UI (via CDP, clicking through `document.querySelector`/`.click()`, not coordinate-guessing) to
     the Community tab: **the rendered panel correctly hid all role-change/remove controls on the
     owner's row and on the admin's own row, showed "Remove" only on plain-member rows, and
     restricted the add-member role picker to `member` only** — matching every rule in
     `docs/ROLE_PERMISSION_AUDIT.md` §4 exactly, verified by direct observation of the rendered DOM
     text, not just the underlying unit tests.
  4. Test data cleaned up afterward (`DELETE FROM relay_members`); no lasting changes to the shared
     dev database or Docker volumes.
- **Open-relay graceful degradation — verified against the real relay**: before seeding, the
  Community tab correctly rendered "No community roster on this relay" (this deployment has no
  kind:13534 snapshot and no `RELAY_OWNER_PUBKEY`) instead of an error or a false-empty roster.
- **Moderation queue and Platform Admin console**: code-complete, unit-tested, and reachable in the
  UI (confirmed via the same screenshot pass), but **not** independently click-tested against
  seeded report/feedback data this session (time-boxed) — see `docs/KNOWN_LIMITATIONS.md` for the
  Platform Admin console's additional, separate infrastructure blocker (this relay has no
  `BUZZ_ADMIN_HOST`).

**Method note**: interactive verification used the Chrome DevTools Protocol (WebView2 exposes one
via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`), driven by short Node
scripts using the platform's native `WebSocket`/`fetch` — clicking real DOM elements
(`document.querySelector(...).click()`) and reading back rendered `innerText`, not synthetic
assertions against mocked state. Screenshots used Win32 `PrintWindow` (not a screen-region
`BitBlt`, which would capture whatever window happens to occlude the same screen coordinates
instead of this specific window) with DPI-scale correction (this environment renders at 125%).

---

**Read this first (historical — prior sessions)**: the real local `buzz-relay` could not be started in this development
environment — `../buzz`'s own setup script hard-requires Docker Desktop (for Postgres/Redis/MinIO),
and Docker is not available here. This is documented in detail in `docs/LOCAL_DEVELOPMENT.md` and
`docs/KNOWN_LIMITATIONS.md`. Given that, every claim in this document uses exactly one of these six
labels — never a blanket "works":

| Label                                               | Meaning                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verified locally**                                | Exercised interactively against a real running local stack (relay + app). Not used anywhere in this document yet — would require Docker.                                                                                                                                                                                                                                                                      |
| **Verified against test fixture**                   | A real, non-mocked automated test passed — either a unit test of pure protocol/logic code, or the WebSocket integration test against `tests/integration/helpers/minimalNostrRelay.ts` (a minimal generic NIP-01 relay, explicitly **not** buzz-relay — see its own doc comment). Proves the code path executes correctly against a real socket/real logic; does not prove Buzz-relay-specific business logic. |
| **Verified against real buzz-relay**                | Exercised against the actual `buzz-relay` binary from `../buzz`. Not used anywhere in this document — blocked by the Docker prerequisite.                                                                                                                                                                                                                                                                     |
| **Code-audited**                                    | Read the actual current source line-by-line against `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` (kind, tags, filter shape) and found no mismatch. Real correctness check (found 3 real bugs, listed below) — not a live-traffic test.                                                                                                                                                                         |
| **Blocked by infrastructure**                       | Cannot be verified at all without infrastructure this environment doesn't have (Docker, a real buzz-acp instance, a real Okta tenant, a real NIP-46 bunker).                                                                                                                                                                                                                                                  |
| **Production-only / pending Okta or NIP-46 bunker** | Applies to the production auth/signing path specifically, which is out of scope for this pass by explicit instruction — see `docs/DECISIONS.md`.                                                                                                                                                                                                                                                              |

No feature below is claimed as "verified end-to-end against buzz-relay" or "verified locally."
Both would require Docker, which this environment doesn't have.

## Method

1. A forked audit agent read every relevant `src/protocol/*.ts`, `src/features/**/*.ts`, and
   `src/services/*.ts` file fresh (not from memory) against `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md`
   and `docs/DECISIONS.md`, specifically looking for wrong kinds, wrong tags, wrong filter shapes,
   missing error handling, and subscription leaks.
2. Every bug it found (not "concern" — actual bug) was fixed in this repo; see the fixes below and
   the commit that introduced them.
3. A new integration test (`tests/integration/relayConnectionService.spec.ts`) was added against a
   minimal, generic, explicitly-not-buzz-relay WebSocket test fixture
   (`tests/integration/helpers/minimalNostrRelay.ts`) to get real (non-mocked) proof that
   `RelayConnectionService`'s own connect/publish/subscribe/reconnect plumbing works against a real
   socket — this is the one thing in this pass that got genuine network-level verification.

## Per-feature results

### 1. Channel discovery/list — Code-audited

Kind 39000 discovery filter, parsing (open/private/dm/archived), live-update subscription. **Fix
applied**: the live subscription was missing a `since` filter, causing a full history replay on
every mount (self-correcting via id-merge, but wasteful) — now scoped to `since: now()`, matching
every other live subscription in the codebase.

### 2. Channel membership — Code-audited, one known race

9000/9001 put/remove, 39001/39002 admin/member list parsing. **Known limitation** (not fixed):
`useJoinChannel`'s query invalidation can run ahead of the relay's async list re-emission — see
`docs/KNOWN_LIMITATIONS.md`.

### 3. Join channel — Code-audited

9021 join request, correctly scoped to open channels only per the protocol reference.

### 4. Post message — Code-audited, one bug fixed

kind:9 building (top-level/reply/mentions), optimistic UI. **Bug found and fixed**: a real race
where the relay could echo a published event back through the live subscription before the local
`publish()` promise resolved, which would have inserted the message twice. Fixed with a new
`reconcileOptimisticMessage()` helper, unit-tested (`tests/unit/features/optimisticMessage.spec.ts`).

### 5. Receive message — Code-audited

Live subscription merge/dedupe-by-id in `useChannelMessages`. Covered indirectly by the
`RelayConnectionService` integration test's "delivers a live event" case (real socket, generic
event — not Buzz-specific parsing, which is unit-tested separately in `tests/unit/protocol/messages.spec.ts`).

### 6. Threads — Code-audited, one real bug fixed

**Bug found and fixed**: `buildThreadSummaryFilter` ANDed `#e` and `#d` tag filters on kind:39005,
which (per Nostr REQ semantics) requires an event to carry both to match — the reference doesn't
confirm both are always set together, and kind:39005 being parameterized-replaceable means `#d`
alone is its protocol-guaranteed identifying tag. Fixed to filter by `#d` only; unit-tested
(`tests/unit/protocol/threads.spec.ts`, new this pass). Reply-tag building/root resolution
(`nip10.ts`) matches the normative resolution rule verbatim and was already tested.

### 7. Reactions — Code-audited (highest-confidence item)

kind:7, the documented `#h`-required subscription quirk (a bare `{kinds:[7]}` filter is
specifically called out as _not_ working — this codebase's `buildReactionFilter` gets it right),
"last valid e tag wins" target resolution, custom-emoji shortcode handling. Already had a
regression test from an earlier session for a previously-fixed live-merge bug.

### 8. Direct messages — Code-audited; one UI gap fixed

kind:41010 open (with unit-tested OK-response `channel_id` parsing), kind:41012 hide, kind:30622
visibility. **Gap found and fixed**: `hideConversation()` existed but had no UI affordance — added
a "Hide" button (`useHideDm.ts` + `DmView.vue`). **Known limitation** (not fixed): no "Unhide" UI
yet, even though the underlying re-publish-kind:41010 mechanism works.

### 9. Invites — Code-audited (and deliberately scoped)

kind:9009 create/list only, per `docs/DECISIONS.md` D4 — the relay's own side-effect handler for
this kind is a confirmed no-op, so no acceptance UI was built, and the UI says so explicitly.

### 10. Presence — Code-audited; one limitation documented (not code-fixed)

kind:20001 publish/subscribe implemented correctly per spec. **Limitation, not a bug**: the initial
snapshot fetch is a one-shot REQ against an ephemeral kind, which relays are unlikely to replay —
see `docs/KNOWN_LIMITATIONS.md` for why this wasn't "fixed" by guessing at the undocumented
kind:40902 payload shape instead.

### 11. Typing indicators — Verified against test fixture + code-audited

Tag building (top-level vs. thread-scoped) and parsing are unit-tested
(`tests/unit/protocol/typing.spec.ts`). 3s throttle constant matches the reference. Client-side
expiry (5s) and channel-scoped subscription reviewed and correct.

### 12. Agent mention/reply — Code-audited

Mentions are a plain `p` tag exactly as documented (no special protocol mechanism) —
`useMentionCandidates` + `MessageComposer`'s dropdown correctly insert this. Agent replies are
wire-identical kind:9 messages, distinguished only via the kind:30177/kind:0 profile lookup, which
is implemented and unit-testable independent of a live relay.

### 13. Agent activity/status rendering — Verified against test fixture + one limitation documented

`useAgentActivity`'s precedence logic (real observer-frame signal wins over the typing-indicator
fallback, scoped to in-scope agents only) is unit-tested (`tests/unit/features/agents.spec.ts`).
**Limitation, not fixed**: the "finished" detection heuristic in `useAgentObserverFeed` is an
unverified guess beyond the one confirmed example type — see `docs/KNOWN_LIMITATIONS.md`.

### 14. Logout — BUG FOUND AND FIXED (highest-severity finding this pass)

`useAuth.ts`'s `logout()` cleared session state and disconnected the relay but **never navigated
away**. Vue Router's guard only re-evaluates on a navigation attempt, so the user was left stranded
on the now-broken view. Fixed: `logout()` now calls `router.push({ name: "login" })`. No automated
test added for this specific composable (would need a router+Pinia test harness not yet set up for
composables — see `docs/KNOWN_LIMITATIONS.md`/`docs/TESTING.md` gaps), but the fix itself is a
two-line, low-risk change reviewed carefully against the router guard's actual logic.

### 15. Reconnect after relay disconnect — Verified against test fixture (strongest result this pass)

Real integration test, real WebSocket, real drop-and-reconnect:
`tests/integration/relayConnectionService.spec.ts` — "reconnects with backoff after the relay
drops the connection" and "re-issues an active subscription after reconnecting" both pass against
`tests/integration/helpers/minimalNostrRelay.ts`. This proves `RelayConnectionService`'s own
reconnect/backoff/resubscribe code works against a real socket. It does **not** prove Buzz-specific
behavior (e.g. whether the relay's own reconnect/session semantics differ from a generic NIP-01
relay) — that part remains blocked on Docker.

**Also this pass**: reviewed the whole reconnect/backoff loop specifically for runaway behavior —
`scheduleReconnect()` is guarded so at most one reconnect timer is ever pending, backoff is capped
at 30s, and `manuallyClosed` stops the loop outright on an explicit `disconnect()`. A refused
loopback connection (the exact symptom reported — `ERR_CONNECTION_REFUSED` against
`ws://localhost:3000`) now surfaces a specific, actionable message ("Can't reach the local Buzz
relay. Make sure it's running") instead of a generic one, verified by a new real-network test
("surfaces a specific 'local relay not running' message for a refused loopback connection").
`ConnectionBadge.vue` now actually displays `lastError` (it previously captured it but never showed
it — the badge just repeated its own short status label).

## What actually got a real automated PASS

```
tests/integration/relayConnectionService.spec.ts   10/10 PASS (real WebSocket, real drop/reconnect,
                                                                real refused-connection messaging)
tests/unit/**                                        71/71 PASS
                                                      ─────────
                                                      81/81 PASS total
```

## What remains Blocked by infrastructure (external, not fixable in this repo)

- Any claim of "verified against real buzz-relay" for all 15 features — needs Docker.
- `examples/countdown-bot` agent round trip — needs a real relay (it does NIP-42 auth against one).
- `Nip46SigningService` / `src-tauri/src/auth/oidc.rs` against real infrastructure — needs a bunker
  / Okta tenant, neither of which exists yet (see `docs/DECISIONS.md`, `docs/BUZZ_INFRASTRUCTURE_DISCOVERY.md`).
- Any interactive/visual UI verification — no GUI in this environment; not attempted.
