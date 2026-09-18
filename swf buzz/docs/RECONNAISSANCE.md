# Phase 0 — Reconnaissance

Date: 2026-09-11
Scope: read-only inspection of `../buzz` (the existing Buzz monorepo, treated strictly as reference). Nothing in `../buzz` was modified.

## 1. Repository layout (`./buzz`)

Monorepo root contains, among others:

```
buzz/
├── crates/                 # Rust workspace (~30 crates)
├── desktop/                 # Existing Buzz Desktop — Tauri 2 + React 19 (NOT Vue)
├── web/                      # Web client
├── admin-web/                # Admin dashboard
├── mobile/                    # Mobile client
├── schema/, migrations/       # Postgres schema
├── docs/                       # Existing docs, incl. two highly relevant pre-existing
│                                 research files (see §4)
├── NOSTR.md                    # Authoritative protocol overview doc
├── VISION_AGENT.md, VISION_MESH.md, VISION_*.md  # Product vision docs (aspirational,
│                                 not all implemented — verify against source)
├── Cargo.toml, Cargo.lock, rust-toolchain.toml
├── package.json, pnpm-workspace.yaml, pnpm-lock.yaml
└── Justfile                    # Local dev orchestration (relay, staging, etc.)
```

Relevant Rust crates for protocol/architecture reference:

- `crates/buzz-core` — **authoritative Nostr event kind registry** (`src/kind.rs`) and thread/reply parsing (`src/nip10.rs`), NIP-44 observer-frame helpers (`src/observer.rs`).
- `crates/buzz-relay` — relay ingest/authorization/side-effects (`src/handlers/ingest.rs`, `src/handlers/side_effects.rs`, `src/handlers/command_executor.rs`, `src/handlers/event.rs`), CORS config (`src/router.rs`), Redis-backed presence/typing.
- `crates/buzz-db` — persistence for channels/DMs (`src/store/dm.rs`).
- `crates/buzz-acp` — agent harness / relay subscription for agent mention-triggering (`src/relay.rs`, `src/lib.rs`).
- `crates/buzz-auth` — NIP-42 relay auth (`src/nip42.rs`), NIP-FI federated identity (server-side, not client-relevant).
- `crates/buzz-test-client` — conformance/interop tests; useful as executable protocol spec (`tests/e2e_nostr_interop.rs`).
- `docs/nips/NIP-AP.md`, `NIP-AM.md`, `NIP-AE.md`, `NIP-DV.md` — Buzz-authored NIP extensions for agent personas, turn metrics, agent memory, DM visibility.

**Explicitly out of scope for SWF Buzz** (present in `./buzz` but not to be ported): `desktop/src-tauri/src/managed_agents/`, git bridge (`git-credential-nostr`, `git-sign-nostr` crates), huddles, `buzz-voice`, canvas/whiteboard, workflow automation, `crates/buzz-agent`'s LLM-provider OAuth (Databricks etc. — irrelevant to end-user auth).

## 2. Toolchain / versions (existing Buzz Desktop, for reference only)

| Item                 | Value                                                                                                                                         | Source                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Tauri                | 2.x (`tauri = "2"`, CLI `~2.11.4`)                                                                                                            | `desktop/src-tauri/Cargo.toml`, `desktop/package.json`      |
| Frontend framework   | **React 19.1** + TanStack Router 1.168 (NOT Vue)                                                                                              | `desktop/package.json`                                      |
| Server-state cache   | `@tanstack/react-query` 5.90.21                                                                                                               | `desktop/package.json`                                      |
| Vite                 | ^8.0.0                                                                                                                                        | `desktop/package.json`                                      |
| TypeScript           | ~6.0.0                                                                                                                                        | `desktop/package.json`                                      |
| Rust toolchain       | 1.95.0 (pinned)                                                                                                                               | `rust-toolchain.toml`                                       |
| Node package manager | pnpm 11.4.0                                                                                                                                   | root `package.json` (`packageManager` field)                |
| Node (CI)            | 24.14.1                                                                                                                                       | `.github/workflows/windows-canary.yml`                      |
| Lint/format          | Biome (not ESLint/Prettier)                                                                                                                   | `biome.json`                                                |
| `nostr` Rust crate   | `0.44`, features `["nip44", "nip49"]` — **`nip46` feature NOT enabled**                                                                       | `desktop/src-tauri/Cargo.toml`                              |
| Secure storage       | `keyring` crate 3.6.3, OS keychain, single JSON blob under one entry                                                                          | `desktop/src-tauri/src/secret_store.rs`                     |
| Media                | Blossom protocol (BUD-01) over HTTP, signed Nostr auth (`kind:24242`), proxied via local Rust HTTP server + custom `buzz-media://` URI scheme | `desktop/src-tauri/src/commands/media.rs`, `media_proxy.rs` |

**Important divergence from this task's target stack**: Buzz Desktop is React, not Vue, and has no Vue Query/Pinia equivalent to copy structurally — only the _pattern_ (TanStack Query for server state, thin per-domain stores for local UI state) transfers. SWF Buzz will use `@tanstack/vue-query` (the direct Vue analogue) and Pinia, per the product requirement, built independently.

**Important gap vs. requirement**: Buzz Desktop does **not** implement NIP-46 remote signing. Its `PayloadType::Bunker`/`Connect` pairing variants only _transport_ an opaque secret string between the user's own devices — nothing consumes it as a live remote signer. The `nostr` crate's `nip46` feature isn't even enabled. SWF Buzz's NIP-46 signing layer is therefore **new work**, not a port. See `DECISIONS.md`.

## 3. `swf buzz/` starting state

Was effectively empty prior to this work (contained only a stray empty `prompts.md/` directory, ignored). No project scaffolding existed yet.

## 4. Pre-existing research found inside `./buzz/docs/`

Two files were discovered that are themselves a prior AI research pass **for this exact task** (a new Vue 3 + Tauri 2 desktop client against this backend):

- `buzz/docs/BUZZ_REPO_IMPLEMENTATION_CONTEXT.md` (~1600 lines)
- `buzz/docs/BUZZ_PROJECT_ARCHITECTURE_AND_REQUIREMENTS.md` (~2170 lines)

These cover kind registries, NIP-29 flows, the DM kind:41010-vs-NIP-17 question, and sequence diagrams in more depth than a single research pass can restate. A sample of their most load-bearing claims (keyring design, NIP-42 exact checks, native websocket plugin shape, NIP-46 absence, CORS default-permissive behavior, Builderlab OAuth loopback pattern) was **independently verified against source** during this reconnaissance and found accurate. Treat these two files as a strong secondary reference; this project's own `PROTOCOL_IMPLEMENTATION_REFERENCE.md` was still independently derived from source (`kind.rs`, relay handlers, client builders) rather than copied from them, per the "verify from source, don't guess" rule.

## 5. Method

Two parallel read-only research passes were run against `./buzz`:

1. Protocol/kind-registry verification — grepped `crates/buzz-core/src/kind.rs` (authoritative registry, has a compile-time no-duplicate-kind test), cross-referenced relay handlers (`crates/buzz-relay/src/handlers/*.rs`) for actual wire behavior, and client builders (`desktop/src-tauri/src/events.rs`, `desktop/src/features/messages/lib/threading.ts`, `desktop/src/shared/api/relayClientSession.ts`) for what's actually emitted.
2. Architecture pattern verification — `desktop/src-tauri/` (Tauri IPC, secure storage, auth, media) and `desktop/src/` (frontend layering, state management, relay connection handling).

Full findings are in `ARCHITECTURE.md` and `PROTOCOL_IMPLEMENTATION_REFERENCE.md`.

## 6. Blockers requiring product/team confirmation (see also `DECISIONS.md`)

1. **NIP-46 bunker infrastructure does not exist yet anywhere in the Buzz stack.** SWF Buzz needs either (a) a real NIP-46-compatible remote signer service to connect to, or (b) an interim development-mode signer. Confirm which bunker implementation SWF Buzz should target in production.
2. **Okta tenant/application details** (issuer URL, client ID, redirect URI, scopes) are not available in this repository and must come from the team.
3. **Invite acceptance (`kind:9009`) has no server-side effect today** — the relay's own handler is a no-op. A client invite feature cannot rely on server enforcement until the relay implements this; confirm timeline/scope with the backend team before building more than a stub.
4. **`kind:41001` (`KIND_DM_CREATED`) and `kind:41011` (`KIND_DM_ADD_MEMBER`)** are registered constants with no confirmed live handler — do not depend on them without re-verification against the deployed relay version SWF Buzz will target.
5. **Dev relay URL / CORS allowlist** for local development against a real `buzz-relay` instance is not specified; `BUZZ_CORS_ORIGINS` must include `tauri://localhost` and `http://tauri.localhost` on the relay operators' side (see `SECURITY.md`).
