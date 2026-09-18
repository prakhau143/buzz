# SWF Buzz

A lightweight employee desktop client for the self-hosted Buzz backend (Nostr-based chat +
agents). Built with Vue 3 + TypeScript + Vite, Tauri 2, and Rust — independently designed against
the existing Buzz protocol, not a fork of the reference Buzz Desktop app. See `docs/` for the full
picture; this file is just a map.

## Start here

- **`docs/ARCHITECTURE.md`** — layering, directory structure, state management, protocol layer,
  auth/signing design, connection management.
- **`docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md`** — the verified Nostr event kind registry this
  client implements against, source-cited against the reference `buzz` relay/backend repo.
- **`docs/DEVELOPMENT.md`** — setup, running, verifying a change, Windows-specific notes.
- **`docs/SECURITY.md`** — the no-raw-private-key architecture, secure storage, IPC boundary,
  known gaps.
- **`docs/TESTING.md`** — what's covered, what isn't yet, how to run the suite.
- **`docs/DECISIONS.md`** — architectural decisions and open questions, numbered D1, D2, ...

## Quick start

```sh
npm install
cp .env.example .env.local   # see docs/DEVELOPMENT.md for what to fill in
npm run tauri dev            # full desktop app
```

Without Okta configured, sign in via **Development Mode** (dev builds only) to exercise the rest
of the app against a local `buzz-relay`.

## What this is (and isn't)

SWF Buzz is a **client only** — it does not implement the relay, the database, pub/sub, or
server-side agents, and it never spawns or manages a local agent process. It talks to an existing,
separately-deployed `buzz-relay`/`buzz-acp` over WebSocket/Nostr. See `docs/ARCHITECTURE.md` §1 for
the full picture and `docs/DECISIONS.md` for what's explicitly out of scope.

## Status

Channels, messages, threads, reactions, direct messages, presence, typing indicators, invites
(create/list only — no acceptance, see `docs/DECISIONS.md` D4), @mentions, and agent
activity/status are implemented and covered by unit tests. Okta OIDC + PKCE and NIP-46 signing are
implemented but unverified against a real tenant/bunker — see `docs/DECISIONS.md` D9 and D2 for
exactly what remains external.
