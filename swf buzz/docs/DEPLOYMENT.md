# Deployment

SWF Buzz ships as a Tauri 2 desktop application (`identifier: com.swfbuzz.desktop`). It needs a
reachable Buzz relay (`buzz-relay`). There is no SWF server component for the local-identity
flow.

## Build

```sh
npm ci
npm run typecheck && npm run lint && npm test          # gates
(cd src-tauri && cargo test)                           # Rust gates
npm run tauri build                                    # runs `npm run build`, then bundles
```

- Bundles are produced for every target on the build OS (`bundle.targets: "all"`), in
  `src-tauri/target/release/bundle/`.
- Release profile: `lto = true`, `codegen-units = 1`, `opt-level = 3`.
- Development-only code is excluded from release builds:
  - the dev signer and its fixed test key (verified absent from `dist/assets`)
  - `SWF_BUZZ_PRIVATE_KEY` / `SWF_BUZZ_PROFILE` environment overrides (`debug_assertions` only)
  - identity diagnostics

## Configuration (build time, `VITE_*`)

| Variable | Purpose |
|---|---|
| `VITE_RELAY_URL` | Default ("home") relay, e.g. `wss://buzz.example.com`. Dev falls back to `ws://localhost:3000`; **release builds have no fallback**. |
| `VITE_ENVIRONMENT` | Informational label for logs. |
| `VITE_ADMIN_URL` | Optional: deployment admin console host (`/api/admin/v1`). The Platform Admin UI is hidden without it. |
| `VITE_OKTA_*`, `VITE_SWF_BACKEND_URL`, `VITE_SWF_COMMUNITY_ID` | Legacy HTTP-backend / Okta paths only; **not used by the local-identity + relay flow**. |

No secret belongs in any `VITE_*` value: they are compiled into the frontend bundle.

## Runtime requirements

- **Relay:** Buzz `buzz-relay` with NIP-42 (`auth_required`), NIP-29 and NIP-43. SWF also uses
  the relay's HTTP bridge (`POST /query`, NIP-98) for channel history, presence snapshots and
  membership probes, so the relay's HTTP origin (`https://<relay host>`) must be reachable and
  allow the app's origin (Buzz answers CORS with `*`).
- **Content Security Policy** (`tauri.conf.json`): `connect-src 'self' ipc: http://ipc.localhost https: wss: ws:`.
  This allows any relay the user connects to; the relay address is validated before use.
- **OS keyring:** Windows Credential Manager, macOS Keychain, or Secret Service on Linux. If the
  keyring is unavailable, the identity falls back to an `identity.key` file in the app data dir
  (see `docs/SECURITY.md`).
- **Deep links:** the `swfbuzz://` scheme is registered by `tauri-plugin-deep-link` at install
  time, with `tauri-plugin-single-instance` so a link opens the running app.

## Per-user data

App data dir `%APPDATA%\com.swfbuzz.desktop` (Windows) holds identity markers only (never the
key when the keyring works). The webview's `localStorage` holds the community address book, read
markers and public profile caches, with no secrets.

## Verification after install

1. Launch → create or import an identity.
2. Open `swfbuzz://connect?relay=wss://<your relay>`: NIP-42 → your community and role.
3. A non-member identity must see "not a member of this community".
