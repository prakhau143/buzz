I need you to reverse-engineer and document this entire Buzz repository.

IMPORTANT:
Do NOT modify, refactor, fix, or rewrite any existing source code.
Do NOT make assumptions about how the system works.
Do NOT invent requirements or architecture.
Your documentation must be based ONLY on what you can verify from the actual repository contents.

I have already created a `docs/` directory at the root of this repository.

Your task is to thoroughly inspect the repository and create:

docs/BUZZ_PROJECT_ARCHITECTURE_AND_REQUIREMENTS.md

This document will be used by a new developer/engineer to understand the Buzz project before making any changes to it.

==================================================
1. FIRST: UNDERSTAND THE ENTIRE REPOSITORY
==================================================

Before writing the documentation, inspect the repository systematically.

Start by identifying:

- repository structure
- major directories
- major source-code areas
- Rust crates/modules
- frontend/web application
- backend/server components
- database/schema definitions
- scripts
- configuration files
- environment/configuration examples
- Docker/container configuration if present
- system/service definitions if present
- tests
- fixtures
- patches
- build/release/deployment files
- documentation already present in the repository

Do not just inspect the top-level directory.

Follow the important source-code paths and understand how the major components actually interact.

Use the repository itself as the source of truth.

==================================================
2. PROJECT OVERVIEW
==================================================

Document:

- What Buzz is
- What problem Buzz is solving
- Who/what uses Buzz
- What the main product/system appears to do
- Major capabilities
- Human-user functionality
- AI-agent functionality
- Important architectural concepts

Clearly separate:

A. Things directly confirmed by source code
B. Things described in existing project documentation
C. Things that are unclear or cannot be confirmed

Do NOT present assumptions as facts.

==================================================
3. COMPLETE REPOSITORY STRUCTURE
==================================================

Create a useful directory tree showing the important parts of the repository.

For each important directory/file, explain:

- what it contains
- why it exists
- what component depends on it
- whether it is runtime code, configuration, testing, tooling, documentation, etc.

Do not document every insignificant generated/vendor file.

Focus on files/directories that a developer needs to understand the architecture.

==================================================
4. ARCHITECTURE
==================================================

Reverse-engineer the actual architecture from the code.

Explain:

- frontend
- backend
- relay/server
- agent/ACP components
- database
- storage
- authentication
- networking
- WebSocket usage
- HTTP/API usage
- Nostr-related components
- protocol handling
- message/event flow
- background services
- external integrations

For every major component explain:

1. Name
2. Responsibility
3. Technology/language
4. Important files
5. Inputs
6. Outputs
7. Dependencies
8. How it communicates with other components

Create ASCII architecture diagrams where useful.

For example:

User
  ↓
Frontend
  ↓
API / WebSocket
  ↓
Backend
  ↓
Database / Relay / Agent
  ↓
External services

BUT:
Only include components that actually exist in this repository.

==================================================
5. END-TO-END DATA FLOW
==================================================

Trace important real flows through the source code.

At minimum, investigate if these flows exist:

A. Application startup
B. User authentication/login
C. Connecting to the backend/relay
D. Sending a message
E. Receiving a message
F. Channel/community operations
G. Direct messages
H. Invites
I. Reactions
J. Presence
K. AI-agent interaction
L. ACP communication
M. File/media handling
N. Database operations
O. Error handling/reconnection

For every flow:

- identify the entry point
- identify important functions/modules
- explain what happens step-by-step
- identify where data is transformed
- identify where data is persisted
- identify where the response goes

Use actual source-code names where possible.

==================================================
6. NOSTR / PROTOCOL ARCHITECTURE
==================================================

Inspect the repository carefully for:

- Nostr
- NIP-29
- NIP-42
- NIP-44
- NIP-46
- event kinds
- relay communication
- subscriptions
- publishing
- signing
- encryption
- authentication

Explain exactly which protocol features Buzz implements.

Do NOT assume that a standard Nostr event kind or NIP behavior is implemented simply because it exists in the ecosystem.

Verify implementation from the repository.

Create a section:

"Supported Protocols and Event Types"

with:

- protocol/NIP
- purpose
- implementation location
- important event/message types
- notes/limitations

==================================================
7. AI AGENT / ACP ARCHITECTURE
==================================================

This is especially important.

Investigate how Buzz interacts with AI agents.

Determine:

- What `buzz-acp` is
- Where ACP is implemented
- How an agent is represented
- How an agent process is started
- How an agent receives messages
- How messages are sent to an agent
- How agent responses return to Buzz
- How sessions are handled
- How agent identity is handled
- How agent configuration works
- How credentials are handled
- How permissions are handled
- What happens when an agent crashes/restarts
- What systemd/service configuration exists
- Which parts run on the server versus client

Document the actual implementation, not the intended future architecture.

==================================================
8. FRONTEND ARCHITECTURE
==================================================

Inspect the frontend/web code.

Document:

- framework
- language
- entry points
- routing
- state management
- API layer
- WebSocket layer
- Nostr client layer
- authentication flow
- UI/component structure
- important pages/views
- important shared components
- Tauri-related code if present

Explain how:

UI
 ↓
frontend state
 ↓
API/protocol layer
 ↓
backend

actually works.

==================================================
9. RUST / TAURI ARCHITECTURE
==================================================

If Tauri/Rust exists in this repository, inspect it deeply.

Document:

- Tauri configuration
- Rust entry point
- commands
- IPC
- frontend ↔ Rust communication
- native functionality
- plugins
- security configuration
- filesystem access
- networking
- media handling
- platform-specific code
- Windows/macOS/Linux differences if present

Identify important Rust modules and explain their responsibilities.

==================================================
10. BACKEND ARCHITECTURE
==================================================

Inspect all backend/server-side code.

Document:

- server entry points
- request handling
- WebSocket handling
- authentication
- authorization
- database access
- business logic
- event processing
- background jobs
- external services
- error handling
- logging
- configuration

For each important API/endpoint, document:

- method
- route
- purpose
- authentication requirement
- request shape
- response shape
- important implementation file

Only document endpoints you can verify.

==================================================
11. DATABASE / STORAGE
==================================================

Inspect:

- SQL
- migrations
- schema files
- ORM models
- database access code
- Redis usage
- MinIO/object storage
- filesystem storage

Document:

- important tables
- important fields
- relationships
- what data is stored where
- lifecycle of important records

Create a simple entity relationship explanation if useful.

==================================================
12. AUTHENTICATION AND SECURITY
==================================================

Inspect actual authentication/security implementation.

Document:

- identity model
- public/private keys if applicable
- authentication mechanisms
- authorization
- sessions/tokens
- encryption
- signing
- secrets
- environment variables
- credential storage
- permission boundaries
- CORS
- WebSocket authentication
- security-sensitive code

Clearly identify:

- confirmed security controls
- potential security-sensitive areas
- things that need further verification

Do NOT claim something is secure merely because it looks secure.

==================================================
13. CONFIGURATION
==================================================

Inspect all important:

- `.env.example`
- config files
- YAML/TOML/JSON files
- CLI arguments
- environment variables
- feature flags
- service configuration
- deployment configuration

Create a table:

| Variable / Config | Purpose | Required? | Used By | Default/Example |
|---|---|---|---|---|

Only include values you can verify.

Never expose actual secrets.

==================================================
14. BUILD / RUN / DEPLOYMENT
==================================================

Determine from the repository:

- prerequisites
- package managers
- build commands
- development commands
- test commands
- lint/format commands
- database setup
- migrations
- local development
- production build
- Docker usage
- systemd usage
- deployment scripts

Create a practical:

"How to Run Buzz Locally"

section.

Only include commands verified from repository documentation/configuration/scripts.

If something cannot be verified, explicitly mark it as:

"Needs verification"

instead of inventing a command.

==================================================
15. TESTING
==================================================

Inspect tests and test infrastructure.

Document:

- unit tests
- integration tests
- end-to-end tests
- fixtures
- test scripts
- test environments
- important test coverage areas

Explain how a developer should run the tests.

==================================================
16. REQUIREMENTS
==================================================

Create a section called:

"Current Requirements"

Separate:

### Functional requirements
What the system must do.

### Technical requirements
Technologies/protocols/infrastructure required.

### Security requirements
Authentication, authorization, key handling, etc.

### Operational requirements
Logging, deployment, monitoring, service management, etc.

### Client requirements
Desktop/web requirements.

### Agent requirements
AI-agent-related requirements.

IMPORTANT:
Derive these requirements from actual repository behavior and existing documentation.

Do not invent requirements.

==================================================
17. IMPORTANT DESIGN DECISIONS
==================================================

Identify important architectural decisions visible in the repository.

For example:

- why a particular protocol is used
- why a component exists
- why a certain architecture pattern is used
- why some functionality is separated
- why certain data is stored in a particular location

Only state the reason when it is supported by comments/docs/code.

Otherwise write:

"Reason not explicitly documented."

==================================================
18. CURRENT STATE VS FUTURE / UNKNOWN
==================================================

Create a very important section:

"Current State, Planned Work, and Unknowns"

Separate:

### Confirmed working/current
Things clearly implemented.

### Partially implemented
Things that exist but are incomplete.

### Planned/future
Things mentioned in docs/comments but not implemented.

### Unknown
Things that cannot be established from the repository.

This distinction is extremely important.

==================================================
19. IMPORTANT FILES FOR A NEW DEVELOPER
==================================================

Create a section:

"Where Should I Start?"

Rank the most important files/directories a new engineer should read.

For example:

1. File/path
   - Why read it
   - What it teaches

2. File/path
   - Why read it
   - What it teaches

Give me a recommended reading order from beginner → intermediate → advanced.

==================================================
20. GLOSSARY
==================================================

Create a simple glossary explaining project-specific terms.

Include terms such as:

- Buzz
- Relay
- Nostr
- NIP
- ACP
- buzz-acp
- Agent
- Session
- Community
- Channel
- DM
- Event
- Subscription
- Tauri
- NDK
- IPC
- etc.

Only include terms relevant to this repository.

==================================================
21. DEVELOPER QUICK REFERENCE
==================================================

At the end create:

"Developer Quick Reference"

Include:

- important commands
- important directories
- important services
- important config files
- important APIs
- important protocols
- important test commands
- common troubleshooting starting points

==================================================
22. DOCUMENTATION QUALITY RULES
==================================================

The final documentation must be:

- beginner-friendly
- technically accurate
- based on repository evidence
- structured with clear headings
- concise where possible but comprehensive
- easy for a new developer to navigate

Use:

- tables
- bullet points
- ASCII diagrams
- code blocks
- file paths
- function/module names

where they improve understanding.

For important claims, include source references like:

`src/path/to/file.rs`
`function_name()`
`module_name`

so another developer can verify the explanation.

==================================================
23. VERY IMPORTANT — DO NOT MODIFY THE PROJECT
==================================================

Your ONLY deliverable is:

docs/BUZZ_PROJECT_ARCHITECTURE_AND_REQUIREMENTS.md

Do not:

- modify source code
- modify configuration
- modify package files
- install dependencies unless absolutely necessary for inspection
- create unrelated files
- delete anything
- refactor anything
- fix bugs
- change git state

You may only create/update the requested documentation file.

==================================================
24. FINAL STEP
==================================================

After creating the documentation:

1. Re-read the generated Markdown file.
2. Check that every major architectural statement is supported by repository evidence.
3. Remove assumptions.
4. Mark unclear areas as "Needs verification".
5. Make sure the documentation explains BOTH:
   - what Buzz currently does
   - how the code actually implements it.
6. Give me a short summary in your final response containing:
   - documentation file created
   - major components discovered
   - any major unknowns/gaps
   - recommended next files for me to study

Do NOT start implementing anything.

Start by inspecting the repository structure and then progressively trace the architecture before writing the document.