We have completed the infrastructure reconnaissance.

Now move from reconnaissance to LOCAL END-TO-END IMPLEMENTATION AND TESTING.

Do not modify ../buzz. It is reference-only.

Our goal is to make the SWF Buzz client fully runnable locally against the real local buzz-relay and verify every in-scope feature from the PRD.

IMPORTANT ARCHITECTURE:

SWF Buzz
↓
Development Authentication
↓
Development Signing
↓
Nostr WebSocket
↓
buzz-relay
↓
Nostr events

Do NOT add a direct SWF Buzz → buzz-acp connection.

Do NOT implement a fake ACP endpoint.

Do NOT implement NIP-46 bunker yet.

Do NOT remove or comment out the existing Okta/NIP-46 production implementation.

Development authentication and signing should remain dev-only.

TASK 1 — LOCAL ENVIRONMENT

Create/configure .env.local if it does not exist.

Use:

VITE_RELAY_URL=ws://localhost:3000

Do not commit .env.local.

Verify that the existing RelayConnectionService connects successfully.

TASK 2 — START LOCAL BACKEND

Verify the commands required to start ../buzz locally:

. ./bin/activate-hermit
just setup
just relay

Do not modify ../buzz.

If the relay cannot start, diagnose the actual error and fix only what is required in SWF Buzz or provide the exact backend prerequisite.

TASK 3 — START SWF BUZZ

Run:

npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run tauri dev

Fix any SWF Buzz issues that prevent the application from starting.

TASK 4 — AUTHENTICATION

Verify:

Continue in Development Mode
↓
DevAuthService
↓
DevSigningService
↓
authenticated relay connection

Verify that no private key is persisted to disk.

Do not weaken production security.

TASK 5 — TEST ALL IN-SCOPE FEATURES

Test and fix each feature:

1. Channel discovery/list
2. Channel membership
3. Join channel
4. Post message
5. Receive message
6. Threads
7. Reactions
8. Direct messages
9. Invites
10. Presence
11. Typing indicators
12. Agent mention/reply
13. Agent activity/status rendering
14. Logout
15. Reconnect after relay disconnect

For every feature:

- verify protocol event kind
- verify payload
- verify relay subscription
- verify UI state update
- verify error handling
- add or update unit tests where useful

TASK 6 — AGENT TESTING

Use ../buzz/examples/countdown-bot as the local protocol-compatible test agent if practical.

Do NOT require a real LLM provider.

Do NOT add a direct ACP client connection.

Verify:

SWF Buzz
↓
@agent
↓
buzz-relay
↓
test agent
↓
agent response
↓
SWF Buzz

TASK 7 — AUTOMATED TESTS

Run all available:

npm run typecheck
npm run lint
npm test
npm run build
cargo check

If integration tests can be added safely, add them.

Do not create fake tests that merely assert mocked success.

TASK 8 — SECURITY CHECK

Verify:

- no private keys committed
- no .env.local committed
- no production credentials
- no hardcoded secrets
- development signer is dev-only
- Okta production path remains intact
- NIP-46 production path remains intact

TASK 9 — DOCUMENTATION

Update/create:

docs/LOCAL_DEVELOPMENT.md
docs/E2E_TEST_RESULTS.md
docs/KNOWN_LIMITATIONS.md

Document:

- exact startup commands
- architecture
- relay connection
- development auth
- development signing
- each tested feature
- test results
- failures and fixes
- remaining infrastructure blockers

TASK 10 — FINAL VERIFICATION

At the end, give me a clear report:

BUILD:
PASS/FAIL

TYPECHECK:
PASS/FAIL

LINT:
PASS/FAIL

UNIT TESTS:
PASS/FAIL — number of tests

CARGO CHECK:
PASS/FAIL

TAURI APP:
PASS/FAIL

LOCAL RELAY:
PASS/FAIL

AUTH:
PASS/FAIL

CHANNELS:
PASS/FAIL

MESSAGES:
PASS/FAIL

THREADS:
PASS/FAIL

REACTIONS:
PASS/FAIL

DMS:
PASS/FAIL

INVITES:
PASS/FAIL

PRESENCE:
PASS/FAIL

TYPING:
PASS/FAIL

AGENT:
PASS/FAIL

RECONNECT:
PASS/FAIL

SECURITY:
PASS/FAIL

IMPORTANT:

Do not stop after fixing compilation.

The objective is a genuinely working local vertical slice, not merely a successful build.

If something cannot be tested because infrastructure is missing, clearly identify it as an external blocker instead of mocking it away.

Do not make unnecessary architectural changes.
Do not rewrite working protocol code without evidence.
Do not modify ../buzz.
