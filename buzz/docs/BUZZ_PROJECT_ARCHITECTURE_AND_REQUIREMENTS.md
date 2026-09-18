# Buzz — Project Architecture and Requirements

This document is a consolidated, evidence-based reference for a new developer or engineer joining the Buzz project. It was produced by systematically inspecting the repository (source code, configuration, migrations, and existing project documentation) rather than by assumption.

**How to read the tags used throughout this document:**
- **[CODE]** — directly confirmed by reading source code in this repository.
- **[DOCS]** — stated in existing repository documentation (`README.md`, `ARCHITECTURE.md`, `NOSTR.md`, `docs/*`, etc.), not independently re-derived from code in this pass.
- **[VISION]** — stated only in the repo's `VISION_*.md` files as an aspirational/future direction. This is explicitly **not** current-state fact and must not be read as implemented.
- **[UNCLEAR]** / "Needs verification" — could not be confirmed from the material inspected. Flagged rather than guessed.

**Important upfront context:** this repository already contains an unusually detailed, current set of engineering documents — `ARCHITECTURE.md` (835 lines), `AGENTS.md`, `NOSTR.md`, `TESTING.md`, and 18 Buzz-authored draft NIP specs under `docs/nips/`. This document synthesizes and cross-checks that material against the actual source code; it is a single onboarding entry point, not a replacement for those deeper references, which it links to throughout.

Note: `spec/requirements.md` in this repository is the user's own task brief for this documentation exercise (confirmed by its file timestamp, newer than the rest of the repo), not shipped project content — it is excluded from all architectural claims below.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Complete Repository Structure](#2-complete-repository-structure)
3. [Architecture](#3-architecture)
4. [End-to-End Data Flow](#4-end-to-end-data-flow)
5. [Nostr / Protocol Architecture](#5-nostr--protocol-architecture)
6. [AI Agent / ACP Architecture](#6-ai-agent--acp-architecture)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Rust / Tauri Architecture](#8-rust--tauri-architecture)
9. [Backend Architecture](#9-backend-architecture)
10. [Database / Storage](#10-database--storage)
11. [Authentication and Security](#11-authentication-and-security)
12. [Configuration](#12-configuration)
13. [Build / Run / Deployment](#13-build--run--deployment)
14. [Testing](#14-testing)
15. [Current Requirements](#15-current-requirements)
16. [Important Design Decisions](#16-important-design-decisions)
17. [Current State, Planned Work, and Unknowns](#17-current-state-planned-work-and-unknowns)
18. [Where Should I Start?](#18-where-should-i-start)
19. [Glossary](#19-glossary)
20. [Developer Quick Reference](#20-developer-quick-reference)

---

## 1. Project Overview

### 1.1 What is Buzz

- **[DOCS]** Buzz is described (`README.md:4,29`) as "a workspace where humans and agents build together, on a relay you own" — a self-hostable team communication workspace where humans and AI agents share the same "rooms" (channels, DMs, threads).
- **[DOCS]** A Buzz **community** is the tenant-visible workspace selected by the connecting host/URL. In the default self-hosted setup, one relay process serves exactly one community; a hosted operator can serve many communities behind many domains (`README.md:31-35`, `ARCHITECTURE.md:9-16`).
- **[CODE+DOCS]** Structurally, Buzz is a Nostr relay (NIP-01 wire protocol) plus a family of clients. Every message, reaction, workflow step, canvas update, huddle (voice) event, and git event is a signed Nostr event stored in one append-only log (`README.md:37`, `ARCHITECTURE.md:1-18`, confirmed by `crates/buzz-core/src/kind.rs` kind registry and `crates/buzz-relay`).
- **[DOCS]** Problem it aims to solve: replace the "seven tabs pretending to know about each other" (chat + issue tracker + forge/git host + bots + CI dashboards + release tooling + search index) with one substrate — one event log, one identity model — shared by humans and AI agents alike (`README.md:78-86`).
- **[DOCS]** Who/what uses Buzz: human team members via a desktop app (Tauri + React) or web client, and AI coding/ops agents (Goose, Codex, Claude Code, and others) via `buzz-cli` and the `buzz-acp` harness, each with their own Nostr keypair, channel memberships, and audit trail — "the same affordances as a human teammate, the same audit trail, a different keypair" (`README.md:41,47-52`).
- **[DOCS]** Company/license: built by Block, Inc., licensed Apache 2.0 (`README.md:287`, `ARCHITECTURE.md:17`, `LICENSE`).

#### Major capabilities

Per `README.md:100-107` ("Works today · Being wired up · Strong opinions, pending code" table) and cross-checked against `ARCHITECTURE.md` §6 (crate reference) and §9 (known limitations):

| Status | Capability | Cross-check |
|---|---|---|
| ✅ [DOCS] Works today | Relay, channels, threads, DMs, canvases, media, search, audit log | `crates/buzz-relay`, `buzz-db`, `buzz-search`, `buzz-audit`, `buzz-media` exist and are described in `ARCHITECTURE.md` §6 [CODE] |
| ✅ [DOCS] Works today | Desktop app (Tauri + React) | `desktop/` directory exists, `desktop/src-tauri`, `desktop/src` [CODE] |
| ✅ [DOCS] Works today | `buzz-cli` (agent-first, JSON in/out) + ACP harness (Goose, Codex, Claude Code) | `crates/buzz-cli`, `crates/buzz-acp` exist [CODE] |
| ✅ [DOCS] Works today | YAML workflows: message/reaction/schedule/webhook triggers | `crates/buzz-workflow`, confirmed trigger types in `ARCHITECTURE.md:541` [CODE+DOCS] |
| ✅ [DOCS] Works today | Git events (NIP-34: patches, repo announcements, status) + git hosting backend | `docs/git-on-object-storage.md`, git HTTP endpoints in `ARCHITECTURE.md:635-638` [DOCS], **git protocol details owned by another research pass — needs verification of NIP-34 specifics** |
| 🚧 [DOCS] Being wired up | Mobile clients (iOS + Android, Flutter) | `mobile/` directory exists with Flutter project files (`pubspec.yaml`, `android/`, `ios/`) [CODE] |
| 🚧 [DOCS] Being wired up | Workflow approval gates | `ARCHITECTURE.md:833` confirms: executor returns `Suspended` but engine marks these runs `Failed` — not wired end-to-end (tracked as "WF-08") [CODE-CONFIRMED GAP] |
| 🚧 [DOCS] Being wired up | Huddle (voice) lifecycle events | `ARCHITECTURE.md:569-580` — audio relay exists in `buzz-relay/src/audio/`; recording/per-track publishing not built [CODE+DOCS] |
| 💭 [DOCS] Strong opinion, pending code | Web-of-trust reputation across relays | Not found in code during this pass — [UNCLEAR, needs verification by other sections] |
| 💭 [DOCS] Strong opinion, pending code | Push notifications | `crates/buzz-push-gateway` exists (APNs gateway for NIP-PL) — appears partially implemented as infrastructure even though README lists push notifications under "pending"; **contradiction worth flagging** [CODE vs DOCS — needs verification by push/notifications-focused research] |
| 💭 [DOCS] Strong opinion, pending code | Culture features | No corresponding code found in this pass — [UNCLEAR] |

Also verified independently in code: known gaps documented in `ARCHITECTURE.md` §9 (`ARCHITECTURE.md:823-835`) — no sqlx offline query cache, no rate-limiting implementation (only a test stub `AlwaysAllowRateLimiter`), no dedicated typing REST endpoint, huddle recording/tracks not built, approval gates not wired end-to-end, `send_dm`/`set_channel_topic` workflow actions return `NotImplemented`. These are **[CODE-CONFIRMED]** current limitations, not assumptions.

#### Important architectural concepts (confirmed by code + docs)

- **Kind-based dispatch**: every event has an integer `kind`; the relay's only routing/dispatch switch is this kind number (`ARCHITECTURE.md:103-144`). New features are added as new kind constants in `crates/buzz-core/src/kind.rs` without breaking existing clients. **[CODE+DOCS]**
- **Relay-as-source-of-truth**: no peer-to-peer event exchange or gossip; all reads/writes flow through `buzz-relay` (`ARCHITECTURE.md:7`). **[DOCS, structurally consistent with crate dependency graph in Cargo.toml]**
- **Agents-as-members**: agents authenticate with their own Nostr keypair and are added to channels the same way a human is, rather than being modeled as bots with elevated/special permission flags (`README.md:41,48`). **[DOCS — permission-model specifics belong to the ACP/agent-architecture section]**

### 1.2 Confirmed vs. documented vs. unclear — summary

- **(A) Directly confirmed by source code in this pass:** repository is a Cargo workspace of 30 Rust crates + 1 example crate (`Cargo.toml:2-35`) plus 3 pnpm-workspace JS/TS packages (`desktop`, `web`, `admin-web` — `pnpm-workspace.yaml:1-4`) plus a Flutter app (`mobile/`); SQL migrations exist and are numbered sequentially (`migrations/0001_initial_schema.sql` … at least through `0030_...`); Docker Compose, Dockerfiles, and a Helm chart exist for deployment.
- **(B) Described in existing project documentation:** the product narrative, "works today / being wired up / pending" capability matrix, and the high-level architecture diagram all come from `README.md` and `ARCHITECTURE.md`, which are unusually detailed, current-dated engineering docs already living in the repo (not something this research invented).
- **(C) Unclear / needs verification by later sections:** exact current implementation state of git hosting (NIP-34), push notifications (code exists in `buzz-push-gateway` despite being listed as "pending" in README), web-of-trust, and "culture features." Flagged above for other sections/forks to confirm or refute with deeper code reads.

---

## 2. Complete Repository Structure

### 2.1 Directory tree (curated — omits vendor/build/lockfile noise)

```
buzz/
├── AGENTS.md                 # [DOCS] AI-agent contributor guide (how AI coding agents should work in this repo)
├── ARCHITECTURE.md           # [DOCS] Authoritative, detailed system architecture reference (primary source for this doc)
├── README.md                 # [DOCS] Product overview, quick start, high-level architecture diagram
├── CONTRIBUTING.md           # [DOCS] Human contributor guide (setup, code style, PR process)
├── TESTING.md                # [DOCS] Multi-agent E2E test suite guide
├── RELEASING.md              # [DOCS] Desktop/mobile/relay release process
├── SECURITY.md, GOVERNANCE.md, CODE_OF_CONDUCT.md, LICENSE, CHANGELOG.md
├── VISION.md, VISION_ACTIVITY.md, VISION_AGENT.md, VISION_MESH.md,
│   VISION_MODERATION.md, VISION_PROJECTS.md, VISION_REMOTE_AGENTS.md,
│   VISION_SOVEREIGN.md        # [DOCS] Forward-looking product vision — NOT current-state documentation
├── NOSTR.md                   # [DOCS] Nostr protocol usage reference
├── Cargo.toml / Cargo.lock    # [CODE/CONFIG] Rust workspace manifest (30 crates + 1 example, see §2.3)
├── package.json / pnpm-workspace.yaml / pnpm-lock.yaml  # [CONFIG] JS/TS workspace (desktop, web, admin-web)
├── Justfile                    # [TOOLING] `just <task>` command runner — primary dev-workflow entry point
├── lefthook.yml                 # [TOOLING] Git hooks config (pre-commit auto-fix/format)
├── deny.toml, biome.json, rust-toolchain.toml, .cargo/config.toml  # [CONFIG] lint/format/toolchain pinning
├── docker-compose.yml           # [CONFIG] Local dev stack (Postgres, Redis, MinIO, Adminer, Prometheus)
├── docker-compose.harness.yml   # [CONFIG] Test-harness compose variant
├── Dockerfile, Dockerfile.push-gateway, Dockerfile.sprig  # [CONFIG] Container build definitions
├── .dockerignore, .gitignore, .gitattributes
├── .env.example                  # [CONFIG] Full environment-variable reference/template (17.8 KB)
├── prometheus.yml                # [CONFIG] Metrics scrape config for local Prometheus
├── ct.yaml                       # [CONFIG] chart-testing config for the Helm chart
├── preview-features.json         # [CONFIG] Feature-flag/preview list — needs verification of consumer(s)
├── renovate.json                 # [TOOLING] Dependency-update bot config
│
├── crates/                    # [CODE] Rust workspace — 30 crates, see §2.3 for full map
│   ├── buzz-relay/            # Relay server (Axum WS + REST) — the runtime core
│   ├── buzz-core/             # Zero-I/O shared types, kind registry, verification
│   ├── buzz-db/               # Postgres access layer
│   ├── buzz-auth/             # NIP-42/NIP-98 auth, scopes
│   ├── buzz-pubsub/           # Redis pub/sub, presence, typing
│   ├── buzz-search/           # Postgres FTS
│   ├── buzz-audit/            # Hash-chain audit log
│   ├── buzz-workflow/         # YAML automation engine
│   ├── buzz-media/            # Blossom/S3 media
│   ├── buzz-acp/              # ACP harness bridging relay ↔ AI agents (Goose/Codex/Claude Code)
│   ├── buzz-agent/            # Minimal built-in ACP-compliant agent
│   ├── buzz-persona/          # Agent persona pack loader
│   ├── buzz-dev-mcp/          # Developer MCP server (shell + file-edit tools for agents)
│   ├── sprig/                 # All-in-one bundle of ACP harness + agent + dev MCP
│   ├── buzz-cli/               # Agent-first CLI, JSON in/out
│   ├── buzz-admin/             # Operator CLI (membership, key generation)
│   ├── buzz-sdk/               # Typed Nostr event builders
│   ├── buzz-ws-client/         # Shared NIP-42 WebSocket client library
│   ├── buzz-test-client/       # Integration test harness + manual test CLI
│   ├── buzz-pair-relay/        # Ephemeral sidecar relay for device pairing (NIP-AB)
│   ├── buzz-pairing-cli/       # CLI for device-pairing interop testing
│   ├── git-sign-nostr/         # NIP-GS: sign git commits/tags with a Nostr key
│   ├── git-credential-nostr/   # Git credential helper producing NIP-98 auth headers
│   ├── buzz-relay-mesh/        # Inter-relay QUIC mesh (transport + membership)
│   ├── buzz-push-gateway/      # APNs push gateway (NIP-PL) for mobile
│   ├── buzz-deletion/          # Whole-community deletion engine
│   ├── buzz-conformance/       # TLA+ trace schema + replay checker for relay spec
│   ├── buzz-backend-kubernetes/# Kubernetes backend provider for remote agents
│   ├── buzz-datastore-tracing/ # Privacy-preserving datastore tracing/instrumentation macros
│   ├── buzz-voice/             # Reusable local voice (audio) primitives
│   └── ifc-core/                # Generic information-flow-control primitives (protocol-agnostic)
│
├── desktop/                   # [CODE] Tauri 2 + React 19 desktop client (primary human client)
│   ├── src/                   # React/TypeScript frontend
│   ├── src-tauri/              # Rust Tauri shell (native IPC, commands, packaging)
│   ├── tests/                  # Playwright test suites (`playwright*.config.ts` — live, perf, release-smoke variants)
│   └── package.json, vite.config.ts, tailwind.config.js, biome.json
│
├── web/                       # [CODE] Browser web client (repo browser; served by the relay per AGENTS.md)
├── admin-web/                 # [CODE] Admin web UI (separate pnpm package)
├── mobile/                    # [CODE] Flutter mobile app (iOS + Android) — 🚧 per README capability matrix
│   ├── lib/, android/, ios/, test/, scripts/
│   └── HUDDLES.md              # [DOCS] Mobile-specific voice/huddle notes
│
├── migrations/                 # [CODE/CONFIG] Sequential SQL migrations, auto-applied on relay startup (AGENTS.md:89)
├── schema/schema.sql            # [CODE] Consolidated/current DB schema snapshot
│
├── deploy/                    # [CONFIG] Production deployment assets
│   ├── charts/buzz/            # Helm chart (templates, values.schema.json, tests) — primary production deploy path
│   ├── charts/buzz-push-gateway/  # Helm chart for the push gateway
│   ├── compose/                # Single-node/VPS docker-compose bundle (Postgres, Redis, MinIO, Caddy/TLS)
│   └── local/                  # Local deployment variant — needs verification
│
├── docs/                      # [DOCS] Deep-dive design docs (see §2.4) — the destination dir for this deliverable
├── spec/requirements.md        # NOT repository documentation — this is the user's own task brief for the current
│                                 documentation exercise, saved into the repo; excluded from architecture claims.
│
├── examples/                   # [CODE] Example/reference integrations
│   ├── countdown-bot/           # Small non-AI bot example (listens to one channel, algorithmic)
│   └── meadow-core/              # needs verification — not inspected in this pass
│
├── benchmarks/                  # [TOOLING] Perf/benchmark harnesses: buzz-dataset, harbor-buzz-orchestra
├── perf/                        # [TOOLING] Relay bus scaling perf scripts + design note (RELAY_BUS_SCALING.md)
├── patches/                     # [CONFIG] pnpm patch files (isomorphic-git, virtua) applied via pnpm-workspace.yaml
├── test-fixtures/                # [TEST] Shared fixture data (e.g. entity-links.json)
├── scripts/                      # [TOOLING] Dev/CI/release helper scripts (bash/python/node/jq) — see notable ones below
├── script/start                  # [TOOLING] Entry-point start script — needs verification of exact usage
├── bin/                          # [TOOLING] Hermit-managed pinned toolchain shims (cargo, node, pnpm, rustc, flutter, dart,
│                                    clippy, cmake, actionlint, etc.) — not hand-maintained binaries, downloaded by Hermit
├── .github/                      # [CONFIG/TOOLING] CI workflows, issue/PR templates, CODEOWNERS, CI helper scripts
├── .config/nextest.toml           # [CONFIG] cargo-nextest test runner config
├── .cargo/config.toml             # [CONFIG] Cargo build profile / env tuning (see note below)
├── .vscode/settings.json          # [CONFIG] Editor settings
├── .agents/skills/, .claude/skills/, .codex/skills/, .goose/skills/
│                                  # [TOOLING] Per-AI-tool "skill" definition files (desktop-screenshot, sprout-cli) —
│                                    duplicated across four AI-agent tool directories, one skill set
├── .intersect/sadscan.yaml        # [CONFIG] Secret/PII scanner exclusion rules (e.g. Cargo.lock checksums, test PEM fixtures)
├── .release/desktop-candidate.json # [CONFIG/STATE] Release-candidate tracking metadata
```

Note: the directory tree above omits `Cargo.lock`, `pnpm-lock.yaml`, `node_modules`, build output directories, and per-crate `target/` — these are generated/vendor artifacts, not architecture.

### 2.2 Top-level directory table

| Path | Contents | Purpose | Type | Notes / Depends-on |
|---|---|---|---|---|
| `crates/` | 30 Rust crates | Entire backend, agent-harness, CLI, and protocol-utility codebase | Runtime code | Cargo workspace root is `Cargo.toml` [CODE] |
| `desktop/` | Tauri 2 + React 19 app | Primary human client (macOS/Linux/Windows) | Runtime code | pnpm workspace member; excluded from Cargo workspace (`Cargo.toml:36` `exclude = ["desktop/src-tauri"]`) — built separately [CODE] |
| `web/` | Browser web client | "Repo browser, served by the relay" per `AGENTS.md:87` | Runtime code | pnpm workspace member [DOCS+CODE] |
| `admin-web/` | Admin web UI | Separate operator-facing web app | Runtime code | pnpm workspace member; scope/purpose beyond name **needs verification** by frontend-focused research |
| `mobile/` | Flutter app | iOS/Android client | Runtime code, 🚧 in-progress per README | Not part of pnpm or Cargo workspace; own `pubspec.yaml` toolchain [CODE] |
| `migrations/` | Numbered `.sql` files | Postgres schema evolution, auto-applied at relay startup | Runtime/DB config | Consumed by `buzz-db` / relay startup (`AGENTS.md:89`) [DOCS] |
| `schema/schema.sql` | Full schema dump | Current consolidated schema reference | Reference/tooling | Likely generated from migrations — **needs verification of generation mechanism** |
| `deploy/` | Helm charts + Compose bundles | Production/staging deployment definitions | Deployment config | `deploy/charts/buzz` is the Helm chart referenced for Kubernetes deploys; `deploy/compose/` is the documented single-node/VPS path (`README.md:178`) [DOCS+CODE] |
| `docs/` | ~25 top-level docs + `admin/`, `nips/`, `spec/`, `formal/`, `assets/` subfolders | Deep-dive design/spec docs for specific subsystems (agent lifecycle, multi-tenant relay, NIPs, formal TLA+/Tamarin specs) | Documentation | See §2.4 below; **this is where the requested deliverable file must be created** |
| `spec/` | `requirements.md` | The user's own task instructions for this documentation exercise, saved as a file | Not project documentation | Excluded from architectural claims; newer file timestamp than the rest of the repo confirms it's session-local, not shipped repo content |
| `scripts/` | Dozens of `.sh`/`.py`/`.mjs`/`.jq` scripts | Dev workflow, CI checks, release automation, DB backfills | Tooling | Invoked by `Justfile` targets and `.github/workflows/*` — **individual script purposes need verification by build/deploy-focused research** |
| `script/start` | Single start script | Entry point — likely used by a specific deploy target | Tooling | **Needs verification** |
| `bin/` | Hermit toolchain shims | Pinned versions of cargo, rustc, node, pnpm, flutter, dart, clippy, cmake, biome, lefthook, actionlint, etc. | Tooling (not hand-written) | Activated via `. ./bin/activate-hermit` (`README.md:162,170`, `AGENTS.md:99`) [DOCS] |
| `test-fixtures/` | Shared JSON fixtures | Cross-crate/test fixture data | Testing | Referenced by tests — **specific consumers need verification** |
| `patches/` | pnpm patch files | Patches applied to `isomorphic-git` and `virtua` npm deps | Config (dependency patching) | Applied via `pnpm-workspace.yaml:21-23` `patchedDependencies` [CODE-CONFIRMED] |
| `benchmarks/` | `buzz-dataset`, `harbor-buzz-orchestra` | Performance benchmarking harnesses | Tooling | Not inspected deeply in this pass — **needs verification** |
| `perf/` | Relay bus scaling scripts + design doc | Performance analysis of the relay's internal event bus | Tooling/docs | `perf/RELAY_BUS_SCALING.md` is a design note; `.py` files appear to be simulation/test scripts [DOCS, partially CODE] |
| `examples/` | `countdown-bot/`, `meadow-core/` | Reference/example integrations against the Buzz relay | Runtime code (example) | `countdown-bot` is a Cargo workspace member (`Cargo.toml:34`); described as "a tiny non-AI Buzz bot example" (`examples/countdown-bot/README.md`) [CODE+DOCS]. `meadow-core` **needs verification**. |
| `.github/` | CI workflows, CODEOWNERS, issue/PR templates, CI scripts | GitHub Actions CI/CD definitions | Tooling/CI config | Numerous `_ci-*.yml` reusable workflows plus top-level `ci.yml`, `release.yml`, `docker.yml`, `helm-chart.yml`, etc. per the earlier `git status` listing [CODE-CONFIRMED filenames] |
| `.config/nextest.toml` | cargo-nextest config | Rust test runner configuration | Test tooling | Used by `just test`/CI Rust test invocations — **exact settings need verification** |
| `.cargo/config.toml` | Cargo build profile + env | Faster local dev builds (`debug = "line-tables-only"`), CMake policy workaround for a vendored dependency (`audiopus_sys`) | Build config | [CODE-CONFIRMED, comments explain the "why"] |
| `.agents/skills/`, `.claude/skills/`, `.codex/skills/`, `.goose/skills/` | `desktop-screenshot/SKILL.md`, `sprout-cli/SKILL.md` (duplicated per tool) | Tool-specific "skill" definitions so different AI coding agents (Claude, Codex, Goose) can drive the desktop app / sprout CLI | Tooling (agent-facing, meta) | Same two skills duplicated across 4 directories — one per supported AI coding-agent tool; not part of Buzz's own runtime agent system (see §7 for that) [CODE-CONFIRMED by filenames] |
| `.intersect/sadscan.yaml` | Secret-scanner exclusion rules | CI/security scanning config (excludes Cargo.lock checksums and self-signed test PEM fixtures from PII/secret detection) | Security tooling config | [CODE-CONFIRMED, comments self-explanatory] |
| `.release/desktop-candidate.json` | Release-candidate tracking state | Desktop release pipeline metadata | Release tooling/state | **Exact producer/consumer needs verification** — likely written by `.github/workflows/desktop-release-candidate.yml` |
| `.vscode/settings.json` | Editor config | Shared VS Code workspace settings | Tooling | Low architectural relevance |

### 2.3 Rust workspace crate map (30 members + 1 example)

Grouped by role, one-line purpose sourced from each crate's `Cargo.toml` `description` field and top `//!` doc comment (all **[CODE-CONFIRMED]**, file paths given):

**Core protocol / relay runtime**
| Crate | Purpose (source) |
|---|---|
| `buzz-relay` | "WebSocket relay server for the Buzz communications platform" — the NIP-01 relay; main server entry point (`crates/buzz-relay/Cargo.toml`, `src/main.rs`) |
| `buzz-core` | "Core types, event verification, and filter matching for Buzz" — zero-I/O foundation; explicitly forbids tokio/sqlx/redis/axum as deps (`crates/buzz-core/src/lib.rs`) |
| `ifc-core` | "Generic reader-set information-flow control primitives" — protocol-agnostic, knows nothing about Buzz/Nostr (`crates/ifc-core/src/lib.rs`) |

**Data/service layer (imported directly by buzz-relay)**
| Crate | Purpose |
|---|---|
| `buzz-db` | Postgres event store and data access layer |
| `buzz-auth` | Authentication and authorization (NIP-42/NIP-98) |
| `buzz-pubsub` | Redis pub/sub fan-out, presence, typing indicators |
| `buzz-search` | "Postgres full-text search for Buzz, scoped by community" |
| `buzz-audit` | "Hash-chain audit log for Buzz" — per-community, tamper-evident |
| `buzz-workflow` | "YAML-as-code workflow engine for Buzz" |
| `buzz-media` | Media storage, validation, thumbnail generation (library only — Axum handlers live in `buzz-relay`) |
| `buzz-deletion` | "Durable whole-community deletion engine for Buzz" |
| `buzz-datastore-tracing` | "Privacy-preserving datastore tracing policy macros for Buzz" |

**Agent / AI surface** (deep-dived by a dedicated section of this document; listed here only for the structure map)
| Crate | Purpose |
|---|---|
| `buzz-acp` | "ACP harness that bridges Buzz events to AI agents" |
| `buzz-agent` | "Minimal, unbreakable ACP-compliant agent. Non-streaming. Tool-calls-as-output." |
| `buzz-persona` | "Parser and loader for Buzz persona pack files (.persona.md)" |
| `buzz-dev-mcp` | Developer MCP server — shell + file-edit tools (per `AGENTS.md:70`; crate's own `description` field not captured in this pass) |
| `sprig` | "All-in-one Buzz ACP harness, agent, and developer MCP" — bundles the three above |

**CLI / operator tooling**
| Crate | Purpose |
|---|---|
| `buzz-cli` | "Agent-first CLI for Buzz relay" |
| `buzz-admin` | "Operator CLI for Buzz relay administration" — member management (NIP-43) |
| `buzz-sdk` | "Typed Nostr event builders for Buzz operations" |
| `buzz-ws-client` | Shared NIP-42 WebSocket client (connect, auth, publish) per `AGENTS.md:82`; own description not captured |
| `buzz-test-client` | "Integration test client and E2E test suite for Buzz" |

**Git / pairing interop**
| Crate | Purpose |
|---|---|
| `git-sign-nostr` | "NIP-GS git commit/tag signing program using Nostr secp256k1 keys" |
| `git-credential-nostr` | "Git credential helper that produces NIP-98 auth headers for Buzz's git server" |
| `buzz-pair-relay` | "Ephemeral sidecar relay for NIP-AB device pairing handshakes" |
| `buzz-pairing-cli` | "CLI tool for NIP-AB device pairing interop testing" |

**Infrastructure / mesh / mobile-adjacent**
| Crate | Purpose |
|---|---|
| `buzz-relay-mesh` | "Inter-relay QUIC mesh: transport, membership, and the fenced wire contract" — one iroh endpoint per relay runtime |
| `buzz-push-gateway` | "Blind, capability-gated NIP-PL gateway for the Buzz mobile app" — stateful APNs last hop |
| `buzz-backend-kubernetes` | "Kubernetes backend provider for Buzz remote agents" (see `docs/remote-agents.md`) |
| `buzz-voice` | "Reusable local voice primitives for Buzz" |
| `buzz-conformance` | "Runtime trace schema + independent replay checker for MultiTenantRelay.tla" — ties to `docs/spec/MultiTenantRelay.tla` |

**Example**
| Crate | Purpose |
|---|---|
| `examples/countdown-bot` | Cargo workspace member (`Cargo.toml:34`); "a tiny non-AI Buzz bot example" — deliberately boring/algorithmic, listens to one channel |

Cross-reference: `AGENTS.md:56-92` gives the repo's own hand-maintained structural map, grouped identically (relay+core / agent surface / clients+interop / tooling+shared), and matches the Cargo workspace members with the exception of the crates it omits (`ifc-core`, `buzz-conformance`, `buzz-push-gateway`, `buzz-deletion`, `buzz-relay-mesh`, `buzz-backend-kubernetes`, `buzz-datastore-tracing`, `buzz-voice`) — those were confirmed independently by reading each crate's `Cargo.toml`/`lib.rs` in this pass. **[CODE-CONFIRMED discrepancy between AGENTS.md's illustrative list and the actual workspace member list — AGENTS.md is not exhaustive.]**

### 2.4 `docs/` inventory (existing repo documentation, not part of this deliverable's source material to rewrite — for cross-referencing)

Top-level `docs/*.md` (22 files), by first heading:
- `agent-availability.md` — Agent availability and lifecycle
- `agent-management-provenance.md` — Agent management provenance
- `agent-profile-identity.md` — Agent profile identity
- `bridge-channel-window.md` — Bridge `/query` extension: channel window
- `buzz-entity-links.md` — Buzz entity links
- `buzz-shared-compute-dev.md` — Buzz shared compute: local GUI verification
- `deployment-identity.md` — Relay deployment identity
- `forum-agent-invitation.md` — Standalone forum agent invitation
- `gif-search.md` — Relay-proxied GIF search
- `git-on-object-storage.md` — Git refs over object storage: a formal specification
- `linux-rendering-troubleshooting.md` — Linux rendering troubleshooting
- `MCP_DRIVEN_HOOKS.md` — MCP-driven lifecycle hooks
- `mention-editor.md` — Mention editor contract
- `multi-tenant-conformance.md` — Multi-tenant conformance checklist
- `multi-tenant-relay.md` — Multi-tenant Buzz relay: a formal specification
- `owned-agent-discovery.md` — Authenticated owned-agent discovery
- `practical-information-flow-for-buzz-agents.md` — Practical information-flow for Buzz agents
- `push-gateway-deployment.md` — Buzz push gateway deployment
- `remote-agents.md` — Remote agents and their management: a formal specification
- `remote-mention-routing.md` — Remote mention preparation and publication
- `staging-dev-relay-images.md` — Staging dev relay images
- `welcome-kickoff-silent-failures.md` — Welcome kickoff — failure paths

Subfolders:
- `docs/admin/README.md` — admin documentation (not deep-read in this pass)
- `docs/nips/` — 18 files: Buzz-specific/extension NIPs (`NIP-AA`, `NIP-AE`, `NIP-AM`, `NIP-AO`, `NIP-AP`, `NIP-CW`, `NIP-DV`, `NIP-ER`, `NIP-FI`, `NIP-GS`, `NIP-IA`, `NIP-MP` + fixture JSONs, `NIP-OA`, `NIP-PL`, `NIP-PMA`, `NIP-RS`, `NIP-WP`) — these are Buzz's own proposed/implemented NIP extensions beyond standard Nostr NIPs; **full contents to be verified by the Nostr-protocol-focused research pass**
- `docs/spec/` — formal specifications: `GitOnObjectStore.tla`/`.cfg`, `MultiTenantAuth.spthy` (Tamarin), `MultiTenantRelay.tla`/`.cfg`
- `docs/formal/` — `nip-pl/`, `nip-rs-unread/`, `STATEFUL_GATEWAY.md`
- `docs/assets/` — `screenshots/`, plus `sprout.png`, `sprout-icon.png` (branding — "Sprout" appears to be a related/legacy internal name, per `Cargo.toml:44` `repository = "https://github.com/block/sprout"` — **needs verification of Buzz/Sprout naming relationship**)

This `docs/` tree is extensive existing **[DOCS]** material. The requested deliverable (`docs/BUZZ_PROJECT_ARCHITECTURE_AND_REQUIREMENTS.md`) should sit alongside these as a single consolidated onboarding document, and should point readers to the relevant deep-dive doc above rather than duplicating their full content.

## 3. Architecture

This section gives the high-level, cross-cutting system picture. Deep detail on each component lives in its own numbered section later in this document (§5–§10).

### 3.1 System diagram (components that actually exist in this repository)

```
                         ┌─────────────────────────────────────────┐
                         │              buzz-relay                 │
                         │   (crates/buzz-relay — Rust/Axum)        │
                         │  Nostr relay (NIP-01/29/42/44/17/98/…)  │
                         │  + HTTP API + Git-over-HTTP + media host │
                         └───────────────┬───────────────────────────┘
                                          │
        ┌──────────────┬──────────────────┼──────────────────┬──────────────┐
        │              │                  │                  │              │
        ▼              ▼                  ▼                  ▼              ▼
   PostgreSQL        Redis          S3/MinIO object      buzz-push-      Other buzz-relay
   (buzz-db,         (buzz-pubsub:  storage (media +      gateway        pods (Redis pub/sub
   sqlx, monthly-    fan-out,       git CAS, via           (APNs, NIP-PL) fan-out; optional
   partitioned       presence,      buzz-media)                           QUIC "mesh" via
   `events` table)   rate limit)                                          buzz-relay-mesh)

        ▲  NIP-01 WebSocket (events) + REST (bridge/HTTP API)      ▲ same protocol
        │  NIP-42 (WS AUTH) / NIP-98 (HTTP AUTH)                    │
        │                                                            │
 ┌──────┴─────────────┐   ┌────────────────────┐   ┌────────────────┴──────┐   ┌──────────────┐
 │  Desktop client     │   │  Web client (web/)  │   │  Mobile client         │   │  buzz-acp     │
 │  (desktop/, Tauri 2 │   │  invite-accept +    │   │  (mobile/, Flutter)    │   │  ("harness")  │
 │  + React 19)        │   │  read-only git view  │   │  full chat/huddle/     │   │  bridges relay│
 │  primary human      │   │                     │   │  agent client          │   │  events to an │
 │  client             │   │                     │   │                       │   │  AI agent      │
 └──────┬──────────────┘   └─────────────────────┘   └───────────────────────┘   │  subprocess    │
        │ spawns as OS child processes (env-var config, stdio)                    └──────┬────────┘
        ▼                                                                                 │ ACP JSON-RPC/stdio
 ┌───────────────────────────────────────────────────────────────────────────┐            ▼
 │ Sidecar binaries: buzz-acp, buzz-agent, buzz-backend-kubernetes,          │   ┌──────────────────┐
 │ buzz-dev-mcp, git-credential-nostr, buzz (CLI)                            │   │ Agent subprocess  │
 └───────────────────────────────────────────────────────────────────────────┘   │ (Goose / buzz-agent│
                                                                                    │ / Codex / Claude   │
                                                                                    │ Code / Pi)         │
                                                                                    └──────┬─────────────┘
                                                                                            │ stdio MCP
                                                                                            ▼
                                                                                    ┌──────────────────┐
                                                                                    │ MCP server(s),    │
                                                                                    │ e.g. buzz-dev-mcp │
                                                                                    │ (shell/file tools)│
                                                                                    └──────────────────┘
```

**[CODE]** Every arrow above was verified against source in a dedicated research pass — see §5–§10 for file-level citations. Nothing on this diagram is inferred from naming alone.

**admin-web/** is a separate React SPA served by `buzz-relay` at a distinct `BUZZ_ADMIN_HOST`, talking REST-only to `/api/admin/v1` — omitted from the main diagram above for clarity but documented in §7.2 and §9.2.

### 3.2 Component summary table

| Component | Responsibility | Technology | Key files | Talks to |
|---|---|---|---|---|
| `buzz-relay` | Nostr relay + HTTP API + git host + media host + background workers; the single source of truth | Rust, Tokio, Axum, sqlx | `crates/buzz-relay/src/main.rs`, `router.rs`, `connection.rs` | Postgres, Redis, S3/MinIO, push gateway, other relay pods, all clients |
| `buzz-core` | Zero-I/O shared types: event/filter/kind definitions, verification | Rust (no tokio/sqlx/redis/axum deps, by design) | `crates/buzz-core/src/kind.rs`, `verification.rs` | Everything else in the workspace (foundation) |
| `buzz-db` | Postgres connection pooling + migrations + all domain SQL | Rust, sqlx | `crates/buzz-db/src/runtime/*`, `store/*` | PostgreSQL |
| `buzz-auth` | NIP-42/NIP-98 verification, rate limiting, scopes, federated identity (NIP-FI) | Rust | `crates/buzz-auth/src/nip42.rs`, `nip98.rs` | Called in-process by `buzz-relay` |
| `buzz-pubsub` | Cross-pod event fan-out, presence, typing, replay guard | Rust, `deadpool-redis` | `crates/buzz-pubsub/src/lib.rs` | Redis |
| `buzz-acp` | ACP "harness" bridging relay events to an AI agent subprocess; holds the agent's Nostr key | Rust | `crates/buzz-acp/src/acp.rs`, `relay.rs`, `pool.rs`, `queue.rs` | `buzz-relay` (NIP-01 WS/REST), agent subprocess (stdio/JSON-RPC) |
| `buzz-agent` | Minimal hand-rolled ACP-compliant agent: LLM tool-call loop | Rust | `crates/buzz-agent/src/main.rs`, `agent.rs`, `llm.rs` | `buzz-acp` (stdio), LLM providers (HTTP), MCP servers (stdio) |
| Desktop client | Primary human client; also the process supervisor for locally-run agents | Tauri 2 + React 19 | `desktop/src-tauri/src/lib.rs`, `desktop/src/app` | `buzz-relay` (WS, via `buzz-ws-client`), sidecar binaries (OS processes) |
| Web client (`web/`) | Invite acceptance + read-only in-browser git repo viewer | React 19 + Vite | `web/src/app/routes` | `buzz-relay` REST API, in-browser via `isomorphic-git` |
| Admin web (`admin-web/`) | Moderation/ops console | React 19 + Vite | `admin-web/src/App.tsx`, `api.ts` | `buzz-relay` `/api/admin/v1` REST API |
| Mobile (`mobile/`) | Full-featured chat/huddle/agent client for iOS/Android | Flutter/Dart, Riverpod | `mobile/lib/features/*` | `buzz-relay` over WebSocket (own Dart Nostr implementation) |
| `buzz-workflow` | Server-side YAML automation engine (event/cron/webhook triggers) | Rust | `crates/buzz-workflow/src/lib.rs` | Runs inside `buzz-relay`'s `AppState` |
| `buzz-search` | Postgres full-text search over the `events` table | Rust | `crates/buzz-search` | PostgreSQL (via the `events.search_tsv` column) |
| `buzz-media` | Media blob storage/validation | Rust | `crates/buzz-media` | S3/MinIO |
| `buzz-audit` | Tamper-evident, per-community audit log | Rust | `crates/buzz-audit` | Its own small Postgres pool |
| `buzz-push-gateway` | Separate service delivering mobile push (APNs) per NIP-PL leases | Rust | `crates/buzz-push-gateway` | `buzz-relay` (push matcher), APNs |
| `buzz-relay-mesh` | Optional inter-relay QUIC-like mesh (off by default) | Rust | `crates/buzz-relay-mesh` | Other relay pods directly (not via Redis) |
| `buzz-backend-kubernetes` | Server-side provider that deploys remote/hosted agent workloads on Kubernetes | Rust | `crates/buzz-backend-kubernetes` | Kubernetes API |
| PostgreSQL | Canonical durable store for every non-ephemeral event and all domain tables | Postgres 17 | `schema/schema.sql`, `migrations/*.sql` | `buzz-db` |
| Redis | Cross-pod fan-out, presence, rate limiting, replay-guard cache | Redis 7 | — | `buzz-pubsub` |
| S3/MinIO | Object storage for media blobs and git repository data (CAS) | S3-compatible | `crates/buzz-relay/src/api/git/store.rs` | `buzz-media`, git handlers |

### 3.3 What is *not* in this repository's architecture

To avoid inventing structure: there is **no** separate microservice mesh for chat features, **no** message queue (Kafka/RabbitMQ/etc. — Redis pub/sub fills that role), **no** GraphQL layer (REST + Nostr WS only), and **no** peer-to-peer event gossip between clients — every read/write goes through a `buzz-relay` process **[DOCS: `ARCHITECTURE.md`, cross-checked against the Cargo workspace dependency graph — CODE]**. The inter-relay "mesh" (`buzz-relay-mesh`) is relay-to-relay only, off by default, and used for huddle/audio and presence signaling between relay pods, not a general event-gossip fabric **[CODE, see §9.5]**.

## 4. End-to-End Data Flow

Each flow below is traced using the actual entry points and module names confirmed during research (§5–§10 have the full citations; this section cross-references rather than repeats them). Flows or steps that could not be directly verified are marked **[UNCLEAR]**.

### A. Application startup

**[CODE]** `buzz-relay`'s boot sequence (`crates/buzz-relay/src/main.rs::run_relay_main`, tracked by a `BootTracker`/`StartupPhase` state machine in `lifecycle.rs`) runs ~29 ordered phases: install crypto provider → structured logging → load config/keys → bind metrics → connect Postgres (+ optionally auto-migrate) → ensure event-table partitions → validate the deletion-serving catalog → bootstrap NIP-43 relay membership → connect Redis + start `PubSubManager` subscriber tasks → construct `AuthService`/`SearchService`/`WorkflowEngine`/`MediaStorage` → build `AppState` → optionally boot the inter-relay mesh → run a git-object-storage conformance probe → repair NIP-29 channel roster snapshots → wire the workflow engine's action sink → spawn ~11 background workers (§9.4) → build the router → bind listeners (app WS/HTTP, optional Unix socket, health, metrics) → serve until SIGTERM, then a staged graceful drain. Full detail in §9.1.

Client-side startup (desktop): **[CODE]** `desktop/src-tauri/src/lib.rs::run()` builds the Tauri app, registers plugins and managed state (`AppState`, pairing handle, native relay client, etc.), runs a `.setup()` boot sequence (which starts the local media-proxy and an orphaned-agent-process reaper), registers ~356 commands, then runs the event loop. See §8.2.

### B. User authentication / login

**[CODE]** Buzz has no separate username/password account system — identity **is** a Nostr keypair. On the desktop client, `get_identity`/`import_identity`/`sign_event` Tauri commands (`desktop/src-tauri/src/lib.rs:554-620`) are the only points where the private key is used; it is stored via `secret_store.rs` in the OS keychain (macOS Keychain / Windows Credential Store / Linux Secret Service) and never leaves Rust state. See §8.5, §11.

On the web client, `web/src/shared/lib/nostr-signer.ts` uses a NIP-07 browser extension (`window.nostr`) when present, or an ephemeral in-page keypair otherwise (durable actions require a real NIP-07 signer — see §7.1).

### C. Connecting to the backend / relay

**[CODE]** Sequence (`crates/buzz-relay/src/router.rs::nip11_or_ws_handler`, `connection.rs`):
1. Client opens an HTTP connection; the `Host` header is resolved to a `TenantContext` (community) via `tenant::bind_community` **before** any WebSocket frame is read — an unmapped host is a generic 404.
2. On upgrade, the connection is registered in a per-community registry; a NIP-42 `AUTH` challenge is sent immediately; the client has 5 seconds to respond or is dropped.
3. Once authenticated, three concurrent loops run per connection: receive (parse `ClientMessage`), send (batched outbound queue), heartbeat/control.

Desktop client side: `native_relay_client.rs` owns the authenticated socket, built on `buzz-ws-client` (shared NIP-42 handshake logic) — see §8.5.

### D. Sending a message

**[CODE, traced across forks]**
```
Desktop UI (compose box, desktop/src)
  → invoke("send_channel_message", {...})            [Tauri IPC, desktop/src-tauri/src/commands/messages.rs]
  → Rust signs a kind:9 ("stream message") event with the user's held private key
  → published over the authenticated WebSocket (native_relay_client.rs, buzz-ws-client)
  → buzz-relay: EVENT message → handlers/event.rs
      - validates signature (buzz_core::verify_event)
      - checks channel-scoped `#h` tag requirement, authz (channel_authz.rs)
      - persists to Postgres `events` table (buzz-db, partitioned by month)
      - triggers side effects (side_effects.rs): thread_metadata updates, search_tsv population
      - publishes to Redis (buzz-pubsub) on `buzz:{community}:channel:{id}` for cross-pod fan-out
  → local + remote WebSocket subscribers with a matching live REQ receive the EVENT frame
  → other clients' UI updates via their own subscription handling
```
The relay also replies `OK` on the originating connection per NIP-01. **[UNCLEAR]** the exact desktop-side reconciliation between the locally-optimistic UI state (if any) and the relay-confirmed event was not traced in this pass.

### E. Receiving a message

**[CODE]** A client's live NIP-01 `REQ` subscription (opened when a channel is viewed) is matched against every newly-persisted event by `buzz-relay`'s `handlers/req.rs` (live subscription registration) and the Redis fan-out subscriber (`buzz-pubsub::run_subscriber`, `handlers::event::fan_out_pubsub_event` for cross-pod delivery). Matching events are pushed as `EVENT` frames on the subscriber's WebSocket. Desktop-side receipt/UI update mechanics (React Query cache updates, virtualized list insertion) were not traced file-by-file in this pass — **[UNCLEAR]**, see `desktop/src/features` for the consuming code.

### F. Channel / community operations

**[DOCS+CODE]** A Buzz **channel** is implemented as a NIP-29 **group** (`NOSTR.md`, cross-checked against `crates/buzz-core/src/kind.rs`'s NIP-29 kind constants). Create/edit/delete/join/leave operations are kind:9007/9002/9008/9021/9022 events handled by the relay's NIP-29 admin-op handlers, which also maintain addressable "mirror" events (kind:39000-39002) reflecting current group metadata/admins/members. A relay currently serves exactly **one community per domain** in the default deployment; multi-tenant hosting (many communities behind many `Host` values on one relay process) is a supported, code-confirmed mode (§9, §10.1). See §5.7 for the full NIP-29 mapping.

### G. Direct messages

**[DOCS+CODE]** DMs use **NIP-17 gift wrap** (kind:1059), not NIP-04/bare NIP-44. A DM is wrapped in an ephemeral-key-signed envelope, stored community-globally, and delivered only to subscriptions whose `#p` filter matches the requesting user's own pubkey (`buzz-relay` rejects a global subscription without an exact `#p` match for `#p`-gated kinds — an anti-eavesdropping control enforced at the live fan-out layer, not just storage). DM content is explicitly excluded from full-text search indexing (`events.search_tsv`, see §10.2). See §5.4, §5.6.

### H. Invites

**[CODE — fully traced in §7.1]** Two paths exist: (1) the web client's browser invite-claim flow — `POST /api/invites/claim` with a NIP-98-signed request (requires a real NIP-07 signer, no ephemeral-key fallback, since it creates durable membership); (2) an in-app path from the desktop client (not independently retraced here — presumably the same `/api/invites/claim` endpoint via `native_relay_client`/HTTP, **[UNCLEAR]** exact desktop command). Invite minting (`POST /api/invites`) requires owner/admin NIP-98 auth. See §9.2's endpoint table.

### I. Reactions

**[DOCS]** NIP-25-style reactions (kind:7) are handled by relay ingest; per `NOSTR.md`, a reaction's channel is derived from its `#e` target event, not a client-supplied `#h` tag. A migration (`0028_long_reaction_payloads.sql`) indicates reaction content grew beyond a single emoji character at some point in the project's history. See §10.2 `reactions` table.

### J. Presence

**[CODE]** Presence (online/offline) and typing indicators are handled by `buzz-pubsub` (`presence.rs`) as **ephemeral** Redis-backed state (kind:20001 presence update, kind:20002 typing indicator per `crates/buzz-core/src/kind.rs`) — ephemeral-range events (kind 20000-29999) are explicitly **never persisted** to Postgres (`buzz-db` crate-doc invariant, §9.5/§10). The `buzz-acp` harness also publishes typing indicators on the agent's behalf while it is composing a reply (`crates/buzz-acp/src/relay.rs`, §6.6).

### K. AI-agent interaction / L. ACP communication

**[CODE — fully traced in §6]** Summary:
```
Human posts in a channel/DM
 → buzz-relay stores + fans out the event over the harness's live NIP-01 subscription
 → buzz-acp (harness) admits the event into a per-channel/per-thread queue, claims a pooled
   agent subprocess slot, and sends a `session/prompt` JSON-RPC request over stdio
 → agent subprocess (Goose / buzz-agent / Codex / Claude Code / Pi) calls its LLM provider
   and executes MCP tool calls (e.g. buzz-dev-mcp's shell tool)
 → the reply reaches other Buzz users because the agent's own tool call runs a
   `buzz messages send` CLI command, which publishes a new Nostr event signed with the
   harness's held private key — NOT by buzz-acp re-publishing the LLM's raw text
 → session/update notifications (chunks, tool calls, usage) stream back to buzz-acp over
   stdio for local observability only (crates/buzz-acp/src/observer.rs)
```
Full detail, including the documented permission-auto-approval finding, in §6.

### M. File / media handling

**[CODE]** Upload: `PUT /upload` or `/media/upload` (Blossom-style, NIP-98 auth expected — **[UNCLEAR]** not independently verified against handler code beyond route placement) → `buzz-media` validates and stores the blob in S3/MinIO, keyed by content hash. Fetch: `GET /media/{sha256_ext}`. On desktop, the app does not load media URLs directly in the webview; it proxies them through a local Rust-owned HTTP proxy (`media_proxy.rs`, exposed via the custom `buzz-media://` URI scheme) so authentication/tunnelling can be applied — see §8.5. Git repository data uses the same S3/MinIO-backed object storage as a content-addressable store (`docs/git-on-object-storage.md`, `crates/buzz-relay/src/api/git/store.rs` — **[UNCLEAR]** full git protocol flow not traced in this pass).

### N. Database operations

**[CODE — full detail in §10]** All writes go through `buzz-db`'s `store/*` modules (one file per domain area) using `sqlx::query()` (runtime-checked, not the compile-time `query!()` macro, per the crate's own documented convention). The `events` table is monthly-partitioned; migrations run under an exclusive Postgres advisory lock (`SCHEMA_DESTRUCTION_LOCK_KEY`) to serialize against concurrent community-deletion transactions, which take a shared counterpart lock. Every table/query is expected to be scoped by `community_id` — enforced in places by triggers (e.g. `channels_community_id_immutable()`) and by primary-key design (composite `(community_id, id)` keys).

### O. Error handling / reconnection

**[CODE]** Server side: fallible boot phases are classified **required** (abort startup) vs. **degraded** (log and continue) by the `BootTracker`/`LifecycleReason` system (§9.1, §9.6). Per-connection backpressure: a slow WebSocket client is force-disconnected after a configurable number of consecutive full-buffer send failures (`connection.rs`). Graceful shutdown: readiness flips to 503, a grace period elapses, then in-flight WebSockets are closed with `1012 Service Restart`, optionally staggered by `BUZZ_DRAIN_JITTER_MS` to avoid a reconnect thundering herd (§12 config table).

Redis fan-out reconnects automatically with exponential backoff (1s → 30s cap) on disconnect (`buzz-pubsub`, §9.5).

Agent-side (`buzz-acp`): a turn that exceeds `max_turn_duration` or hits a transport failure is marked dead; under **Queue** dedup mode the triggering event batch is requeued rather than dropped (`pool.rs::requeue_batch_if_queue`); the OS child process is cleaned up via `kill_on_drop(true)` + process-group isolation. Nothing inside `crates/buzz-acp` restarts the **harness process itself** if it exits — that is an external supervisor's responsibility (§6.12).

Desktop-side: a background sweep task reaps orphaned managed-agent OS processes left behind by a crashed prior app instance, every 60s with a grace period (`desktop/src-tauri/src/lib.rs:456-493`, §8.6).

## 5. Nostr / Protocol Architecture

Buzz is, at its core, **a Nostr relay** (`buzz-relay`) that implements NIP-29 (relay-based groups) as its native chat model, plus a large family of Buzz-authored draft NIPs for features standard Nostr does not cover (agents, push, workspace identity, etc.). [DOCS: `NOSTR.md`] [CODE: `crates/buzz-relay`]

### 5.1 Supported Protocols and Event Types

| Protocol/NIP | Purpose | Implementation location | Important event/message types | Notes/limitations |
|---|---|---|---|---|
| NIP-01 (basic protocol, event format, filters) | Base event/filter format, addressable/replaceable events | `crates/buzz-core/src/kind.rs`, `crates/buzz-core/src/filter.rs`, `crates/buzz-core/src/event.rs`; wraps the external `nostr` crate (`nostr = "0.44"`, `Cargo.toml:73`) | kind:0 (profile), kind:1 (text note), kind:3 (contacts), kind:5 (deletion), replaceable 10000-range, addressable 30000-range | [CODE] Foundational; nearly everything else builds on it. |
| NIP-29 (relay-based groups) | Buzz's native channel/community model | `crates/buzz-relay/src/handlers/*` (event/ingest handlers), `crates/buzz-core/src/kind.rs` (KIND_NIP29_*), documented in `NOSTR.md` | kind:9 (message), 9000-9008/9021/9022 (group admin ops), 39000-39003 (group metadata/admins/members/roles) | [DOCS+CODE] `NOSTR.md` states Buzz "is a Nostr relay that speaks NIP-29 natively"; per its own feature table, kind:39003 (group roles) is defined but **not emitted** by the relay, and kind:9009 (create invite) is accepted/stored but its side-effect handler is a no-op. |
| NIP-42 (client authentication to relays) | Proactive AUTH challenge/response | `crates/buzz-auth/src/nip42.rs` (`generate_challenge`, `verify_nip42_event`), wired in `crates/buzz-relay/src/handlers/auth.rs` and `crates/buzz-relay/src/connection.rs` | kind:22242 (`KIND_AUTH`) | [CODE] AUTH events are explicitly never stored/logged (may carry bearer tokens) per doc comment in `nip42.rs`. Challenge tolerance ±60s; relay URL normalized (localhost≈127.0.0.1). |
| NIP-44 (versioned encryption) | Symmetric conversation-key encryption for private payloads | Uses `nostr::nips::nip44` (external crate, feature-enabled in `Cargo.toml:73`). Call sites: `crates/buzz-core/src/engram.rs` (agent engrams), `crates/buzz-core/src/observer.rs` (agent observability frames), `crates/buzz-core/src/pairing/session.rs` (device pairing), `crates/buzz-core/src/private_managed_agent.rs`, `crates/buzz-relay/src/handlers/push_lease.rs` | kind:30174 (agent engram), kind:24200 (agent observer frame), kind:30350 (push lease), kind:30179 (private managed agent) | [CODE] NIP-44 is Buzz's general-purpose encryption primitive for agent memory, telemetry, push leases, and pairing — **not** used for standard NIP-04 DMs (Buzz does not implement NIP-04; see NIP-17 row). |
| NIP-17 (private DMs via gift wrap) | Direct messages | Handling referenced in `crates/buzz-relay/src/handlers/{event,ingest,req}.rs`, `push_runtime.rs`; `KIND_GIFT_WRAP = 1059` in `crates/buzz-core/src/kind.rs` | kind:1059 (gift wrap) | [DOCS: `NOSTR.md`] "✅" — accepted with ephemeral signing keys, stored community-globally, delivered via `#p`-filtered subscriptions, **not indexed in search**. NIP-04/NIP-44-direct DMs and kind:10050 (DM relay list) are explicitly **not implemented** ("deferred") per `NOSTR.md`'s "What Doesn't Work" table. |
| NIP-04 (legacy encrypted DM) | — | — | — | [DOCS] Explicitly **not implemented** — `NOSTR.md` states "NIP-04/NIP-44 not implemented" for DMs (Buzz uses NIP-17 gift wrap instead for DM transport; NIP-44 the *primitive* is used elsewhere, see above). |
| NIP-46 (remote signing / bunker) | Remote signer connection | `crates/buzz-core/src/pairing/types.rs` (`PayloadType::Bunker` — a pairing-payload variant holding a bunker connection string), `crates/buzz-pairing-cli/src/main.rs` | — (string payload, not a wire protocol implementation) | [CODE, limited] Buzz's device-pairing flow can carry an `nsec` or a NIP-46 `bunker://`/`nostrconnect://` string as one of several payload types over its own encrypted pairing channel. **No evidence found** of Buzz's relay or clients acting as a NIP-46 signer or remote-signer client themselves — only that a bunker string can be transported during pairing. [UNCLEAR] whether any Buzz client actually connects to a bunker as a signer. |
| NIP-11 (relay information document) | Relay metadata (name, description, icon, supported NIPs) | `crates/buzz-relay/src/nip11.rs` | `GET /` with `Accept: application/nostr+json` | [DOCS+CODE] Also serves the per-workspace icon set via kind:9033 (NIP-WP, custom). |
| NIP-50 (search) | Full-text search over events | Referenced in `NOSTR.md`; backing search crate `crates/buzz-search` | One-shot `{"search":"...", "kinds":[9], "#h":[...]}` REQ → results → EOSE | [DOCS] "Not registered as persistent subscriptions" — search is a one-shot query only, not live. |
| NIP-10 (thread replies) | Reply/threading tags | `crates/buzz-core/src/nip10.rs` | `["e", "<root>", "", "reply"]` tags | [DOCS+CODE] Threads create `thread_metadata` atomically; unknown parents are rejected. |
| NIP-09 (deletion) | Event deletion | kind:5 handling in relay ingest | kind:5 | [DOCS] Self-authored only; `#e` required, `#h` optional. Admin deletion of others' events uses the Buzz-custom kind:9005 instead. |
| NIP-25 (reactions) | Reactions | Relay ingest handlers | kind:7 | [DOCS] Channel is derived from the reaction's `#e` target event, not the client-supplied `#h`. |
| NIP-98 (HTTP auth) | Signed-event HTTP authentication | `nostr::nips::nip98` (external crate) used by `crates/git-credential-nostr/src/lib.rs` | kind:27235 (`KIND_HTTP_AUTH`) | [CODE] Used for the git credential helper (see 5.3) and referenced as a dependency by several custom NIPs (NIP-CW, NIP-FI, NIP-IA, NIP-WP). |
| NIP-05 (DNS identifier) | Human-readable identity verification | `crates/buzz-relay/src/api/nip05.rs`, sync logic referenced in `crates/buzz-db/src/store/user.rs` | profile kind:0 `nip05` field | [DOCS] `NOSTR.md`: NIP-05 handles must canonicalize to the relay's own domain; off-domain/invalid handles are silently cleared on profile sync; a handle collision (unique constraint) causes just that field to be skipped, other profile fields still sync. |
| NIP-43 (relay access metadata / membership) — **not an official upstream NIP; Buzz-coined identifier reusing the "NIP-43" number for its own relay-membership extension** | Relay-wide membership allowlist | `NOSTR.md` "Relay Membership (NIP-43)" section; kind constants `KIND_NIP43_MEMBERSHIP_LIST` (13534), `KIND_NIP43_MEMBER_ADDED` (8000), `KIND_NIP43_MEMBER_REMOVED` (8001), `KIND_NIP43_LEAVE_REQUEST` (28936) in `crates/buzz-core/src/kind.rs`; handler `crates/buzz-relay/src/handlers/relay_admin.rs` | kind:9030 (add member), 9031 (remove), 9032 (change role), 13534 (membership list snapshot, relay-signed) | [DOCS+CODE] Gated by `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`; relay owner bootstrapped from `RELAY_OWNER_PUBKEY`. Documented known limitation: the CLI/`compose exec` admin path does not push live 8000/8001 deltas over Redis (in-process only) — only the 13534 snapshot is authoritative and live. |
| NIP-70 (protected events) | Marks relay-authored events as non-replayable/protected | Referenced in `NOSTR.md` for kind:13534 | kind:13534 | [DOCS] Noted as "NIP-70 protected." |
| **Buzz custom NIPs** (`docs/nips/*.md`) | Extensions beyond upstream Nostr for agent/product features | `docs/nips/NIP-{AA,AE,AM,AO,AP,CW,DV,ER,FI,GS,IA,MP,OA,PL,PMA,RS,WP}.md` | see §5.4 | [DOCS] All marked `draft`/`optional` in their own headers; NIP-PMA is explicitly "protocol/codec reservation only... Relays MUST reject this kind until [more work is done]" — i.e., defined but deliberately not yet live. |

### 5.2 Event Kind Registry (selected, from `crates/buzz-core/src/kind.rs`)

The canonical kind numbers are defined as Rust constants in one file, `crates/buzz-core/src/kind.rs` [CODE]. Selected groups:

- **Standard Nostr (unmodified semantics):** `KIND_PROFILE=0`, `KIND_TEXT_NOTE=1`, `KIND_CONTACT_LIST=3`, `KIND_DELETION=5`, `KIND_REACTION=7`, `KIND_GIFT_WRAP=1059`, `KIND_FILE_METADATA=1063`, `KIND_LONG_FORM=30023`, `KIND_USER_STATUS=30315`, `KIND_READ_STATE=30078`, `KIND_AUTH=22242`, `KIND_BLOSSOM_AUTH=24242`, `KIND_HTTP_AUTH=27235`, `KIND_REPORT=1984` (NIP-56 reports).
- **NIP-29 group management:** `KIND_STREAM_MESSAGE=9` (chat message — Buzz calls it "stream message"), `KIND_NIP29_PUT_USER=9000`, `REMOVE_USER=9001`, `EDIT_METADATA=9002`, `DELETE_EVENT=9005`, `CREATE_GROUP=9007`, `DELETE_GROUP=9008`, `CREATE_INVITE=9009`, `JOIN_REQUEST=9021`, `LEAVE_REQUEST=9022`, and the addressable state-mirror kinds `GROUP_METADATA=39000`, `GROUP_ADMINS=39001`, `GROUP_MEMBERS=39002`, `GROUP_ROLES=39003` (defined but not emitted, per `NOSTR.md`).
- **Buzz-specific chat extensions:** `KIND_STREAM_MESSAGE_V2=40002` (rich content), `_EDIT=40003`, `_PINNED=40004`, `_BOOKMARKED=40005`, `_SCHEDULED=40006`, `KIND_STREAM_REMINDER=40007`, `_DIFF=40008`, `KIND_CANVAS=40100`, `KIND_SYSTEM_MESSAGE=40099`, `KIND_THREAD_SUMMARY=39005`, `KIND_WINDOW_BOUNDS=39006` (NIP-CW), `KIND_DM_VISIBILITY=30622` (NIP-DV).
- **Moderation:** `KIND_MODERATION_BAN=9040`, `_UNBAN=9041`, `_TIMEOUT=9042`, `_UNTIMEOUT=9043`, `_RESOLVE_REPORT=9044`.
- **Relay membership / identity archival:** `KIND_NIP43_MEMBERSHIP_LIST=13534`, `_MEMBER_ADDED=8000`, `_MEMBER_REMOVED=8001`, `_LEAVE_REQUEST=28936`, `KIND_IA_ARCHIVE_REQUEST=9035`, `_UNARCHIVE_REQUEST=9036`, `_ARCHIVED=8002`, `_UNARCHIVED=8003`, `_ARCHIVED_LIST=13535`.
- **AI agent kinds:** `KIND_AGENT_PROFILE=10100`, `KIND_AGENT_ENGRAM=30174` (NIP-AE, persistent agent memory), `KIND_PERSONA=30175` (NIP-AP), `KIND_TEAM=30176`, `KIND_MANAGED_AGENT=30177`, `KIND_TEAM_CATALOG=30178`, `KIND_PRIVATE_MANAGED_AGENT=30179` (NIP-PMA, reserved/blocked), `KIND_AGENT_OBSERVER_FRAME=24200` (NIP-AO), agent turn metrics kind referenced in `crates/buzz-core/src/agent_turn_metric.rs` (NIP-AM, `kind:44200` per `docs/nips/NIP-AM.md`).
- **Presence/ephemeral/misc:** `KIND_PRESENCE_UPDATE=20001`, `KIND_TYPING_INDICATOR=20002`, `KIND_PAIRING=24134`, `KIND_HUDDLE_REACTION=24810`, `KIND_EVENT_REMINDER=30300` (NIP-ER), `KIND_PUSH_LEASE=30350` (NIP-PL), `KIND_WORKFLOW_DEF=30620` (workflows), `KIND_PRODUCT_FEEDBACK=42000`.
- **Membership notifications:** kind:44100 (member added), kind:44101 (member removed) — relay-signed, community-global, `#p`-gated (documented in `NOSTR.md`, not directly seen as a named constant in the excerpt read but consistently referenced throughout `NOSTR.md`). [Needs verification: exact constant name in `kind.rs`.]

### 5.3 Signing

- Buzz depends on the external `nostr` crate (v0.44, features `nip44`+`nip98`, `Cargo.toml:73`) for core cryptography — BIP-340 Schnorr signatures, event ID hashing, and NIP-44 encryption — rather than reimplementing secp256k1 primitives itself. [CODE]
- Event signature verification on the relay side goes through `buzz_core::verify_event` (called from `crates/buzz-auth/src/nip42.rs`), i.e., a shared verification helper in `buzz-core`. [CODE: `crates/buzz-core/src/verification.rs` — file present per directory listing; not read in full, content not verified beyond the call site.]
- **git-sign-nostr** (`crates/git-sign-nostr/src/lib.rs`) is a standalone Unix CLI usable as git's `gpg.x509.program`, letting a user sign git commits/tags with their Nostr (BIP-340 Schnorr) key instead of GPG/SSH, per the custom **NIP-GS** (`docs/nips/NIP-GS.md`). It emits GnuPG-compatible status-fd protocol lines so `git log --show-signature` works. Documented limitation: its `TRUST_FULLY` status is advisory only, not a PKI trust root. [CODE+DOCS]
- **git-credential-nostr** (`crates/git-credential-nostr/src/lib.rs`) is a git credential helper: on request, it signs a kind:27235 (NIP-98) HTTP-auth event and returns it base64-encoded as the credential value; git then sends it as `Authorization: Nostr <credential>` on git-over-HTTP(S) operations against Buzz's git hosting. [CODE]
- No client-side hardware key / hardware wallet signing code was found in this pass. [UNCLEAR — needs verification against desktop/mobile signer code, out of this fork's scope.]

### 5.4 Encryption

NIP-44 (versioned symmetric encryption via ECDH conversation key) is Buzz's general encryption primitive, used for:
- **Agent engrams** (`crates/buzz-core/src/engram.rs`) — persistent agent memory, kind:30174, encrypted between agent and owner keys (NIP-AE).
- **Agent observability frames** (`crates/buzz-core/src/observer.rs`) — ephemeral session telemetry, kind:24200 (NIP-AO).
- **Device pairing** (`crates/buzz-core/src/pairing/session.rs`) — encrypting the pairing payload (nsec, bunker string, or nostrconnect URI) exchanged over an untrusted relay during device linking.
- **Private managed agents** (`crates/buzz-core/src/private_managed_agent.rs`) — kind:30179 (NIP-PMA), currently reservation-only per its own spec doc.
- **Push leases** (`crates/buzz-relay/src/handlers/push_lease.rs`) — decrypting lease payloads (NIP-PL).

DMs use **NIP-17 gift wrap** (kind:1059) as the transport/privacy envelope rather than a bare NIP-44/NIP-04 encrypted kind:4 event; per `NOSTR.md` this is implemented, while NIP-04 itself is not. [DOCS+CODE]

### 5.5 Authentication (NIP-42 AUTH flow)

1. On connection, the relay sends `["AUTH", "<challenge>"]` (challenge generated by `generate_challenge()` in `crates/buzz-auth/src/nip42.rs`, 32 random bytes hex-encoded).
2. The client signs a kind:22242 event embedding the challenge and the relay URL as tags, and sends it back.
3. The relay validates it with `verify_nip42_event()`: checks `event.kind == Kind::Authentication`, verifies the Schnorr signature via `buzz_core::verify_event`, matches the challenge string, matches the (normalized) relay URL, and checks the timestamp is within ±60s (`TIMESTAMP_TOLERANCE_SECS`).
4. AUTH events are never persisted or logged, per an explicit doc comment (they may carry bearer tokens as an additional tag — see `crates/buzz-relay/src/handlers/auth.rs` for how tokens interact with pubkey auth).
5. Optional **pubkey allowlist** (`BUZZ_PUBKEY_ALLOWLIST=true`): pubkey-only NIP-42 connections (no API token) are checked against a `pubkey_allowlist` DB table; fails closed on DB error; API-token holders bypass it. [DOCS: `NOSTR.md`]
6. Optional **relay membership** (`BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`): every authenticated connection is checked against a `relay_members` table (see §5.1 NIP-43 row). [DOCS]

### 5.6 Subscriptions and Publishing (REQ/EVENT/CLOSE/EOSE/OK/NOTICE)

The wire-level message types (`REQ`, `EVENT`, `CLOSE`, `EOSE`, `OK`, `NOTICE`, `AUTH`) are handled inside `buzz-relay`'s connection/handler layer (`crates/buzz-relay/src/connection.rs`, `crates/buzz-relay/src/protocol.rs`, `crates/buzz-relay/src/handlers/{event,ingest,req,mod}.rs`) — full request/response and fan-out plumbing is relay backend territory and is left to the Architecture/Backend section of the main document rather than duplicated here. [CODE — see backend section for details] Key protocol-relevant facts confirmed from `NOSTR.md`:
- Channel-scoped events (kind:9, group-admin kinds) require an `#h` tag naming the channel UUID; missing it is rejected (`invalid: channel-scoped events must include an h tag`).
- `#p`-gated kinds (44100, 44101, 1059/gift-wrap) require any global subscription to include a `#p` filter whose values are exactly the authenticated user's own pubkey, or the relay rejects the subscription (`restricted: p-gated events require #p matching your pubkey`) — this is a deliberate anti-eavesdropping control on live fan-out, not just at storage.
- NIP-29 discovery events (39000-39002) are stored channel-scoped, so they do **not** appear on live global kind-only subscriptions; clients must discover groups via historical REQ. This is called out as a known gap ("Live push for open-channel discovery is a future enhancement").

### 5.7 NIP-29 groups ↔ Buzz "communities/channels" mapping

`NOSTR.md` confirms this mapping directly and is treated here as authoritative documentation, cross-checked against the kind constants above: a Buzz **channel** is a NIP-29 **group** (`#h` tag = channel UUID = NIP-29 group `d` tag on the 39000/39001/39002 mirror events). The relay currently supports exactly **one community per relay domain** ("Today's single-relay deployment has exactly one community behind that URL"), with multi-community/multi-tenant support keyed off the connection's HTTP Host header — described in `NOSTR.md`'s "Community scope" section and `docs/multi-tenant-relay.md` / `docs/multi-tenant-conformance.md` (not fully read in this pass; flagged for the backend/tenancy section). [DOCS] "Buzz treats the relay URL/domain as authoritative for the community."

### 5.8 `buzz-conformance` — NOT a NIP conformance suite

Important correction to a natural assumption: `crates/buzz-conformance` is **not** a suite that checks compliance against upstream Nostr NIPs. Per its own module doc (`crates/buzz-conformance/src/lib.rs`), it is a **formal-methods trace-replay checker** that validates the relay's runtime behavior against a **TLA+ specification** (`docs/spec/MultiTenantRelay.tla`) of multi-tenant isolation invariants (e.g., `Inv_NonInterference` — no cross-community data leakage). It defines a `TraceStep`/`TraceAction`/`AbstractState` schema that the relay emits at its accept/reject boundary, and an independent Rust re-implementation of the spec's transition relation (`check_trace`) to replay and validate those traces — explicitly *not* a proof, and explicitly *not* sharing code with the production reducer it's checking, "exactly the failure the skill calls out." [CODE — verified from source, overriding the assumption in this fork's own directive that it might be a NIP conformance suite.]

### 5.9 Custom NIPs catalog (`docs/nips/`)

All are Buzz-authored draft extensions (not upstream Nostr NIPs), each marked `draft`/`optional` in its own front matter:

| Doc | Kind(s) | Purpose |
|---|---|---|
| NIP-AA | — | Agent Authentication: lets an agent whose owner is a relay member gain implicit relay access via a NIP-OA `auth` tag during NIP-42, without separate enrollment. Depends on NIP-OA + NIP-43 + NIP-42. |
| NIP-AE | 30174 | Agent Engrams: addressable, NIP-44-encrypted persistent agent memory (owner can always decrypt, symmetric key). |
| NIP-AM | 44200 | Agent Turn Metrics: one encrypted event per completed agent turn recording token usage/cost, for owner-side accounting. |
| NIP-AO | 24200 | Agent Observability: ephemeral encrypted session telemetry streamed from agent process to owner's desktop client. |
| NIP-AP | 30175, 30178 | Agent Personas: public addressable "blueprint" events (identity, system prompt, model, runtime) from which agents are instantiated; 30178 is a shareable team-catalog projection. |
| NIP-CW | (uses 39005/39006) | Channel Window: relay-computed, cursor-paged timeline view returned as ordinary signed events, with aux-closure (reactions/deletions/edits) and thread-summary/window-bounds overlays. |
| NIP-DV | 30622 | DM Visibility: per-viewer, relay-signed snapshot of hidden DM conversations (hide-without-leaving). |
| NIP-ER | 30300 | Event Reminders: encrypted, author-only reminders with a public `not_before` due-time tag. |
| NIP-FI | — | Federated Identity Authorization: stateless authorization combining an issuer-qualified identity assertion (verified offline via JWKS) with fresh NIP-42 proof of key possession. |
| NIP-GS | — | Git Object Signing with Nostr Keys (see §5.3, `git-sign-nostr`). |
| NIP-IA | 9035/9036 (requests), 8002/8003 (deltas), 13535 (snapshot) | Identity Archival: hide a pubkey from active-member/autocomplete surfaces while preserving history. |
| NIP-MP | 30621 | Multi-Repository Projects: named grouping of NIP-34 repo announcements (30617) spanning repos/owners; metadata only, no authority transfer. |
| NIP-OA | — | Owner Attestation: an `auth` tag by which an owner key authorizes an agent key to publish under the agent's own authorship (explicitly reuses NIP-26's credential format but *not* its delegation semantics — event stays attributed to the agent, not reassigned to the owner). |
| NIP-PL | 30350 | Push Leases: stored, expiring authorization for a push executor to keep a filter alive and wake an app installation via platform push (APNs/FCM/UnifiedPush) after the socket closes. |
| NIP-PMA | 30179 | Private Managed-Agent Aggregate: **reservation only** — relays MUST currently reject this kind pending further privacy/CAS/revocation work. |
| NIP-RS | (kind:30078-based) | Cross-Device Read State Sync: encrypted per-context "read up to timestamp T" sync across a user's own devices; explicitly not a read-receipt protocol visible to others. |
| NIP-WP | (uses 9033 command, NIP-11 `icon` field) | Workspace Profile: admin/owner sets a relay-scoped workspace icon via kind:9033; read via standard NIP-11. |

Two docs (`NIP-MP.fixtures.json`, `NIP-MP.fold-fixtures.json`) are test-fixture data for NIP-MP, not prose specs. [CODE-adjacent evidence of an actual implementation/test harness for NIP-MP, stronger signal than a pure paper spec.]

### 5.10 Gaps / Unknowns

- Exact wire-level guarantee details for REQ/EOSE/CLOSE/NOTICE (backpressure, filter limits) were not traced into `buzz-relay`'s handler code in this pass — left to backend section. [UNCLEAR]
- Whether any Buzz client (desktop/mobile/web) actually implements a NIP-46 remote-signer *client* role (connecting out to a bunker) versus just transporting a bunker string during pairing was not established. [UNCLEAR — needs verification]
- The exact constant names for kind:44100/44101 (membership notifications) were not located by name in the `kind.rs` grep excerpt used; their existence and behavior is nonetheless well-documented in `NOSTR.md`. [Needs verification against `kind.rs` directly.]
- Full behavior of `crates/buzz-search` (NIP-50 backing implementation) not inspected. [Needs verification]

## 6. AI Agent / ACP Architecture

> Tags: **[CODE]** verified directly in source, **[DOCS]** stated in existing repo markdown (README/docs), **[VISION]** stated only in `VISION_*.md` as aspirational/future — not necessarily built, **[UNCLEAR]** cannot be confirmed either way.

### 6.0 Overview diagram

```
Buzz relay (crates/buzz-relay)
        ^  NIP-01 WebSocket (events) + REST (channel discovery)
        |  NIP-42 AUTH
        v
buzz-acp  ("the harness")            <-- holds the agent's own Nostr keypair (nsec)
  crates/buzz-acp
  - relay.rs   : relay client (WS+REST), reconnect/backoff, publishes replies
  - queue.rs   : per-channel/per-thread event queue + admission + dedup
  - pool.rs    : owns N agent-process slots, dispatches prompts, panic/timeout recovery
  - acp.rs     : ACP JSON-RPC 2.0 client (spawns + talks to the agent subprocess)
  - scope.rs   : session scoping policy (per-channel vs per-thread)
        |  stdio, JSON-RPC 2.0 (NDJSON), "ACP" = Agent Client Protocol
        v
agent subprocess  (pluggable; selected by --agent-command / BUZZ_ACP_AGENT_COMMAND, default "goose")
  one of: goose | buzz-agent (crates/buzz-agent) | codex-acp | claude-agent-acp | pi-acp
        |  stdio, JSON-RPC 2.0 (MCP), one MCP child per session
        v
MCP server(s), e.g. buzz-dev-mcp (crates/buzz-dev-mcp) — shell, file edit, rg, tree, todo
```

Message round trip, current implementation **[CODE]**:

```
Human posts in a Buzz channel/DM
   -> buzz-relay stores + fans out kind event over NIP-01 WS subscription
   -> buzz-acp's HarnessRelay (relay.rs) receives BuzzEvent over its mpsc channel
   -> queue.rs admits the event into a per-channel/per-thread queue (SessionScope)
   -> pool.rs claims an idle OwnedAgent slot, builds prompt from the queued batch
   -> acp.rs AcpClient::session_new (once) then session_prompt (JSON-RPC "session/prompt")
        --stdio--> agent subprocess (e.g. buzz-agent)
   -> agent subprocess calls the configured LLM provider, executes MCP tool calls
        (e.g. buzz-dev-mcp "shell" tool running `buzz messages send ...`)
   -> tool call itself publishes the reply as a new Nostr event back to buzz-relay,
      signed with the harness's private key (the agent's Nostr identity)
   -> agent subprocess emits "session/update" notifications (agent_message_chunk,
      tool_call, tool_call_update, usage_update) back over stdio to buzz-acp
   -> AcpClient::session_prompt resolves with a stopReason; pool.rs returns the
      agent to the idle pool
```

Key point verified in code: the assistant's reply reaches other Buzz users **by the agent's own tool call publishing a Nostr event** (via the `messages send` shell command executed through buzz-dev-mcp), not by buzz-acp re-publishing the LLM's raw text. `crates/buzz-agent/README.md` "Reply Guard" section **[DOCS/CODE]** describes exactly this: turns are nudged to actually invoke `messages send`/`reactions add` because "the model's assistant text is invisible to humans" otherwise.

---

### 6.1 What is "buzz-acp"? What does ACP mean here?

**[CODE]** `crates/buzz-acp/Cargo.toml`: `description = "ACP harness that bridges Buzz events to AI agents"`. Binary entry point `crates/buzz-acp/src/main.rs` is a 3-line wrapper calling `buzz_acp::run()`.

**[CODE]** `crates/buzz-acp/src/acp.rs` top doc: *"ACP client module — manages communication with an AI agent subprocess over stdio using JSON-RPC 2.0 (newline-delimited / NDJSON)."*

**[DOCS]** `crates/buzz-agent/README.md`: *"buzz-agent is an ACP agent. It speaks the Agent Client Protocol over stdio..."* — "ACP" = **Agent Client Protocol**, an external/emerging protocol also used by editors (Zed, JetBrains). Buzz does not define ACP itself; it implements a client (`buzz-acp`) and a from-scratch compliant agent (`buzz-agent`) for it.

**[CODE]** `crates/buzz-acp/src/acp.rs:611-614`: a code comment states Buzz is "requesting version 2 is an intentional temporary pin — we are squatting on ACP v2 ahead of the upstream ACP RFD." This confirms Buzz tracks an *unfinished upstream spec* and has made a version-numbering choice ahead of ratification — worth flagging to a new developer as a moving target.

So concretely, two distinct crates implement the two ends of ACP:
- **`buzz-acp`** = the ACP **client** ("harness") that bridges the Buzz relay to an agent subprocess.
- **`buzz-agent`** = one possible ACP **agent** (server) implementation that buzz-acp can spawn — but buzz-acp is not limited to it (see 6.4).

---

### 6.2 Where ACP is implemented; protocol/message shape

**[CODE]** Implementation files:
- `crates/buzz-acp/src/acp.rs` (5,030 lines) — the JSON-RPC client (`AcpClient` struct, line 141), including `spawn`, `initialize`, `session_new_full`, `session_prompt_with_idle_timeout`, `session_cancel`/`cancel_with_cleanup`, and the inbound-message dispatch loop.
- `crates/buzz-agent/src/main.rs` + `crates/buzz-agent/src/*.rs` — the ACP **server** side, described in `crates/buzz-agent/README.md` as hand-rolled (no ACP SDK dependency): *"Three request methods (`initialize`, `session/new`, `session/prompt`), one inbound notification (`session/cancel`), and three outbound update variants (`agent_message_chunk`, `tool_call`, `tool_call_update`). The full server is hand-rolled in `main.rs`."*

**Wire format [CODE]**: JSON-RPC 2.0, newline-delimited (NDJSON) over the child process's stdin/stdout. `crates/buzz-acp/src/acp.rs:551` sets up a `FramedRead` with `LinesCodec::new_with_max_length(MAX_LINE_SIZE)` over the child's stdout.

**Methods observed in code (`crates/buzz-acp/src/acp.rs`, grep for JSON-RPC method strings) [CODE]:**

| Method | Direction | Purpose |
|---|---|---|
| `initialize` | client → agent (request) | protocol version + capability negotiation |
| `authenticate` | client → agent (request) | ACP-advertised auth method (used for provider OAuth flows, see 6.10) |
| `session/new` | client → agent (request) | create a session; carries `cwd`, `mcpServers`, optional `systemPrompt`/`_meta` |
| `session/prompt` | client → agent (request) | send a user turn; returns `stopReason` |
| `session/cancel` | client → agent (notification) | cancel an in-flight turn |
| `session/update` | agent → client (notification) | streamed turn events: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `usage_update`, `keepalive` |
| `session/request_permission` | agent → client (request) | ask the client to authorize a tool call before it runs |
| `_goose/unstable/session/update` | agent → client (notification) | Goose-specific non-standard usage-update extension, explicitly special-cased |

**MCP server config shape [DOCS]** (`crates/buzz-agent/README.md`, "MCP Servers" section) — the client passes MCP server specs inside `session/new`'s `mcpServers` array; each entry is `{name, command, args, env:[{name,value}]}` and is spawned by the agent as its own stdio subprocess with tools namespaced `server__tool`.

---

### 6.3 Agent representation (identity/profile/persona)

**[CODE]** `crates/buzz-persona` — *"Parser and loader for Buzz persona pack files (`.persona.md`)"* (`Cargo.toml` description). `crates/buzz-persona/src/persona.rs` top doc:

```
A `.persona.md` file is YAML frontmatter (between `---` delimiters)
followed by a markdown body that becomes the system prompt.
---
name: my-bot
display_name: My Bot
description: Does things.
---
You are My Bot. You do things.
```

So a **persona** = YAML metadata (name, display name, description, presumably model/provider hints — see `crates/buzz-persona/src/manifest.rs`, `merge.rs`, `resolve.rs`, `pack.rs`, `validate.rs` for pack/merge/validation logic, not read in full for this pass — **[UNCLEAR: exact frontmatter schema without reading `manifest.rs`/`validate.rs` in full]**) plus a markdown body used as the agent's system prompt.

**[CODE]** Agent Nostr identity: `crates/buzz-acp/src/config.rs` — the harness CLI takes a `--private-key` flag (`pub private_key: String`, line ~250), parsed with `nostr::Keys::parse(&args.private_key)` (line ~933), and the raw key string is explicitly zeroed out of memory after parsing (`args.private_key.replace_range(.., &"0".repeat(...))`). This confirms **each running `buzz-acp` harness process holds a single Nostr keypair that is the agent's identity on the relay** — the agent is, from the relay's point of view, just another Nostr pubkey (npub) publishing events, same as a human user.

**[DOCS]** `VISION_AGENT.md`: *"the relay URL they connect to selects their community... an agent's profile, presence, DMs, memories, jobs, channel memberships, and audit trail are still scoped to the community behind that URL. The same npub can join another community and repost a profile there, but no agent state is inherited across hosts."*

---

### 6.4 How an agent process is started

**[CODE]** `crates/buzz-acp/src/acp.rs:454` `AcpClient::spawn(command, args, extra_env, has_generated_codex_config)`:
- Uses `tokio::process::Command::new(command)` — a genuine OS **subprocess**, not a container or systemd unit launched by this code path.
- stdin/stdout piped (`Stdio::piped()`); stderr **inherited** so agent logs surface in the harness's own terminal/log stream.
- `kill_on_drop(true)` plus, on Unix, `cmd.process_group(0)` — spawned into its own process group so a `SIGKILL` doesn't propagate to the harness's own process group.
- On Windows, `configure_no_window(&mut cmd)` suppresses the console window Windows would otherwise pop for a console-subsystem child.
- Injects per-runtime default env vars (`crate::config::default_agent_env(command)`), then per-persona `extra_env`, with **operator-set env vars always winning** (injection is skipped if the key is already set in the parent environment) — except `CODEX_CONFIG`, which gets a dedicated recursive-merge path (`build_codex_config_env`).

**Which binary gets spawned [CODE]** — `crates/buzz-acp/src/config.rs`: CLI flag `--agent-command` / env `BUZZ_ACP_AGENT_COMMAND`, **default value `"goose"`** (an external, third-party ACP-speaking agent runtime — Block's Goose — not implemented in this repo). Recognized command identities normalized in `normalize_agent_command_identity`/`normalize_agent_args` include: `goose`, `codex` / `codex-acp`, `claude-agent-acp` / `claude-code-acp` / `claude-code` / `claudecode`, and **`buzz-agent`** (this repo's own minimal agent). So **buzz-acp is agent-implementation-agnostic**: it can drive Goose, Codex, Claude Code's ACP adapter, or its own `buzz-agent`, selected purely by which binary name/path is configured. `standard_adapter` classification in `acp.rs:529-536` further special-cases Claude- and Codex-family adapters for framing quirks (e.g. system prompt delivery via `_meta` vs a bare `systemPrompt` field, see `SystemPromptTransport` in `session_new_full`).

`pi_launcher.rs` **[CODE]** additionally documents a "Pi-specific native launcher": for `pi-acp` sessions Buzz points `PI_ACP_PI_COMMAND` at a private launcher that injects `--system-prompt <file>` and a `--skill <directory>` flag ahead of the adapter's own args — another supported agent family.

**Server vs client launch context [UNCLEAR without further reading]**: the spawn call itself is generic subprocess spawning; whether the *harness process itself* (`buzz-acp`) is launched by a person on their desktop, by desktop app code, by a systemd unit, or by a Kubernetes pod is a **deployment** decision covered in §6.13/6.14, not something `AcpClient::spawn` determines.

---

### 6.5 Transport: how messages reach/leave the agent

**[CODE]** Stdio only, both hops:
- Buzz relay ↔ `buzz-acp`: NIP-01 WebSocket + REST (see `relay.rs` doc comment, §6.6), not stdio.
- `buzz-acp` ↔ agent subprocess: stdio, NDJSON JSON-RPC (`acp.rs`).
- agent subprocess ↔ MCP server(s): stdio, NDJSON JSON-RPC (`crates/buzz-agent/README.md`: *"Transport: stdio only. No HTTP, no SSE."* — advertised via `agentCapabilities.mcpCapabilities.http:false / sse:false`).

Sending **to** the agent: `AcpClient::session_prompt_with_idle_timeout` writes a `session/prompt` JSON-RPC request built from the queued event batch. Receiving **from** the agent: `AcpClient` reads NDJSON lines from stdout in a loop (`read_until_response_with_idle_timeout`), dispatching by `method` (`session/update`, `session/request_permission`, etc.) or matching `id` for direct responses.

---

### 6.6 How responses get back into Buzz

Two distinct return paths exist in the code, and they should not be conflated:

1. **Side-channel visibility (harness-local only)**: `session/update` notifications (`agent_message_chunk`, `tool_call`, `tool_call_update`, `usage_update`) stream from the agent to `buzz-acp` over stdio and are surfaced to a local **observer** feed (`crates/buzz-acp/src/observer.rs`, `AcpClient::observe`/`set_observer`) — used for local logging/telemetry, not for delivering the reply to other Buzz users.
2. **Actual delivery to other users**: the agent's own tool call (typically the MCP `shell` tool executing a Buzz CLI command such as `buzz messages send ...` or `buzz reactions add ...`, per the Reply Guard description in `crates/buzz-agent/README.md`) is what **publishes a new Nostr event** back to `buzz-relay`, signed with the harness's held private key (§6.3/6.8). `crates/buzz-acp/src/relay.rs` doc comment confirms the `HarnessRelay` background task also *"Publishes ephemeral events (typing indicators) via `PublishEvent` commands"* — i.e., the harness itself publishes at least presence/typing events directly, while message content publication is driven by the agent's own tool calls through the CLI/MCP path. **[UNCLEAR]**: whether every content-bearing reply path always goes through the agent's shell/tool call, or whether `buzz-acp` also has a direct "publish agent reply" code path outside the Reply Guard's documented mechanism — not fully traced in this pass; recommend reading `pool.rs`'s prompt-completion handling and `crates/buzz-acp/src/relay.rs`'s `PublishEvent` command enum for the authoritative answer.

---

### 6.7 Sessions / turns

**[CODE]** `crates/buzz-acp/src/scope.rs` — `SessionScope` is *"the single hashable key that identifies an ACP provider session and its conversational-context boundary,"* derived once per admitted event from an operator `SessionPolicy`:

| Surface | Scope (thread policy) |
|---|---|
| New top-level channel mention | `Thread(channel_id, triggering_event)` |
| Reply in a channel thread | `Thread(channel_id, canonical_root)` |
| Repeated mention in same thread | reuses that thread scope |
| Direct message | `Conversation(channel_id)` |

Under `SessionPolicy::Channel` (documented as *"the current default / rollback path"*) every surface collapses to `Conversation(channel_id)` — i.e. **one ACP session per channel**, matching pre-existing behavior; thread-scoped sessions are a **feature-flagged** rollout (`--session-policy` / `BUZZ_ACP_SESSION_POLICY`), confirmed **[CODE]**, not purely aspirational, but its *default* is the coarser channel-scoped mode.

**Pool/dispatch [CODE]** `crates/buzz-acp/src/pool.rs` top doc: `AgentPool` owns `Vec<Option<OwnedAgent>>` slots plus a `JoinSet` of in-flight tasks; `try_claim()` removes an agent from its slot, `run_prompt_task` executes the turn, and the agent is returned to its slot via an `mpsc` result channel when done. `AcpClient is NOT Clone — ownership moves out on claim and back on return`, i.e. **one OS subprocess can only run one turn at a time**; concurrency across channels/threads comes from having **N pooled subprocesses** (pool size configurable, exact flag not confirmed in this pass — **[UNCLEAR]**, check `config.rs` for a `--pool-size`/`agent-count`-style flag).

`queue.rs` **[CODE]**: per-channel (or per-scope, under thread policy) event queue with two dedup modes: **Drop** (default — new events for a channel with an in-flight turn are silently dropped) and **Queue** (events accumulate and are batched into the next flush). Caps: `MAX_PENDING_PER_SCOPE` and an aggregate `MAX_PENDING_PER_CHANNEL` bound backlog per channel even under per-thread partitioning.

**Turn-level LLM session handling** happens inside `buzz-agent` (single-purpose ACP server), not in the harness: `crates/buzz-agent/src/agent.rs` (turn/loop logic), `llm.rs` (7,973 lines — provider request/response handling, retries, truncation recovery), `handoff.rs` (context-window handoff/summarization when history fills up — `BUZZ_AGENT_MAX_HANDOFFS`), `mcp.rs` (per-session MCP child management).

**Migration hint [CODE]**: `migrations/0005_agent_turn_metric_fts.sql` confirms the relay database persists **agent turn metrics** server-side — i.e. turns are tracked as first-class records in Postgres, not purely ephemeral in-process state. (Full schema not read in this pass — see database section of the main document / `schema/schema.sql`.)

---

### 6.8 Agent identity (Nostr keypair)

Already established in §6.3: **[CODE]** the harness (`buzz-acp`) is started with `--private-key <nsec-or-hex>`, parsed into `nostr::Keys`. This *is* the agent's Nostr identity — the agent looks, to the relay and to other users, like any other Nostr pubkey. There is no separate "agent identity" abstraction inside `buzz-agent` (the LLM-calling subprocess) itself; `buzz-agent` never touches Nostr keys directly — it only speaks ACP/MCP and HTTP to LLM providers (confirmed by absence of `nostr`/`Keys` references in the file list of `crates/buzz-agent/src/*.rs` doc-comment scan; **[UNCLEAR]** without a full grep — recommend `grep -rn nostr crates/buzz-agent/src` to be certain no such coupling exists).

`crates/buzz-persona` sits alongside this as the **behavioral** identity (name/prompt), separate from the **cryptographic** identity (keypair) held by the harness — two different axes of "who is this agent."

---

### 6.9 Agent configuration

Two independent configuration surfaces, confirmed **[CODE/DOCS]**:

1. **Harness (`buzz-acp`) configuration** — `crates/buzz-acp/src/config.rs` (3,192 lines): *"CLI-first: every option is a CLI flag with env var fallback. Config file (TOML) for complex subscription rules."* Flags observed: `--private-key`/`BUZZ_ACP...`, `--agent-command`/`BUZZ_ACP_AGENT_COMMAND`, `--idle-timeout`/`BUZZ_ACP_IDLE_TIMEOUT` (default derived — sized so a 1200s max shell timeout has 300s headroom before a 1500s idle cutoff), `--max-turn-duration`/`BUZZ_ACP_MAX_TURN_DURATION` (default 2h, hard upper bound 7 days), `--session-policy`/`BUZZ_ACP_SESSION_POLICY`, `--lazy-pool`, plus a TOML file for "complex subscription rules" (exact schema not read in this pass).
2. **Agent (`buzz-agent`) configuration** — **[DOCS]** `crates/buzz-agent/README.md`, "Configuration" section, explicit and complete: *"Everything is environment variables. No flags, no config files. (We are a subprocess; subprocess config is environment.)"* Full variable table includes `BUZZ_AGENT_PROVIDER` (required, no implicit fallback), provider-specific keys/models/base URLs, `BUZZ_AGENT_SYSTEM_PROMPT[_FILE]`, `BUZZ_AGENT_MAX_ROUNDS`, `BUZZ_AGENT_MAX_OUTPUT_TOKENS`, `BUZZ_AGENT_MAX_TOKEN_RECOVERIES`, `BUZZ_AGENT_MAX_CONTEXT_TOKENS`, `BUZZ_AGENT_MAX_HANDOFFS`, `BUZZ_AGENT_LLM_TIMEOUT_SECS`, `BUZZ_AGENT_TOOL_TIMEOUT_SECS`, `BUZZ_AGENT_MAX_PARALLEL_TOOLS`, `BUZZ_AGENT_MAX_SESSIONS`, `BUZZ_AGENT_MAX_LINE_BYTES`, `BUZZ_AGENT_MAX_HISTORY_BYTES`, `BUZZ_AGENT_MAX_TOOL_RESULT_TEXT_BYTES`, `BUZZ_AGENT_REQUIRE_REPLY` (Reply Guard, default `0`, but `1` on "mesh"/shared-compute agents).

Per-persona env is injected by the harness at spawn time (§6.4) as `extra_env`, meaning the harness — not the agent binary — is the layer that turns a persona pack into the agent subprocess's environment variables.

---

### 6.10 Credentials for agents

**[DOCS]** `crates/buzz-agent/README.md` "Providers" table names the required credential env var per provider: `ANTHROPIC_API_KEY`, `OPENAI_COMPAT_API_KEY`, `OPENROUTER_API_KEY`, `DATABRICKS_TOKEN` (optional static bearer) or browser-based OAuth. No values are stored in the repo; `.env.example` at repo root presumably documents these names for local dev (not fully cross-checked in this pass — **[UNCLEAR]**, recommend grepping `.env.example` for `ANTHROPIC_API_KEY`/`OPENAI_COMPAT`/etc. to confirm parity).

**OAuth path [CODE]** `crates/buzz-agent/src/auth.rs`: implements RFC 6749 + RFC 7636 (OAuth 2.0 PKCE) with on-disk token caching keyed by `sha256(discovery_url|client_id|scopes)`; first use requires an interactive browser flow (opens `authorization_endpoint`, listens on `127.0.0.1:0` for the redirect); subsequent calls hit the cache and refresh silently. Used at least for Databricks (`crates/buzz-agent/src/catalog.rs` — model discovery reuses the same token source without ever triggering a browser flow itself).

**[DOCS]** `crates/buzz-agent/README.md` "Security Model": *"API keys come from env. Use systemd, Docker secrets, or a wrapper"* for actual secret injection/rotation — i.e. **credential lifecycle management is explicitly out of scope for this crate**; it is an operator/deployment responsibility. No secrets manager integration found in this crate.

---

### 6.11 Permissions/scopes for what an agent can do

Two layers, and a **documentation/implementation mismatch worth flagging to a new developer**:

- **[CODE]** `crates/buzz-agent/src/permission.rs` — a `session/request_permission` **broker** inside `buzz-agent`: *"buzz-agent asks the client to authorize every LLM-issued MCP tool call before executing it; the client applies `BUZZ_ACP_PERMISSION_POLICY` and answers. The agent never reads the policy — it always asks."* The module implements careful correlation-id lifecycle safety (global `Semaphore` cap via `BUZZ_AGENT_MAX_PENDING_PERMISSIONS`, abort-safe `Drop`-based cleanup, claim-before-wake, single absolute deadline).
- **[CODE — contradicts the above doc comment]** On the *client* side, `crates/buzz-acp/src/acp.rs:1934` `handle_permission_request` does **not** apply any configurable policy: it scans the `options` array in the `session/request_permission` request for one with `kind == "allow_once"` and **automatically selects it** ("`auto-approving permission id={id}`" log line), falling back to `reject_once` only if no `allow_once` option exists. A repo-wide search found **no** `BUZZ_ACP_PERMISSION_POLICY` implementation anywhere in `crates/buzz-acp` — the env var is referenced only in that one `buzz-agent` doc comment.

**Conclusion**: today, the harness effectively **auto-approves every tool-call permission request** the agent asks for; the "policy" described in the `buzz-agent` module doc does not appear to be implemented on the `buzz-acp` side. This should be called out explicitly as **[CODE-confirmed current behavior, contradicting a stale/aspirational doc comment]** — flag for verification with the team rather than assumed to be a documentation bug or a not-yet-wired feature.

The MCP-level sandboxing that *does* exist (`crates/buzz-agent/README.md` "Security Model" table, §buzz-dev-mcp) is process-boundary, not permission-policy: whitelisted env vars passed to MCP children (`PATH`, `HOME`, `TERM`, `LANG`, `LC_ALL`, `TMPDIR` + explicit client-passed vars), process-group kill on exit, bounded frame/response/tool-result sizes. The trust boundary is explicitly stated as *"the operator who launched the agent... The shell runs at the operator's trust level, like bash itself"* — i.e. Buzz does not sandbox the shell tool's *capabilities*, only its process lifecycle and output size.

---

### 6.12 Agent crash/restart behavior

**[CODE]** Within a running harness process, `pool.rs` treats a subprocess/turn failure as a per-task event, not a process-wide crash:
- A "hard-cap" (turn exceeded `max_turn_duration`) or transport failure marks the turn dead; under **Queue** dedup mode the triggering batch is **requeued** (`requeue_batch_if_queue`, `requeue_cancelled_batch` — many call sites in `pool.rs`) rather than lost, so a fresh prompt attempt is made (presumably against a newly spawned/returned agent slot).
- A "recently active" window (`pool.rs` top-of-file constant, §6.7-adjacent) distinguishes a turn that was still producing output right up to the hard cap (eligible for requeue) from one that's been silently stuck (candidate for dead-lettering instead).
- `AcpClient::spawn` sets `kill_on_drop(true)` and process-group isolation so a crashed/abandoned `AcpClient` cleans up its OS child; `shutdown()` is documented as the **guaranteed** cleanup path, with `Drop`-based kill being best-effort only.

**Process-supervision above the harness process itself [UNCLEAR]**: nothing in `crates/buzz-acp` restarts the **harness binary** if it exits/panics — that would be an external supervisor's job (systemd `Restart=`, Kubernetes `restartPolicy`, a desktop-app process manager, etc.), none of which is implemented inside this crate. See §6.13.

---

### 6.13 systemd / service configuration

**No systemd unit files are checked into this repository** (confirmed by `find . -iname "*.service"` returning nothing under source control). systemd is referenced only in **prose**, as an example/recommended deployment substrate, never as shipped config:

- **[DOCS]** `crates/buzz-agent/README.md` Security Model: *"Not authenticated. API keys come from env. Use systemd, Docker secrets, or a wrapper."* — a recommendation, not a provided unit.
- **[DOCS]** `docs/remote-agents.md` (a large spec-style doc, not fully read in this pass) mentions systemd multiple times as one of several possible "launcher"/"binding" substrates alongside a bash script, a CI job, or a Kubernetes pod, e.g.: *"a bash script, a systemd unit, a CI job, or this document's provider protocol"* and *"(`restartPolicy: OnFailure`, systemd `Restart=on-failure`) may be [equivalent]"*. This reads as **design guidance for operators/integrators**, not a description of an existing shipped systemd integration.
- The repository *does* ship a Kubernetes-based remote-agent backend as real code: `crates/buzz-backend-kubernetes` — `Cargo.toml description = "Kubernetes backend provider for Buzz remote agents (docs/remote-agents.md)"`, ~6,650 lines of Rust. This is the actually-implemented deployment substrate for remote/hosted agents; systemd is discussed only as an alternative/example, not implemented here.

**Conclusion**: mark systemd integration as **[DOCS-only / not implemented in this repo]**. A new developer should not expect to find a working systemd unit; the real "start an agent as a managed remote workload" implementation to read is `crates/buzz-backend-kubernetes` plus `docs/remote-agents.md`.

---

### 6.14 Server-side vs client-side split for agent functionality

Based on crate locations and stated responsibilities:

| Component | Runs where | Evidence |
|---|---|---|
| `buzz-relay` | Server | WebSocket relay server crate; agents connect to it like any client |
| `buzz-acp` (harness) | Operator-controlled — can be run on a desktop machine, a server, or inside a Kubernetes pod; it is a generic client of the relay's public/authenticated protocol, not relay-internal code | Talks to the relay purely over NIP-01 WS + REST, same as any Nostr client [CODE, `relay.rs`] |
| `buzz-agent` (LLM loop) | Subprocess of whatever launched `buzz-acp` (or any other ACP client, per `VISION_AGENT.md`: "works with Zed, JetBrains, buzz-acp, or anything else that speaks ACP") | [DOCS] `VISION_AGENT.md` |
| `buzz-dev-mcp` | Subprocess of the agent (`buzz-agent` or another ACP agent), one instance per session | [DOCS] `crates/buzz-agent/README.md` MCP Servers |
| `buzz-backend-kubernetes` | Server-side (relay operator's infrastructure) — provisions remote/hosted agent workloads | [CODE] Cargo.toml description; crate lives alongside other server-side crates |
| Desktop app (`desktop/src-tauri`) | Client machine | Referenced as the thing that "sets `BUZZ_AGENT_REQUIRE_REPLY=1` automatically... for Buzz shared-compute agents" [DOCS, `crates/buzz-agent/README.md` "Reply Guard"] — i.e. the desktop app is one of the things that can launch/configure agents (local/"mesh"/shared-compute agents), not read in depth this pass |

**[UNCLEAR]**: the precise mechanism by which the *desktop app* spawns/manages a `buzz-acp` harness (vs. a human operator running it manually, vs. a Kubernetes-hosted remote agent) was not traced in this pass — recommend reading `desktop/src-tauri` for Tauri commands referencing `buzz-acp`/`buzz_acp`/"mesh" and `VISION_MESH.md` for the shared-compute concept.

---

### 6.15 `buzz-workflow` — is it a distinct agent orchestration engine?

**[CODE]** `crates/buzz-workflow/Cargo.toml`: *"YAML-as-code workflow engine for Buzz."* `crates/buzz-workflow/src/lib.rs` top doc:

> *"Channel-scoped automations with sequential execution, variable substitution, conditional logic, and execution traces."*
> - `WorkflowEngine` — top-level handle, lives in `AppState` (i.e., part of the **server/relay** process, not the ACP harness)
> - `schema` — YAML/JSON definition types (`WorkflowDef`, `TriggerDef`, `ActionDef`, `Step`)
> - `executor` — sequential execution, template resolution, condition evaluation
> - Triggered via `engine.on_event(community_id, &stored_event)` from "the event handler post-store hook," and via a background scheduler for cron triggers (`engine.run()`).

**This is a separate mechanism from ACP/agent turns.** It is a rules/automation engine that reacts to stored Nostr events or cron schedules with declarative YAML actions — **not** the thing that drives an LLM conversation turn (that's `buzz-acp` + `buzz-agent`). It runs server-side (`AppState`), scoped per community/tenant. Whether workflow actions can themselves *trigger* an agent turn (e.g., an automation step that pings an agent) is **[UNCLEAR without reading `schema.rs`'s `ActionDef` variants]** — worth a follow-up read of `crates/buzz-workflow/src/schema.rs` and `executor.rs` if workflow↔agent interop matters to the reader.

---

### Summary table for §21 Developer Quick Reference

| Concept | Crate/File | One-line role |
|---|---|---|
| ACP client / harness | `crates/buzz-acp` | Bridges Buzz relay events to an agent subprocess over ACP; holds the agent's Nostr keypair |
| ACP agent (LLM loop) | `crates/buzz-agent` | Minimal hand-rolled ACP server; calls an LLM, executes MCP tools |
| MCP dev tools server | `crates/buzz-dev-mcp` | Shell/file-edit/search MCP server spawned by the agent |
| Persona packs | `crates/buzz-persona` | `.persona.md` (YAML frontmatter + system-prompt body) parser/loader |
| Workflow automation | `crates/buzz-workflow` | Server-side YAML rules engine reacting to events/cron — distinct from agent turns |
| Remote agent hosting (k8s) | `crates/buzz-backend-kubernetes` | Server-side provider that deploys remote agent workloads on Kubernetes |

## 7. Frontend Architecture

The repository contains **three separate frontend clients** plus one embedded desktop web layer, not one unified frontend:

| Client | Path | Purpose | Stack |
|---|---|---|---|
| Desktop client (primary) | `desktop/src` (Tauri webview) | Main Buzz chat/community/agent client | React 19, TanStack Router/Query, Tauri v2 [CODE] |
| Standalone web app | `web/src` | Lightweight browser-only app: invite acceptance + read-only git repo browser | React 19, TanStack Router/Query, nostr-tools, isomorphic-git [CODE] |
| Admin web panel | `admin-web/src` | Relay/community moderation panel (reports, feedback) | React 19, hand-rolled router, no state library [CODE] |
| Mobile client | `mobile/lib` | Full-featured Flutter mobile client | Flutter/Dart, Riverpod, nostr, web_socket_channel [CODE] |

[UNCLEAR] Whether `desktop/src` is also built/served as a plain web app outside Tauri (e.g. for a hosted web client) was not verified in this pass — it imports `@tauri-apps/api` in 59 files, so it is at least Tauri-aware; other forks covering `desktop/src-tauri` and build scripts may confirm build targets.

---

### 7.1 `web/` — Standalone Web App

**package.json** (`web/package.json`) confirms: React 19, `@tanstack/react-router` + `@tanstack/react-query`, `nostr-tools` 2.x, `isomorphic-git` + `@isomorphic-git/lightning-fs` (in-browser git), Radix UI primitives, Tailwind CSS v4, Vite 8, TypeScript 6, Biome (lint/format), Playwright (e2e). [CODE]

- **Entry point:** `web/src/main.tsx` — mounts `<App/>` inside `QueryClientProvider`, `ThemeProvider`, `TooltipProvider`, with a `sonner` `Toaster`. [CODE: `web/src/main.tsx`]
- **Routing:** TanStack Router, file-based under `web/src/app/routes/` (config in `web/src/app/routes.ts`, generated tree in `web/src/app/routeTree.gen.ts`, Vite plugin config in `web/vite.config.ts`). Routes present: [CODE]
  - `web/src/app/routes/index.tsx` — home/landing
  - `web/src/app/routes/invite.$code.tsx` — invite acceptance by code
  - `web/src/app/routes/repos.tsx`, `repos.$repoId.tsx`, `repos.$repoId.blob.$.tsx` — repo list, repo detail, blob viewer
  - `web/src/app/routes/root.tsx` — root layout
- **State management:** No global client-state library (no Redux/Zustand). Server state via `@tanstack/react-query`; local/UI state via React hooks. [CODE]
- **API/HTTP layer:** `web/src/features/invite/invite-api.ts` calls the relay's HTTP API directly via `fetch`, using a NIP-98 signed `Authorization` header (see §7.4). [CODE]
- **WebSocket / Nostr client layer:** `web/src/shared/lib/nostr-client.ts` implements a minimal hand-rolled Nostr client: opens a `WebSocket`, waits briefly for a NIP-42 `AUTH` challenge, signs and replies, then sends `REQ`, collects `EVENT`s until `EOSE`/`CLOSED`, and resolves. It does not implement live subscriptions (no persistent `sub` loop) — it's a one-shot query helper. [CODE: `web/src/shared/lib/nostr-client.ts`]
- **Signing:** `web/src/shared/lib/nostr-signer.ts` — uses `window.nostr` (NIP-07 browser extension) when present; otherwise falls back to a page-lifetime ephemeral keypair generated via `nostr-tools/pure` (`generateSecretKey`/`finalizeEvent`). Flows that create durable state (e.g. claiming an invite) pass `requireNip07: true` so an ephemeral identity cannot silently create an orphaned membership. [CODE]
- **NIP-98 HTTP auth:** `web/src/shared/lib/nip98.ts` (`makeNip98AuthHeader`) — used by `invite-api.ts` to sign HTTP requests to the relay's REST API (see §7.4/§12).
- **Git browsing:** `web/src/features/repos/git-client.ts` + `use-git-browse.ts`, `use-repo-refs.ts`, `use-repos.ts` — uses `isomorphic-git` against an in-browser `lightning-fs` filesystem to clone/read repositories for the read-only web viewer (`RepoTreeSection.tsx`, `RepoBlobViewer.tsx`, `RepoCommitsSection.tsx`, `RepoReadmeSection.tsx`, `RepoRefsSection.tsx`). [CODE] This pairs with the repo-storage concept documented as "git-on-object-storage" (`docs/git-on-object-storage.md` — [DOCS], not verified against backend code in this pass).
- **Theming:** `web/src/shared/theme/ThemeProvider` + `web/src/shared/styles` (Tailwind v4, `@tailwindcss/postcss`).
- **UI components:** shadcn/ui-style primitives under `web/src/shared/ui` (confirmed by `web/components.json`... actually `components.json` was inspected at `desktop/components.json`; `web/` likely has an equivalent — [UNCLEAR], not directly opened, but Radix + `class-variance-authority` + `tailwind-merge` deps match the shadcn pattern).

**Traced flow — accepting an invite in the browser** (`web/src/app/routes/invite.$code.tsx` → `InvitePage.tsx` → `invite-api.ts`): [CODE]
1. User opens `/invite/:code`; route loads `InvitePage.tsx` (`web/src/features/invite/ui/InvitePage.tsx`), possibly showing `InviteJoinPolicyNotice.tsx` if a join policy applies.
2. On accept, `claimInviteInBrowser(code, policyReceipt)` in `invite-api.ts` builds `POST {relayHttpBaseUrl()}/api/invites/claim` with JSON body `{ code, policy_receipt }`.
3. `makeNip98AuthHeader(url, "POST", { body, requireNip07: true })` signs a NIP-98 event — this **requires** a real NIP-07 extension (no ephemeral fallback) since a durable community-membership row is being created.
4. Request is sent with `Authorization: Nostr <base64 event>`; relay responds with `{status, community_id, host, role}` which becomes a `BrowserInviteClaim`.
5. This is a pure HTTP flow (not a raw Nostr event publish to a relay socket) — the relay backend exposes REST endpoints for invite claiming, consumed via ordinary `fetch`.

This app does **not** implement message sending/receiving, channels, DMs, reactions, or presence — those live only in the desktop and mobile clients. [CODE — absence verified via `web/src/features` containing only `invite/` and `repos/`]

---

### 7.2 `admin-web/` — Admin/Moderation Panel

**package.json** (`admin-web/package.json`): React 19, Vite 8, TypeScript, Vitest + Testing Library (unit tests), Playwright (e2e). No router library, no state library, no Nostr library dependency listed. [CODE]

- **Entry:** `admin-web/src/main.tsx` → `admin-web/src/App.tsx`.
- **Routing:** Hand-rolled — `usePath()`/`Link` in `App.tsx` uses `history.pushState` + a `popstate` listener; no routing library. [CODE: `admin-web/src/App.tsx`]
- **Data layer:** `admin-web/src/api.ts` + `admin-web/src/useResource.ts` (a small custom fetch/loading/error hook, `useResource<T>`). `api.ts` targets `PREFIX = "/api/admin/v1"` on the relay. [CODE]
- **Auth:** `probeAuthMode()` in `api.ts` discovers whether the relay requires auth: `AuthMode = "nip98" | "disabled"`. When `"nip98"`, every admin request is signed client-side via `signNip98()`, which builds a kind-27235 NIP-98 event (`u`, `method`, `nonce`, and a `payload` SHA-256 tag for body-bearing requests) through `window.nostr`, and sends `Authorization: Nostr <base64 event>`. A code comment in `api.ts` notes the `nonce` exists specifically to avoid event-ID collisions (and 401 retry loops) when two same-second requests would otherwise be byte-identical, and that the relay's verifier is in `auth.rs` (backend, not in this app). [CODE: `admin-web/src/api.ts`]
- **Pages/features observed:** `Reports` (open moderation reports, `/reports?status=open&limit=100`) and feedback types (`FeedbackDetail`, `FeedbackSummary`, `FeedbackStatus`) per `admin-web/src/types.ts` and usage in `App.tsx`. This is a moderation/ops console, not an end-user chat client. [CODE]
- No dedicated WebSocket layer was found in `admin-web/src` — it appears to be pure REST-over-HTTP against the relay's admin API. [CODE — absence based on file listing (`api.ts`, `App.tsx`, `main.tsx`, `styles.css`, `types.ts`, `useResource.ts`); no exhaustive full-text search performed]

---

### 7.3 `mobile/` — Flutter Mobile Client

**pubspec.yaml** (`mobile/pubspec.yaml`) confirms: Flutter/Dart (SDK `^3.11.4`), `hooks_riverpod` + `flutter_hooks` (state management), `web_socket_channel` (relay WebSocket connection), `nostr: ^2.0.0` + `pointycastle` (Nostr protocol + crypto), `flutter_secure_storage` (key/credential storage), `mobile_scanner` (QR — likely for pairing), `connectivity_plus`, `local_auth` (biometric), plus rich media deps (`camera`, `image_picker`, `video_player`, `record`, `just_audio`, `google_mlkit_selfie_segmentation`), `app_links` (deep links), `app_badge_plus` (notification badges), `gpt_markdown`/`highlight` (agent/markdown rendering). [CODE]

- **Feature modules** (`mobile/lib/features/`): `activity`, `channels`, `forum`, `home`, `invites`, `pairing`, `profile`, `pulse`, `search`, `settings`. [CODE]
- **Shared modules** (`mobile/lib/shared/`): `auth`, `community`, `crypto`, `custom_emoji`, `deeplink`, `emoji`, `huddle` (voice/video, matching the desktop `huddle` concept in §7.1's `AppHuddleBar.tsx`), `mentions`, `profile`, `push`, `read_state`, `relay`, `reminders`, `security`, `theme`, `utils`, `widgets`. [CODE]
- The presence of `mobile/lib/shared/relay` + `web_socket_channel` + `nostr` dependencies, alongside feature parity with desktop concepts (`channels`, `huddle`, `pairing`, `invites`, `forum`, `pulse`), indicates the mobile client talks to the **same backend/relay** as the desktop client over the same Nostr/WebSocket protocol, using its own Dart implementation rather than a shared JS/TS core. [CODE — inferred from directory/dependency parity; exact wire compatibility not independently verified against relay code in this pass]
- Platforms: `mobile/android/` and `mobile/ios/` directories both present, confirming dual-platform Flutter build targets. [CODE]
- `mobile/HUDDLES.md` exists as in-repo documentation specific to the huddle (voice/video) feature — not read in this pass; flagged for the huddle-focused section of the main document. [DOCS — pointer only]

---

### 7.4 Tauri-Specific Frontend Code (in `desktop/src`, Rust side out of scope for this section)

`desktop/src` is the primary, full-featured Buzz client (2,414 files under `desktop/src`, vs. ~20 in `web/src`), covering chat channels, communities, AI agents, workflows, and huddles — confirmed by `desktop/src/app` containing `AppShellChannelSurface.tsx`, `AppHuddleBar.tsx`/`AppHuddleShell.tsx`, `useHuddlePresentation.ts`, `AppWorkflowEditorOverlayProvider.tsx`, and `desktop/src/features` (not enumerated in depth here — reserved for other sections of the main document). [CODE]

- **Stack confirmation** (`desktop/package.json`): React 19, `@tanstack/react-router` + `@tanstack/react-query` + `@tanstack/react-virtual`, `nostr-tools`, `@tauri-apps/api ~2.11`, plus Tauri plugins `plugin-notification`, `plugin-opener`, `plugin-process`, `plugin-updater`. [CODE]
- **UI system:** `desktop/components.json` confirms shadcn/ui (`style: "new-york"`, Tailwind config at `tailwind.config.js`, base color `zinc`, aliases `@/shared/ui`, `@/shared/lib`) — same convention as `web/`. [CODE]
- **Tauri IPC usage:** 59 files under `desktop/src` import `@tauri-apps/api`, including: [CODE — via repo search, file list truncated to representative examples]
  - `desktop/src/app/App.tsx`
  - `desktop/src/app/useTauriWindowDrag.ts` (native window drag)
  - `desktop/src/app/useCloseWindowShortcut.ts`, `useWebviewZoomShortcuts.ts` (native window/webview control)
  - `desktop/src/app/useTrayMenu.ts` (system tray)
  - `desktop/src/features/agents/lib/useAgentsDataRefresh.ts`, `useInstallOutputLine.ts`, `usePersonaSync.test.mjs` (agent-related native calls — likely spawning/monitoring local `buzz-acp`/agent processes via Tauri commands; the Rust command implementations are out of scope for this section and covered by the Tauri/Rust-focused research).
  - This confirms the desktop client uses Tauri's `invoke()`-style IPC extensively for OS integration (window chrome, tray, notifications, updater, process control) and for agent lifecycle management, not just as a packaging wrapper. [CODE — exact `invoke()` call sites and their Rust command counterparts not enumerated here; see Tauri/Rust section]

---

### 7.5 UI → Backend Flow (Web App, Verified)

```
User (browser)
  │
  ▼
web/src/app/routes/invite.$code.tsx  (TanStack Router route)
  │
  ▼
InvitePage.tsx  (web/src/features/invite/ui)
  │  user clicks "Accept"
  ▼
invite-api.ts: claimInviteInBrowser(code, policyReceipt)
  │
  ├─► nostr-signer.ts: signNostrEvent(..., requireNip07: true)
  │       │  requires window.nostr (NIP-07 extension)
  │       ▼
  │   nip98.ts: makeNip98AuthHeader(url, "POST", {body})
  │       (builds "Authorization: Nostr <base64 kind-27235 event>")
  │
  ▼
fetch POST {relay}/api/invites/claim  (HTTP, not raw WS)
  │
  ▼
Relay backend REST API  (out of scope for this section)
  │
  ▼
JSON response { status, community_id, host, role }
  │
  ▼
InvitePage.tsx renders result (joined / already_member)
```

This diagram is intentionally scoped to the one flow fully traced above; it uses only components verified to exist in `web/src`. [CODE]

---

### Gaps / Not Verified in This Pass

- Full route/page inventory of `desktop/src` (only `app/` top-level files sampled; `features/`, `protectedFeatures/`, and `testing/` directories not enumerated).
- Whether `web/` and `desktop/src` share any code (no shared package under a common workspace path was checked beyond both following the same shadcn/`@/shared` alias convention).
- `admin-web/src` was checked for a WebSocket layer only by file listing, not full-text search — a hidden WS usage inside `api.ts` beyond what was read cannot be fully ruled out. [UNCLEAR]
- Mobile-to-relay wire compatibility (Dart `nostr` package version vs. server-side event/kind support) not cross-checked against backend code.

## 8. Rust / Tauri Architecture

Scope: `desktop/src-tauri` — the Rust/Tauri 2.x shell that turns the `desktop/src` web frontend into the Buzz desktop application (Windows/macOS/Linux). [CODE]

### 8.1 Overview

- Crate name: `buzz-desktop`, lib target `buzz_lib` (`desktop/src-tauri/Cargo.toml:9-24`). [CODE]
- Tauri version 2, with plugins: `deep-link`, `opener`, `single-instance`, `window-state`, `dialog`, `updater`, `process`, `notification`, `global-shortcut` (`Cargo.toml` `[dependencies]`). [CODE]
- Package identifier: `xyz.block.buzz.app`, product name `Buzz`, version `0.5.23` (`tauri.conf.json:3-5`). [CODE]
- The crate has an *inner* Cargo workspace of its own (`[workspace] members = ["crates/buzz-terminal"]`), explicitly NOT inferring membership from the path deps up to the repo's shared crates — a comment notes this was a deliberate fix to a prior CI blind spot (`Cargo.toml:1-5`). [CODE]
- Optional `mesh-llm` feature pulls in the `iroh`/`mesh-llm-*` crates for the "shared compute" P2P LLM mesh; disabled builds use `mesh_llm_stubs.rs` instead of `mesh_llm/` (`lib.rs:23-26`). [CODE]
- Default feature `system-keyring` backs desktop secret storage with the OS keychain; when disabled, secrets fall back to `0o600` files (`Cargo.toml:16-19`, `secret_store.rs:1-24`). [CODE]

### 8.2 Entry point and app bootstrap

- `src/main.rs` is a thin launcher: on Linux it applies WebKitGTK rendering env fixes *before* any GTK object exists (must run single-threaded), then calls `buzz_lib::run()` (`main.rs:1-20`). [CODE]
- `src/lib.rs::run()` (≈950 lines) is the real entry point:
  - Optionally installs an 8&nbsp;MiB-stack multi-thread Tokio runtime when `mesh-llm` is enabled, because mesh-llm's async chains overflow Tauri's default 2&nbsp;MiB stacks (`lib.rs:100-122`). [CODE]
  - Builds a `tauri::Builder` registering: `single-instance` (focuses existing window + forwards deep links), `deep-link`, `notification`, `opener`, `window-state`, a custom `initial-window-reveal` plugin (coordinates first-paint reveal, esp. on macOS), the custom `native_websocket::init()` plugin, `dialog`, `process`, and conditionally `global-shortcut` (via `ptt_shortcut::install`) and `updater` (release builds only, gated by `cfg(buzz_updater_enabled)`) (`lib.rs:123-215`). [CODE]
  - Registers a custom **async URI scheme protocol** `buzz-media://` that proxies media through `media_proxy::handle_buzz_media` (`lib.rs:217-223`). [CODE]
  - `.manage(...)` registers shared app state: `AppState` (built by `app_state::build_app_state()`), clipboard state, pending deep-link stores, Builderlab session/login state, a pairing handle, terminal sessions, archive-sync state, the native relay client, unread/observed-unread stores, channel-head cache (`lib.rs:224-236`). [CODE]
  - `.setup(...)` runs boot sequence (see 8.6). [CODE]
  - `.invoke_handler(tauri::generate_handler![...])` registers ~356 commands (see 8.3). [CODE]
  - `app.run(...)` handles `RunEvent`s: macOS dock re-open, main-window close→hide-to-tray, huddle companion window close semantics, and graceful shutdown (`shut_down_app`) including a `mesh-llm`+macOS special case that force-exits before native Metal/ggml global destructors can abort (`lib.rs:885-947`). [CODE]

### 8.3 Tauri commands

356 `#[tauri::command]`-tagged functions across 94 files under `src/` (mostly `src/commands/**`, plus `src/huddle/**`, `src/archive/**`, `src/terminal_runtime.rs`, `src/managed_agents/runtime_commands.rs`, etc.) — counted via `grep -rc '#\[tauri::command\]' src`. [CODE] This is too large to enumerate exhaustively; grouped by responsibility:

| Module / file(s) | Command count (approx.) | Responsibility |
|---|---|---|
| `commands/agents.rs`, `commands/agent_*`, `managed_agents/runtime_commands.rs` | ~45 | Managed-agent lifecycle: create/start/stop/delete/list, runtime discovery, auth, model/provider config, settings, access policy |
| `commands/messages.rs`, `commands/messages/*` | ~13 | Feed/search/thread fetch, send/edit/delete message, reactions, forum posts |
| `commands/channels.rs`, `channel_templates.rs`, `channel_window.rs`, `channel_reconnect_repair.rs` | ~24 | Channel CRUD, membership, topic/purpose, templates, reconnect-gap repair |
| `commands/identity.rs`, `identity_archive.rs`, `key_backup.rs` (root) | ~27 | Nostr identity: get/import/sign, ncryptsec backups, archive/unarchive identities |
| `commands/project_git*.rs` | ~25 | Git-over-Nostr project features: repo snapshot/diff/clone/push/pull, PR/issue signing, merge terminals (see `git-sign-nostr`, `git-credential-nostr` crates) |
| `commands/personas/*`, `commands/team_snapshot.rs`, `commands/teams/*` | ~25 | Agent "persona" cards, team catalogs, export/import snapshots |
| `commands/media*.rs` | ~19 | Upload/download/transcode media, clipboard, snapshots, GIF, voice notes |
| `commands/workflows.rs` | 11 | Channel workflow automation: create/update/trigger/approve workflow runs |
| `commands/social.rs`, `dms.rs`, `bestie.rs` | ~14 | Nostr social notes (kind 1-style timeline), DMs, "bestie" (default agent assignment) |
| `commands/pairing.rs`, `agent_discovery/*` | ~8 | QR/SAS device pairing, relay-directory agent discovery |
| `commands/relay_members.rs`, `join_policy.rs` | ~7 | Relay/community membership management, join-policy fetch |
| `commands/mesh_llm.rs` / `mesh_llm_stubs.rs` | 6 | Start/stop/status of the local MeshLLM node, model catalog |
| `huddle/*` (voice) | ~35 | Voice "huddle" calls: join/leave, audio pipeline, STT/TTS, agent voice |
| `archive/*` | ~20 | Local event archive (SQLite via `rusqlite`): save subscriptions, read/index archived events, usage stats, sync |
| `terminal_runtime.rs`, `commands/project_terminal.rs` | ~11 | PTY-backed terminal sessions (via `portable-pty`) for agent/dev workflows |
| `builderlab.rs` (root) | 13 | "Builderlab" web-auth login/community management flow |
| `commands/workspace.rs`, `commands/canvas.rs`, `deep_link.rs` | ~15 | Active workspace/relay selection, shared canvas doc, deep-link handling |
| window/tray/OS glue: `window_chrome.rs`, `window_vibrancy.rs`, `tray_menu.rs`, `os_idle.rs`, `prevent_sleep.rs`, `macos_notifications.rs`, `updater.rs` | ~15 | Native window chrome, macOS tray, idle detection, sleep prevention, native notifications, updater status |

Most architecturally significant individual commands, by area:

- **Identity/auth**: `get_identity`, `get_nsec`, `import_identity`, `sign_event`, `sign_nostr_identity_binding`, `create_auth_event`, `nip44_encrypt_to_self`/`nip44_decrypt_from_self`, `sign_out` (`lib.rs:554-620`). These are the only points where the private key ever leaves Rust state to be used — signing happens in Rust, not JS. [CODE]
- **Agent lifecycle**: `create_managed_agent` (`commands/agents.rs:341`), `start_managed_agent`/`start_managed_agent_runtime` (`commands/agents.rs:821`, `managed_agents/runtime_commands.rs`), `stop_managed_agent`, `delete_managed_agent`, `reconcile_managed_agent_runtimes`. These drive the child-process spawn described in 8.6. [CODE]
- **Messaging**: `send_channel_message`, `send_managed_agent_channel_message`, `get_feed`, `get_channel_messages_before`, `edit_message`/`delete_message`, `add_reaction`/`remove_reaction` (`commands/messages.rs`). [CODE]
- **Workspace/relay selection**: `apply_workspace`, `get_active_workspace`, `get_relay_ws_url`/`get_relay_http_url`, `fetch_workspace_icon` (`commands/workspace.rs`). [CODE]
- **Media proxy**: `get_media_proxy_port` exposes the localhost media-proxy port started in `setup()` (see 8.5). [CODE]

### 8.4 IPC: frontend ↔ Rust

Two channels, standard Tauri 2 pattern, confirmed by counts in `desktop/src` (`grep invoke(` → 17 files, `grep listen(` → 16 files) and `lib.rs`'s `emit`/`register_asynchronous_uri_scheme_protocol` usage: [CODE]

```
Frontend (desktop/src, TS/React)
    │  invoke("command_name", { args })         (Tauri `@tauri-apps/api/core`)
    ▼
Rust #[tauri::command] fn  (desktop/src-tauri/src/commands/**, huddle/**, archive/**, ...)
    │  reads/writes tauri::State<AppState>, calls out to Nostr relay / OS / child agent processes
    ▼
Result<T, String>  ── returned synchronously to the invoke() Promise
```

```
Rust side (event push)
    app_handle.emit("event-name", payload)   e.g. "legacy-nest-migrated" (lib.rs:405),
                                              "huddle-companion-returned" (lib.rs:920),
                                              huddle-state-changed (see huddle module)
    │
    ▼
Frontend:  listen("event-name", callback)    (Tauri `@tauri-apps/api/event`)
```

- 25 `emit(...)` call sites found under `src/` (root `grep -rc "\.emit("`). [CODE] Examples confirmed by reading: `legacy-nest-migrated` (one-time nest migration hint, `lib.rs:405`), `huddle-companion-returned` (restores huddle drawer UI, `lib.rs:920`). [CODE]
- A custom Tauri plugin, `native_websocket::init()` (`lib.rs:200`, module `src/native_websocket.rs`), is registered — this is a Rust-side WebSocket implementation invoked from JS, distinct from the browser's built-in WebSocket; likely used so the relay/media socket runs in Rust and can survive webview reloads. Exact JS-facing API surface **[UNCLEAR — not traced beyond registration]**.
- Long-running/native async work (huddle audio pipeline, ACP agent processes, archive sync) is modeled as Rust-managed background tasks/state (`tauri::async_runtime::spawn`, `State<AppState>`), not one-shot commands — the frontend polls/subscribes via commands + emitted events rather than holding the async work itself. [CODE]

### 8.5 Native functionality exposed

- **Filesystem**: no blanket `fs` plugin permission is enabled (not present in `capabilities/default.json`); file access is mediated through specific commands (media upload/download, git/project files, archive DB, agent snapshots) implemented directly in Rust using `std`/`tokio::fs` rather than the generic Tauri fs plugin. [CODE]
- **Networking**:
  - The desktop app is a **thick client that connects outward to a remote (or self-hosted) Buzz relay over WebSocket** — it does not embed the relay server itself. Confirmed by `native_relay_client.rs`'s doc comment: "Owns the authenticated relay socket... Built on `buzz-ws-client`, which owns the wire format and the NIP-42 handshake" (`native_relay_client.rs:1-18`). [CODE]
  - `buzz_ws_client_pkg` (crate `buzz-ws-client`) and `nostr` (rust-nostr, with `nip44`/`nip49` features) are direct dependencies (`Cargo.toml`). [CODE]
  - A local **media streaming proxy** is started on `setup()` on localhost, port stored in `AppState.media_proxy_port` and exposed via `get_media_proxy_port` (`lib.rs:357-368`); it's used by the custom `buzz-media://` URI scheme handler (`lib.rs:217-223`, `media_proxy.rs`) so `<img>`/`<video>` tags can load relay-hosted media through Rust (adding auth/VPN-tunnelling) instead of directly. [CODE]
  - `reqwest` (with `rustls`/`aws_lc_rs`) is the general HTTP client (`Cargo.toml`), shared via `AppState.http_client`. [CODE]
- **OS keychain/credential storage**: `secret_store.rs` stores the nsec (private key) as one JSON blob per OS keychain entry (service = app service name, user = `"secrets"`), one prompt per process lifetime; backend selected per-target via the `keyring` crate (macOS SecKeychain, Windows credential store, Linux Secret Service via `sync-secret-service`+`vendored`) (`secret_store.rs:1-24`, `Cargo.toml` per-target `keyring` deps). Falls back to `0o600` files if `system-keyring` feature is off. [CODE] Explicitly documented as NOT on the `BUZZ_PRIVATE_KEY` env read path, to avoid divergent precedence with agent-child env injection (`secret_store.rs:17-21`). [CODE]
- **Notifications**: `tauri-plugin-notification` plus, on Linux, a direct `notify-rust` dependency used *alongside* the plugin specifically to hold the D-Bus posting connection open (GNOME 46+ dismisses notifications when that connection drops) — an example of working around a plugin limitation with raw platform code (`Cargo.toml` linux-target comment). On macOS, `objc2-user-notifications` bindings are used directly (`macos_notifications.rs`). [CODE]
- **Deep-linking**: `tauri-plugin-deep-link` with a registered `buzz://` URL scheme (`tauri.conf.json:46-50`), handled by `deep_link.rs` (community/navigation/entity deep links) and coordinated with `tauri-plugin-single-instance` so links opened while the app is already running get forwarded to the existing instance (`lib.rs:124-135`). [CODE]
- **Updater**: `tauri-plugin-updater`, registered only in non-debug builds behind a build-time `cfg(buzz_updater_enabled)` flag, with empty `endpoints` in the checked-in config (`tauri.conf.json:42-45`, `lib.rs:209-215`) — actual update endpoint(s) are presumably injected at release-build time. `is_auto_update_supported` command reports platform support (excludes Linux per `commands/updater.rs:11-13`). [CODE]
- **Global shortcuts**: `tauri-plugin-global-shortcut`, installed via `ptt_shortcut::install` for push-to-talk in huddles; disabled in test builds. [CODE]
- **Clipboard**: custom `ClipboardState` (not the generic Tauri clipboard plugin) built on `arboard`, with the `wayland-data-control` feature specifically enabled so copies work in native Wayland apps, not just XWayland (`Cargo.toml` comment). [CODE]
- **PTY/terminal**: `portable-pty` backs `terminal_runtime.rs`, giving agents/dev workflows a real terminal inside the desktop app (used by `project_terminal.rs`, `open_project_terminal` command). [CODE]
- **Audio**: `opus`, `neteq`, `rodio`, `earshot` (VAD), `rubato` (resampling), `sherpa-onnx` (local STT/TTS models) — full local voice pipeline for "huddles" (voice calls with humans/agents), see `src/huddle/`. [CODE]
- **Idle/sleep**: `user-idle` crate + `os_idle.rs`/`prevent_sleep.rs` for OS idle detection and preventing system sleep during active sessions. [CODE]

### 8.6 Embedded/sidecar processes — how agents actually run

This is the most important native-functionality finding for understanding the desktop app's role in the AI-agent architecture (see also §7):

- `tauri.conf.json`'s `bundle.externalBin` lists sidecar binaries shipped inside the app bundle: **`binaries/buzz-acp`, `binaries/buzz-agent`, `binaries/buzz-backend-kubernetes`, `binaries/buzz-dev-mcp`, `binaries/git-credential-nostr`, `binaries/buzz`** (the CLI) (`tauri.conf.json:52-62`). The Windows-specific override (`tauri.windows.conf.json`) drops `buzz-backend-kubernetes` from that list. [CODE]
- These are **not** run via Tauri's `Command::sidecar()` shell-plugin API; instead `managed_agents/runtime.rs` spawns them with plain `std::process::Command`, resolving the executable path itself (`resolve_command`, augmented `PATH` search covering: bundled sidecar dir next to the app exe, a local CLI symlink, nvm-managed Node, and the user's login-shell PATH) (`runtime.rs:520-561`). [CODE]
- **Per managed agent**, on start, Rust builds a `buzz-acp` child process and configures it entirely through environment variables, e.g.: `BUZZ_PRIVATE_KEY` (the agent's own nsec), `BUZZ_RELAY_URL`, `BUZZ_ACP_AGENT_COMMAND`/`BUZZ_ACP_AGENT_ARGS` (the underlying coding-agent CLI to run, e.g. Claude Code/Goose/etc.), `BUZZ_ACP_MCP_COMMAND` (optional MCP server sidecar), `BUZZ_ACP_LAZY_POOL`, `BUZZ_ACP_IDLE_TIMEOUT`, `BUZZ_ACP_MAX_TURN_DURATION`, `BUZZ_ACP_AGENTS` (parallelism), `BUZZ_ACP_SYSTEM_PROMPT`, `BUZZ_ACP_TEAM_INSTRUCTIONS`, `MCP_HOOK_SERVERS` (`runtime.rs:563-660`). [CODE] stdout/stderr are redirected to a per-agent log file (`log_path`, `open_log_file`) (`runtime.rs:505-519`). [CODE]
- So: **the desktop app is the process supervisor for locally-run AI agents** — it spawns one `buzz-acp` process per managed agent as a genuine OS child process (not a thread, not a plugin), hands it the agent's private key and relay URL over env vars, and the child process independently connects to the relay and runs the ACP protocol against a wrapped coding-agent CLI. Rust's job here is lifecycle (start/stop/restart/reap), config resolution, and logging — not message relaying at runtime. [CODE] Deep protocol/session details of `buzz-acp` itself are out of scope for this section — see §7.
- A background sweep task, started in `setup()`, runs every 60s to reap orphaned agent processes left behind by dead app instances (two-tick grace period to avoid killing agents mid-spawn) (`lib.rs:456-493`). [CODE]
- No local relay server is embedded in the desktop app — `buzz-relay` (the server crate) is not a dependency of `desktop/src-tauri` (see 8.7). [CODE]

### 8.7 Security configuration

- **CSP** (`tauri.conf.json:38-40`): `default-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/@mediapipe/; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost buzz-media: http://buzz-media.localhost https: http: wss: ws:; img-src 'self' buzz-media: http://buzz-media.localhost data: blob: https: http:; media-src 'self' buzz-media: http://buzz-media.localhost data: blob: https: http:; worker-src 'self' blob:`. Notably `connect-src`/`img-src`/`media-src` allow arbitrary `https:`/`http:`/`ws:`/`wss:` — broad, presumably necessary because the app connects to user-chosen/self-hosted relays and arbitrary link-preview/media URLs; this is a deliberate trade-off, not an oversight, but is a wide egress surface for a webview. [CODE][flag for review]
- **Capabilities** (`capabilities/default.json`): scoped to windows `["main", "huddle-*"]`, permission list includes `core:default`, targeted window controls (badge, focus, drag, close, show), `notification:default`, `opener:default`, `websocket:default`, `window-state:default`, `dialog:default`, `updater:allow-check/download/install`, `process:allow-restart`, `global-shortcut:allow-register/unregister/is-registered`. No filesystem, shell, or generic HTTP-plugin permissions are granted — those capabilities are implemented as custom Rust commands instead, keeping the actual OS-level access inside Rust-reviewed code rather than exposed as a generic capability to the webview. [CODE]
- `macOSPrivateApi: true` is enabled (`tauri.conf.json:37`) — used for macOS window vibrancy/traffic-light customization (`window_vibrancy.rs`, `tauri.conf.json`'s `trafficLightPosition`). [CODE]
- An `egress_guard.rs` module exists at the crate root (`src/egress_guard.rs`, with `egress_guard_tests.rs`) — name suggests outbound-request gating, likely relevant to the wide CSP `connect-src` above. **[UNCLEAR — not read in depth; flagged as relevant to security review]**.

### 8.8 Platform-specific code

- **Linux**: WebKitGTK rendering-environment fixes applied before GTK init (`webkit_rendering.rs`, called from `main.rs`); `getUserMedia` enablement + permission handling for the WebKitGTK webview (`linux_media.rs`); `notify-rust`+D-Bus for notification persistence; Secret Service keyring backend; Wayland clipboard support. [CODE]
- **macOS**: private API for vibrancy/traffic lights; native tray menu (`tray_menu.rs`, only compiled `cfg(target_os = "macos")`); native `UNUserNotificationCenter` bindings (`macos_notifications.rs`); dock re-open (`RunEvent::Reopen`) and close-to-hide-in-tray window behavior; a special mesh-llm shutdown path that force-exits to dodge a native Metal/ggml destructor abort (`lib.rs:934-945`); DMG installer layout (`tauri.conf.json` `bundle.macOS.dmg`, `Info.plist`, `Entitlements.plist`). [CODE]
- **Windows**: `windows-sys` bindings for security/filesystem/process/registry APIs; separate `tauri.windows.conf.json` overriding `externalBin` to drop the Kubernetes-backend sidecar. [CODE]

### 8.9 Shared Rust crates used by the desktop app

`desktop/src-tauri` depends directly on these workspace crates (path deps in `Cargo.toml`), showing what's shared between desktop and other Buzz binaries vs. desktop-only:

| Crate (as used) | Purpose (from crate name / doc comments seen) |
|---|---|
| `buzz-core` (`buzz_core_pkg`) | Shared core types/logic |
| `buzz-persona` (`buzz_persona_pkg`) | Agent "persona" data model |
| `buzz-sdk` (`buzz_sdk_pkg`) | Client SDK for talking to relay/backend |
| `buzz-agent` (`buzz_agent_pkg`) | Agent-related logic (also shipped as sidecar `buzz-agent`) |
| `buzz-voice` (`buzz_voice_pkg`) | Voice/huddle support |
| `buzz-ws-client` (`buzz_ws_client_pkg`) | WebSocket + NIP-42 relay wire client, used by `native_relay_client.rs` |
| `buzz-media` (`buzz_media_pkg`) | dev-dependency only — media validation, so client-side sanitize can be tested against the relay's actual acceptance contract |
| `buzz-terminal` (local `crates/buzz-terminal`) | PTY/terminal backend for `terminal_runtime.rs` |

`buzz-acp` itself is **not** a Rust library dependency of `desktop/src-tauri` — it is only consumed as a prebuilt sidecar binary (`externalBin`), confirming desktop and `buzz-acp` communicate purely as separate OS processes (env vars in, relay protocol at runtime), not via a shared Rust API. [CODE]

### 8.10 Notes / gaps for this section

- Exact JS-facing API of the custom `native_websocket` Tauri plugin was not traced (only its registration). [UNCLEAR]
- `egress_guard.rs` purpose inferred from name only, not read. [UNCLEAR]
- Windows updater endpoint values and code-signing configuration were not located in this pass (likely injected at CI/release time, per `.release/desktop-candidate.json` / release workflows — not inspected here). [UNCLEAR]

## 9. Backend Architecture

[CODE] The backend is a single Rust binary, **`buzz-relay`** (`crates/buzz-relay`), that is simultaneously: a Nostr relay (NIP-01 WebSocket protocol), an HTTP API server, a media/blob host, a Git-over-HTTP server, an inter-relay "mesh" node, and a runner for background workers (moderation, push notifications, deletion, workflow automation). It is a **multi-tenant** server: every table and almost every code path is scoped by `community_id`, and a single relay process can serve many "communities" (workspaces), each bound to a distinct HTTP `Host` header (`crates/buzz-relay/src/tenant.rs`).

### 9.1 Entry point and boot sequence

- Name: **buzz-relay** binary
- Responsibility: process bootstrap, config/secret loading, DB/Redis connection, background worker spawning, HTTP/WS server serving
- Technology: Rust, Tokio multi-threaded runtime, `axum` web framework, `sqlx` (Postgres), `deadpool-redis` (Redis)
- Important files: `crates/buzz-relay/src/main.rs` (boot orchestration, ~2300 lines), `crates/buzz-relay/src/config.rs` (env-var config), `crates/buzz-relay/src/lifecycle.rs` (staged boot tracker), `crates/buzz-relay/src/state.rs` (`AppState`, the shared app state struct)
- Inputs: environment variables (see `.env.example` / config table in a later section), Postgres, Redis
- Outputs: structured JSON logs (via `tracing` + `tracing-subscriber`), optional OTLP traces, Prometheus metrics, HTTP/WS responses
- Dependencies: `buzz-db`, `buzz-auth`, `buzz-audit`, `buzz-pubsub`, `buzz-search`, `buzz-media`, `buzz-workflow`, `nostr`, `axum`, `sqlx`, `deadpool-redis`
- Communicates with: Postgres (writer + optional read replica), Redis (pub/sub + cache invalidation + rate limiting), S3/MinIO-compatible object storage (media, git), an optional push gateway service, other relay pods over Redis pub/sub and (if mesh is enabled) directly over QUIC-like "mesh" transport

[CODE] Boot sequence, in order (`main.rs::run_relay_main`), tracked through a `BootTracker`/`StartupPhase` state machine (`lifecycle.rs`) that can mark phases required/degraded:
1. Install `rustls` crypto provider (`ring`).
2. Initialize structured JSON logging (+ optional OpenTelemetry OTLP exporter if `OTEL_EXPORTER_OTLP_ENDPOINT` is set).
3. Load `Config::from_env()`.
4. Load the relay's Nostr keypair from `BUZZ_RELAY_PRIVATE_KEY` (relay has its own Nostr identity, used to sign system/discovery events).
5. Bind the Prometheus metrics exporter (`relay_metrics::try_install`).
6. Connect to Postgres via `buzz-db::Db::new` (writer pool + optional lazy read-replica pool).
7. Optionally run DB migrations if `BUZZ_AUTO_MIGRATE=true` ([CODE] `buzz_auto_migrate_enabled`, `main.rs:29-36, 273-283`).
8. Ensure future partitions exist for the `events`/`delivery_log` monthly-partitioned tables (`db.ensure_future_partitions(3)`).
9. Validate the "community deletion serving fence" (a safety catalog check — `db.validate_deletion_serving_catalog()`).
10. Spawn a replica-freshness "fence probe" that gates whether read-replica routing is allowed (`db.spawn_fence_probe()`).
11. NIP-43 (relay membership) bootstrap: derive the deployment's own `community` row from `BUZZ_RELAY_URL`'s host, ensure it exists, migrate `pubkey_allowlist` rows into `relay_members`, and bootstrap the configured `RELAY_OWNER_PUBKEY` as owner. Several of these steps are **fatal** at startup if `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`, non-fatal warnings otherwise.
12. Backfill `d_tag` on legacy NIP-33 parameterized-replaceable events.
13. Optionally start the audit service (`buzz-audit`, gated by `BUZZ_AUDIT_ENABLED`).
14. Connect a Redis pool (`deadpool_redis`) and construct `PubSubManager` (`buzz-pubsub`); spawn three long-running subscriber tasks: cross-pod event fan-out, cross-pod cache invalidation, cross-pod connection control (ban/disconnect commands).
15. Construct `AuthService` (`buzz-auth`).
16. Construct `SearchService` (`buzz-search`) — Postgres full-text search, preferring the read replica.
17. Construct `WorkflowEngine` (`buzz-workflow`) for automations/webhooks/cron.
18. Validate and initialize `MediaStorage` (`buzz-media` — S3/MinIO-backed blob storage).
19. Build `AppState` (`state.rs`), the single struct threaded through all handlers via `Arc<AppState>`.
20. Optionally boot the inter-relay "mesh" (`mesh_boot::boot_mesh`) — off by default (`BUZZ_MESH` kill switch).
21. Run a Git-object-storage conformance probe against the configured S3/MinIO backend (fatal on failure unless disabled via `BUZZ_GIT_CONFORMANCE_PROBE=false`) — this is a linearizable conditional-write ("CAS") capability check the git-over-object-storage design depends on.
22. Verify the "channel roster fence" and repair any legacy NIP-29 channel member snapshots.
23. If membership is enforced, reconcile NIP-43 membership snapshots and start a periodic reconciliation loop (`BUZZ_NIP43_RECONCILE_INTERVAL_SECS`, default 60s).
24. Optionally reconcile channel discovery events from DB state (`BUZZ_RECONCILE_CHANNELS`, dev/CI only).
25. Wire the workflow engine's "action sink" to the relay (`workflow_sink::RelayActionSink`) and start its cron loop.
26. Spawn numerous background workers (see §9.3).
27. Build the app router and health router (`router::build_router`, `router::build_health_router`).
28. Spawn a periodic pool-metrics task and a periodic "usage metrics" task (per-community gauges for Prometheus/Datadog).
29. Call `serve(...)` — binds listeners and runs until SIGTERM, then performs a graceful drain (readiness flips to 503, a 5s grace period, then up to 30s hard-drain timeout for in-flight WebSockets) — see the large doc comment at `main.rs:1319-1362` and `GRACEFUL_DRAIN_TIMEOUT`.

[CODE] Listeners (from the doc comment at `main.rs:1319-1332`): a TCP app listener (`BUZZ_BIND_ADDR`, default port 3000, serving both the Nostr WebSocket and HTTP API), an optional Unix Domain Socket listener, a TCP health-only listener (port 8080) for Kubernetes probes, and a separate TCP metrics listener (port 9102, bound directly by the Prometheus exporter builder).

### 9.2 HTTP router and endpoint map

[CODE] `crates/buzz-relay/src/router.rs::build_router` composes several sub-routers (each `with_state(state.clone())`) and layers `track_metrics` middleware, an HTTP trace layer, and a CORS layer (`BUZZ_CORS_ORIGINS`; permissive if unset) on top.

| Method | Route | Purpose | Auth | Handler file |
|---|---|---|---|---|
| GET | `/` | Content-negotiated: NIP-11 relay-info JSON for `Accept: application/nostr+json`, else upgrades to the Nostr WebSocket (or serves the SPA index if Git web GUI is enabled) | None for NIP-11; connection then does NIP-42 over the socket | `router.rs::nip11_or_ws_handler` |
| GET | `/info` | NIP-11 relay information document | None | `nip11.rs::relay_info_handler` |
| GET | `/.well-known/nostr.json` | NIP-05 identifier → pubkey resolution | None | `api/nip05.rs` |
| GET | `/health`, `/_liveness` | Liveness probe | None | `router.rs` |
| GET | `/_readiness` | Public-listener readiness (Postgres/Redis/deletion-catalog checks) | None | `router.rs::public_readiness_handler` |
| POST | `/events` | Submit a signed Nostr event over plain HTTP (bridge, not WS) | NIP-98 | `api/bridge.rs::submit_event` |
| POST | `/query` | Query events (REQ-equivalent) over HTTP | NIP-98 | `api/bridge.rs::query_events` |
| POST | `/count` | NIP-45 count query over HTTP | NIP-98 | `api/bridge.rs::count_events` |
| POST | `<gifs search path>` / `<gifs share path>` | Relay-proxied third-party GIF search/share | NIP-98 | `api/gifs.rs` |
| GET | `/workflows/{workflow_id}/runs` | List workflow runs | [UNCLEAR — likely NIP-98] | `api/workflows.rs::workflow_runs` |
| GET | `/workflows/{workflow_id}/runs/{run_id}/approvals` | List approvals for a workflow run | [UNCLEAR] | `api/workflows.rs::run_approvals` |
| GET/POST | `/operator/communities` | List / provision communities (multi-tenant operator API) | [UNCLEAR — operator-scoped] | `api/operator.rs` |
| POST | `/operator/communities/archive` \| `/unarchive` \| `/transfer` | Community lifecycle operations | [UNCLEAR] | `api/operator.rs` |
| GET | `/operator/communities/availability` | Host/community availability check | [UNCLEAR] | `api/operator.rs` |
| POST | `/api/invites` | Mint a relay invite (owner/admin) | NIP-98 + role check | `api/invites.rs::mint_invite` |
| GET | `/api/join-policy` | Fetch the relay's join policy | None | `api/invites.rs::join_policy` |
| GET | `/api/join-policy/terms`, `/privacy` | Static policy documents (opened in system browser by desktop client) | None | `api/invites.rs` |
| POST | `/api/invites/accept-policy` | Record policy acceptance | [UNCLEAR] | `api/invites.rs::accept_policy` |
| POST | `/api/invites/claim` | Redeem an invite code (explicitly exempt from the membership gate) | Invite-token based | `api/invites.rs::claim_invite` |
| GET | `/moderation/reports`, `/moderation/audit`, `/moderation/restricted` | Moderation queue reads | NIP-98 + moderator-authz gate | `api/bridge.rs` |
| POST | `/hooks/{id}` | Inbound webhook trigger for workflow automations | Shared secret (not NIP-98) | `api/bridge.rs::workflow_webhook` |
| POST | `/_mesh/demo/echo` | Mesh testbed echo probe | Disabled unless `BUZZ_MESH=on` and `BUZZ_MESH_DEMO_ECHO=on` (404 otherwise) | `api/mesh_demo.rs` |
| GET | `/huddle/{channel_id}/audio` | WebSocket upgrade for voice/audio "huddles" | [UNCLEAR, likely same NIP-42 pattern] | `audio/handler.rs::ws_audio_handler` |
| PUT | `/upload`, `/media/upload` | Upload a media blob (Blossom-style) | [UNCLEAR — likely NIP-98] | `api/media.rs::upload_blob` |
| GET/HEAD | `/media/{sha256_ext}` | Fetch/probe a media blob by content hash | [UNCLEAR] | `api/media.rs::get_blob` / `head_blob` |
| (git smart-HTTP routes) | mounted via `api::git::git_router` / `git_policy_router` | Git-over-HTTP for the "git-on-object-storage" feature | [UNCLEAR — see `docs/git-on-object-storage.md`] | `api/git/*.rs` |
| `/api/admin/v1/*` | mounted only if `AdminConfig` is set | Admin dashboard API (separate from the operator API) | Session/token per `api/admin/auth.rs` | `api/admin/mod.rs` |

[CODE] The router also serves two Single Page Applications as static file fallbacks: the **admin web bundle** (only for requests to the configured admin `Host`, with a strict Content-Security-Policy — see `router.rs::ADMIN_CSP`, `with_admin_csp`) and the **public web bundle** (only for `/invite/*` landing pages, and optionally `/repos*` "git web GUI" paths if `serve_git_web_gui` is enabled). All other unmatched paths on the admin host are hard 404s — "the directory is not browsable" (`router.rs:231-237` comment).

[CODE] `build_health_router` is a separate, unauthenticated, no-CORS, no-metrics-middleware router bound to its own port (8080), exposing `/_liveness`, `/_readiness` (with the `reason` field included, unlike the public one), `/_status` (service name/version/uptime/build SHA), and `/_mesh` (live mesh peer/status JSON).

### 9.3 WebSocket protocol handling (Nostr NIP-01)

[CODE] Connection lifecycle (`connection.rs`):
1. `nip11_or_ws_handler` resolves the request's `Host` header to a `TenantContext` (community) via `tenant::bind_community` **before** any WebSocket frame is read ("row zero" binding — an unmapped host fails with a generic 404, never revealing which hosts exist).
2. On upgrade, `handle_connection` registers the connection in a per-community connection registry, checks the community is active, and (if the connection semaphore has capacity) proceeds to `handle_active_connection`.
3. A random NIP-42 `AUTH` challenge is generated and sent immediately (`generate_challenge` from `buzz-auth`); the connection has `AUTH_TIMEOUT` = 5 seconds to complete authentication or is dropped.
4. Three concurrent loops run per connection: a receive loop (parses `ClientMessage`s), a send loop (drains an mpsc channel of outbound `WsMessage`s, batched up to `MAX_WS_SEND_BATCH`=64 frames per flush), and a heartbeat/control loop (Pong/Close on a separate priority channel so control frames aren't blocked by backpressure).
5. Backpressure: if a connection's outbound buffer fills, the relay counts consecutive failures; after `grace_limit` (configurable) consecutive full-buffer events it force-disconnects the slow client (`ConnectionState::send`, `connection.rs:96-119`).

[CODE] NIP-01 message types (`protocol.rs::ClientMessage`): `EVENT` (submit a signed event), `REQ` (open a subscription with up to `MAX_FILTERS_PER_REQ`=10 filters and a sub_id up to `MAX_SUB_ID_LENGTH`=256 chars, plus a Buzz extension field `before_id` for cursor-based pagination tiebreaking), `CLOSE` (cancel a subscription), `COUNT` (NIP-45 aggregate count), `AUTH` (NIP-42 challenge response, kind:22242 — **never persisted or logged**, per `buzz-auth/src/lib.rs` doc comment).

[CODE] Server → client `RelayMessage`s are defined in the same `protocol.rs` module (not fully read in this pass — [NEEDS VERIFICATION] for the exact enum, but standard Nostr relay messages `EVENT`, `OK`, `EOSE`, `CLOSED`, `NOTICE`, `COUNT`, and `AUTH` are the expected set given NIP-01/NIP-42/NIP-45 support).

[CODE] Handler modules under `crates/buzz-relay/src/handlers/` route each parsed client message to domain logic: `event.rs` (EVENT ingestion — validation, persistence, side effects, fan-out; 2496 lines, the largest handler), `req.rs` (REQ — filter translation to SQL, live subscription registration; 2545 lines, the largest file in the crate), `close.rs`, `count.rs`, `auth.rs` (NIP-42 verification wiring), `ingest.rs`, `channel_authz.rs` (per-channel access control), `moderation_authz.rs`, `moderation_commands.rs`, `moderation_notices.rs`, `community_provisioning.rs`, `identity_archive.rs`, `imeta.rs`, `push_lease.rs`, `product_feedback.rs`, `relay_admin.rs`, `report.rs`, `report_resolution.rs`, `side_effects.rs` (post-persistence side effects: system messages, discovery-event re-emission, subscription eviction — used heavily by the background reapers), `admin_action_worker.rs`, `admin_outbox_worker.rs`, `command_executor.rs`.

### 9.4 Background workers / periodic jobs

[CODE] All spawned in `main.rs` via `tokio::spawn`, running for the process lifetime:

| Worker | Interval | Purpose |
|---|---|---|
| Redis pub/sub event subscriber | continuous | Cross-pod event fan-out to local WS subscribers (`buzz_relay::handlers::event::fan_out_pubsub_event`) |
| Redis cache-invalidation subscriber | continuous | Drops local in-memory (moka) caches when membership/visibility changes on another pod |
| Redis connection-control subscriber | continuous | Applies cross-pod ban/disconnect commands to local sockets |
| Workflow cron loop | internal | Drives scheduled workflow automations (`buzz-workflow::WorkflowEngine::run`) |
| Ephemeral channel reaper | `BUZZ_REAPER_INTERVAL_SECS` (default 60s) | Archives channels whose TTL deadline passed; emits system messages, updates NIP-29 discovery events, evicts subscriptions |
| NIP-43 membership reconciliation loop | `BUZZ_NIP43_RECONCILE_INTERVAL_SECS` (default 60s) | Repairs the event-backed relay-membership roster |
| NIP-PL push matcher + delivery worker | continuous | Matches events against push subscriptions and delivers to the push gateway (only if `BUZZ_PUSH_ENABLED=true`) — `push_runtime.rs` |
| Admin outbox delivery worker | continuous | Delivers `relay_admin_outbox` rows with DB-level leases for multi-pod safety (`handlers/admin_outbox_worker.rs`) |
| Admin action recovery worker | continuous | Resumes stranded `relay_admin_actions` rows after a crash, from persisted `step_marker` state (`handlers/admin_action_worker.rs`) |
| NIP-ER reminder scheduler | `SPROUT_REMINDER_SCHEDULER_INTERVAL_SECS` (default 10s) | Polls due reminders, claims them via atomic DB claim, publishes to Redis pub/sub |
| Community lifecycle revalidator | `BUZZ_COMMUNITY_REVALIDATE_INTERVAL_SECS` (default 30s) | Backstop for missed Redis pub/sub archive commands; only revalidates communities with local live sockets |
| Pool metrics poller | `BUZZ_POOL_METRICS_INTERVAL_SECS` (default 10s) | Exports DB/Redis pool gauges, replica-fence lag, deletion serving-lease stats |
| Usage metrics poller | env-configured | Exports per-community and fleet-wide usage gauges to Prometheus |

[CODE] Concurrency-safety pattern used throughout: **claim-before-publish** with an opaque per-attempt "delivery stamp" so a failed side effect can be rolled back without clobbering a different pod's concurrent claim (see the reminder scheduler comment at `main.rs:892-905`).

### 9.5 Supporting crates (one per responsibility)

### `buzz-auth` — Authentication & authorization
- Responsibility: verify NIP-42 (WebSocket AUTH, kind:22242) and NIP-98 (HTTP `Authorization: Nostr` header, kind:27235) signed-event authentication; per-connection rate limiting; OAuth-style scope parsing; "NIP-FI" federated identity assertion verification (JWKS-based, for enterprise IdP integration).
- Key files: `crates/buzz-auth/src/nip42.rs`, `nip98.rs`, `nip98_replay.rs` (replay-attack protection), `access.rs`, `rate_limit.rs`, `scope.rs`, `nip_fi.rs`.
- [CODE] Explicit security invariant documented in the crate root: "AUTH events (kind:22242) are NEVER stored or logged." No JWT validation, no token management, no IdP runtime dependency for the core NIP-42/NIP-98 paths.
- Produces an `AuthContext { pubkey, scopes, channel_ids, auth_method, agent_owner_pubkey }` consumed by `buzz-relay` handlers to authorize every subsequent action on a connection.
- A `#[cfg(any(test, feature = "dev"))]`-gated function `derive_pubkey_from_username` deterministically derives a Nostr keypair from a plain username (`SHA-256("buzz-test-key:{username}")`) for dev/test convenience — explicitly documented as insecure and excluded from production builds.

### `buzz-pubsub` — Redis fan-out, presence, typing
- Responsibility: multi-pod event fan-out, cross-pod cache invalidation, cross-pod connection control, online/offline presence, typing indicators, a Redis-backed rate limiter, and a Redis-backed NIP-98 replay guard.
- [CODE] Architecture (from the crate doc comment, `buzz-pubsub/src/lib.rs:1-21`): a `deadpool-redis` pool is used for ordinary commands (`PUBLISH`, `SET`, `ZADD`, …); a **separate, dedicated** `redis::aio::PubSub` connection (not pooled, because pub/sub is stateful) dynamically `SUBSCRIBE`s to `buzz:{community}:channel:{id}` and `buzz:{community}:global` topics, and `run_subscriber()` fans messages out to N local WebSocket receivers over an in-process `broadcast::channel(4096)`. Reconnects automatically on Redis disconnect with exponential backoff (1s → 30s cap).
- Modules: `cache_invalidation.rs`, `conn_control.rs`, `presence.rs`, `publisher.rs`, `subscriber.rs`, `rate_limiter.rs`, `nip98_replay.rs`.

### `buzz-db` — Postgres event store
- Responsibility: connection pooling (writer + optional lazy read-replica), schema migrations, and all domain persistence/query logic.
- [CODE] Crate doc invariants (`buzz-db/src/lib.rs`): AUTH events (kind 22242) are never stored; ephemeral events (kind 20000–29999) are never stored (Redis pub/sub only); the `events` table is partitioned by month on `created_at`; no foreign keys reference partitioned tables; queries use `sqlx::query()` (runtime-checked) rather than `sqlx::query!()` (compile-time macro).
- Internal module split (not public API): `runtime` (pool construction, writer/replica routing, transactions, sessions, metrics, health, migrations — `crates/buzz-db/src/runtime/{mod,migration,observability,replica_fence}.rs`) vs. `store` (domain SQL, row mapping, locking, mutation rules — one file per domain area: `community.rs`, `channel.rs`, `channel_members.rs`, `event.rs`, `dm.rs`, `reaction.rs`, `thread.rs`, `feed.rs`, `user.rs`, `moderation.rs`, `admin_moderation.rs`, `deletion.rs`, `git_repo.rs`, `push.rs`, `reminder.rs`, `relay_invite.rs`, `relay_members.rs`, `relay_operators.rs`, `relay_admin_actions.rs`, `replaceable.rs`, `allowlist.rs`, `api_token.rs`, `archived_identities.rs`, `partition.rs`, `product_feedback.rs`, `usage.rs`, `workflow.rs`).
- **Migrations**: [CODE] `crates/buzz-db/src/runtime/migration.rs` uses `sqlx::migrate!("../../migrations")` — an embedded `sqlx` migrator that applies the checked-in, additive SQL files in `migrations/*.sql` at the versioned filename order. `run_migrations` wraps the entire migrator run in an **exclusive Postgres advisory lock** (`SCHEMA_DESTRUCTION_LOCK_KEY`), serializing schema changes against concurrent destructive community-deletion transactions (which take a shared counterpart lock). A source lint enforces that `MIGRATOR.run` is called from nowhere else. After migrating, the code re-verifies a "replica-fence floor guard" trigger exists on the `events` parent table and every partition (a partition attached via `ATTACH PARTITION` rather than `CREATE TABLE .. PARTITION OF` would silently miss the parent's trigger, so this is a fail-closed catalog check). Migrations only run automatically when `BUZZ_AUTO_MIGRATE=true`; otherwise the operator is expected to run them out-of-band (`just` recipes — see build/run section).
- `schema/schema.sql` is a **consolidated, generated snapshot** of the schema state after all migrations — the practical single place to read full table/column/index/constraint definitions (see §10).

### `buzz-search` — Full-text search
- [CODE] From `main.rs` comments: search is implemented as **Postgres full-text search (FTS)** over the same `events` table, not a separate search engine — "the searchable row IS the persisted event row (its `tsvector` column is populated by the `insert_event` write)". Comments note this replaced an earlier Typesense-based design ("Typesense → Postgres FTS"). The search service opens its own connection pool, preferring the read replica when configured (`config.read_database_url`).

### `buzz-audit` — Audit logging
- Responsibility: durable audit trail, gated by `BUZZ_AUDIT_ENABLED`. Uses its own small Postgres connection pool (`connect_audit_pool`, max 5 connections) so audit writes don't compete with the main pool. Provides a `AuditService` and a graceful-drain handle (`audit_shutdown.drain(...)`) used at shutdown to flush buffered entries. [UNCLEAR — exact schema/what is audited needs deeper reading of `crates/buzz-audit/src`; the `audit_log` table exists in `schema/schema.sql:645`.]

### `buzz-deletion` and the "deletion" store module
- Responsibility: **community deletion** — a multi-step, fenced, resumable process (see `deletion_state` enum on `communities`: `active → quiescing → fenced → tombstone`, and tables `community_deletion_requests`, `community_deletion_approvals`, `community_deletion_checkpoints`, `community_deletion_manifest_keys`, `community_serving_write_leases`, `community_deletion_executor_heartbeats`, `storage_taxonomy_sweeps`). [CODE] The relay validates a "deletion serving catalog" at every boot (`db.validate_deletion_serving_catalog()`) and periodically reaps expired "serving write leases" — this strongly suggests deletion uses a lease/fence mechanism to safely stop serving a community's data before physically deleting it, likely coordinating with `buzz-backend-kubernetes` for infra-level teardown. [NEEDS VERIFICATION — exact state machine not read in full.]

### `buzz-relay-mesh` and mesh boot (`mesh_boot.rs`, `tunnel/`)
- [CODE] An **inter-relay mesh** feature, off by default behind a `BUZZ_MESH` kill switch. When enabled, `boot_mesh` binds a transport, registers per-profile inbound consumers (huddle/audio datagram fan-in, a "HuddleControl" accept loop, a reliable-stream accept loop, and an optional demo echo endpoint), and publishes the pod's mesh presence. Exposes live status at `/_mesh` on the health listener. [UNCLEAR — full peer-discovery/consensus mechanism not read in this pass; see `docs/` and `VISION_MESH.md` for design intent vs. `crates/buzz-relay-mesh/src` for implementation.]

### `buzz-pair-relay` and `crates/buzz-pairing-cli`
- [UNCLEAR — not read in this pass]. Naming suggests a device/agent "pairing" flow (QR-code or similar out-of-band trust establishment), separate from the main relay binary. Needs verification against `crates/buzz-pair-relay/src` and `docs/deployment-identity.md`.

### `buzz-push-gateway`
- Responsibility: a separate service (own `Dockerfile.push-gateway`, own Helm chart `deploy/charts/buzz-push-gateway`) that the relay's NIP-PL push matcher/delivery worker talks to for mobile/desktop push notifications. Tables `push_gateway_challenges`, `push_gateway_installations`, `push_gateway_delegations`, `push_gateway_endpoint_quotas`, `push_gateway_delivery_auth_replays`, `push_gateway_delivery_request_replays` in `schema/schema.sql` (lines 1124-1204) suggest a challenge/installation/delegation model with replay protection for push delivery authorization. See `docs/push-gateway-deployment.md` for operational detail. [NEEDS VERIFICATION against crate source.]

### `buzz-admin`
- Responsibility: backs the `/api/admin/v1` router mounted only when `AdminConfig` is present (`router.rs:54-61`), serving the separately-built **admin-web** SPA. Distinct from the "operator" API (`/operator/communities/*`), which appears to be for provisioning/lifecycle at the hosting-provider level rather than per-relay administration. [NEEDS VERIFICATION — not read in this pass; see `crates/buzz-relay/src/api/admin/*.rs` and `admin-web/`.]

### `buzz-cli`
- [UNCLEAR — not read in this pass.] Likely an operator/developer command-line tool for interacting with a Buzz relay (given the `git-credential-nostr` and `git-sign-nostr` sibling crates, this may bundle Nostr-based git tooling). Needs verification.

### `buzz-backend-kubernetes`
- [UNCLEAR — not read in this pass.] Naming suggests a Kubernetes-specific backend integration, plausibly used by the community-deletion or operator-provisioning flows to manage per-tenant infra. Needs verification against `crates/buzz-backend-kubernetes/src`.

### `ifc-core`
- [UNCLEAR — not read in this pass.] "IFC" commonly stands for Information Flow Control; given `docs/practical-information-flow-for-buzz-agents.md` exists, this crate plausibly underpins policy enforcement for what data AI agents are allowed to read/see. Needs verification.

### `buzz-datastore-tracing`
- [CODE, inferred from `main.rs` test module] Provides the `buzz_datastore` tracing target used to emit OpenTelemetry client-kind spans for individual SQL operations (e.g., a `SELECT` span nested under an `http.request` span — see the `http_and_datastore_spans_are_exported_in_the_same_trace` test in `router.rs`). Filtered independently from the general `RUST_LOG` via `BUZZ_OTEL_FILTER`.

### 9.6 Error handling & logging

[CODE] Logging is structured JSON via `tracing` + `tracing-subscriber`, controlled by `RUST_LOG` (default `buzz_relay=info`). A custom `EnvFilter` wrapper (`log_env_filter`) and a separate OTEL-specific filter (`BUZZ_OTEL_FILTER`, default enables the `buzz_datastore` target) let log verbosity and trace-export verbosity be tuned independently. Errors from fallible boot phases are captured by the `BootTracker`/`LifecycleReason` system (`lifecycle.rs`) which distinguishes **required** failures (abort startup) from **degraded** ones (log a warning, continue) — e.g., a failed OTLP exporter build degrades tracing but does not stop the relay from starting. Sensitive data (raw exporter/OTLP URLs, which "can carry credentials") is deliberately excluded from log lines (`main.rs:188-190` comment). Per-crate error types (`buzz-relay/src/error.rs::RelayError`, `buzz-db/src/error.rs`, `buzz-auth::error::AuthError`) are the primary error-handling mechanism; `anyhow::Result` is used at the top level in `main.rs` for boot-time failures.

---

## 10. Database / Storage

[CODE] Primary datastore: **PostgreSQL**, accessed through `sqlx` (async, runtime-checked queries) via the `buzz-db` crate. Secondary datastore: **Redis**, used for pub/sub fan-out, presence, rate limiting, and NIP-98 replay protection (not for durable business data). Object storage (S3/MinIO-compatible) is used for media blobs and Git repository data (`buzz-media`, `crates/buzz-relay/src/api/git/store.rs`) — see `deploy/charts/buzz/templates/quickstart-minio*.yaml` and `docker-compose.yml` for local MinIO wiring. `schema/schema.sql` is the authoritative, consolidated view of the current schema (1895 lines); `migrations/*.sql` (30+ files at the time of inspection, `0001_initial_schema.sql` through at least `0030_community_deletion_recovery.sql`) is the incremental, applied history.

### 10.1 Multi-tenancy model

[CODE] Every core table is scoped by a `community_id UUID` column that (per extensive schema comments) is treated as **immutable** once set — e.g. a Postgres trigger `channels_community_id_immutable()` raises an exception if `channels.community_id` is ever updated (schema.sql:128-140). Primary keys are consistently `(community_id, <natural id>)` composites rather than a bare UUID, so the same UUID (e.g. a channel id) can legitimately exist in two different communities without collision — every handler is expected to carry a `TenantContext` and scope all queries through it. This "row zero" tenant binding happens once per WebSocket connection, from the HTTP `Host` header, before any protocol frame is processed (`router.rs::nip11_or_ws_handler`, `tenant.rs::bind_community`).

### 10.2 Core tables (from `schema/schema.sql`)

| Table | Purpose | Key columns / relationships |
|---|---|---|
| `communities` | One row per tenant/workspace. | `id` (PK), `host` (unique, case-insensitive — the HTTP Host that maps to this tenant), `signing_key`, `icon`, `deletion_state` (`active`/`quiescing`/`fenced`/`tombstone`), `deletion_fence_generation`. |
| `channels` | Chat channels/streams/DMs within a community. | PK `(community_id, id)`; `channel_type`, `visibility`, `nip29_group_id` (unique per community — maps to NIP-29 group semantics), `participant_hash` (unique per community — used to dedupe DM channels by participant set), `ttl_seconds`/`ttl_deadline` (ephemeral channel expiry, consumed by the reaper worker), ownership/topic/purpose metadata. `community_id` is trigger-enforced immutable. |
| `channel_members` | Channel roster. | PK `(community_id, channel_id, pubkey)`, FK to `channels(community_id, id)` `ON DELETE CASCADE`; `role` (`member_role` enum), `removed_at`/`removed_by` (soft-remove), `hidden_at`. |
| `users` | Per-community user profile (Nostr kind:0 projection) + agent metadata. | PK `(community_id, pubkey)`; `nip05_handle` (unique per community), `agent_type`, `capabilities` (JSONB), `agent_owner_pubkey` (self-referencing FK to another `users` row in the same community — models an AI agent "owned by" a human user), `channel_add_policy`. |
| `events` | **The canonical Nostr event store** — every non-ephemeral, non-AUTH event the relay has accepted, for every community. Partitioned by month on `created_at`. | PK `(community_id, created_at, id)`; `pubkey`, `kind`, `tags` (JSONB), `content`, `sig`, `channel_id`, `d_tag` (NIP-33 parameterized-replaceable dimension), `deleted_at` (soft delete), `not_before`/`delivered_at` (NIP-ER-style scheduled delivery). A generated `search_tsv TSVECTOR` column powers Postgres FTS, explicitly **excluded** for encrypted/private kinds (1059=NIP-44 gift wrap DMs, 30179/30300/30350/30622/44100/44101/44200 — see list at schema.sql:224) "so encrypted/private routing wrappers... must never be discoverable through NIP-50 full-text search." |
| `event_mentions` | Fan-out index for `#p`-tag mentions (so "events mentioning pubkey X" is queryable without scanning `events.tags`). | PK `(community_id, pubkey_hex, event_id)`; the code comment explicitly warns that joins back to `events` must include `community_id` or they "leak cross-community mentions" — flagged as a verified-in-code security property. |
| `subscriptions` / `delivery_log` | Persisted (server-side, non-WebSocket) subscriptions with webhook/other delivery, and a partitioned audit log of delivery attempts. | `subscriptions` FKs to `users(community_id, owner_pubkey)`; `delivery_log` partitioned by month on `delivered_at`. |
| `workflows` / `workflow_runs` / `workflow_approvals` / `scheduled_workflow_fires` | Automation/workflow-engine definitions, their executions, human-in-the-loop approval gates, and cron-style scheduled triggers. | Backing store for `buzz-workflow`'s `WorkflowEngine`. |
| `api_tokens` | Long-lived API tokens (as opposed to per-connection NIP-42/NIP-98 auth). | [NEEDS VERIFICATION of exact scope model — see `buzz-auth::scope`.] |
| `rate_limit_violations` | Recorded rate-limit breaches. | Complements the Redis-backed live rate limiter with a durable record. |
| `thread_metadata` | Denormalized thread/reply-tree bookkeeping for messages. | |
| `reactions` | Emoji/reaction events (NIP-25-style), including a migration (`0028_long_reaction_payloads.sql`) suggesting reaction content grew beyond simple single emoji. | |
| `pubkey_allowlist` / `relay_members` / `join_policy_acceptances` / `relay_invites` | Relay membership model (NIP-43): a legacy flat allowlist (`pubkey_allowlist`, migrated away from at boot — see `db.backfill_from_allowlist`), the current `relay_members` roster, records of users accepting a join policy, and invite codes/tokens for onboarding. | |
| `archived_identities` | [UNCLEAR — likely holds identity records for users removed/archived from a community, for audit/recovery.] | |
| `audit_log` | Durable audit trail written by `buzz-audit`. | |
| `moderation_reports` / `community_bans` / `moderation_actions` | Content moderation: user-submitted reports, ban records, and the log of moderator actions taken. | |
| `git_repo_names` | Human-readable name ↔ repo mapping for the Git-over-object-storage feature. | |
| `parameterized_event_watermarks` | [UNCLEAR — likely a cursor/watermark table for NIP-33 parameterized-replaceable-event processing.] | |
| `product_feedback` | In-app feedback submissions (backing `handlers/product_feedback.rs` and the admin dashboard's `/feedback` route). | |
| `push_leases` / `push_wake_outbox` / `push_match_queue` / `push_gateway_*` | The NIP-PL push-notification pipeline: leases (which pod owns delivering to a given endpoint), an outbox of pending wake events, a match queue (events matched against subscriptions awaiting delivery), and gateway-side challenge/installation/delegation/quota/replay-protection tables. | |
| `replica_heartbeat` | Written periodically so the "replica fence" can measure read-replica replication lag and gate whether replica routing is safe (see `main.rs`'s `spawn_fence_probe`). | |
| `community_deletion_*` (`requests`, `approvals`, `checkpoints`, `manifest_keys`), `storage_taxonomy_sweeps`, `community_serving_write_leases`, `community_deletion_executor_heartbeats` | The full community-deletion state machine: requests, multi-party approvals, resumable checkpoints, per-object-storage-manifest encryption keys, a lease mechanism to stop "serving" a community mid-deletion, and executor liveness heartbeats. | |
| `relay_operators` / `relay_admin_actions` / `relay_admin_outbox` / `relay_operator_audit` | The relay-operator/admin-dashboard backing tables: who the operators are, a queue of admin actions with lease-based execution (consumed by `admin_action_worker.rs`), an outbox for admin-triggered side effects (consumed by `admin_outbox_worker.rs`), and an audit trail of operator activity. | |
| `_operator_global_tables` | [UNCLEAR — likely a small marker/registry table listing which tables are intentionally *not* tenant-scoped, used by a conformance/lint check.] | |

### 10.3 Entity relationships (simplified)

```text
communities (1) ──< channels (community_id, id)
communities (1) ──< users (community_id, pubkey)
communities (1) ──< events (community_id, created_at, id)   [partitioned monthly]
channels    (1) ──< channel_members (community_id, channel_id, pubkey)
users       (1) ──< users.agent_owner_pubkey (self-FK: agent "owned by" human user, same community)
events      (1) ──< event_mentions (fan-out index for #p mentions)
users       (1) ──< subscriptions (owner_pubkey) ──< delivery_log
workflows   (1) ──< workflow_runs (1) ──< workflow_approvals
communities (1) ──< community_deletion_requests (1) ──< community_deletion_approvals / checkpoints / manifest_keys
```

All of the above `1—<` relationships are additionally scoped by `community_id` on both sides — this is not optional foreign-key hygiene but (per the `event_mentions` comment) a documented, previously-verified security property (cross-tenant data leakage prevention).

### 10.4 Migrations vs. consolidated schema

[CODE] `migrations/000N_*.sql` are the incremental, additive-only SQL files applied in order by the embedded `sqlx` migrator (`buzz-db/src/runtime/migration.rs`) — see §9.5. `schema/schema.sql` is a **generated, consolidated snapshot** reflecting the cumulative effect of all migrations at the time it was last regenerated; it is the fastest way to see a table's *current* full definition, but the migrations directory is the source of truth for *how* the schema evolved and *why* (many migration filenames and the `schema.sql` inline comments reference specific conformance requirements, e.g. `0021_created_at_fence_floor.sql` ↔ the replica-fence floor-guard trigger verified at boot and after every migration run).

[NEEDS VERIFICATION] Whether a `Justfile`/`script` target regenerates `schema/schema.sql` automatically (a `just` recipe search — see §14 — would confirm; not independently verified in this pass).

## 11. Authentication and Security

This section consolidates authentication/security facts established across the backend (§9), Nostr protocol (§5), Tauri/desktop (§8), and configuration (§12) research passes. It does not re-derive them from scratch.

### 11.1 Identity model

**[CODE+DOCS]** There is no separate username/password account system anywhere in this repository. Identity **is** a Nostr secp256k1 keypair (npub/nsec). A human user, an AI agent, and the relay itself are all, structurally, "a pubkey" — the `users` table's `agent_owner_pubkey` self-referencing column is how an agent is modeled as "owned by" a human, not a separate identity type (§10.2). This is a deliberate design choice, stated directly in `README.md`: agents get "the same affordances as a human teammate, the same audit trail, a different keypair."

### 11.2 Authentication mechanisms (confirmed)

| Mechanism | Where | Used for |
|---|---|---|
| NIP-42 (WebSocket AUTH, kind:22242) | `crates/buzz-auth/src/nip42.rs`, wired in `connection.rs`/`handlers/auth.rs` | Every WebSocket connection to the relay (human clients, mobile, `buzz-acp` harnesses) |
| NIP-98 (HTTP signed-event auth, kind:27235) | `crates/buzz-auth/src/nip98.rs` + `nip98_replay.rs` | REST API calls (`/events`, `/query`, `/api/invites/*`, admin API, git-over-HTTP via `git-credential-nostr`) |
| NIP-07 browser extension / ephemeral key | `web/src/shared/lib/nostr-signer.ts` | Web client signing (falls back to a page-lifetime key for non-durable actions only) |
| OS keychain-backed key storage | `desktop/src-tauri/src/secret_store.rs` | Desktop client's held private key (macOS Keychain / Windows Credential Store / Linux Secret Service) |
| NIP-FI (federated identity assertion, JWKS-based) | `crates/buzz-auth/src/nip_fi.rs` | Enterprise IdP integration path — **[UNCLEAR]** exact trigger/usage not deep-dived |

**[CODE]** Explicit, documented invariant in `buzz-auth`'s crate root: *AUTH events (kind:22242) are never stored or logged* (they may carry additional bearer-token tags). This is a deliberate privacy/security property, not an oversight.

**[CODE]** A `#[cfg(any(test, feature = "dev"))]`-gated helper (`derive_pubkey_from_username`, deterministic `SHA-256("buzz-test-key:{username}")`) exists purely for dev/test convenience and is explicitly documented as insecure and excluded from production builds.

### 11.3 Authorization

**[CODE]** `AuthContext { pubkey, scopes, channel_ids, auth_method, agent_owner_pubkey }` is produced once per authenticated connection/request and threaded through every handler to authorize subsequent actions (`buzz-auth`). Channel-level authorization is a distinct module (`crates/buzz-relay/src/handlers/channel_authz.rs`); moderation actions have their own authorization path (`moderation_authz.rs`). Admin-dashboard requests are additionally gated by `RELAY_OPERATOR_PUBKEYS`/`RELAY_OWNER_PUBKEY` (Operator role) — see §12 config table.

**Relay-wide membership (optional, opt-in):**
- `BUZZ_PUBKEY_ALLOWLIST=true` — pubkey-only connections checked against a `pubkey_allowlist` table; fails **closed** on DB error.
- `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` — every authenticated connection checked against the `relay_members` table (NIP-43 extension, §5.1/§10.2), reconciled by a periodic background worker.

### 11.4 Encryption

**[CODE, see §5.4]** NIP-44 (versioned symmetric encryption) is the general encryption primitive, used for: agent persistent memory ("engrams", kind:30174), agent observability telemetry (kind:24200), device-pairing payloads, "private managed agent" records (kind:30179, currently reservation-only), and push-lease payloads (kind:30350). DM privacy is achieved via **NIP-17 gift wrap** (kind:1059), which itself uses ephemeral per-message signing keys plus NIP-44 encryption of the inner event, rather than a bare NIP-04/NIP-44-encrypted kind:4 event.

### 11.5 Credential / secrets handling

**[CODE+DOCS]**
- All backend configuration, including credentials, is environment-variable based (`.env.example`, §12). `SECURITY.md` and `.env.example` both state that real deployment secrets belong in a secret manager and must never be committed; the shipped `.env.example` values (e.g. `buzz_dev_secret`) are explicitly local-dev-only placeholders.
- Desktop: the user's private key is stored as a single OS-keychain blob entry (not on disk in plaintext), decoupled from the `BUZZ_PRIVATE_KEY` env-var read path used by agent processes, specifically to avoid divergent precedence rules (`secret_store.rs` doc comment, §8.5).
- AI agent LLM-provider credentials (`ANTHROPIC_API_KEY`, `OPENAI_COMPAT_API_KEY`, `OPENROUTER_API_KEY`, `DATABRICKS_TOKEN`, or Databricks OAuth) are read from environment variables by `buzz-agent`; `crates/buzz-agent/README.md`'s own "Security Model" section states credential lifecycle management (rotation, injection) is explicitly **out of scope** for that crate — an operator/deployment responsibility (systemd, Docker secrets, or a wrapper are suggested, none of which are shipped in this repo, §6.10/§6.13).
- `deny.toml` (`cargo-deny`) enforces a license allow-list and dependency security-advisory checks in CI (`_ci-security.yml`).

### 11.6 CORS

**[CODE]** `crates/buzz-relay/src/router.rs::build_router` applies a CORS layer configured by `BUZZ_CORS_ORIGINS`; **permissive (allow-any) if unset** — a default worth flagging for production hardening review (§12 config table doesn't list an explicit required-in-production marker for this variable; **[UNCLEAR]** whether deployment tooling sets a stricter default — check `deploy/charts/buzz/values.yaml` if hardening this).

### 11.7 WebSocket authentication

Covered in full in §5.5 (NIP-42 AUTH flow) and §4.C. Summary: challenge sent immediately on connect, 5-second timeout to respond, challenge/relay-URL/timestamp (±60s) all validated server-side before the connection is treated as authenticated.

### 11.8 Rate limiting

**[CODE]** `BUZZ_RATE_LIMIT_*` env vars (8 total, §12) configure per-minute/second admission limits for human messages, agent messages, API calls, WS events, and GIF search, enforced via `buzz-pubsub`'s Redis-backed rate limiter (`crates/buzz-pubsub/src/rate_limiter.rs`) plus a durable `rate_limit_violations` table (§10.2) recording breaches. **[CODE-CONFIRMED GAP, per `ARCHITECTURE.md` §9 as independently cross-checked in §1]**: the production rate-limiter has a documented test-only stub (`AlwaysAllowRateLimiter`) — flagged in the repo's own known-limitations list, not this document's invention.

### 11.9 Security-sensitive areas flagged for further review

These are **not** claimed to be vulnerabilities — they are documented, code-confirmed facts that a new developer doing security work should be aware of and verify against current intent:

1. **ACP permission auto-approval** — `crates/buzz-agent/src/permission.rs`'s doc comment describes a client-enforced `BUZZ_ACP_PERMISSION_POLICY` gating every agent tool call, but `crates/buzz-acp/src/acp.rs::handle_permission_request` unconditionally auto-approves any `allow_once` option offered, and no `BUZZ_ACP_PERMISSION_POLICY` implementation exists anywhere in `crates/buzz-acp`. **Current behavior: every tool-call permission request an agent makes is auto-approved.** See §6.11 for full detail. **[CODE-confirmed, contradicts a doc comment — recommend verifying current intent with the team before relying on any permission gate.]**
2. **Desktop CSP `connect-src`/`img-src`/`media-src`** allow arbitrary `https:`/`http:`/`ws:`/`wss:` (`tauri.conf.json`) — a wide egress surface for a webview, plausibly necessary because the app connects to arbitrary user-chosen/self-hosted relays and link-preview/media URLs, but not narrowly scoped. See §8.7.
3. **`egress_guard.rs`** exists in `desktop/src-tauri/src` (with its own test file) — name suggests outbound-request gating, likely relevant to point 2 above, but its logic was not read in this research pass. **[UNCLEAR — needs verification.]**
4. **MCP shell tool trust boundary** — `crates/buzz-agent/README.md`'s own "Security Model" table states the shell tool's process is sandboxed only at the OS-process-lifecycle level (whitelisted env vars, process-group kill, bounded output size), not at the *capability* level: "the shell runs at the operator's trust level, like bash itself." This is documented, intentional scope, not a gap — but is worth a new developer's explicit awareness before granting an agent shell access. See §6.11.
5. **CORS default** (§11.6) — permissive unless `BUZZ_CORS_ORIGINS` is explicitly set.

### 11.10 What is explicitly confirmed as NOT implemented (do not assume otherwise)

- No NIP-04 (legacy encrypted DM). **[DOCS: `NOSTR.md`]**
- No evidence Buzz relay/clients act as a NIP-46 remote-signer (bunker) *client* — only that a bunker connection string can be transported as one payload type during device pairing. **[CODE, limited — see §5.1]**
- No JWT validation or general token-management system on the core NIP-42/NIP-98 auth paths (`buzz-auth` crate-doc). **[CODE]**

## 12. Configuration

**Sources:** `.env.example` [CODE] (17KB, fully read), `docker-compose.yml` [CODE], `docker-compose.harness.yml` [CODE], `TESTING.md` [DOCS], `SECURITY.md` [DOCS], `deploy/charts/buzz/values.yaml` [CODE].

All Buzz backend configuration is environment-variable based (no config-file format for the relay itself; the ACP harness additionally supports a TOML file for one feature — see below). `cp .env.example .env` is the documented bootstrap step (`Justfile` `bootstrap` recipe). `set dotenv-load := true` at the top of the `Justfile` means every `just` recipe auto-loads `.env`.

### Configuration Table

| Variable / Config | Purpose | Required? | Used By | Default/Example |
|---|---|---|---|---|
| `DATABASE_URL` | Postgres connection string (writer) | Yes (or PG* vars) | relay, buzz-admin (migrate), buzz-db | `postgres://buzz:buzz_dev@localhost:5432/buzz` |
| `READ_DATABASE_URL` | Optional read-replica connection string | No | relay read paths | unset → all reads go to writer |
| `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` | Discrete Postgres connection parts (alt. to `DATABASE_URL`) | No | tooling that expects libpq env vars | `localhost`/`5432`/`buzz`/`buzz_dev`/`buzz` |
| `BUZZ_REDIS_POOL_SIZE` | Max connections in relay's shared Redis pool | No | buzz-relay | `16` |
| `BUZZ_DB_POOL_SIZE` | Max connections per relay Postgres pool (writer, and reader if `READ_DATABASE_URL` set) | No | buzz-relay | `50` |
| `BUZZ_DB_LOCK_TIMEOUT_MS` | Postgres `lock_timeout` for relay/buzz-db pools; 0 disables | No | buzz-db, relay audit pool | `5000` |
| `BUZZ_DB_IDLE_TXN_TIMEOUT_MS` | Postgres `idle_in_transaction_session_timeout` | No | buzz-db, relay audit pool | `60000` |
| `BUZZ_DB_STATEMENT_TIMEOUT_MS` | Postgres `statement_timeout`; 0 = off | No | buzz-db, relay audit pool | `0` (off — startup migrations can run long) |
| `REDIS_URL` | Redis connection string (pub/sub, rate limiting) | Yes | buzz-relay, buzz-pubsub | `redis://localhost:6379` |
| `TYPESENSE_API_KEY` / `TYPESENSE_URL` | Search backend (Typesense) credentials/endpoint | Needs verification — no Typesense service is defined in `docker-compose.yml`, only referenced in `.env.example`; buzz-search crate presumably consumes it | buzz-search | key `buzz_dev_key`, url `http://localhost:8108` |
| `BUZZ_BIND_ADDR` | Relay WebSocket/HTTP bind address | No | buzz-relay | `0.0.0.0:3000` |
| `RELAY_URL` | Public WS URL advertised in NIP-42 auth challenges / NIP-11 (note: no `BUZZ_` prefix) | Yes (production) | buzz-relay | `ws://localhost:3000` |
| `BUZZ_RELAY_PRIVATE_KEY` | Relay's own stable Nostr signing key (hex) | Yes (persisted) | buzz-relay | generated by `just bootstrap` / `scripts/ensure-local-relay-key.sh` into `.env` |
| `BUZZ_WEB_DIR` | Path to built web frontend (`web/dist`); when set, relay serves it at `/` | No | buzz-relay | unset in dev (use `just web` for Vite HMR); container default `/srv/buzz/web` |
| `BUZZ_SERVE_GIT_WEB_GUI` | Expose bundled Git repo browser at `/` and `/repos/...` | No | buzz-relay | `false` |
| `BUZZ_PUSH_ENABLED` | Enable NIP-PL mobile push delivery (explicit opt-in) | No | buzz-relay | `false` |
| `BUZZ_PUSH_GATEWAY_DELIVERY_URL` | Push gateway delivery endpoint | No | buzz-relay | `https://push.buzz.xyz/v1/deliveries/apns` if enabled and unset |
| `BUZZ_ADMIN_HOST` | Hostname serving the moderation dashboard + `/api/admin/v1` | No | buzz-relay admin API | unset (admin surface absent) |
| `BUZZ_ADMIN_AUTH` | Admin auth mode: `nip98` (default) or `disabled` | No | buzz-relay admin API | `nip98`; `BUZZ_ADMIN_TOKEN` is explicitly removed/ignored |
| `RELAY_OPERATOR_PUBKEYS` | Comma-separated hex pubkeys authorized as admin Operators | No (needed for `nip98` mode) | buzz-relay admin API | unset |
| `RELAY_OWNER_PUBKEY` | Implicit Operator fallback; bootstrapped as `owner` in `relay_members` at first start | No | buzz-relay | unset |
| `RELAY_OPERATOR_API_ORIGIN` | Canonical origin NIP-98 community-provisioning requests are verified against | Required only to use `POST /operator/communities` | buzz-relay | `http://127.0.0.1:3000` |
| `BUZZ_ADMIN_WEB_DIR` | Path to built admin dashboard assets | No | buzz-relay admin API | `./admin-web/dist` |
| `BUZZ_KLIPY_API_KEY` | Relay-owned GIF search (Klipy) API key | No | buzz-relay, desktop client (via relay proxy) | unset |
| `BUZZ_RATE_LIMIT_*` (8 vars) | Per-minute/second admission limits for human/agent messages, API calls, WS events, GIF search — Redis-backed | No | buzz-relay | e.g. `BUZZ_RATE_LIMIT_HUMAN_MESSAGES_PER_MIN=60`, `BUZZ_RATE_LIMIT_AGENT_PLATFORM_MESSAGES_PER_MIN=600` |
| `BUZZ_GIT_REPO_PATH` | Root dir for ephemeral Git workspaces + pack cache (NIP-34) | No | buzz-relay git handling | `./repos` |
| `BUZZ_GIT_MAX_PACK_BYTES` / `BUZZ_GIT_MAX_REPO_BYTES` | Git pack/repo size caps | No | buzz-relay | `524288000` / `1048576000` |
| `BUZZ_GIT_PACK_CACHE_PATH` / `_MAX_BYTES` / `_MAX_CONCURRENT_POPULATIONS` | Process-local immutable pack/index cache config | No | buzz-relay | `./repos/.pack-cache`, `5368709120`, `2` |
| `BUZZ_S3_ENDPOINT` / `_ACCESS_KEY` / `_SECRET_KEY` / `_BUCKET` / `_REGION` / `_ADDRESSING_STYLE` | S3-compatible object storage for media + Git CAS | Yes | buzz-relay, buzz-media | `http://localhost:9000`, `buzz_dev`, `buzz_dev_secret`, `buzz-media`, `us-east-1`, `path` |
| `BUZZ_MEDIA_MAX_CONCURRENT_UPLOADS` / `_PER_PUBKEY` / `BUZZ_MEDIA_UPLOADS_PER_MINUTE` | Media upload admission limits | No | buzz-media | `8` / `2` / `30` |
| `BUZZ_EPHEMERAL_TTL_OVERRIDE` | Override client-provided TTL for ephemeral channels (testing) | No | buzz-relay | unset (use client TTL) |
| `BUZZ_REAPER_INTERVAL_SECS` | How often expired-ephemeral-channel reaper runs | No | buzz-relay | `60` |
| `RUST_LOG` | Standard Rust `tracing` log-level filter | No | all Rust binaries | `buzz_relay=debug,buzz_datastore=info,...` |
| `BUZZ_OTEL_FILTER` | Independent OpenTelemetry trace target filter (decoupled from `RUST_LOG`) | No | buzz-relay tracing | unset |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP tracing collector endpoint | No | buzz-relay | unset (tracing export disabled) |
| `BUZZ_PRIVATE_KEY` | Nostr private key (hex/bech32) identifying an ACP agent | **Yes** for `buzz-acp` | buzz-acp harness | none — required |
| `BUZZ_RELAY_URL` | Relay WS URL the ACP harness connects to (distinct from relay's own `RELAY_URL`) | No | buzz-acp | same value as `RELAY_URL` in local dev |
| `BUZZ_ACP_AGENT_COMMAND` | Binary to spawn as the AI agent subprocess (e.g. `goose`, `codex-acp`, `claude-code`) | No | buzz-acp | `goose` |
| `BUZZ_ACP_AGENT_ARGS` | Comma-separated args passed to agent binary | No | buzz-acp | `acp` (goose); empty for codex/claude |
| `BUZZ_ACP_MCP_COMMAND` | Optional MCP server sidecar binary (e.g. `buzz-dev-mcp`) | No | buzz-acp | unset |
| `BUZZ_ACP_AGENTS` | Number of parallel agent subprocesses (1–32) | No | buzz-acp | `1` |
| `BUZZ_ACP_MODEL` | Desired LLM model ID applied to every new ACP session | No | buzz-acp | unset |
| `DATABRICKS_MODEL_FILTER` | Discovery-only visibility filter for Databricks model picker | No | buzz-acp / buzz-agent | unset (show all) |
| `BUZZ_ACP_TURN_TIMEOUT` | Max seconds per agent turn before timeout | No | buzz-acp | `320` (~5 min) |
| `BUZZ_ACP_MAX_TURNS_PER_SESSION` | Max turns before proactive session rotation; 0 disables | No | buzz-acp | `0` |
| `BUZZ_ACP_SYSTEM_PROMPT` / `_SYSTEM_PROMPT_FILE` | System prompt injected into every agent session (inline or file, mutually exclusive) | No | buzz-acp | unset |
| `BUZZ_ACP_INITIAL_MESSAGE` | Message sent to agent immediately after session creation | No | buzz-acp | unset |
| `BUZZ_ACP_HEARTBEAT_INTERVAL` | Seconds between heartbeat prompts; 0 disables, else must be ≥10 | No | buzz-acp | `0` |
| `BUZZ_ACP_HEARTBEAT_PROMPT` / `_PROMPT_FILE` | Heartbeat prompt text (inline or file) | No | buzz-acp | unset |
| `BUZZ_ACP_SUBSCRIBE` | Subscribe mode: `mentions` (default), `all`, or `config` | No | buzz-acp | `mentions` |
| `BUZZ_ACP_KINDS` | Comma-separated event kinds to subscribe to (overrides mode default) | No | buzz-acp | unset |
| `BUZZ_ACP_CHANNELS` | Comma-separated channel UUIDs limiting subscription scope | No | buzz-acp | unset |
| `BUZZ_ACP_NO_MENTION_FILTER` | Disable @-mention filter in mentions mode | No | buzz-acp | `false` |
| `BUZZ_ACP_CONFIG` | Path to TOML file for rule-based subscriptions (`config` mode) | No | buzz-acp | `./buzz-acp.toml` |
| `BUZZ_ACP_DEDUP` | Duplicate-event handling: `queue` (default) or `drop` | No | buzz-acp | `queue` |
| `BUZZ_ACP_NO_IGNORE_SELF` | Process the agent's own messages instead of ignoring them | No | buzz-acp | `false` |
| `BUZZ_ACP_SESSION_POLICY` | ACP provider session scoping: `channel` (legacy, one session/channel) or `thread` (one session per canonical thread) | No | buzz-acp | `channel` |
| `BUZZ_ACP_CONTEXT_MESSAGE_LIMIT` | Max context messages fetched for thread replies/DMs (0–100) | No | buzz-acp | `12` |
| `BUZZ_ACP_NO_PRESENCE` | Disable automatic online/offline presence | No | buzz-acp | `false` |
| `BUZZ_ACP_NO_TYPING` | Disable typing indicators while agent processes | No | buzz-acp | `false` |
| `BUZZ_ACP_EVENT_BUFFER` | Event channel buffer capacity (WS → harness), min 1 | No | buzz-acp | `256` |
| `BUZZ_ACP_PRIVATE_KEY` | Legacy alias for `BUZZ_PRIVATE_KEY` | No | buzz-acp | — |
| `VITE_BUZZ_FORCE_FRESH_ONBOARDING` | Dev-only: replay first-run onboarding/Welcome Team kickoff each launch | No | desktop (Vite build) | unset |
| `VITE_BUZZ_BESTIE` | Protected internal builds only: selects module graph containing the default-off "Bestie" experiment | No | desktop (Vite build) | unset — official OSS builds must leave unset |
| `BUZZ_TERMS_OF_SERVICE_MARKDOWN` / `BUZZ_PRIVACY_POLICY_MARKDOWN` / `BUZZ_AGE_ATTESTATION_REQUIRED` | Relay-served join-policy documents/age gate | No | buzz-relay | unset (policy acceptance disabled unless configured) |
| `BUZZ_REQUIRE_AUTH_TOKEN` | Require NIP-98 for REST (no `X-Pubkey` dev fallback) | No [DOCS: `TESTING.md`] | buzz-relay | `false` |
| `BUZZ_REQUIRE_RELAY_MEMBERSHIP` | Only pubkeys in `relay_members` can connect | No [DOCS: `TESTING.md`] | buzz-relay | `false` |
| `BUZZ_DRAIN_JITTER_MS` | Randomized upper bound (ms) for staggering WS `1012 Service Restart` closes on graceful shutdown; capped at 20000 | No [DOCS: `TESTING.md`] | buzz-relay | `0` (close all at once) |
| `BUZZ_AUDIT_ENABLED` | Enable tamper-evident event/media audit log | No [DOCS: `TESTING.md`] | buzz-audit | `true` |
| `BUZZ_AUTO_MIGRATE` | Run embedded SQLx migrations on relay startup | No [DOCS: `TESTING.md`] | buzz-relay | `false` |
| `BUZZ_ALLOW_NIP_OA_AUTH` | Enable NIP-OA owner attestation for membership | No [DOCS: `TESTING.md`] | buzz-relay | `false` |
| `BUZZ_HEALTH_PORT` | Separate health/liveness/readiness port (bypasses auth middleware, for K8s probes) | No [DOCS: `TESTING.md`] | buzz-relay | `8080` |
| `BUZZ_METRICS_PORT` | Prometheus `/metrics` port | No [DOCS: `TESTING.md`] | buzz-relay | `9102` |
| `BUZZ_RELAY_URL` (CLI) | CLI's relay base URL target | No | buzz (CLI) | `http://localhost:3000` |
| `BUZZ_PRIVATE_KEY` (CLI) | CLI signing identity | **Yes** | buzz (CLI) | none |
| `BUZZ_AUTH_TAG` | Optional NIP-OA owner attestation JSON | No | buzz (CLI), buzz-relay | unset |

No secret **values** are reproduced above — all are the placeholder/dev values shipped in `.env.example` (e.g. `buzz_dev_secret`), explicitly documented as local-dev-only. `.env.example` and `SECURITY.md` both say real deployment secrets belong in a secret manager, never committed.

### Other Configuration Files
- `rust-toolchain.toml` [CODE] — pins Rust toolchain `1.95.0`, `profile = "default"`. Rustup uses this to select the compiler for the whole workspace.
- `.config/nextest.toml` [CODE] — configuration for `cargo-nextest`, the test runner used by `just test-unit` (exists; not read in full — Needs verification for specific overrides such as retries/partitioning).
- `biome.json` (root, and one per `desktop/`, `web/`, `admin-web/`) [CODE] — Biome linter/formatter config for all TypeScript/JS packages.
- `deny.toml` [CODE] — `cargo-deny` policy: license allow-list and security-advisory checks, run in CI's Security Domain (`_ci-security.yml`).
- `renovate.json` [CODE] — Renovate bot config for automated dependency-update PRs.
- `pnpm-workspace.yaml` [CODE] — declares the pnpm workspace packages (`desktop`, `web`, `admin-web`) and two patched dependencies (see Patches below).
- `patches/isomorphic-git.patch`, `patches/virtua@0.49.3.patch` [CODE] — pnpm `patchedDependencies`; exact reasons for each patch need in-file inspection (Needs verification — not read in this pass).
- `preview-features.json` [CODE, content not read in this pass] — likely a feature-flag manifest; Needs verification.
- `lefthook.yml` [CODE] — Git hook manager config; `just hooks` installs it (`lefthook install --force`) pointed at the shared `.git/hooks` dir so linked worktrees share hooks.
- `ct.yaml` [CODE] — small (283B) config, name suggests `chart-testing` (`ct`) config for the Helm chart CI lint/install checks; Needs verification of exact contents.
- `prometheus.yml` [CODE] — local Prometheus scrape config mounted into the `prometheus` docker-compose service.

---

## 13. Build / Run / Deployment

**Sources:** `Justfile` [CODE] (55KB, recipe list enumerated + key recipes read: `bootstrap`, `setup`, `dev`, `relay`, `relay-web`, `admin`, `test`, `test-unit`, `migrate`/`_ensure-migrations`), `TESTING.md` [DOCS], `docker-compose.yml` [CODE], `docker-compose.harness.yml` [CODE], `deploy/charts/buzz/*` [CODE], `.github/workflows/*` [CODE].

### Prerequisites
- **Rust** `1.95.0` — pinned via `rust-toolchain.toml` [CODE].
- **Docker** — required by `just bootstrap`, which hard-fails if `docker` is not on `PATH`. Used for Postgres, Redis, MinIO, Adminer, Keycloak, Prometheus in local dev.
- **Node.js / pnpm** — `packageManager: pnpm@11.4.0` pinned in root `package.json` [CODE]. `pnpm-workspace.yaml` covers `desktop`, `web`, `admin-web`.
- **Flutter/Dart** — `mobile/pubspec.yaml` pins `sdk: ^3.11.4` (Dart SDK constraint) [CODE].
- **Hermit** (`bin/` directory with `activate-hermit`) — the repo vendors a Hermit-managed toolchain (cargo, node, pnpm, flutter, just, lefthook, cmake, etc. all resolve through `bin/` symlinks that self-download pinned versions on first use). `just bootstrap` explicitly runs each Hermit-proxied tool once to trigger downloads.
- **just** (command runner) — the `Justfile` is the primary developer entry point; also Hermit-managed (`bin/just`).

### Core Local-Dev Command Sequence (from `Justfile` + `TESTING.md`, verified)

```bash
just bootstrap   # installs pinned toolchain via Hermit, requires Docker present,
                  # creates .env from .env.example if missing, generates a stable
                  # relay signing key via scripts/ensure-local-relay-key.sh
just setup        # bootstrap + starts Docker services + runs migrations
                  # (implemented as: bootstrap, then ./scripts/dev-setup.sh)
just dev           # bootstrap + sidecar stubs + migrations, then: builds
                  # buzz-acp/buzz-agent/buzz-backend-kubernetes/buzz-dev-mcp/
                  # buzz-cli/git-credential-nostr/buzz-relay, launches the debug
                  # buzz-relay binary in the background, waits for /_readiness,
                  # then runs `pnpm exec tauri dev` in desktop/ — this is the
                  # full Tauri desktop app against a local relay
```

Other primary entry points defined as `Justfile` recipes:
- `just relay` — `cargo run -p buzz-relay` (debug build), depends on `bootstrap` + `_ensure-migrations`.
- `just relay-release` — same, `--release`.
- `just relay-web` — builds `web/` (`pnpm -C web build`) and serves it from the relay via `BUZZ_WEB_DIR=./web/dist cargo run -p buzz-relay`.
- `just admin` — builds `admin-web/`, launches relay with `BUZZ_ADMIN_HOST` (default `admin.localhost:3000`) and `BUZZ_ADMIN_AUTH` (defaults to `disabled` for local review, since localhost lacks a NIP-07 signer).
- `just desktop-standalone` — runs only the desktop app with **no** relay/DB/Docker/migrations/`.env` required; the app prompts for a community before connecting.
- `just web` — Vite dev server for the standalone web client.
- `just down` / `just ps` / `just logs` — `docker compose down` / `ps` / `logs -f` wrappers.
- `just reset` — destructively wipes local dev data (`scripts/dev-reset.sh --yes`); gated behind a `[confirm(...)]` prompt in the Justfile itself.
- `just migrate` — alias for `_ensure-migrations` (see Database section below).
- `just mobile-dev` — Flutter mobile dev entry point (exists; not read in detail — Needs verification of exact behavior).
- `just goose key="$AGENT_NSEC"` / `just goose-bg ...` — convenience wrappers that export ACP env vars and launch `buzz-acp` foreground/background against a running relay (documented in `TESTING.md` and `crates/buzz-acp/README.md`).

`_ensure-migrations` (private recipe, `Justfile:209`) resolves to: `_ensure-services` (starts Docker Compose stack, Needs verification of full body) → `cargo run -p buzz-admin -- migrate` → `./scripts/seed-local-community.sh`. **Migrations are applied via the `buzz-admin` CLI binary**, not directly via `sqlx-cli` or `pgschema` — though `bin/pgschema` exists in the vendored Hermit toolchain and `schema/schema.sql` exists as a canonical schema snapshot, suggesting `pgschema` is used for schema *diffing/drift-checking* rather than applying the incremental `migrations/*.sql` files themselves (Needs verification — not confirmed from source in this pass).

### Build Commands
- `just build` — `cargo build --workspace` (debug).
- `just build-release` — `cargo build --workspace --release`.
- `just desktop-build` — desktop frontend production build (`pnpm` under `desktop/`, exact script Needs verification beyond `package.json`'s `"build": "tsc && node ./scripts/build-protected-feature-artifacts.mjs"`).
- `just web-build` — `web/` production build (`package.json`: `"build": "tsc && vite build"`).
- `desktop/package.json` [CODE] scripts confirmed: `dev` (`vite`), `build`, `build:e2e` (`vite build --mode e2e`), `typecheck` (`tsc --noEmit`), `lint`/`check`/`format` (Biome), `tauri` / `tauri:build` (Tauri CLI wrapper via `scripts/tauri-command.mjs`).
- `web/package.json` [CODE] scripts confirmed: `dev`, `build`, `typecheck`, `lint`/`check`/`format`, `preview`, `test:e2e`, `test:e2e:smoke`.

### Lint / Format / Check
- `just fmt` / `just fmt-check` — `cargo fmt` across the Rust workspace.
- `just clippy` — Rust clippy lints.
- `just desktop-check`, `just desktop-tauri-fmt(-check)`, `just desktop-tauri-clippy` — desktop TS + Tauri Rust checks (the Tauri clippy recipe explicitly lints **both** the default and `mesh-llm`-feature cfg graphs, since features are additive and both graphs ship).
- `just web-check`, `just mobile-check` — equivalent checks for web and Flutter mobile.
- `just check` — aggregate: `fmt-check clippy desktop-check desktop-tauri-fmt-check desktop-tauri-clippy web-check mobile-check security-review-check file-size-check`.
- `just file-size-check` — repository file-size policy gate (script not read in detail).
- `just security-review-check` — validates `.github/scripts/codex-security-review.js` (`node --check`).
- `just hooks` — installs `lefthook` git hooks pointed at the shared `.git/hooks` dir (works across linked worktrees).

### Docker / Local Infrastructure (`docker-compose.yml`, verified)
Services defined (all on a `buzz-net` bridge network, all bound to `127.0.0.1` only):
| Service | Image | Host Port(s) | Purpose |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | 5432 | Primary datastore |
| `redis` | `redis:7-alpine` | 6379 | Pub/sub, rate limiting |
| `adminer` | `adminer:latest` | 8082 | Postgres DB browser UI |
| `keycloak` | `quay.io/keycloak/keycloak:26.0` | 8180 (mapped from 8080) | Present in compose; **its role in the app's auth flow is not established from files read in this pass — Buzz's primary documented auth is NIP-42/NIP-98 Nostr-key based (per `SECURITY.md`), so Keycloak's actual integration point needs verification** (candidate: an OIDC path for `buzz-agent`'s Databricks/model-provider auth, given `DATABRICKS_MODEL_FILTER` and OAuth-coordinator mentions in `Justfile` comments — Needs verification). |
| `minio` / `minio-init` | `minio/minio`, `minio/mc` | 9000 (API), 9001 (console) | S3-compatible object storage for media + Git CAS; `minio-init` auto-creates the `buzz-media` bucket with anonymous access disabled |
| `prometheus` | `prom/prometheus:latest` | 9090 | Scrapes relay metrics per `prometheus.yml` |

Note: **Typesense is referenced in `.env.example` but has no service in `docker-compose.yml`** — Needs verification whether it's started separately, optional, or the compose file is out of date relative to `buzz-search`'s needs.

`docker-compose.harness.yml` [CODE] defines a **second, isolated** Compose project (`buzz-harness`) — Postgres/Redis/MinIO only, on alternate ports (5471/6471/9471-9472) — explicitly so a test-relay harness never collides with the primary dev stack. Comment attributes the pattern to "Eva's evaperf-* isolation pattern." A companion script `scripts/start-isolated-test-relay.sh` runs the relay itself on ports 3030/8088/9202.

### Dockerfiles
- `Dockerfile` [CODE, not read in full this pass] — presumably builds the production `buzz-relay` image referenced by `deploy/charts/buzz` (`image.repository: ghcr.io/block/buzz`).
- `Dockerfile.push-gateway` — image for the separately-deployed push-notification gateway (`buzz-push-gateway` crate; has its own Helm chart `deploy/charts/buzz-push-gateway`).
- `Dockerfile.sprig` — image for the `sprig` crate/tool (purpose not established in this pass — Needs verification; there's also a `sprig.yml` / `sprig-image.yml` CI workflow).

### Kubernetes / Helm Deployment (`deploy/charts/buzz`, verified)
`Chart.yaml` [CODE] describes Buzz as *"a Nostr-based messaging platform for human–agent collaboration... A single relay binary serving WebSocket + REST + web UI, backed by PostgreSQL and Redis."* Chart version `0.1.8`, app version `0.1.0`.

Two supported deployment tiers per `values.yaml` comments:
- **Production (default):** external Postgres/Redis/S3, `existingSecret` refs, no chart-side secret generation, GitOps-safe (ArgoCD/Flux — example manifests in `deploy/charts/buzz/examples/`). HA-ready (`replicaCount >= 2`), requires Redis for `buzz-pubsub` cross-replica fan-out. Git ref/object state is object-storage-backed (not a shared filesystem), so no `ReadWriteMany` volume is required even with multiple replicas.
- **Quickstart (eval-only):** bundles in-cluster Postgres + Redis + MinIO via optional subcharts (`postgresql.enabled`, `redis.enabled`, `minio.enabled` — subcharts sourced from `oci://registry-1.docker.io/cloudpirates`), auto-generates secrets via Helm's `lookup` pattern — explicitly **not GitOps-safe**. Single replica. See `deploy/charts/buzz/ci/quickstart-values.yaml`.

Key `values.yaml` knobs observed: `relayUrl` (required, drives `RELAY_URL` env + default media base URL + ingress host), `image.{repository,tag,digest,pullPolicy}` (supports immutable digest pinning with tag fallback), `replicaCount`, `autoscaling` (HPA — CPU-based via Metrics Server, optional WebSocket-connection-count custom metric requiring a custom-metrics adapter).

Chart templates (`deploy/charts/buzz/templates/`): `deployment.yaml`, `service.yaml`, `ingress.yaml`, `httproute.yaml` (Gateway API alternative), `hpa.yaml`, `pdb.yaml` (PodDisruptionBudget), `pvc-git.yaml` (git workspace volume), `pairing-relay.yaml`, `secret-chart.yaml`, `serviceaccount.yaml`, `servicemonitor.yaml` (Prometheus Operator integration), `quickstart-minio*.yaml`.

A second, independent chart `deploy/charts/buzz-push-gateway` exists for the push-notification gateway service. CI workflows `helm-chart.yml` and `push-gateway-helm-chart.yml` presumably lint/package/publish these (not read in detail — Needs verification of exact publish target, e.g. an OCI registry).

`deploy/compose/` and `deploy/local/` subdirectories also exist under `deploy/` — contents not enumerated in this pass; Needs verification.

### systemd / Other Substrates
**No `.service` unit files exist anywhere in this repository** (verified via filesystem search). `systemd` is mentioned only in prose documentation (`docs/remote-agents.md`, `crates/buzz-agent/README.md`, `crates/buzz-persona/PERSONA_PACK_SPEC.md`, `spec/requirements.md`, `CHANGELOG.md`) as one *conceptually possible* launcher/binding substrate for the ACP harness alongside Kubernetes — e.g. `docs/remote-agents.md` describes a Kubernetes "binding" as one realization of a generic launcher contract and states "a systemd/SSH deployer... is the live example" of a different substrate satisfying the same contract, but ships no such deployer in-repo. The only concretely implemented backend/deployment automation in-repo is the `buzz-backend-kubernetes` crate + the Helm charts above. **Conclusion: Kubernetes (via the Helm chart) is the only implemented production deployment substrate found in this repository; systemd is discussed only as an architectural possibility.**

### CI/CD (`.github/workflows/`, verified list + `ci.yml` read in full)
23 workflow files exist. The main `ci.yml` fans out via a `changes` job (path-filtering with `dorny/paths-filter`) into reusable workflows:
- `_ci-rust.yml` — Rust workspace: lint (clippy), unit tests, Windows cross-build, a separate cross-compile lane.
- `_ci-desktop.yml` / `_ci-desktop-macos.yml` — desktop TS build/test + desktop Tauri Rust build/test, with a dedicated macOS lane.
- `_ci-relay.yml` — three "lanes" reused for different jobs: `artifacts` (produces relay build artifacts consumed by e2e jobs), `postgres` (Postgres-backed test suite), `required` (relay + Postgres required gate). Feeds Desktop E2E Relay, Desktop E2E Integration, Backend Integration, PostgreSQL Tests, and Relay E2E gate jobs.
- `_ci-clients.yml` — web + mobile (including a `mobile-swift` lane for iOS-specific checks).
- `_ci-security.yml` — security gate (cargo-deny / cargo-audit per `SECURITY.md`'s "Dependency Management" section).
Other workflows by filename (not opened in this pass): `codex-security-review.yml`, `desktop-release-candidate.yml`, `desktop-release-cache-proof.yml`, `mobile-release-candidate.yml`, `promote-oss-desktop-release.yml`, `release.yml`, `auto-tag-on-release-pr-merge.yml`, `docker.yml`, `helm-chart.yml`, `push-gateway-helm-chart.yml`, `benchmark-harbor.yml`, `mesh-lifecycle.yml`, `linux-canary.yml`, `macos-intel-canary.yml`, `signed-macos-canary.yml`, `windows-canary.yml`, `staging-dev-relay-image.yml`, `sprig.yml`, `sprig-image.yml` — these strongly suggest a scheduled-canary + tagged-release pipeline producing signed desktop builds (macOS signing implied by `signed-macos-canary.yml`) and container/Helm publishing, but exact behavior of each is **Needs verification** (not read).

`ci.yml`'s `changes` job also runs a battery of `scripts/test-*-contract.sh` self-tests validating the release/promotion workflow logic itself before any build runs — evidence of unusually strong process/meta-testing around the release pipeline.

### "How to Run Buzz Locally" (only verified steps)

**Fastest path — full desktop app against a local relay:**
```bash
just bootstrap   # once: toolchain + .env + stable relay key
just dev          # starts Docker infra + Postgres migrations + relay + Tauri desktop app
```

**Relay only, driven by the CLI (from `TESTING.md`, verified end-to-end):**
```bash
. ./bin/activate-hermit
just bootstrap
just setup                                              # Docker services + migrations
cargo build --release -p buzz-relay -p buzz-cli -p buzz-admin
export PATH="$PWD/target/release:$PATH"

# terminal 1
set -o allexport; source .env; set +o allexport
buzz-relay                                              # ws://localhost:3000

# terminal 2 — verify
curl -s http://localhost:3000/health                    # → ok
curl -s http://localhost:8080/_readiness                # → {"status":"ready"}

# terminal 2 — smoke test
GEN=$(buzz-admin generate-key)
export BUZZ_PRIVATE_KEY=$(echo "$GEN" | awk '/Secret key:/ {print $3}')
CHANNEL=$(buzz channels create --name "smoke-$$" --type stream --visibility open | jq -r '.channel_id')
buzz messages send --channel "$CHANNEL" --content "hello from smoke test"
buzz messages get --channel "$CHANNEL" --limit 5 | jq .
```

**Web-only client:**
```bash
just relay        # or just relay-web to serve the built web bundle straight from the relay
just web           # separate terminal — Vite dev server with HMR
```

**Admin/moderation dashboard:**
```bash
just admin         # builds admin-web, launches relay with BUZZ_ADMIN_HOST=admin.localhost:3000,
                    # BUZZ_ADMIN_AUTH=disabled by default for local review
```

**Stopping / resetting:**
```bash
just down          # stop Docker services, keep data
just reset          # DESTRUCTIVE — wipes all local dev data (confirmation-gated)
```

⚠️ `TESTING.md` explicitly warns: Desktop and a manually-run test relay share the same Docker container names/ports by default, so `just reset` will wipe Desktop's data too unless isolated via a different `COMPOSE_PROJECT_NAME` or the harness compose file.

---

## 14. Testing

**Sources:** `TESTING.md` [DOCS] (read in full), `Justfile` `test`/`test-unit`/`test-integration`/`desktop-e2e-*` recipes [CODE], `desktop/playwright*.config.ts` (4 variants, headers read) [CODE], `desktop/package.json` scripts [CODE], `.github/workflows/ci.yml` [CODE].

### Test Layers

1. **Rust unit tests — `just test-unit`** (no infrastructure needed). Runs via `cargo-nextest` when available, else falls back to `./scripts/run-tests.sh unit`. The `Justfile` enumerates unit-test targets **explicitly per-crate** rather than `cargo test --workspace`, with extensive inline comments explaining *why* each crate is enumerated (to prevent tests silently running in no CI lane) — crates covered: `buzz-core`, `buzz-auth` (incl. NIP-FI doctests), `buzz-voice`, `buzz-cli`, `buzz-acp`, `buzz-db` (`--lib` only — Postgres-backed tests are `#[ignore]`d), `buzz-conformance` (multi-tenant replay-fixture conformance gate), `buzz-push-gateway`, `buzz-backend-kubernetes`, `buzz-agent` (includes a cross-language "model-capabilities" corpus drift guard and an OAuth coordinator concurrency matrix run against a stub OIDC provider), and a narrowly-scoped slice of `buzz-relay --lib` (admin-API auth-boundary tests + pure authorization-decision tests for NIP-29 channel membership / moderation).

2. **Integration tests — `just test-integration`** / `just test` (`./scripts/run-tests.sh integration` / `all`). Starts Postgres/Redis automatically if not already running; exercises DB-backed code paths.

3. **Relay E2E tests (`buzz-test-client` crate)** — marked `#[ignore]`, require a live relay: `cargo test -p buzz-test-client -- --ignored`, per `TESTING.md`.

4. **Live-relay CLI smoke test** — a manual, documented end-to-end flow in `TESTING.md` (build release binaries → run `buzz-relay` → drive it with the `buzz` CLI, which signs every request with NIP-98) — the recommended way to verify a relay works without hand-rolled `curl`/`nak`.

5. **Large-roster script test** — `scripts/e2e-large-channel-roster.sh`, run against an isolated DB, proves NIP-29 channel-membership behavior beyond 1,000 members (relay-served kind 39002 correctness, message publish by a late-joined member, targeted-reconciliation safety). Refuses to run against debug binaries or binaries outside `target/release`.

6. **ACP harness live test** — documented manual recipe in `TESTING.md`: mint an agent identity, add it to a channel, run `buzz-acp` (defaults to spawning `goose`), @mention it from a separate sender identity, and confirm a `kind:9` reply appears. Also documents `BUZZ_ACP_LAZY_POOL=true` for testing deferred ACP startup, with an automated regression test (`pool_lifecycle_state`) covering single-wake/retry/backoff/stale-result behavior as a complement (not replacement) for the manual smoke test.

7. **Desktop E2E (Playwright)** — four separate configs in `desktop/`, each with a distinct purpose (headers read directly):
   - `playwright.config.ts` — default suite; `smoke` project matches specific named specs (`smoke.spec.ts`, `owned-agent-discovery.spec.ts`, etc.); an `integration` project also exists (per `package.json`'s `test:e2e:integration` script and `Justfile`'s `desktop-e2e-integration` recipe, which depends on `_ensure-migrations`, i.e. is relay/DB-backed).
   - `playwright.live.config.ts` — runs only `agents-everywhere.live.spec.ts`, 90s timeout — a live-agent-dependent test kept separate from the default suite.
   - `playwright.perf.config.ts` — runs `**/*.perf.ts` specs against a static `python3 -m http.server` serving `dist`, not the dev server — pure frontend performance measurement decoupled from backend.
   - `playwright.release-smoke.config.ts` — runs `release-smoke.spec.ts`, `dm-history-live-regression.spec.ts`, `foreground-responsiveness-regression.spec.ts` with a 10-minute timeout and JSON+HTML reporters — a heavier pre-release regression gate, invoked via `just desktop-release-smoke` → `./scripts/run-desktop-release-smoke.sh` against an isolated local relay.

   Corresponding `Justfile` recipes: `desktop-e2e-seed` (seeds deterministic channel data via `scripts/setup-desktop-test-data.sh`), `desktop-e2e-smoke`, `desktop-e2e-integration`, `desktop-release-smoke`, `desktop-e2e-pre-push` (runs only specs changed vs. `origin/main`, both projects, before pushing).

8. **Desktop unit tests** — `desktop/package.json`'s `"test"` script: Node's built-in test runner (`node --import ./test-loader.mjs --experimental-strip-types --test`) over `src/**/*.test.mjs` and `scripts/*.test.mjs` — notably **not** Vitest/Jest; a custom loader (`test-loader.mjs`, `test-loader-hooks.mjs`) is used, and TypeScript is run directly via `--experimental-strip-types` rather than pre-compiled.

9. **Web E2E** — `web/package.json`: `test:e2e` / `test:e2e:smoke` via Playwright (single default config, not enumerated with multiple variants like desktop).

10. **Admin dashboard tests** — `just admin-check`: `cargo check -p buzz-relay --all-targets`, `cargo test -p buzz-relay api::admin`, `cargo test -p buzz-relay router::tests`, `pnpm -C admin-web check`, `pnpm -C admin-web test:e2e`.

11. **Mobile tests** — `just mobile-test` (Flutter; exact command Needs verification — not opened).

12. **CLI test suite** — `TESTING.md` references a dedicated `crates/buzz-cli/TESTING.md` covering all 54 CLI subcommands across 12 command groups (file exists per directory listing; not read in this pass — Needs verification of contents, but its existence and scope are confirmed).

13. **"Review-Proven Test Standards"** — `TESTING.md` explicitly documents a project norm, sourced from real PR review threads (cross-referenced to `AGENTS.md`'s "Review-Proven Rules"): *"Regression tests must bind the production seam and be falsifiable"* — a test whose guard, if deleted, doesn't fail anything protects nothing. Cites specific past incidents (PRs #6996, #7013 — mutation testing survived twice) as the origin of this rule. This is a documented, evidence-backed team convention, not an assumption.

### Fixtures
- `test-fixtures/entity-links.json` [CODE] — a single JSON fixture file; used by some entity-link-related test (likely tied to `docs/buzz-entity-links.md` — Needs verification of exact consumer).
- Deterministic seed scripts referenced above (`scripts/setup-desktop-test-data.sh`, `scripts/seed-local-community.sh`, `scripts/seed-admin-dashboard.sh`) act as fixture generators for e2e/manual testing rather than static fixture files.

### Benchmarks / Performance
- `benchmarks/buzz-dataset` and `benchmarks/harbor-buzz-orchestra` directories exist (contents not enumerated in this pass — Needs verification); a `benchmark-harbor.yml` CI workflow and `just benchmark` / `just benchmark-check` / `just benchmark-down` Justfile recipes exist.
- `perf/RELAY_BUS_SCALING.md` + `perf/relay_bus_scaling.py` + `perf/test_relay_bus_scaling.py` — a Python-based load/scaling model and test for the relay's internal pub/sub "bus," separate from the Rust test suite. Contents not read in this pass — Needs verification of methodology.

### How a Developer Should Run Tests (synthesized from verified commands)
```bash
just test-unit                 # fast, no infra — run this first on every change
just test                      # unit + integration, auto-starts Docker
just ci                        # the full pre-push/CI-equivalent local gate:
                                # check test-unit desktop-test desktop-build
                                # desktop-tauri-check desktop-tauri-test web-build mobile-test
just desktop-e2e-pre-push       # Playwright specs changed vs. origin/main, before pushing
```
`TESTING.md`'s troubleshooting table confirms `just ci` is the canonical local reproduction of the CI gate ("Tests pass locally but CI fails → Forgot to run `just ci`").

## 15. Current Requirements

Derived only from confirmed repository behavior and existing documentation (§1–§14). Nothing below is invented; items whose evidence is thin are marked accordingly.

### Functional requirements

- The system must store every non-ephemeral, non-AUTH event as a signed Nostr event in an append-only, per-community-partitioned log (`events` table). **[CODE]**
- The system must support channel-based group chat modeled as NIP-29 groups (create/edit/archive/delete, join/leave, roles, membership), including ephemeral (TTL-expiring) channels. **[CODE, §5.7/§9.4]**
- The system must support direct messages via NIP-17 gift wrap, delivered only to subscriptions that prove ownership of the target pubkey. **[CODE, §5.4/§4.G]**
- The system must support reactions (NIP-25), threaded replies (NIP-10), and full-text search (Postgres FTS) that explicitly excludes encrypted/private event kinds. **[CODE, §10.2]**
- The system must support AI agents as first-class channel/DM participants, authenticated with their own Nostr keypair, able to receive channel/DM traffic and publish replies through the same relay protocol as a human client. **[CODE, §6]**
- The system must support pluggable agent runtimes (Goose, Codex, Claude Code's ACP adapter, Pi, or Buzz's own `buzz-agent`) behind one client protocol (ACP), selected by configuration rather than hard-coded integration. **[CODE, §6.4]**
- The system must support declarative, YAML-defined workflow automations triggered by events, schedules (cron), or webhooks, run server-side. **[CODE, §6.15]**
- The system must support relay-hosted Git repositories over HTTP (git-on-object-storage), including Nostr-key-based commit signing (NIP-GS) and NIP-98-authenticated git credentials. **[CODE, §5.3]**
- The system must support media upload/storage/retrieval addressed by content hash, backed by S3-compatible object storage. **[CODE, §4.M]**
- The system must support voice ("huddle") calls with a local audio pipeline (STT/TTS, VAD, resampling) — desktop implementation confirmed; server-side audio relay confirmed; recording/per-track publishing is a known, documented gap (not yet built). **[CODE + DOCS gap, §1]**
- The system must support relay-wide membership control (allowlist and/or membership-table enforcement), invite issuance/redemption, and moderation (reports, bans, timeouts, audit trail of moderator actions). **[CODE, §9.2/§10.2]**
- The system must support multi-tenancy: one relay process able to serve multiple isolated "communities," routed by HTTP `Host` header, with `community_id` scoping enforced throughout the data layer. **[CODE, §10.1]**
- The system must support a full desktop client (Windows/macOS/Linux via Tauri), a lighter browser client (invite acceptance + read-only git browsing), an admin/moderation web console, and a full-featured mobile client (iOS/Android via Flutter). **[CODE, §7]**

### Technical requirements

- Rust `1.95.0` (pinned, `rust-toolchain.toml`) for all backend/CLI/agent-harness/desktop-native code. **[CODE]**
- PostgreSQL 17 as the sole durable datastore; Redis 7 for cross-pod fan-out/presence/rate-limiting (not durable business data). **[CODE, §10]**
- S3-compatible object storage (MinIO locally) for media and git object storage. **[CODE, §12]**
- Node.js + pnpm (`pnpm@11.4.0` pinned) for the three JS/TS frontend packages (`desktop`, `web`, `admin-web`). **[CODE]**
- Flutter/Dart (SDK `^3.11.4`) for the mobile client. **[CODE]**
- Tauri 2.x for desktop packaging/native integration. **[CODE, §8]**
- Nostr protocol compliance: NIP-01, NIP-29, NIP-42, NIP-44, NIP-17, NIP-10, NIP-09, NIP-25, NIP-11, NIP-98, NIP-05 are implemented; NIP-04 and general NIP-46 signer support are explicitly not implemented. See §5.1 for the full matrix and Buzz's own 17 draft protocol extensions in `docs/nips/`. **[CODE+DOCS]**
- Toolchain reproducibility via Hermit (`bin/` directory), pinning cargo/node/pnpm/flutter/just/lefthook/cmake/etc. **[CODE, §13]**

### Security requirements

- Every event must carry a valid Schnorr (BIP-340) signature, verified via a single shared `buzz_core::verify_event` path before acceptance. **[CODE, §5.3]**
- WebSocket connections must complete NIP-42 AUTH (challenge/response, ±60s tolerance) before most operations proceed; AUTH events themselves must never be persisted or logged. **[CODE, §11.2]**
- HTTP API calls must be authenticated via NIP-98 signed events where applicable (admin API, invites, bridge endpoints); replay protection is required (`nip98_replay.rs`). **[CODE, §11.2]**
- Cross-tenant data isolation must be preserved at the database layer (`community_id` scoping, immutability triggers, and — uniquely — a formal-methods trace-replay checker (`buzz-conformance`) validating relay behavior against a TLA+ multi-tenant-isolation spec). **[CODE, §5.8/§10.1]**
- Secrets (API keys, private keys) must never be committed to the repository; production secrets must come from a secret manager, not `.env`. **[DOCS: `SECURITY.md`, `.env.example`]**
- Dependency security/license posture must be enforced in CI via `cargo-deny` (`deny.toml`). **[CODE, §12]**
- **Gap, not yet a met requirement**: a configurable, enforced permission policy for AI-agent tool calls is documented as intended (`BUZZ_ACP_PERMISSION_POLICY`) but not implemented — today, all tool-call permission requests are auto-approved. See §11.9(1). **[CODE-confirmed gap]**

### Operational requirements

- Structured JSON logging via `tracing`, independently tunable log-level (`RUST_LOG`) and OpenTelemetry trace-export filter (`BUZZ_OTEL_FILTER`); optional OTLP trace export. **[CODE, §9.6]**
- Separate, unauthenticated health/readiness/metrics listeners (ports 8080 and 9102 by default) so Kubernetes probes and Prometheus scraping don't share the app listener's auth/CORS middleware. **[CODE, §9.1/§9.2]**
- Graceful shutdown: readiness flips to unavailable, a grace period elapses, then in-flight connections are closed with a staggerable delay before a hard drain timeout. **[CODE, §4.O]**
- Database migrations are additive-only SQL files applied under an exclusive advisory lock, serialized against concurrent community-deletion operations. **[CODE, §9.5/§10.4]**
- Deployment is via a Helm chart (`deploy/charts/buzz`) supporting both a production tier (external Postgres/Redis/S3, GitOps-safe, HA-ready) and a quickstart/eval tier (bundled subcharts, single replica, not GitOps-safe). **[CODE, §13]**
- No systemd unit files are shipped; Kubernetes (via the Helm chart) is the only implemented production deployment substrate in this repository — systemd is discussed only as a hypothetical alternative in prose docs. **[CODE-confirmed absence, §6.13/§13]**
- CI enforces linting, unit/integration tests, security scanning (cargo-deny/cargo-audit), and multiple release/canary pipelines across desktop (macOS signed builds), mobile, and container/Helm publishing. **[CODE, §13]**

### Client requirements

- **Desktop** (primary client): Windows/macOS/Linux via Tauri 2 + React 19; holds the user's private key in the OS keychain; is also the process supervisor that spawns/monitors locally-run AI agent sidecar processes. **[CODE, §7.4/§8]**
- **Web**: lightweight, deliberately scoped to invite acceptance and read-only git browsing only — not a full chat client. **[CODE, §7.1]**
- **Mobile**: full-featured (chat, channels, DMs, huddles, agents, pairing) per README's capability matrix, marked "being wired up" (🚧) rather than fully stable. **[DOCS+CODE, §1/§7.3]**
- **Admin web**: separate, minimal, REST-only moderation console; no Nostr/WebSocket dependency. **[CODE, §7.2]**

### Agent requirements

- An agent must hold its own Nostr keypair (its identity on the relay) — no separate "agent account" abstraction exists. **[CODE, §6.3/§6.8]**
- An agent's behavioral identity (name, system prompt) is defined separately from its cryptographic identity, via `.persona.md` persona-pack files (YAML frontmatter + markdown body). **[CODE, §6.3]**
- An agent process must speak ACP (Agent Client Protocol) over stdio JSON-RPC to be driven by `buzz-acp`; Buzz does not require agents to be implemented in this repository — third-party ACP-speaking agents (Goose, Codex, Claude Code) are first-class supported options alongside Buzz's own `buzz-agent`. **[CODE, §6.2/§6.4]**
- An agent's visible reply to other users must be produced by the agent actually invoking a messaging tool call (e.g. `buzz messages send` via MCP) — the harness does not auto-publish the LLM's raw output text. **[CODE, §6.6, "Reply Guard"]**
- Agent LLM-provider credentials must be supplied via environment variables to the agent subprocess; credential lifecycle (rotation, injection) is explicitly an operator/deployment responsibility, out of scope for the agent crate itself. **[DOCS: `crates/buzz-agent/README.md`, §6.10]**
- Remote/hosted agent workloads (as opposed to locally-run sidecars) are provisioned via the `buzz-backend-kubernetes` server-side crate — the only implemented remote-agent deployment substrate found. **[CODE, §6.13/§6.14]**

## 16. Important Design Decisions

Each decision below is stated only where supported by code, comments, or existing documentation. Where the *reason* for a decision was not explicitly documented anywhere found in this pass, that is stated plainly rather than inferred.

**Kind-based dispatch as the relay's only routing mechanism.** Every event carries an integer `kind`; the relay's dispatch logic switches on this number, and new features are added as new kind constants (`crates/buzz-core/src/kind.rs`) without breaking existing clients. **Reason (documented):** `ARCHITECTURE.md` frames this as the mechanism that lets the protocol grow additively. **[DOCS+CODE]**

**Relay-as-source-of-truth; no peer-to-peer gossip.** All reads/writes flow through `buzz-relay`; there is no client-to-client event exchange. **Reason not explicitly documented** beyond general Nostr-relay convention — Buzz did not invent this pattern, it inherited it from the Nostr protocol model it builds on.

**Multi-tenancy via `community_id` + HTTP `Host` header, not separate deployments per tenant.** A single relay process can serve many communities; tenant binding happens once per connection, before any protocol frame is processed ("row zero" binding, `tenant::bind_community`). **Reason (documented):** enables hosted/managed offerings from one relay fleet; cross-tenant isolation is treated as a first-class, formally-verified property (`buzz-conformance`'s TLA+ trace-replay checker against `docs/spec/MultiTenantRelay.tla`) rather than an incidental guarantee. **[CODE+DOCS]**

**Postgres full-text search instead of a dedicated search engine.** Code comments in `main.rs` explicitly note this replaced an earlier Typesense-based design: "the searchable row IS the persisted event row." **Reason (documented, inferred from comment):** avoids a second system of record / index-consistency problem — the FTS index is a generated column on the same row being written transactionally. **[CODE]** Note: `TYPESENSE_API_KEY`/`TYPESENSE_URL` still appear in `.env.example` with no corresponding service in `docker-compose.yml` — likely a leftover from the pre-migration design, flagged as a config/doc drift needing verification (§17).

**Agents are first-class Nostr identities, not a distinct "bot" object with special flags.** An agent authenticates with its own keypair and joins channels the same way a human does; the only structural distinction is the `users.agent_owner_pubkey` self-referencing column linking an agent to its human owner. **Reason (documented):** `README.md` states the explicit intent — "the same affordances as a human teammate, the same audit trail, a different keypair" — so agent actions inherit the same authz/audit machinery as human actions rather than needing a parallel permission system. **[DOCS+CODE]**

**ACP chosen as an agent-implementation-agnostic protocol boundary.** `buzz-acp` (the harness) speaks a single client protocol (ACP, JSON-RPC 2.0 over stdio) and can drive Goose, Codex, Claude Code's ACP adapter, Pi, or Buzz's own `buzz-agent` — selected purely by which binary is configured. **Reason (documented in code comments):** decouples "how Buzz delivers events to something" from "what that something is," letting operators pick/swap agent runtimes without relay or harness changes. A code comment explicitly notes Buzz is "squatting on ACP v2 ahead of the upstream ACP RFD" — i.e., tracking an unfinished external spec by deliberate choice, accepting the risk of upstream churn. **[CODE]**

**`buzz-agent` is hand-rolled with no ACP SDK dependency.** Its own README states this directly: three request methods, one notification, three update variants, "hand-rolled in `main.rs`." **Reason not explicitly documented** beyond the implicit minimalism goal stated in its `Cargo.toml` description ("Minimal, unbreakable ACP-compliant agent"). **[DOCS]**

**"Reply Guard" — agents must actually invoke a tool call to be heard.** The harness does not treat an LLM's assistant-text output as a deliverable reply; a reply only reaches other users if the agent's own tool call publishes a Nostr event (typically via a `buzz messages send` shell command). **Reason (documented):** `crates/buzz-agent/README.md` states plainly that "the model's assistant text is invisible to humans" otherwise — this is a deliberate design to force agents through the same event-publishing path (and therefore the same audit trail) as any other action, rather than having a privileged "just say something" output channel. **[DOCS+CODE]**

**Desktop app is a thin client + process supervisor, not an embedded relay or agent runtime.** The desktop app has no `buzz-relay` dependency; it connects outward over WebSocket to a remote/self-hosted relay, and for local AI agents it spawns `buzz-acp` (and its sidecars) as genuine OS child processes configured entirely via environment variables. **Reason not explicitly documented**, but the pattern (external protocol boundary + OS-process isolation) is consistent with keeping agent crashes, resource use, and LLM-provider credentials out of the main desktop app's process and trust boundary. **[CODE]**

**No generic filesystem/shell Tauri plugin permissions granted to the webview.** `desktop/src-tauri/capabilities/default.json` grants no `fs`/`shell`/generic-HTTP plugin capabilities; all native access (files, media, git, agent processes) is implemented as specific, individually-reviewed `#[tauri::command]` functions in Rust instead. **Reason (inferable from the pattern itself, not an explicit comment found):** keeps the attack surface exposed to arbitrary webview-executed JS narrow and auditable, rather than granting broad OS access wholesale. **[CODE]**

**Kubernetes (via Helm) is the only implemented remote-agent/production deployment substrate; systemd is discussed only in prose.** `crates/buzz-backend-kubernetes` is real, ~6,650 lines of Rust; no `.service` unit files exist anywhere in the repository. **Reason not explicitly documented** as to why systemd was not also implemented — docs treat it as one of several conceptually equivalent "launcher" substrates an operator could build, not a stated roadmap item. **[CODE-confirmed absence]**

**Migrations run under an exclusive Postgres advisory lock, serialized against community deletion.** `SCHEMA_DESTRUCTION_LOCK_KEY` is held for the entire migrator run; community-deletion transactions take a shared counterpart lock. **Reason (documented in code):** prevents a schema migration from racing a destructive whole-community deletion in a way that could corrupt state or violate the deletion state machine's invariants. **[CODE]**

**Auth events (NIP-42, kind:22242) are never persisted or logged, by explicit invariant.** **Reason (documented):** AUTH events may carry additional bearer-token tags; logging or storing them would leak credentials into logs/backups. **[CODE]**

## 17. Current State, Planned Work, and Unknowns

This is a direct aggregation of findings flagged throughout §1–§14. Nothing here is new analysis — it is a single place to see, at a glance, what is solid ground versus what needs a conversation with the team before being relied upon.

### Confirmed working / current

- Core relay: NIP-01 WebSocket protocol, NIP-29 channels/communities, NIP-42/NIP-98 auth, NIP-17 DMs, NIP-10 threads, NIP-25 reactions, NIP-11 relay info, NIP-05, Postgres FTS search, multi-tenancy with `community_id` scoping. **[CODE, §5, §9, §10]**
- `buzz-relay`'s full boot/shutdown lifecycle, HTTP+WS router, ~29-phase startup sequence, background worker set (reaper, push matcher, admin outbox, NIP-43 reconciliation, etc.). **[CODE, §9]**
- AI agent architecture end-to-end: `buzz-acp` harness ↔ pluggable agent subprocess (Goose/`buzz-agent`/Codex/Claude Code/Pi) ↔ MCP tools, with the Reply Guard pattern for delivering visible replies. **[CODE, §6]**
- Desktop client (Tauri 2 + React 19): 356 Tauri commands, full IPC layer, OS-keychain key storage, local agent-process supervision, media proxy, huddle voice pipeline. **[CODE, §7, §8]**
- Database: consolidated schema (`schema/schema.sql`), 30+ sequential migrations, advisory-lock-serialized migration runner, monthly event partitioning. **[CODE, §10]**
- Deployment: Helm chart with production and quickstart tiers, `docker-compose.yml` local dev stack, extensive CI (23 workflow files) including desktop/mobile/relay/security lanes. **[CODE, §13]**
- Testing infrastructure: per-crate unit tests, Postgres-backed integration tests, live-relay E2E via `buzz-test-client`, four distinct Playwright configs for desktop (default/live/perf/release-smoke), a documented "regression tests must bind the production seam" team norm with cited past incidents. **[CODE+DOCS, §14]**
- 17 Buzz-authored draft protocol extensions (`docs/nips/`) with real kind constants wired into `buzz-core`, several with test fixtures (e.g. NIP-MP). **[CODE, §5.9]**

### Partially implemented

- **Workflow approval gates**: the workflow executor returns a `Suspended` state, but the engine currently marks these runs `Failed` — not wired end-to-end. **[CODE-CONFIRMED, per `ARCHITECTURE.md` §9, independently cross-checked, §1]**
- **Huddle (voice) recording / per-track publishing**: the audio relay pipeline exists (`buzz-relay/src/audio/`), but recording and per-track publishing are not built. **[DOCS+CODE, §1]**
- **AI-agent tool-call permissions**: `crates/buzz-agent`'s own module doc describes a client-enforced `BUZZ_ACP_PERMISSION_POLICY`; the actual `buzz-acp` code auto-approves every request unconditionally, and the env var has no implementation anywhere in `buzz-acp`. This is a **documentation/implementation mismatch**, not confirmed as a known/tracked gap by any issue tracker reference found in this pass. **[CODE-confirmed, §6.11/§11.9 — recommend verifying current intent with the team]**
- **Mobile client**: full feature set present in code (channels, DMs, huddles, agents, pairing) but marked "being wired up" (🚧) in `README.md`'s own capability matrix, not "works today." **[DOCS, cross-checked against real `mobile/lib/features/*` code, §7.3]**
- **Rate limiting**: real Redis-backed limiter exists, but a test-only `AlwaysAllowRateLimiter` stub is documented (`ARCHITECTURE.md` §9) as the production-adjacent gap — exact production posture needs verification against deployed config. **[CODE-confirmed per repo's own docs]**
- Some workflow actions (`send_dm`, `set_channel_topic`) are documented in `ARCHITECTURE.md` §9 as returning `NotImplemented`. **[DOCS, not independently re-verified against `executor.rs` in this pass]**

### Contradictions / drift found between documentation and code (flag for the team, not resolved here)

- **Push notifications**: `README.md`'s own capability table lists push notifications under "💭 strong opinion, pending code," but `crates/buzz-push-gateway` is a real, substantial crate (own Dockerfile, own Helm chart, a full challenge/installation/delegation/quota/replay-protection schema in `schema/schema.sql`), and `buzz-relay` has a live push-matcher/delivery background worker gated by `BUZZ_PUSH_ENABLED`. **This looks like stale README content rather than an accurate current-state description — needs verification with the team.** **[CODE vs DOCS discrepancy, §1/§9.4]**
- **Typesense**: `.env.example` documents `TYPESENSE_API_KEY`/`TYPESENSE_URL`, but `docker-compose.yml` defines no Typesense service, and `main.rs` code comments describe search as having *already migrated* from Typesense to Postgres FTS. Likely leftover config from a completed migration — needs verification / cleanup consideration. **[CODE+DOCS drift, §12]**
- **Keycloak**: present as a real service in `docker-compose.yml`, but Buzz's documented primary auth model (`SECURITY.md`) is NIP-42/NIP-98 Nostr-key based with no OIDC/JWT dependency in the core auth crate. Keycloak's actual integration point (candidate: `buzz-agent`'s Databricks/OAuth model-provider flow) was **not established** in this pass. **[UNCLEAR, §13]**

### Planned / future (per `VISION_*.md` — explicitly not current implementation)

- Web-of-trust reputation across relays (`README.md`'s "pending" list) — no corresponding code found in this pass. **[VISION/UNCLEAR]**
- "Culture features" (`README.md`'s "pending" list) — no corresponding code found. **[VISION/UNCLEAR]**
- NIP-PMA (private managed-agent aggregate, kind:30179) is explicitly a **reservation-only** spec — its own doc states relays MUST currently reject this kind pending further privacy/CAS/revocation design work. **[DOCS, §5.9]**
- NIP-29 group-roles mirror events (kind:39003) are defined as constants but not emitted by the relay. **[DOCS: `NOSTR.md`, §5.1]**
- Live push notification of open-channel discovery (NIP-29 discovery events don't appear on live global subscriptions today) is called out in `NOSTR.md` as a "future enhancement." **[DOCS, §5.6]**
- Broader "shared compute" / mesh-LLM concepts described in `VISION_MESH.md` go beyond what was confirmed as built in `buzz-relay-mesh` (which is confirmed as an inter-relay transport/membership layer, off by default) — the full P2P shared-compute vision should be treated as aspirational unless independently verified against `desktop/src-tauri`'s `mesh_llm` feature code. **[VISION vs partial CODE, §6.14/§8.1]**

### Unknown / needs verification (not established in this research pass — a follow-up read is the concrete next step, file paths given)

- `crates/buzz-cli` internals (only inferred as "agent-first CLI" from `Cargo.toml`). → read `crates/buzz-cli/src`.
- `crates/buzz-backend-kubernetes` internals beyond its stated role. → read `crates/buzz-backend-kubernetes/src`.
- `crates/buzz-pair-relay` and `crates/buzz-pairing-cli` — device/agent pairing flow not deep-read. → read `crates/buzz-pair-relay/src`, `docs/deployment-identity.md`.
- `crates/ifc-core` — plausibly underpins information-flow-control policy for agent data visibility (`docs/practical-information-flow-for-buzz-agents.md` exists) but not confirmed. → read `crates/ifc-core/src`.
- `crates/buzz-audit`'s exact schema/what is audited. → read `crates/buzz-audit/src`, `audit_log` table usage.
- `crates/buzz-deletion`'s exact state-machine transition logic. → read `crates/buzz-deletion/src`.
- `desktop/src-tauri`'s `egress_guard.rs` purpose (name suggests outbound-request gating relevant to the wide CSP). → read `desktop/src-tauri/src/egress_guard.rs`.
- `desktop/src-tauri`'s custom `native_websocket` Tauri plugin's JS-facing API. → read `desktop/src-tauri/src/native_websocket.rs` + its frontend consumer.
- Exact request/response shapes for several relay endpoints (operator API, workflows API, media upload, git routes) — auth requirements were inferred from route placement, not fully verified in handler code. → read `crates/buzz-relay/src/api/{operator,workflows,media,git}.rs`.
- Whether `pgschema` (vendored in `bin/`) or the `buzz-admin migrate` CLI is the authoritative migration-application mechanism — both exist; only `buzz-admin -- migrate` was confirmed as what `just migrate` actually invokes. → check `scripts/` for any `pgschema` invocation and how `schema/schema.sql` gets regenerated.
- `deploy/compose/`, `deploy/local/`, `benchmarks/*`, `patches/*.patch` contents and rationale. → open each directly.
- Most of the 23 GitHub Actions workflow files (only `ci.yml` and its immediate reusable-workflow structure were read). → open individually as needed.
- Exact CORS default posture in production deployments (code default is permissive if `BUZZ_CORS_ORIGINS` unset — whether deployment tooling overrides this was not checked). → check `deploy/charts/buzz/values.yaml` / `templates/deployment.yaml`.
- `admin-web`'s absence of a WebSocket layer was confirmed only by file listing, not a full-text search. → `grep -rn WebSocket admin-web/src`.
- Mobile-to-relay wire compatibility (the Dart `nostr` package's version/behavior vs. the server's exact expectations) was not cross-verified. → compare `mobile/pubspec.yaml`'s `nostr` package against `crates/buzz-core`'s event/kind handling.

### How to use this section

Treat the "Confirmed working" list as safe to build on. Treat "Partially implemented" and "Contradictions" as things to raise with the team *before* assuming behavior either way — in particular, the ACP permission-auto-approval finding (§11.9) has real security implications and is worth a direct conversation, not a silent fix or a silent reliance on the doc comment's described (but unimplemented) policy.

## 18. Where Should I Start?

A recommended reading order, beginner → advanced. Each entry says why to read it and what it teaches, so you can stop early if you only need part of the picture.

### Beginner (product + shape of the repo)

1. **`README.md`** — Product framing: what Buzz is, who it's for, the "works today / being wired up / pending" capability matrix. Teaches: the elevator pitch and an honest view of what's solid vs. aspirational.
2. **`docs/BUZZ_PROJECT_ARCHITECTURE_AND_REQUIREMENTS.md`** (this document) — a single map of the whole system with citations into everything below.
3. **`ARCHITECTURE.md`** — the repo's own 835-line authoritative architecture reference. Teaches: crate dependency graph, event pipeline, kind ranges, known gaps (cross-checked throughout this document).
4. **`AGENTS.md`** — contributor conventions and a hand-maintained structure map (note: not exhaustive — see §2.3 for the crates it omits). Teaches: how the team expects code to be written and reviewed here, including cited "Review-Proven Rules."
5. **`.env.example`** — every configuration knob the system has, grouped by subsystem, in one file. Teaches: the real surface area of the system faster than reading code.

### Intermediate (how to run it, how data is shaped)

6. **`TESTING.md`** + skim `Justfile` recipe names — how to build, run, and test locally. Teaches: `just bootstrap && just dev` gets a full desktop app running against a local relay; §13/§14 of this document distill the exact commands.
7. **`crates/buzz-core/src/kind.rs`** — the entire event-kind vocabulary of the system in one file. Teaches: every feature in Buzz is ultimately "a new kind number" — this file is the shape of the whole protocol surface.
8. **`schema/schema.sql`** — the consolidated, current database schema. Teaches: the real data model (communities, channels, events, users, workflows, moderation, deletion, push) faster than reading 30+ migration files individually.
9. **`NOSTR.md`** — Buzz's own protocol usage reference. Teaches: exactly which NIPs are implemented and how Buzz's channel/community model maps onto NIP-29.

### Advanced (how the server and clients actually work)

10. **`crates/buzz-relay/src/main.rs`** — the full server boot sequence; ties together every subsystem (DB, Redis, auth, search, workflows, media, mesh, background workers). Teaches: what "starting the relay" really does, and the order dependencies between subsystems.
11. **`crates/buzz-relay/src/router.rs`** + **`connection.rs`** — the HTTP/WebSocket surface and per-connection lifecycle (tenant binding, NIP-42 handshake, backpressure). Teaches: how a request/connection actually gets authenticated and routed.
12. **`crates/buzz-acp/src/acp.rs`** + **`crates/buzz-agent/README.md`** — the AI agent architecture end-to-end (the harness's JSON-RPC client, and the agent side's own excellent self-documentation). Teaches: exactly how a human message becomes an agent reply, and where the permission-policy mismatch (§11.9) lives.
13. **`desktop/src-tauri/src/lib.rs`** — the desktop app's entry point: plugin registration, IPC command registration, sidecar-process supervision for local agents. Teaches: the desktop app is a thin client + process supervisor, not an embedded server.
14. **`desktop/src/app`** (top-level files) — the primary human client's UI entry point. Teaches: how the frontend is organized around Tauri IPC (`invoke`/`listen`) rather than a typical pure-web app.
15. **`docs/nips/`** — Buzz's own 17 draft protocol extensions (agent auth, memory, personas, observability, push leases, DM visibility, etc.). Teaches: where Buzz has extended Nostr for product needs standard NIPs don't cover.

### Read last, deliberately

16. **`VISION.md`** and the other `VISION_*.md` files — forward-looking product direction. Read these *last* and consciously separate them from the current-state material above (§17 of this document does this separation explicitly) — they describe where the team wants to go, not what exists today.

## 19. Glossary

Only terms actually used in this repository, with the meaning they carry here specifically (some diverge from generic usage).

| Term | Meaning in Buzz |
|---|---|
| **Buzz** | The overall product/platform: a self-hostable Nostr relay plus a family of clients (desktop, web, mobile, admin), built for humans and AI agents to share the same communication substrate. |
| **Relay** | A Nostr relay process — here, the `buzz-relay` binary. The single source of truth for all events in the communities it serves. |
| **Nostr** | The base protocol (NIP-01) Buzz is built on: signed JSON events, published/queried over WebSocket. |
| **NIP** | "Nostr Implementation Possibility" — a numbered protocol extension spec. Buzz implements several standard NIPs and defines its own draft NIPs (`docs/nips/`) for features standard Nostr doesn't cover. |
| **Kind** | The integer type tag on every Nostr event (e.g. kind:1 = text note, kind:9 = Buzz "stream message"). Buzz's entire feature dispatch is keyed on this number (`crates/buzz-core/src/kind.rs`). |
| **Event** | A signed, immutable JSON object (id, pubkey, kind, tags, content, sig) — the atomic unit of everything in Buzz: messages, reactions, channel metadata, agent memories, workflow definitions, etc. |
| **Subscription (REQ)** | A live query a client opens on a relay connection (`["REQ", sub_id, filters...]`); the relay pushes matching events as they're created until the client sends `CLOSE`. |
| **Community** | A tenant/workspace in Buzz's multi-tenant model — the set of data (channels, users, events) scoped to one `community_id`, bound to a specific hostname on a relay. |
| **Channel** | A Buzz chat channel — implemented as a NIP-29 relay-based group. Includes regular channels, DMs (as a channel type), and ephemeral (TTL-expiring) channels. |
| **DM** | Direct message — implemented via NIP-17 "gift wrap" (kind:1059), not a bare encrypted kind:4 event. |
| **NIP-29** | The Nostr spec for relay-based groups; Buzz's native model for channels/communities. |
| **NIP-42** | Client-to-relay authentication via a signed challenge/response over the WebSocket connection. |
| **NIP-44** | Versioned symmetric (ECDH-derived) encryption; Buzz's general-purpose encryption primitive (agent memory, telemetry, pairing, push leases). |
| **NIP-46** | The "remote signer"/bunker protocol. Buzz's pairing flow can *transport* a bunker connection string, but no evidence was found of Buzz acting as a bunker client itself. |
| **NIP-98** | HTTP request authentication via a signed Nostr event in the `Authorization` header — used for Buzz's REST API and git-over-HTTP credential flow. |
| **ACP** | Agent Client Protocol — an external, still-evolving JSON-RPC-over-stdio protocol (also used by editors like Zed/JetBrains) for driving AI coding/chat agents. Buzz implements a client (`buzz-acp`) and a from-scratch agent (`buzz-agent`) for it. |
| **buzz-acp** | The "harness" crate: bridges Buzz relay events to an AI agent subprocess over ACP. Holds the agent's Nostr private key. |
| **buzz-agent** | Buzz's own minimal, hand-rolled ACP-compliant agent — an LLM tool-call loop, one of several agent runtimes `buzz-acp` can drive. |
| **Agent** | An AI participant in Buzz — structurally just another Nostr keypair, owned by (linked to) a human user, that can be added to channels and publish events like any other participant. |
| **Persona** | An agent's behavioral identity: a `.persona.md` file (YAML frontmatter + markdown system-prompt body), separate from its cryptographic (keypair) identity. |
| **Session (ACP)** | A conversational context boundary between the harness and an agent subprocess — scoped per-channel by default, optionally per-thread (`SessionScope`). |
| **Harness** | Informal name for the `buzz-acp` process — it "harnesses" an underlying agent CLI to the Buzz relay. |
| **MCP** | Model Context Protocol — the tool-calling protocol an agent subprocess uses to talk to tool servers (e.g. `buzz-dev-mcp`'s shell/file-edit tools), also stdio JSON-RPC. |
| **Reply Guard** | The design rule that an agent's reply only becomes visible to humans if the agent actually invokes a messaging tool call — raw LLM assistant text is not auto-published. |
| **Sidecar** | A prebuilt binary bundled inside the desktop app (`buzz-acp`, `buzz-agent`, `buzz-backend-kubernetes`, `buzz-dev-mcp`, `git-credential-nostr`, the `buzz` CLI) and spawned as a real OS child process, not run in-process. |
| **Tauri** | The Rust-based framework wrapping Buzz's React frontend into a native desktop app (Windows/macOS/Linux), providing IPC between JS and Rust. |
| **IPC** | Inter-process communication between the desktop app's webview (JS) and its Rust backend — `invoke()` calls from JS to Rust commands, `emit()`/`listen()` for Rust-to-JS events. |
| **Operator** | A relay-administration role — a pubkey listed in `RELAY_OPERATOR_PUBKEYS` (or the bootstrapped `RELAY_OWNER_PUBKEY`) authorized to use the admin API / operator-provisioning API. |
| **Relay Membership (NIP-43)** | Buzz-coined extension (reuses the "NIP-43" number for its own purpose) for a relay-wide allowlist of who may connect, distinct from per-channel membership. |
| **Workflow** | A YAML-defined, server-side automation: sequential actions triggered by an event, a cron schedule, or a webhook (`buzz-workflow`). Distinct from an ACP agent turn. |
| **Huddle** | Buzz's term for a voice (and eventually video) call between participants, with a local audio pipeline (STT/TTS/VAD) on the client and an audio relay on the server. |
| **Mesh** | The optional, off-by-default inter-relay transport (`buzz-relay-mesh`) used for cross-pod huddle/presence signaling — not a general P2P event-gossip network. |
| **Push Lease (NIP-PL)** | A stored, expiring authorization letting a push executor keep a filter "alive" and wake a mobile app via platform push (APNs) after its WebSocket closes. |
| **IFC / ifc-core** | Information Flow Control — a generic, protocol-agnostic primitives crate (`ifc-core`), plausibly underlying policy about what data agents may see (`docs/practical-information-flow-for-buzz-agents.md`); exact usage not fully traced (see §17 unknowns). |
| **Tenant** | Synonym for "community" in the multi-tenancy model — the unit of data isolation, keyed by `community_id`. |

## 20. Developer Quick Reference

### Essential commands

```bash
. ./bin/activate-hermit         # activate pinned toolchain (cargo/node/pnpm/flutter/just/...)
just bootstrap                  # one-time: toolchain + .env + stable relay signing key
just dev                        # full desktop app + local relay + Docker infra + migrations
just relay                      # relay only (debug build), no desktop app
just relay-web                  # build web/ and serve it straight from the relay
just web                        # standalone web client, Vite dev server
just admin                      # admin-web dashboard against a local relay
just desktop-standalone         # desktop app only, no relay/DB/Docker required
just test-unit                  # fast Rust unit tests, no infra needed — run first on every change
just test                       # unit + integration tests, auto-starts Docker
just ci                         # full local reproduction of the CI gate
just desktop-e2e-pre-push       # Playwright specs changed vs. origin/main
just down / just ps / just logs # Docker Compose stack control
just reset                      # DESTRUCTIVE — wipes local dev data (confirmation-gated)
```

### Important directories

| Path | What it is |
|---|---|
| `crates/` | 30-crate Rust workspace — relay, DB, auth, agents, CLI, git tooling |
| `crates/buzz-relay` | The server binary — start here for backend work |
| `crates/buzz-acp`, `crates/buzz-agent` | AI agent architecture — start here for agent work |
| `desktop/` | Primary human client (Tauri 2 + React 19) |
| `desktop/src-tauri` | Rust/native shell — start here for desktop-native work |
| `web/`, `admin-web/` | Lightweight browser client, moderation console |
| `mobile/` | Flutter iOS/Android client |
| `migrations/`, `schema/schema.sql` | Database schema evolution and current snapshot |
| `deploy/charts/buzz` | Production Helm chart |
| `docs/nips/` | Buzz's own draft Nostr protocol extensions |
| `docs/` (root files) | Deep-dive design docs for specific subsystems |

### Important services (local dev, `docker-compose.yml`)

| Service | Port | Purpose |
|---|---|---|
| PostgreSQL | 5432 | Primary datastore |
| Redis | 6379 | Pub/sub fan-out, presence, rate limiting |
| MinIO | 9000 (API) / 9001 (console) | S3-compatible object storage (media + git) |
| Adminer | 8082 | Postgres browser UI |
| Prometheus | 9090 | Metrics scraping |
| Keycloak | 8180 | Present in compose; integration point in Buzz's auth flow not confirmed — see §17 |
| `buzz-relay` app listener | 3000 | Nostr WS + HTTP API |
| `buzz-relay` health listener | 8080 | `/health`, `/_liveness`, `/_readiness`, `/_status`, `/_mesh` |
| `buzz-relay` metrics listener | 9102 | Prometheus `/metrics` |

### Important config files

| File | Purpose |
|---|---|
| `.env.example` | Full environment-variable reference (copy to `.env`) |
| `Justfile` | Primary dev-workflow command runner |
| `rust-toolchain.toml` | Pinned Rust version (`1.95.0`) |
| `docker-compose.yml` | Local dev infrastructure stack |
| `deploy/charts/buzz/values.yaml` | Production Helm chart configuration |
| `tauri.conf.json` (`desktop/src-tauri/`) | Desktop app packaging, CSP, sidecars, plugins |
| `schema/schema.sql` | Current consolidated database schema |

### Important APIs (see §9.2 for the full table)

| Endpoint | Purpose |
|---|---|
| WS `/` (upgrade) | Nostr NIP-01 relay connection |
| GET `/` (Accept: nostr+json) or `/info` | NIP-11 relay info |
| POST `/events`, `/query`, `/count` | HTTP bridge for EVENT/REQ/COUNT (NIP-98 auth) |
| POST `/api/invites`, `/api/invites/claim` | Invite mint / redeem |
| `/api/admin/v1/*` | Admin/moderation dashboard API |
| `/operator/communities/*` | Multi-tenant provisioning API |
| PUT `/upload`, GET `/media/{hash}` | Media blob upload/fetch |
| GET `/huddle/{channel_id}/audio` | Voice call WebSocket |

### Important protocols

NIP-01, NIP-29, NIP-42, NIP-44, NIP-17, NIP-10, NIP-09, NIP-25, NIP-11, NIP-98, NIP-05 (all implemented, §5.1) · ACP (agent client protocol, §6.2) · MCP (agent tool-calling, §6.5) · 17 Buzz-authored draft NIPs (`docs/nips/`, §5.9)

### Important test commands

```bash
just test-unit                                   # per-crate Rust unit tests
just test-integration                             # Postgres/Redis-backed integration tests
cargo test -p buzz-test-client -- --ignored       # relay E2E (requires a live relay)
just desktop-e2e-smoke                            # Playwright smoke suite
just desktop-e2e-integration                      # Playwright, relay/DB-backed
just desktop-release-smoke                        # heavy pre-release regression gate
just admin-check                                  # admin API + admin-web checks
just mobile-test                                  # Flutter tests
```

### Common troubleshooting starting points

- **"Tests pass locally but CI fails"** → you forgot `just ci` (documented in `TESTING.md`'s own troubleshooting table).
- **Desktop app and a manually-run test relay fighting over Docker container names/ports** → they share defaults by default; use `docker-compose.harness.yml` / a distinct `COMPOSE_PROJECT_NAME` for an isolated test relay (§13/§14).
- **A WebSocket connection is rejected immediately with a generic 404** → the connecting `Host` header doesn't map to any known community (`tenant::bind_community`) — this is intentional (unmapped hosts never reveal which hosts exist).
- **Agent doesn't seem to reply** → check whether it actually invoked a tool call (Reply Guard, §6.6/§16) rather than just producing assistant text; check `BUZZ_ACP_SUBSCRIBE`/`BUZZ_ACP_KINDS`/`BUZZ_ACP_CHANNELS` scoping.
- **Trying to gate what an agent's tool calls can do** → read §11.9(1) first; the documented `BUZZ_ACP_PERMISSION_POLICY` is not currently implemented — every tool-call permission request is auto-approved today.
- **Migration seems stuck / schema change conflicts with community deletion** → migrations and community deletion share an exclusive/shared advisory-lock pair by design (§9.5/§16); this is expected serialization, not a bug.
- **Where do I look for X's exact behavior and it's not in this document** → check §17's "Unknown / needs verification" list first; it names the exact file to open next for most known gaps.
