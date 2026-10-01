You are working on the SWF Buzz desktop client.

IMPORTANT PROJECT STRUCTURE:

The current workspace contains TWO projects under a parent directory:

buzz/
├── buzz/       -> OLD BUZZ PROJECT
└── swf buzz/   -> NEW SWF BUZZ PROJECT

HARD RULE:
- DO NOT modify, refactor, delete, rename, install dependencies into, or commit changes to the OLD BUZZ project.
- OLD BUZZ is reference/infrastructure only.
- The active development project is ONLY `swf buzz`.
- The existing Buzz Relay/backend infrastructure from the OLD BUZZ repository may be started with Docker because SWF Buzz depends on it.
- Do not confuse the OLD BUZZ desktop client with the SWF BUZZ desktop client.

GOAL:

I have cloned the SWF Buzz repository onto a new Windows machine from GitHub.

I need you to first inspect the local repositories and then get the SWF Buzz project running exactly as it was intended to run in development.

Do NOT blindly change source code.

PHASE 1 — AUDIT THE WORKSPACE

1. Identify the current working directory.
2. Identify:
   - OLD BUZZ repository path
   - SWF BUZZ repository path
3. Inspect the SWF BUZZ repository:
   - package.json
   - package-lock.json
   - vite.config.*
   - src/
   - src-tauri/
   - backend/
   - docs/
   - tests/
   - .env*
   - README.md
   - Tauri configuration
4. Inspect the OLD BUZZ repository ONLY to determine how its Buzz Relay is started.
5. Do not modify OLD BUZZ files.
6. Determine the exact commands required to start:
   - Buzz Relay
   - SWF Buzz frontend
   - SWF Buzz Tauri desktop application

Before executing commands, report the detected structure and startup plan.

PHASE 2 — CHECK WINDOWS DEVELOPMENT ENVIRONMENT

Check whether the following are installed and usable:

- Node.js
- npm
- Rust
- Cargo
- Docker
- Docker Compose
- Tauri CLI if required
- Git

Run safe version checks such as:

node --version
npm --version
rustc --version
cargo --version
docker --version
docker compose version
git --version

If something required by SWF Buzz is missing, clearly tell me what is missing.

Do not install system software automatically unless explicitly necessary and safe.
Do not change unrelated system configuration.

PHASE 3 — SWF BUZZ DEPENDENCIES

Work ONLY inside the SWF BUZZ directory.

Inspect package.json and determine the correct package manager.

If this repository uses npm and package-lock.json exists, use:

npm install

Do not replace package-lock.json unnecessarily.

If node_modules already exists, inspect whether dependencies are already installed before reinstalling.

PHASE 4 — ENVIRONMENT CONFIGURATION

Inspect the SWF BUZZ repository for environment requirements.

Look for:

.env
.env.local
.env.example
.env.development
Vite environment variables
Tauri environment configuration
backend configuration
relay URL configuration
Okta configuration

Do not invent environment variable values.

If an example file exists, compare it with the expected development configuration.

For the previous SWF Buzz local development setup, the relay URL was:

VITE_RELAY_URL=ws://localhost:3000

But verify this against the actual cloned repository before creating or changing any file.

If required environment variables are missing, list them clearly before making changes.

Do NOT add fake Okta credentials, secrets, API keys, client secrets, or tokens.

PHASE 5 — START BUZZ RELAY

The SWF Buzz client depends on the existing Buzz Relay infrastructure.

The OLD BUZZ repository contains the relay/backend infrastructure.

Use the OLD BUZZ repository ONLY for running the existing relay infrastructure.

Previously the relay development flow was:

1. Go to OLD BUZZ repository.
2. Run:

just setup

3. Then run:

just relay

However, DO NOT assume these commands are still correct.

First inspect the OLD BUZZ repository's README, justfile, Docker configuration, docker-compose files, and relay configuration.

Determine the current correct Docker-based relay startup command.

The relay should normally expose the development WebSocket endpoint expected by SWF Buzz.

Do not modify the OLD BUZZ application code.

Do not start the OLD BUZZ desktop client.

Do not run its frontend.

Do not migrate or copy its source code.

PHASE 6 — VERIFY RELAY

After starting the relay:

1. Verify Docker containers are running.
2. Verify the expected relay port is listening.
3. Verify the WebSocket/relay endpoint is reachable.
4. Check Docker logs for startup errors.
5. Confirm whether the SWF Buzz client can use the relay.

If the relay fails, diagnose the Docker error instead of modifying SWF Buzz unnecessarily.

PHASE 7 — START SWF BUZZ

Now move into ONLY:

swf buzz/

Start the Vite/Tauri development application using the repository's actual scripts.

First inspect package.json.

If the project contains the expected Tauri script, the development command may be:

npm run tauri dev

If the project uses another script, use the repository-defined script instead.

Do NOT invent scripts.

The intended architecture is:

Vue 3 + TypeScript + Vite
        ↓
Tauri 2
        ↓
Rust native layer
        ↓
SWF Buzz services
        ↓
Buzz Relay/backend

PHASE 8 — TAURI/RUST CHECK

Inspect:

src-tauri/
Cargo.toml
tauri.conf.json or equivalent
capabilities/
build configuration

Make sure the Rust/Tauri dependencies can compile.

If there is a Rust compilation error:

- report the exact error
- identify whether it is caused by missing Windows tooling, dependency mismatch, environment configuration, or project code
- do not perform unrelated refactoring

Do not remove Tauri functionality just to make the build pass.

PHASE 9 — IMPORTANT SWF BUZZ ARCHITECTURE RULES

The current SWF Buzz project must follow these architectural decisions:

HUMAN AUTHENTICATION:

Okta
  ↓
Verified application session
  ↓
Application User
  ↓
Community Membership
  ↓
Community Role
  ↓
Permissions

Human authentication must NOT depend on Nostr identity.

Do NOT introduce or restore:

- Nostr pubkeys as human identity
- npub
- nsec
- NIP-42
- NIP-46
- bunker
- NIP-98
- human Nostr event signing
- Nostr private-key identity for users

Old Buzz may contain these concepts. They are NOT to be copied into the new human authentication architecture.

PHASE 10 — COMMUNITY / CHAT FUNCTIONALITY

The SWF Buzz client should preserve the required Old Buzz business/user behavior where applicable:

- Communities
- Community members
- Community roles
- Channels
- Channel membership
- Channel permissions
- Text messaging
- Threads
- Reactions
- DMs
- Profiles
- Profile → DM
- Community invites
- Presence
- Remote/server-side agents

But implement these through the new SWF application architecture, not by copying Old Buzz's Nostr human identity implementation.

PHASE 11 — INVITE ARCHITECTURE

The current invite architecture must be application-session based.

Expected flow:

Owner/Admin
    ↓
Community
    ↓
Create Invite
    ↓
POST /api/invites
    ↓
SWF authenticated session + CSRF
    ↓
Secure invite token
    ↓
Invite URL
    ↓
User opens /invite/<token>
    ↓
If not logged in → Okta login
    ↓
SWF application session
    ↓
Restore invite URL
    ↓
Join
    ↓
POST /api/invites/claim
    ↓
Application User derived from authenticated session
    ↓
Community Membership created
    ↓
Role = member
    ↓
User enters community

Do not use NIP-98 for invite authentication.

Do not use Nostr pubkeys for invite claiming.

Do not trust sender_user_id or claimant_user_id supplied by the browser.

The backend must derive the authenticated user from the SWF application session.

PHASE 12 — DO NOT CHANGE OLD BUZZ

The OLD BUZZ project is only an existing infrastructure/reference source.

NEVER:

- edit its frontend
- edit its desktop client
- refactor it
- migrate it
- copy its source wholesale
- run its desktop client
- commit changes to it
- change its Nostr implementation for the purpose of SWF Buzz

Only use its existing relay/backend infrastructure when required by SWF Buzz.

PHASE 13 — STARTUP VERIFICATION

After starting everything, verify:

1. Docker is running.
2. Buzz Relay is running.
3. Relay port is available.
4. SWF Buzz dependencies are installed.
5. Vite starts successfully.
6. Tauri starts successfully.
7. Rust compiles successfully.
8. SWF Buzz connects to the relay.
9. No unexpected Nostr human-identity requirement appears.
10. Okta configuration is detected without exposing secrets.
11. No OLD BUZZ frontend is running.
12. No unrelated project is modified.

PHASE 14 — DO NOT MAKE UNNECESSARY CODE CHANGES

This task is primarily to get the cloned project running.

Before changing source code:

- identify the actual error
- explain why the change is required
- make the smallest possible change
- keep the existing architecture intact

Do not perform cleanup, refactoring, dependency upgrades, formatting changes, or feature development as part of startup.

PHASE 15 — FINAL REPORT

When finished, give me a concise report containing:

A. Workspace detected

B. OLD BUZZ location

C. SWF BUZZ location

D. Required tools and their versions

E. Docker relay command used

F. Relay URL and port

G. SWF BUZZ dependency installation result

H. Environment variables required/missing

I. Tauri startup command

J. Whether the desktop application started successfully

K. Any errors encountered

L. Exact commands I should use next time to start the complete development environment

IMPORTANT:

Do not stop after explaining the commands.

Actually inspect the repositories and run the safe startup commands needed to get SWF Buzz running.

Start with PHASE 1 audit now.