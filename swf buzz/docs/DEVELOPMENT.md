# SWF Buzz — Development

## Prerequisites

- Node.js (see `RECONNAISSANCE.md` for the version this repo was set up against) + npm.
- Rust toolchain (stable) + Tauri 2 CLI prerequisites for your platform
  ([tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/)).
- A running `buzz-relay` to develop against — from the reference `../buzz` repo: `just relay`
  (defaults to `ws://localhost:3000`, matching this project's `.env.example`). This repo never
  modifies `../buzz`; it only connects to it as a client.

## Setup

```sh
npm install
cp .env.example .env.local   # fill in VITE_OKTA_* if testing production auth; otherwise leave blank
```

If you're testing real Okta sign-in (not Development Mode), also `export` the `SWF_BUZZ_OKTA_*`
pair before launching — see `.env.example` for why these can't just live in `.env.local` (Cargo/
Tauri don't read it; only Vite does).

If npm reports pending install scripts (`npm warn allow-scripts ...`), review and approve them
explicitly rather than ignoring the warning:

```sh
npm approve-scripts --allow-scripts-pending
```

## Running

```sh
npm run dev          # Vite dev server only (browser), useful for fast UI iteration
npm run tauri dev    # full desktop app via Tauri, hot-reloading the webview
```

Without `VITE_OKTA_ISSUER`/`VITE_OKTA_CLIENT_ID` set, the login screen still works via
**Development Mode** (dev builds only — see `docs/SECURITY.md`), which pairs with an in-memory
signer so the rest of the app is exercisable before real Okta/NIP-46 infrastructure exists.

## Verifying a change

Run all of these before considering a change done — see `docs/TESTING.md` for what each one is
expected to catch:

```sh
npm run typecheck
npm run lint
npm run test
npm run build
cd src-tauri && cargo check && cargo clippy --all-targets && cargo fmt --check
```

`npm run format` / `npm run format:check` keep formatting consistent; CI (once set up) should run
`format:check`, not `format`, so it fails loudly rather than silently reformatting. Same idea for
Rust: `cargo fmt` (write) locally, `cargo fmt --check` in CI.

## Project layout

See `docs/ARCHITECTURE.md` §2 for the full directory structure and layering rules. The short
version: Vue components never import `src/protocol/*` directly — they go through a
`features/<name>/` composable → application service → protocol adapter.

## Windows-specific notes

- Tauri's webview origin on Windows is `http://tauri.localhost` (not `tauri://localhost`, which is
  the macOS/Linux scheme) — see `docs/ARCHITECTURE.md` for why this matters for relay CORS/origin
  configuration if the relay ever enforces an origin allowlist. Flag this explicitly to the backend
  team rather than silently working around a CORS failure.
- `npm run build` uses Vite 7 (esbuild/rollup), not Vite 8's newer rolldown-based bundler —
  see `docs/DECISIONS.md` D8 for why (a native-binding block encountered in this environment).
  If you hit an "Application Control policy has blocked this file" error from a `.node` native
  addon anywhere in `node_modules`, that is a local OS/EDR policy issue, not a code bug — try
  reinstalling just that package, or ask your IT admin for an exception, before assuming the
  dependency itself is broken.
- The same policy can block a freshly-compiled Cargo build-script binary when `src-tauri/target/`
  lives under a `Downloads` folder (confirmed: `cargo check` failed on `typeid`'s build script with
  `os error 4551` until the target directory was relocated). If `cargo check`/`cargo build`/
  `npm run tauri dev` fails with `"An Application Control policy has blocked this file"`, point
  Cargo's output outside the affected tree instead of debugging the crate itself:
  ```sh
  CARGO_TARGET_DIR=/c/Users/<you>/.cargo-target/swf-buzz cargo check
  # or export it for the session / set it in your own (uncommitted) .cargo/config.toml
  ```
  This is a per-developer machine setting — don't commit an absolute path into the repo.

## Packaging

```sh
npm run tauri build
```

Produces a Windows installer (NSIS/MSI per `src-tauri/tauri.conf.json`). No code-signing step is
configured yet — see `docs/DECISIONS.md` D7; unsigned installers will trigger SmartScreen warnings.
