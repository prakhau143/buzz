# SWF Buzz

A desktop client (Tauri 2 + Rust, Vue 3 + TypeScript + Vite) for **Buzz** communities: Nostr
relays running `buzz-relay` (NIP-29 groups, NIP-42 auth, NIP-43 membership). SWF Buzz is a
**client only**. It connects to existing Buzz relays, including communities used from the
OLD BUZZ desktop app, and never runs a relay or migrates data.

## How signing in works

```text
Existing Nostr identity (nsec / ncryptsec, or a new key)
  → SWF secure identity  (private key in the OS keyring; signing happens in Rust)
  → NIP-42 AUTH on the community's relay (wss://…)
  → relay membership check (relay_members) → role (owner / admin / member)
  → community → channels (NIP-29) → messages, DMs, threads, reactions, attachments
```

A person who isn't a member is refused by the relay (`restricted: not a relay member`). The
client never adds anyone. See **`docs/COMMUNITY_CONNECTION.md`**.

## Start here

| Topic | Document |
|---|---|
| Connecting to an existing community (OLD BUZZ integration) | `docs/COMMUNITY_CONNECTION.md` |
| Architecture: layers, state, connection management | `docs/ARCHITECTURE.md` |
| Nostr protocol: every event kind used, source-cited | `docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md` |
| Authentication and authorization (identity, NIP-42, NIP-98, roles) | `docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md`, `docs/AUTHORIZATION_RUNTIME_FLOW.md`, `docs/SWF_ROLE_MODEL.md` |
| Identity switching and sign-out lifecycle | `docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md` |
| Security model | `docs/SECURITY.md` |
| Tests: what runs where | `docs/TESTING.md` |
| Building and shipping | `docs/DEPLOYMENT.md` |
| Development setup (incl. Windows notes) | `docs/DEVELOPMENT.md`, `docs/LOCAL_DEVELOPMENT.md` |
| Decisions and known limitations | `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md` |
| Phase 5 production-readiness status | `docs/PHASE_5_CLOSURE_REPORT.md` |

## Quick start

```sh
npm install
cp .env.example .env.local   # VITE_RELAY_URL = your default relay (dev falls back to ws://localhost:3000)
npm run tauri dev            # the desktop app; the identity boundary only exists inside Tauri
```

On first launch, **create** an identity or **import** an existing one (`nsec` or `ncryptsec`
backup). You then land on **Choose a community**: pick a recent community or enter its
relay address (a `swfbuzz://connect?relay=wss://…` link fills this in). A community is never
opened automatically — not after sign-in, sign-out or an app restart; the relay decides
membership every time.

## Checks

```sh
npm run typecheck && npm run lint && npm test && npm run build
cd src-tauri && cargo check && cargo test
```

Real-relay E2E suites (`tests/integration/*.e2e.spec.ts`) need a local `buzz-relay` plus test
keys. See `docs/TESTING.md`.
