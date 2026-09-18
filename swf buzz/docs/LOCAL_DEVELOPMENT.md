# Local Development

**This is the practical how-to.** For the protocol/infrastructure reconnaissance behind it, see
`docs/INFRASTRUCTURE_INTEGRATION.md` and `docs/BUZZ_INFRASTRUCTURE_DISCOVERY.md`. For what was and
wasn't verified in this environment, see `docs/E2E_TEST_RESULTS.md`. For known gaps, see
`docs/KNOWN_LIMITATIONS.md`.

## Architecture (Development Mode)

```
SWF Buzz
  ↓
DevAuthService        (src/features/auth/authService.dev.ts — dev builds only)
  ↓
DevSigningService     (src/features/signing/signingService.dev.ts — dev builds only)
  ↓
RelayConnectionService (src/services/RelayConnectionService.ts — real WebSocket, nostr-tools' Relay)
  ↓
buzz-relay             (../buzz, local instance)
```

Development Mode is completely independent of the Okta/NIP-46 production path — see
`docs/SECURITY.md` for the isolation rules (dev-build-only gating, no persisted keys) and
`docs/ARCHITECTURE.md` §6 for why auth and signing are separate concerns. **Neither the production
Okta flow (`src-tauri/src/auth/oidc.rs`, `authService.okta.ts`) nor the production NIP-46 flow
(`signingService.nip46.ts`) were touched to build or verify this** — they're a separate, untouched
code path.

## Prerequisites

- Node.js + npm (already set up if you're reading this from a working checkout).
- Rust + Cargo, for the Tauri shell (`npm run tauri dev`) — optional if you only need the browser
  UI via `npm run dev`.
- **For a real local relay**: Docker Desktop, `just`, and **Git Bash** (not PowerShell/cmd — see
  "Windows: use Git Bash, not PowerShell" below). See "The relay requires Docker" below — this is a
  real prerequisite the reference `../buzz` repo's own setup script hard-requires, not an SWF Buzz
  choice.

### Windows: use Git Bash, not PowerShell, for `just`/`../buzz` commands

Two Windows-specific issues were found and diagnosed by actually running these commands on a real
Windows checkout — not guessed:

1. **`just` isn't on PATH by default.** `../buzz/bin/just` _looks_ like it should provide it (it's
   a [Hermit](https://github.com/cashapp/hermit)-managed tool shim), but on this Windows checkout
   it's a 16-byte placeholder text file, not a working shim — Hermit's shims are meant to be real
   Unix symlinks to a downloaded binary, and a plain `git clone`/checkout on Windows (without
   symlink support enabled) checks them out as inert text instead. This affects every tool in
   `../buzz/bin/` (`just`, `cargo`, `node`, `pnpm`, ...), and even `../buzz/bin/hermit` itself is a
   `#!/bin/bash` script, not a native `.exe` — the whole toolchain is POSIX-shell-native by design.
   **Fix**: install `just` directly instead of relying on the Hermit shim — it's a small, standard
   tool, not something exotic:
   ```sh
   cargo install just
   ```
   This uses the Rust toolchain you already have (confirmed working throughout this project) and
   puts `just.exe` in `~/.cargo/bin`, which is already on both Git Bash's and PowerShell's PATH on
   a standard Rust install — no PATH changes needed.
2. **Run `just` from Git Bash, not PowerShell.** Even with `just` installed, running a `just`
   recipe _from PowerShell_ fails with `error: could not find 'cygpath' executable to translate
recipe shebang interpreter path` — `just`'s Windows support shells out to Git for Windows'
   `cygpath` utility to translate the `#!/usr/bin/env bash` shebang every recipe in this `Justfile`
   uses, and that utility isn't on PowerShell's PATH by default either. Running the _exact same
   command_ from **Git Bash** works with no extra configuration, because bash executes its own
   shebang scripts directly — no path translation needed. Open Git Bash (already installed
   alongside Git for Windows — right-click a folder → "Git Bash Here", or find it in the Start
   Menu) and run the commands below there.

   Once you're in Git Bash, the broken `bin/cargo`/`bin/node` placeholders are harmless: bash's own
   PATH resolution skips non-executable files and falls through to your regular system `cargo`/
   `node` — confirmed working (and `cargo` even auto-installs `../buzz`'s exact pinned Rust
   toolchain version via its `rust-toolchain.toml`, independent of Hermit entirely). `pnpm` has no
   such system fallback and will error if invoked — harmless for SWF Buzz's purposes, since we only
   need the relay, not `../buzz`'s own `desktop`/`web` frontends, and `just setup` treats a missing
   `pnpm` as a warning, not a failure.
   You do **not** need `. ./bin/activate-hermit` — it only prepends the (non-functional) `bin/` to
   PATH, which the fallback behavior above makes moot.

## Step 1 — Configure SWF Buzz

```sh
cd "swf buzz"
cp .env.example .env.local
```

`.env.local` is git-ignored (`*.local` in `.gitignore`) and must never be committed. The default
`VITE_RELAY_URL=ws://localhost:3000` already matches the reference repo's own local dev default
(confirmed against `../buzz/examples/countdown-bot/README.md` and
`../buzz/crates/buzz-acp/src/config.rs`) — no changes needed for local dev.

## Step 2 — Start a local buzz-relay

**In Git Bash** (see above — not PowerShell/cmd):

```sh
cd ../buzz
just setup      # requires Docker Desktop running — see below
just relay      # relay listens on ws://localhost:3000
```

### The relay requires Docker

`just setup` runs `scripts/dev-setup.sh`, which hard-requires Docker (`command -v docker`,
`docker info`) to bring up Postgres, Redis, and MinIO — `buzz-relay` needs all three. There is no
native/Docker-less path in the reference repo (no bundled Postgres/Redis binary, no SQLite mode).
This was directly confirmed by actually running `just bootstrap` (the first step of `just setup`)
on a real Windows machine without Docker installed: `cargo`/`node` resolved fine via the system
fallback described above, then the script hit its own explicit check and stopped cleanly:

```
Ensuring toolchain via Hermit...
v24.19.0
cargo 1.95.0 (f2d3ce0bd 2026-03-21)
Error: Docker is required but not installed.
Install it from https://docs.docker.com/get-docker/
error: recipe `bootstrap` failed with exit code 1
```

This is the one remaining genuine blocker — not an SWF Buzz issue, and not fixable without
installing Docker Desktop:

1. Install **Docker Desktop for Windows**: <https://docs.docker.com/desktop/setup/install/windows-install/>
   (requires WSL2 or Hyper-V; the installer will guide you — this needs your own interactive
   confirmation/admin rights, so it isn't something to script unattended).
2. Start Docker Desktop and wait for it to report "running."
3. From Git Bash: `cd ../buzz && just setup && just relay`.

If you have Docker running, `just setup`/`just relay` should now work end-to-end (the `just`/PATH
issues above are the only things that were actually blocking it on Windows) — see
`docs/E2E_TEST_RESULTS.md` for exactly what remains unverified until then.

## Step 3 — Run SWF Buzz

```sh
cd "swf buzz"
npm install
npm run tauri dev
```

Or, for browser-only UI iteration (Development Mode needs no Tauri IPC at all — see
`docs/KNOWN_LIMITATIONS.md`):

```sh
npm run dev
```

On the login screen, use **"Continue in Development Mode"** (only rendered in dev builds). This
signs in with a fresh in-memory ephemeral Nostr keypair and immediately connects
`RelayConnectionService` to `VITE_RELAY_URL`.

**If Step 2's relay isn't running yet**, the top-bar connection badge will show "Connection error"
with the detail "Can't reach the local Buzz relay. Make sure it's running" (hover the badge, or it's
shown inline once it's not too long) and keep retrying with capped backoff — this is expected,
working behavior, not a crash. It'll connect automatically as soon as the relay comes up; no need to
reload or re-login. Your browser/Tauri devtools console will additionally show the technical detail
(`[RelayConnectionService.connect] ...`) — that's a developer-facing log, not the same as what the
UI shows the user; see `docs/SECURITY.md` for why raw errors never reach the UI directly.

## Step 4 — Optional: a test agent

`../buzz/examples/countdown-bot` is a small non-AI bot that speaks the real protocol (NIP-42 auth,
`kind:0` profile, `kind:9` replies) — good for exercising the @mention/agent-reply UI without an
LLM-backed ACP instance:

```sh
cd ../buzz
BUZZ_RELAY_URL=ws://localhost:3000 \
BUZZ_CHANNEL_ID=<channel-uuid, copy from SWF Buzz after creating a channel> \
BUZZ_BOT_PRIVATE_KEY=<any 64-hex secret you generate locally, e.g. `openssl rand -hex 32`> \
BUZZ_BOT_AUTH_MODE=standalone \
cargo run --manifest-path examples/countdown-bot/Cargo.toml
```

This also requires a running real `buzz-relay` (it does NIP-42 auth against it), so it's blocked
by the same Docker prerequisite as Step 2 — see `docs/E2E_TEST_RESULTS.md`.

## Verifying a change

```sh
npm run typecheck
npm run lint
npm run test          # includes tests/integration/ — a real (non-mocked) WebSocket
                       # integration test against a minimal test-fixture relay, no
                       # Docker/buzz-relay required. See docs/E2E_TEST_RESULTS.md.
npm run build
cd src-tauri && cargo check && cargo clippy --all-targets && cargo fmt --check
```

## Security notes specific to Development Mode

- `DevSigningService` generates an ephemeral in-memory secp256k1 keypair per app session — never
  written to disk, never sent through Tauri IPC, discarded on app close.
- The "Continue in Development Mode" button is compiled out of production builds
  (`import.meta.env.DEV`), not just hidden — see `docs/SECURITY.md`.
- Nothing about Development Mode touches `src-tauri/src/auth/oidc.rs`, `secure_storage_*` Tauri
  commands, or `signingService.nip46.ts`.
