SWF Buzz — Final Completion, Integration & Full Test Prompt for Claude Code

Role

You are the lead engineer responsible for taking the existing swf buzz project from its current partially implemented state to a complete, working, tested, production-ready MVP according to the project's PRD, architecture documents, protocol analysis, and existing implementation decisions.

Work directly inside the existing swf buzz directory.

Do not start a new project, throw away the existing implementation, or fork/copy the current Buzz Desktop application. The existing buzz repository is reference material only.

1. Current Project Context

Target structure:

buzz2.0/
├── buzz/ # existing Buzz repository — READ ONLY reference
└── swf buzz/ # our new project — IMPLEMENT HERE

Expected architecture:

Tauri 2

Rust backend/core

Vue 3

TypeScript

Vite

Nostr protocol

NIP-29 for groups/channels

NIP-42 for relay authentication

NIP-46 for remote signing

Okta OIDC Authorization Code + PKCE

Relay connection over WebSocket

buzz-relay as the self-hosted relay/backend

buzz-acp for existing server-side AI agents

No local agent spawning

No raw private key stored in the client

Windows-first Tauri support

Cream + white professional UI

Small, clean, maintainable codebase

2. Product Scope

Must support

Authentication

Okta OIDC login using Authorization Code + PKCE

NIP-46 remote signing/bunker architecture

Relay connection

Relay reconnect handling

Channel discovery

Channel membership

Join/view/post messages

Threads

Reactions

Direct messages

Invites

Presence

Typing/status indicators

Existing server-side AI agents as participants

@mentioning an existing agent

Receiving agent responses

Loading/error/empty states

Secure authentication/signing state

Windows Tauri CORS/origin support

Automated tests

Build/package validation

Explicitly do NOT implement

Managed Agents UI

Local Claude/Codex/Goose subprocess management

Local agent spawning

Local agent credential injection

Git bridge

Projects/Git functionality

Huddles

Voice/video

Canvas/whiteboard

Workflow automation

Local agent credential/env management

Any other Buzz Desktop feature not required by the PRD

If a feature is not required by the PRD, do not add it merely because Buzz Desktop has it.

3. First: Audit the Existing Project

Before coding, inspect the complete swf buzz repository.

Read the actual files that exist, especially:

docs/
src/
src-tauri/
package.json
vite.config.*
tsconfig*
Cargo.toml

Also inspect relevant documentation such as:

docs/PRD*
docs/PROTOCOL*
docs/RECONNAISSANCE.md
docs/DECISIONS.md
docs/DEVELOPMENT.md
docs/TESTING.md
docs/SECURITY.md
docs/buzz-kind-registry-analysis.md

Use the actual filenames if they differ.

Create an internal checklist:

DONE
PARTIALLY DONE
MISSING
BROKEN
BLOCKED BY EXTERNAL INFRASTRUCTURE

Do not duplicate working implementations.

4. Current State to Verify

The previous implementation session reported:

frontend typecheck passes

lint passes

unit tests exist

frontend build passes

Rust/Tauri cargo check passes

protocol wire-format layer exists

kind registry layer exists

thread resolution exists

message serialization exists

presence exists

typing exists

invites exist

DM protocol layer exists

agent protocol layer exists

relay connection/reconnect service exists

relay connection is wired into authentication flow

documentation exists

Git repository has been initialized

ChannelsView.vue and DmView.vue were identified as incomplete/stubs

Treat the repository itself as the source of truth. Verify these claims before relying on them.

5. Main Goal

Finish the application as a real working product, not a UI mockup.

Target flow:

User opens application
↓
Okta Login
↓
OIDC callback
↓
Authenticated session
↓
NIP-46 bunker/signing connection
↓
Relay WebSocket connection
↓
Fetch communities/channels
↓
Select/join channel
↓
Load messages
↓
Send message
↓
Sign through approved signing mechanism
↓
Publish to relay
↓
Receive messages
↓
React / reply in thread
↓
DM another user
↓
Presence / typing
↓
@mention existing AI agent
↓
buzz-acp / server-side agent
↓
Agent response
↓
Display response in client

6. Implement the Real UI

Build actual Vue screens, not placeholders.

Use a simple professional enterprise style:

cream

off-white

white

subtle neutral borders

readable dark text

restrained accent color

clean typography

comfortable spacing

subtle shadows

moderate rounded corners

Do not make it flashy.

Minimum screens:

Login

Okta login

loading state

error state

retry

Main application

Use a structure similar to:

┌─────────────────────────────────────────────────────┐
│ Header / Workspace │
├──────────────┬──────────────────────┬───────────────┤
│ Sidebar │ Conversation │ Details │
│ │ │ │
│ Channels │ Messages │ Members │
│ DMs │ Threads │ Agent info │
│ Invites │ Composer │ │
└──────────────┴──────────────────────┴───────────────┘

7. Channels

Implement:

channel list

channel selection

channel loading

membership

join channel

message history

send message

receive messages

reactions

threads

typing

presence

loading states

empty states

errors

Use the actual protocol layer. Do not hardcode fake events into the UI.

8. DMs

There has previously been uncertainty between:

NIP-17 gift-wrap / kind 1059

and the Buzz implementation:

KIND_DM_OPEN = 41010
normal kind 9 messages inside a private channel

Do not guess.

Use the verified buzz-core registry/protocol analysis and documented team decision.

If the production decision is still unavailable, isolate DM transport behind an interface so the protocol can be changed without rewriting the UI.

The UI must not know protocol-specific details.

9. Agent Interaction

The client must NOT spawn or manage local agents.

Existing agents run server-side.

Target flow:

User
↓
Channel / DM
↓
@Agent mention
↓
Relay
↓
buzz-acp
↓
Existing server-side agent
↓
Relay
↓
Client

Treat the agent as a participant.

Do not expose internal agent logs, token counts, JSONL entries, or tool activity as normal chat messages.

Show useful operational activity separately, e.g.:

SWF Agent is thinking...
SWF Agent is typing...
SWF Agent completed

10. State Management

Keep protocol logic separate from UI state.

Use:

Pinia

for small/local UI state.

Use:

TanStack Vue Query

for server/relay-backed state where appropriate.

Do not create one huge global store.

Suggested conceptual separation:

Vue UI
↓
Composable / Service
↓
Protocol Service
↓
Signer
↓
Relay Connection

Do not construct Nostr events directly inside Vue components.

11. Protocol Layer

Keep protocol code independent from Vue.

It should handle:

event kinds

payload construction

event parsing

thread relationships

reactions

presence

typing

invites

DMs

agent events

relay subscriptions

Verify exact event kind numbers and payload shapes against the project's verified buzz-core source analysis. Never guess.

12. Security / Signing

This is critical.

Never:

generate production private keys locally

store raw private keys in localStorage

store raw private keys in IndexedDB

write private keys to disk

log private keys

send raw private keys through IPC

send raw private keys to the relay

expose private keys to Vue

Intended architecture:

Okta
↓
Authenticated user
↓
NIP-46 bunker
↓
Remote signer / KMS-backed key
↓
Client requests signature
↓
Signed event
↓
Relay

If real NIP-46 infrastructure is unavailable, build a clean signing abstraction and an isolated development/test implementation.

Clearly document what is test-only. Never pretend a mock is production security.

13. Okta

Implement:

Authorization Code + PKCE

Do not hardcode credentials.

Provide:

.env.example

with placeholders.

If the real Okta tenant/client configuration is unavailable:

implement the integration boundary

provide configuration points

provide mocked auth for tests

document exactly what the team must supply

Never invent tenant IDs, client IDs, issuers, or secrets.

14. Relay Connection

Implement:

WebSocket connection

authentication

subscriptions

reconnect

backoff

subscription re-registration

disconnect handling

connection state

error handling

Avoid reconnect storms.

Expose useful states:

Connected
Connecting...
Reconnecting...
Offline

15. Windows Tauri CORS

Deployment must explicitly support:

BUZZ_CORS_ORIGINS=https://<control-plane-domain>,tauri://localhost,http://tauri.localhost,https://tauri.localhost

Document this requirement for development, staging, and production.

Do not assume the backend will automatically know the Windows Tauri origin.

16. Backend Dependencies

The client depends on:

buzz-relay
buzz-acp

They remain external pinned releases.

Do not modify their source from this client repository.

Document:

backend versions

protocol compatibility

upgrade process

integration testing procedure

17. Error Handling

Handle at minimum:

login failure

relay unavailable

WebSocket disconnect

auth expiry

invalid event

publish failure

permission failure

empty channel

no DMs

agent unavailable

signer unavailable

Do not silently swallow errors.

Do not expose stack traces to normal users.

18. Testing

Run the complete existing validation suite, not only typecheck.

At minimum:

npm run typecheck
npm run lint
npm run test
npm run build
cargo check

Also inspect package.json and Cargo.toml for additional scripts/tests and run relevant ones.

Add or improve tests for:

event serialization

event parsing

message publishing

threads

reactions

presence

typing

invites

DMs

relay reconnect

authentication

signing abstraction

Vue components

security-sensitive behavior

Example behavioral test:

Create message
→ correct event kind
→ correct payload
→ correct tags
→ signer called
→ event published

19. Integration Testing

Where possible, create a local/test environment.

If real Okta, NIP-46, buzz-relay, or buzz-acp infrastructure is unavailable:

isolate the external integration

create deterministic mocks/test doubles

test the complete client behavior against them

document exactly which real infrastructure test remains

Final reporting must distinguish:

PASSED LOCALLY
PASSED WITH MOCKS
REQUIRES REAL INFRASTRUCTURE
NOT TESTED

Never claim a real E2E test passed when it was only mocked.

20. Security Review

Before completion, review:

private-key exposure

secrets in source

secrets in .env

secrets in logs

unsafe IPC

unsafe HTML rendering

untrusted message rendering

WebSocket security

auth token leakage

Tauri permissions

filesystem permissions

shell/process permissions

local storage

dependency risks

Fix what can be fixed locally.

Document external risks.

21. Tauri Permissions

Review Tauri capabilities and permissions.

Grant only what is necessary.

Do not give the frontend unnecessary:

shell access

filesystem access

process spawning

arbitrary command execution

Remember:

No local agents
No local subprocess management

22. Dependency Review

Review:

package.json
Cargo.toml

Remove unused dependencies where safe.

Do not add dependencies unnecessarily.

For major dependencies, understand:

why it exists
where it is used
runtime vs development-only

Keep the dependency surface small.

23. Documentation

Update the actual project documentation after implementation.

At minimum maintain the equivalent of:

README.md
docs/ARCHITECTURE.md
docs/PRD.md
docs/PROTOCOL_IMPLEMENTATION.md
docs/SECURITY.md
docs/DEVELOPMENT.md
docs/TESTING.md
docs/DECISIONS.md

Document:

final architecture

project structure

frontend

Tauri/Rust

protocol

relay

authentication

signing

channels

DMs

agents

testing

deployment

CORS

security

limitations

future work

24. Decisions

Record important decisions in:

docs/DECISIONS.md

Do not silently make risky assumptions.

Include decisions such as:

Tauri instead of Electron
Vue 3 + TypeScript
Remote signing via NIP-46
No local agent spawning
External pinned buzz-relay/buzz-acp
Windows Tauri origin handling
Final DM protocol selection

Use existing decision numbering if already present.

25. External Blockers

Do not stop the whole project because an external service is unavailable.

Examples:

missing Okta tenant configuration

missing NIP-46 bunker/KMS

unavailable staging relay

unavailable buzz-acp

missing credentials

Instead:

IMPLEMENT EVERYTHING POSSIBLE +
ISOLATE EXTERNAL DEPENDENCIES +
CREATE TEST DOUBLES +
DOCUMENT EXACT REQUIREMENTS

Only stop for clarification when proceeding would create a wrong architecture or irreversible security/protocol decision.

26. Do Not Fake Success

Never say:

E2E passed

if only unit tests passed.

Never say:

Okta works

if no real tenant was configured.

Never say:

NIP-46 works

if no real bunker exists.

Never say:

Agent integration works

if the real backend was not reachable.

Be exact about test scope.

27. Final Validation

Before declaring completion:

1. Install dependencies if needed
2. Clean build
3. Typecheck
4. Lint
5. Unit tests
6. Integration tests
7. Frontend build
8. Rust cargo check
9. Tauri build/package if environment supports it
10. Security review
11. Dependency review
12. Inspect git diff
13. Inspect git status
14. Confirm no secrets
15. Confirm generated artifacts are not committed
16. Verify documentation
17. Verify README setup
18. Verify .gitignore

If something fails:

diagnose
→ fix
→ rerun

Do not ignore failures.

28. Git Hygiene

Never commit:

node_modules/
dist/
target/
.env
real credentials
private keys
secret-bearing logs

Before committing inspect:

git status
git diff
git diff --cached

Do not force push.

Do not delete project history.

29. Definition of Done

Architecture

Frontend architecture clean

Rust/Tauri boundary clean

Protocol isolated

Relay layer isolated

Auth isolated

Signing isolated

Vue does not contain protocol internals

Authentication

Okta architecture implemented

PKCE implemented/configurable

No secrets committed

Auth state safe

Protocol

Kind registry verified

Channels implemented

Messages implemented

Threads implemented

Reactions implemented

Presence implemented

Typing implemented

Invites implemented

DM implementation verified

Agent interaction implemented

Relay

WebSocket connection

Authentication

Subscriptions

Reconnect

Error handling

UI

Login

Channels

DMs

Threads

Reactions

Invites

Presence

Typing/status

Agent messages

Loading states

Empty states

Error states

Security

No raw private key

No secrets in repo

Minimal Tauri permissions

Safe message rendering

Secure IPC

Security docs updated

Testing

Typecheck passes

Lint passes

Unit tests pass

Integration tests pass where possible

Build passes

Cargo check passes

Tauri package/build passes if supported

Documentation

README updated

Architecture documented

Protocol documented

Security documented

Testing documented

Deployment documented

External blockers documented

30. Development Phases

Work in this order:

Phase 0 — Audit

Inspect repository and create gap checklist.

Phase 1 — Foundation

Fix architecture/build/config issues.

Phase 2 — Authentication + Signing

Complete Okta and signing abstractions.

Phase 3 — Relay

Complete connection/auth/subscriptions/reconnect.

Phase 4 — Channels

Complete channel discovery, membership, messages, threads, reactions.

Phase 5 — DMs

Complete the verified DM protocol.

Phase 6 — Presence / Typing / Invites

Complete these flows.

Phase 7 — Agent Interaction

Connect to existing server-side agents.

Phase 8 — UI Polish

Apply the cream/white professional design.

Phase 9 — Security

Perform security review.

Phase 10 — Testing

Run and fix all tests.

Phase 11 — Build & Packaging

Build the complete application.

Phase 12 — Documentation

Update final documentation.

31. Important Rules

Do not rewrite working code unnecessarily.

Do not create duplicate implementations.

Do not guess protocol kind numbers.

Verify protocol behavior against the project's verified source analysis.

Do not fork Buzz Desktop.

Do not copy managed-agent code.

Do not implement out-of-scope features.

Do not store raw private keys.

Do not hardcode credentials.

Do not fake integration success.

Do not leave avoidable TODOs.

Do not stop because optional infrastructure is unavailable.

Use mocks/adapters where appropriate.

Keep backend dependencies isolated.

Keep protocol logic independent of Vue.

Keep Tauri permissions minimal.

Keep UI simple and professional.

Run tests after meaningful changes.

Fix failures instead of ignoring them.

Update documentation when architecture changes.

32. Start Now

Do not only explain what you would do.

Start by inspecting the current swf buzz repository and its documentation.

Then execute:

AUDIT
→ PLAN
→ IMPLEMENT
→ TEST
→ FIX
→ SECURITY REVIEW
→ BUILD
→ DOCUMENT

Take the project as close to fully working as the available environment and external infrastructure allow.

When an external dependency genuinely prevents final validation, isolate it cleanly, continue all locally possible work, and clearly report the exact remaining requirement.

33. Final Report

When finished, provide:

1. Existing work found

2. Work implemented

3. Files/modules changed

4. Final architecture

5. Final user flow

6. Protocol decisions

Cover:

Channel
Message
Thread
Reaction
Presence
Typing
Invite
DM
Agent
Authentication
Signing

7. Exact tests executed

Example format:

npm run typecheck PASS
npm run lint PASS
npm run test PASS
npm run build PASS
cargo check PASS

Never invent test counts/results.

8. External infrastructure still required

Clearly separate:

CODE COMPLETE

from:

REQUIRES OKTA CONFIGURATION
REQUIRES NIP-46 BUNKER/KMS
REQUIRES STAGING RELAY
REQUIRES REAL BUZZ-ACP

9. Remaining risks

10. Exact next step for the team

Do not stop at the audit. Continue implementing, testing, fixing, and documenting until the project is genuinely complete or a real external dependency is the only remaining blocker.
