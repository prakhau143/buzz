# SWF Buzz — Complete Local Development Mode

## Objective

Continue working on the existing `swf buzz` project.

The immediate goal is to make the application fully usable locally for development and testing.

IMPORTANT:

For this task, DO NOT implement, modify, debug, or require the production Okta authentication flow or the production NIP-46 bunker flow.

Okta and NIP-46 will be implemented/configured later when the real production infrastructure details are available.

For now, everything must work using the existing Development Mode authentication/signing implementation.

The current application shows:

    WebSocket connection to ws://localhost:3000/
    failed: ERR_CONNECTION_REFUSED

This means the application is trying to connect to the local Buzz relay, but a relay is not currently running.

Do not simply hide the error or mock the relay inside the application.

The goal is to make the LOCAL DEVELOPMENT STACK actually work.

---

# 1. First inspect the existing project

Work from the current repository state.

Do NOT rewrite the architecture from scratch.

First inspect:

- package.json
- .env.example
- .env.local if present
- src/
- src/protocol/
- src/services/
- src/features/
- src-tauri/
- docs/ARCHITECTURE.md
- docs/LOCAL_DEVELOPMENT.md
- docs/E2E_TEST_RESULTS.md
- docs/KNOWN_LIMITATIONS.md
- docs/BUZZ_INFRASTRUCTURE_DISCOVERY.md
- docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md
- docs/DECISIONS.md

Also inspect the reference Buzz repository located at:

    ../buzz

Use it ONLY as a reference where the existing project documentation/PRD permits.

Do not fork Buzz Desktop.

Do not copy Buzz Desktop wholesale.

Do not introduce features that are explicitly out of scope.

---

# 2. Production authentication must remain untouched

For this task:

DO NOT modify:

    src-tauri/src/auth/oidc.rs
    authService.okta.ts
    signingService.nip46.ts

unless a change is absolutely required to keep the development and production implementations cleanly separated.

Do not add fake Okta credentials.

Do not add a fake bunker URL.

Do not invent a NIP-46 bunker.

Do not make Development Mode depend on Okta.

Do not store a private key permanently.

The production architecture remains:

    Okta OIDC
        ↓
    NIP-46 bunker
        ↓
    remote signing
        ↓
    Buzz relay

That will be handled later.

---

# 3. Make Development Mode work correctly

Development Mode should work like this:

    SWF Buzz
       ↓
    Development Authentication
       ↓
    ephemeral in-memory Nostr identity
       ↓
    Development Signing Service
       ↓
    RelayConnectionService
       ↓
    local buzz-relay
       ↓
    Postgres / Redis / MinIO

Requirements:

- no Okta required
- no NIP-46 bunker required
- no production credentials required
- no private key persisted to disk
- development identity may exist only in memory
- application must clearly indicate that this is Development Mode

Do not weaken production security to achieve this.

---

# 4. Solve the localhost:3000 connection failure properly

The current error is:

    WebSocket connection to ws://localhost:3000/
    failed: ERR_CONNECTION_REFUSED

Determine exactly why the relay is unavailable.

Inspect the reference Buzz repository and existing documentation to determine the correct local relay startup procedure.

The documented local stack currently expects:

    Docker Desktop
    Postgres
    Redis
    MinIO
    buzz-relay

Do NOT build a fake relay just to make the UI appear functional.

Do NOT replace the real Buzz protocol with mocked data.

If Docker is unavailable in the current environment, clearly document that as an infrastructure limitation.

However, make sure the SWF Buzz application itself is correctly configured to connect to the real local relay once it is started.

Verify:

    VITE_RELAY_URL=ws://localhost:3000

or whatever exact local relay URL is confirmed from the current Buzz repository.

Do not guess.

---

# 5. Validate the relay configuration

Inspect the actual Buzz relay configuration and determine:

- WebSocket endpoint
- required environment variables
- Postgres dependency
- Redis dependency
- MinIO dependency
- authentication requirements
- CORS/origin requirements
- local development startup command

Document the exact commands required to start the real local relay.

The final developer flow should be as close as possible to:

Terminal 1:

    cd ../buzz
    <correct environment setup>
    <correct relay infrastructure startup>

Terminal 2:

    cd ../swf-buzz
    npm install
    npm run tauri dev

or browser development:

    npm run dev

Do not invent commands. Verify them from the repository.

---

# 6. Check the entire RelayConnectionService

Review:

    src/services/RelayConnectionService.ts

Verify:

- connection lifecycle
- connect
- disconnect
- reconnect
- exponential/capped backoff
- subscription restoration
- error handling
- connection state
- cleanup
- duplicate connection prevention
- subscription leaks
- publish handling
- WebSocket close handling

Make sure a temporarily unavailable relay does NOT create an uncontrolled reconnect loop.

The UI should show a clear connection state such as:

    Connecting...
    Connected
    Reconnecting...
    Disconnected

instead of exposing raw WebSocket errors to the user.

Do not suppress useful developer console errors.

---

# 7. Complete the LOCAL feature set

Using the existing protocol implementation and PRD, make the local development application functional for:

1. Development login
2. Relay connection
3. Channel discovery
4. Channel membership
5. Join channel
6. Channel list
7. Channel message list
8. Send message
9. Receive message
10. Threads
11. Reactions
12. Direct messages
13. Invites
14. Presence
15. Typing indicators
16. Agent mentions
17. Agent activity/status UI
18. Logout
19. Reconnect after relay disconnect

Do not add:

- Managed Agents UI
- local agent subprocess management
- Git bridge
- Projects
- Huddles
- voice/video
- Canvas
- workflow automation
- local agent credential management

These are explicitly out of scope.

---

# 8. Agent interaction

The client should treat an existing server-side agent like another participant.

The client must NOT:

- spawn an agent
- install an agent
- configure an agent
- manage agent credentials
- manage Claude/Codex/Goose subprocesses

The expected architecture is:

    User
      ↓
    SWF Buzz
      ↓
    Buzz Relay
      ↓
    buzz-acp
      ↓
    existing server-side agent
      ↓
    Buzz Relay
      ↓
    SWF Buzz

If a real buzz-acp instance is unavailable locally, do not fake a production ACP integration.

Instead:

- keep the client-side agent protocol implementation correct
- test what can be tested without ACP
- clearly document what requires a real buzz-acp instance

---

# 9. UI requirements

Keep the current UI simple and professional.

Use the existing visual direction:

- cream + white
- clean spacing
- minimal UI
- professional enterprise feel
- readable typography
- subtle borders
- restrained accent usage
- no excessive gradients
- no unnecessary animations

Do NOT redesign the entire application unless necessary.

Prioritize functionality first.

The UI should clearly communicate:

    Development Mode

and connection state.

---

# 10. Error handling

Improve user-facing errors.

Instead of:

    [RelayConnectionService.connect] unknown Something went wrong.

show something meaningful in the UI, for example:

    Unable to connect to the local Buzz server.
    Make sure the local Buzz relay is running.

If reconnecting:

    Reconnecting to Buzz...

If connected:

    Connected

Do not expose sensitive internal information.

---

# 11. Testing

After implementation, run ALL available validation.

Frontend:

    npm run typecheck
    npm run lint
    npm run test
    npm run build

Rust/Tauri:

    cargo check
    cargo clippy --all-targets
    cargo fmt --check

If the repository already has integration tests, run them.

Do not remove existing tests just to make the suite pass.

Do not weaken assertions.

If tests fail:

1. investigate the actual failure
2. fix the root cause
3. rerun the failing test
4. rerun the complete suite

---

# 12. Real relay testing

If Docker and the local Buzz infrastructure are available:

Start the real local Buzz relay and perform actual end-to-end testing.

Verify:

    Development Login
          ↓
    Real buzz-relay
          ↓
    Channel discovery
          ↓
    Join channel
          ↓
    Send message
          ↓
    Receive message
          ↓
    Thread
          ↓
    Reaction
          ↓
    DM
          ↓
    Presence
          ↓
    Typing indicator
          ↓
    Logout
          ↓
    Login again

Also test:

    relay disconnect
        ↓
    reconnect
        ↓
    subscriptions restored

Do NOT call a feature "E2E verified" unless it was actually tested against the real buzz-relay.

---

# 13. If Docker is unavailable

If Docker is unavailable in the environment:

DO NOT:

- create a fake production relay
- silently mock the real relay
- claim E2E success
- change the application to avoid the relay

Instead:

- complete all code-level work
- run all available unit/integration tests
- verify configuration
- verify build
- verify protocol implementation
- verify RelayConnectionService
- document the exact external blocker
- provide the exact commands I can run on a machine with Docker

The project should be ready for real-relay testing once Docker is available.

---

# 14. Fix known issues only when source-verified

Review the currently documented limitations:

- presence snapshot limitation
- agent finished detection heuristic
- join/refetch race
- mention candidate stale cache
- DM unhide UI
- production Okta limitations
- NIP-46 bunker limitation

For protocol-related issues:

DO NOT guess.

If the required behavior is not documented, inspect the actual Buzz source/reference implementation and confirm it before changing anything.

---

# 15. Important architecture rule

Maintain this separation:

    DEVELOPMENT

    DevAuthService
          ↓
    DevSigningService
          ↓
    RelayConnectionService


    PRODUCTION

    Okta OIDC
          ↓
    NIP-46
          ↓
    Bunker
          ↓
    Remote Signing
          ↓
    RelayConnectionService

Both paths eventually converge at the protocol/relay layer.

Do not mix the two authentication systems.

---

# 16. Documentation

Update the relevant documentation after the work.

At minimum:

    docs/LOCAL_DEVELOPMENT.md
    docs/E2E_TEST_RESULTS.md
    docs/KNOWN_LIMITATIONS.md
    docs/ARCHITECTURE.md

Clearly separate:

    Verified locally
    Verified against test fixture
    Verified against real buzz-relay
    Blocked by infrastructure
    Production-only / pending Okta
    Production-only / pending NIP-46 bunker

Do not overclaim.

---

# 17. Final verification report

At the end, provide a concise report containing:

### Build

- typecheck: PASS/FAIL
- lint: PASS/FAIL
- unit tests: X/X
- integration tests: X/X
- build: PASS/FAIL
- cargo check: PASS/FAIL
- clippy: PASS/FAIL
- fmt: PASS/FAIL

### Functional status

For every feature:

    Development login
    Relay connection
    Channels
    Membership
    Messages
    Threads
    Reactions
    DMs
    Invites
    Presence
    Typing
    Agent mentions
    Agent activity
    Logout
    Reconnect

mark:

    VERIFIED
    CODE-AUDITED
    BLOCKED

### Infrastructure blockers

Explicitly list anything that requires:

- Docker
- real buzz-relay
- real buzz-acp
- Okta
- NIP-46 bunker
- production credentials/configuration

### Files changed

List important files changed and briefly explain why.

### Commands to run locally

Give me the exact commands I should run to start:

1. Buzz infrastructure
2. SWF Buzz frontend
3. Tauri application
4. optional agent/ACP testing

---

# Critical instruction

Do not stop after fixing the localhost connection error.

Continue through the entire local-development implementation and verification process.

However, do not attempt to solve production Okta/NIP-46 infrastructure in this task.

The goal is:

    "Make SWF Buzz as fully working as possible in LOCAL DEVELOPMENT using the real Buzz protocol and real local buzz-relay, while leaving production Okta + NIP-46 for later."

Work systematically, inspect before changing, make minimal safe changes, test after every major change, and give a truthful final verification report.
