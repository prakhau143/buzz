# SWF Buzz — Testing

## Commands

```sh
npm run typecheck      # vue-tsc --noEmit
npm run lint            # eslint . --max-warnings 0
npm run test             # vitest run (unit + integration, jsdom environment)
npm run test:watch        # vitest, watch mode
npm run test:coverage      # vitest run --coverage (v8 provider)
npm run format:check        # prettier --check .
npm run build                 # vue-tsc --noEmit && vite build (also catches type errors)
```

A change is not "done" until all of `typecheck`, `lint`, `test`, and `build` pass — see
`docs/DEVELOPMENT.md`. None of these substitute for the others: `build` succeeding does not mean
the feature is correct, and `test` passing does not mean the app compiles cleanly for every route
(`vue-tsc` type-checks the whole project, not just files touched by a test).

## What's covered today (`tests/unit/`, 62 tests as of this writing)

- **Protocol layer** (`tests/unit/protocol/`) — the highest-value tests in this codebase, since
  `src/protocol/*.ts` is the single place that encodes verified wire-format behavior from
  `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md`. A regression here silently breaks compatibility
  with the real relay in a way the type system cannot catch (tags are `string[][]`, not typed
  structures).
  - `nip10.spec.ts` — thread marker resolution (root/reply combinations, malformed `e` tags).
  - `messages.spec.ts` — kind:9 event building (top-level, reply, mentions) and parsing, kind:40099
    system message parsing.
  - `reactions.spec.ts` — kind:7 building (plain + custom-emoji shortcode), "last valid e tag wins"
    target resolution, the channel-scoped subscription filter shape.
  - `channels.spec.ts` — kind:39000 discovery event parsing (open/private/DM/archived).
  - `dm.spec.ts` — kind:41010 participant-count bounds, kind:41012, kind:30622 visibility parsing.
  - `typing.spec.ts` — kind:20002 tag building (top-level vs. thread-scoped) and parsing.
- **Feature/service layer** (`tests/unit/features/`):
  - `reactions.spec.ts` — `groupReactions`/`applyReaction` (the live-update merge logic that feeds
    `useChannelReactions`). Includes a regression test for a real bug caught and fixed in this repo:
    an earlier `applyReaction` implementation recomputed the whole reaction map from only events
    seen since subscribing, silently discarding historical reactions on any message that received a
    new live reaction.
  - `dm.spec.ts` — `Kind41010Transport.open()`'s parsing of the relay's OK-reason JSON
    (`{"channel_id": ...}`), including the missing-`channel_id` and non-JSON-reason error paths.
  - `agents.spec.ts` — `useAgentActivity`'s precedence logic (a real kind:24200 observer-frame
    signal wins over the kind:20002 typing-indicator fallback; out-of-scope agents are excluded
    even if typing).
- **Stores** (`tests/unit/stores/`) — `connection.spec.ts` (status transitions, reconnect-attempt
  reset-on-connect), `session.spec.ts` (auth state set/clear).
- **Signing** (`tests/unit/signing/`) — `signingService.dev.spec.ts` exercises `DevSigningService`
  end-to-end: stable keypair, event signing, and a real NIP-44 encrypt/decrypt round trip between
  two instances (this is the one place a "service layer behavior" test can run fully offline,
  since `Nip46SigningService` requires a live bunker connection — see Gaps below).

## Test fixture note: hex placeholders must be valid hex

Several protocol functions validate that referenced event ids are 64 lowercase-hex characters
(`nip10.ts`'s `HEX64`, `reactions.ts`'s target-id regex). A test fixture built as e.g. `"t".repeat(64)`
is **not valid hex** (`t` isn't `0-9a-f`) and will be silently rejected by the code under test,
producing a confusing failure that looks like a code bug. Use digits or `a`–`f` for any fixture
event id that needs to pass hex validation (pubkeys in `p` tags aren't hex-validated by the current
parsers, so this only matters for `e`-tag event ids). This bit us once while writing
`reactions.spec.ts` — see the git history if you want the exact failure.

## Rust (`src-tauri/`)

```sh
cd src-tauri
cargo check              # type-check
cargo clippy --all-targets
cargo fmt --check
```

No `#[test]`s exist yet in the Rust code — `src-tauri/src/auth/oidc.rs`'s PKCE/state/redirect-URI
logic in particular is exactly the kind of thing worth unit-testing (e.g. `pkce_challenge` is a
pure function; `wait_for_redirect`'s state-mismatch/timeout branches could be tested against a
real `tiny_http::Server` bound to `127.0.0.1:0` without needing a real Okta tenant). Not done yet —
flagged as a gap rather than silently skipped.

## Gaps / what to add next

- **`Nip46SigningService`** has no automated test yet — it requires a live (or mocked)
  `BunkerSigner`/relay round trip. A reasonable next step is a fake bunker relay in tests rather
  than skipping this indefinitely, since it's the actual production signing path.
- **`src-tauri/src/auth/oidc.rs`** (Okta PKCE flow) has no automated test yet, and — more
  importantly — has **not been exercised against a real Okta tenant** in this environment (none is
  available). `cargo check`/`clippy` prove it compiles; they prove nothing about interop. See
  `docs/DECISIONS.md` D9 for the known ID-token-signature-verification gap on top of that.
- **`RelayConnectionService`** has no automated test yet — reconnect/backoff behavior is exactly
  the kind of thing that regresses silently. Test against a local mock WebSocket server (or a
  fake implementing the same interface as `nostr-tools`' `Relay`) rather than a real relay.
- **Vue Query composables** (`useChannels`, `useChannelMessages`, `useDmList`, etc.) are exercised
  indirectly through the pure functions they call (`groupReactions`/`applyReaction`,
  `Kind41010Transport`) but not end-to-end with a mocked relay — the live-subscription-into-cache
  wiring itself (e.g. `useChannelMessages`'s dedupe-by-id, `useThread`'s reply merge) has no direct
  test. A fake `RelayConnectionService` (or a real one pointed at a mock WebSocket server) would let
  these be tested without a live relay.
- No component/UI tests yet (`@vue/test-utils` is installed and configured but unused so far).
  Prioritize `LoginView.vue`'s two-step flow (Okta → pending bunker pairing), `MessageComposer.vue`'s
  mention-dropdown matching/insertion logic, and any component that branches on
  `MessageStatus`/`ConnectionStatus`.
- No integration tests exist yet in `tests/integration/` (directory is a placeholder). This should
  eventually hold an end-to-end flow against a real local `buzz-relay` (`just relay` from `../buzz`)
  — e.g. connect → discover channels → join → send → receive → react → reply-in-thread — now that
  enough of the feature layer exists to make that meaningful. This is the single highest-value next
  testing investment: everything in `tests/unit/` today runs against mocked/pure logic, so a real
  local-relay round trip is the only thing that would catch a wire-format assumption that's subtly
  wrong despite matching the source-verified reference.

## Manual verification

Type-checking and automated tests verify code correctness, not feature correctness. Per the
project's engineering rules, any UI-visible change should also be exercised via `npm run tauri dev`
(or `npm run dev` for browser-only UI work) before being called done — this repo does not yet have
a way to screenshot/drive the Tauri window from this environment, so manual verification here means
actually running the app and clicking through the golden path plus at least one edge case
(disconnected relay, empty state, error state).
