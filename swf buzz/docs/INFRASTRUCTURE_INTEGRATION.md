# Infrastructure Integration — Local Development

**Status: read-only reconnaissance only. Nothing in this document has been implemented yet** —
see `docs/BUZZ_INFRASTRUCTURE_DISCOVERY.md` for the specific `buzz.lmdconsulting.com` investigation
this builds on. `../buzz` was not modified in either pass. Existing Okta/NIP-46 production code in
`swf buzz/src/features/auth/` and `swf buzz/src/features/signing/` is untouched — this document only
_proposes_ how to add a Development Auth path alongside it.

## A. Current Buzz infrastructure

One deployable unit, `ghcr.io/block/buzz`, running the `buzz-relay` binary, which is simultaneously:
Nostr WebSocket relay, HTTP REST API, media (S3/MinIO-backed), and NIP-11 discovery document — all
on one port (3000 in-cluster/compose). Fronted in the reference deploy configs by either Caddy
(`deploy/compose/compose.caddy.yml` + `Caddyfile`) or a Kubernetes Ingress
(`deploy/charts/buzz/templates/ingress.yaml`) — always a single upstream, no path-based split to a
different backend. Dependencies (Postgres, Redis, S3/MinIO) are internal-only, never client-reachable.
`buzz-acp` is not part of this deployable unit at all — it's a separate process that connects
_outward_ to the relay as a Nostr client (`crates/buzz-acp/src/config.rs:246`,
`BUZZ_RELAY_URL`, default `ws://localhost:3000`). See `BUZZ_INFRASTRUCTURE_DISCOVERY.md` §3-4 for
full citations.

An **optional, off-by-default** device-pairing relay (`buzz-pair-relay`,
`deploy/charts/buzz/values.yaml:216-218`, `pairingRelay.enabled: false`) exists for NIP-AB
(one-time secret transfer between a user's own devices) — it is not a NIP-46 bunker/signer. See
`BUZZ_INFRASTRUCTURE_DISCOVERY.md` §5 for why this distinction matters.

## B. SWF Buzz required infrastructure

To run SWF Buzz locally against a real backend, only one thing is actually required: **a reachable
`buzz-relay` WebSocket endpoint**. Everything else (ACP, a NIP-46 bunker) is either not directly
connected-to by the client (ACP — the client just sees its traffic _through_ the relay) or not yet
available anywhere (a real NIP-46 bunker).

## C. Relay connection flow

```
SWF Buzz (RelayConnectionService, src/services/RelayConnectionService.ts)
  ↓ new WebSocket(VITE_RELAY_URL)   — e.g. ws://localhost:3000 locally
buzz-relay
```

Already implemented in this project exactly this way — `RelayConnectionService` (nostr-tools'
`Relay`, capped-backoff reconnect) reads `config.relayUrl` (`src/app/config.ts`), which falls back
to `ws://localhost:3000` in dev builds if `VITE_RELAY_URL` is unset. No change needed for local dev
against a `just relay`/`docker compose` instance — this already matches the reference repo's own
default (`examples/countdown-bot/README.md:30`, `crates/buzz-acp/src/config.rs:246`).

## D. ACP/agent flow

No direct client→ACP connection exists or is needed (`BUZZ_INFRASTRUCTURE_DISCOVERY.md` §4/§9).
SWF Buzz already implements agent interaction correctly for this architecture: it never calls ACP
directly, only resolves agent identity via relay-delivered events (`kind:0`, `kind:30177`,
`kind:30175`) and renders agent activity from `kind:24200`/`kind:20002` — see
`src/features/agents/`. **For local testing without a real LLM-backed ACP instance**,
`../buzz/examples/countdown-bot` is a ready-made, non-AI test agent that speaks the exact same
protocol (NIP-42 auth, `kind:0` profile, `kind:9000` self-add, `kind:9` replies) — good enough to
exercise SWF Buzz's mention/reply/agent-badge UI end-to-end. See §L for the run command.

## E. Authentication flow (current, unmodified)

```
LoginView.vue
  ↓
useAuth() (src/features/auth/useAuth.ts)
  ↓ (production)                          ↓ (dev build only)
OktaAuthService                            DevAuthService
  ↓ invoke("start_okta_login")             ↓ in-memory identity, no IPC
src-tauri/src/auth/oidc.rs                 (src/features/auth/authService.dev.ts)
  (real PKCE loopback flow, D9: ID token
   signature not verified yet)
```

This is untouched. `DevAuthService` already exists and is already gated to dev builds only
(`import.meta.env.DEV`, checked in `LoginView.vue`) — see `docs/SECURITY.md` for the existing
rules. **Nothing here needs to change to connect to a local relay** — Development Mode already
provides a working identity independent of Okta.

## F. NIP-46 flow (current, unmodified)

```
DevSigningService (dev)                    Nip46SigningService (production)
  in-memory ephemeral keypair,               real BunkerSigner (nostr-tools), requires
  never persisted                            a real bunker:// URI from pairing — NONE
                                              EXISTS TODAY (confirmed absent in ../buzz,
                                              see BUZZ_INFRASTRUCTURE_DISCOVERY.md §5)
```

`DevSigningService` (`src/features/signing/signingService.dev.ts`) already IS the safe local-dev
signer this task asked to design — it exists, is real (not a stub), signs real events with a real
in-memory keypair, and is already excluded from production builds. **No new development signer
needs to be built.** What's missing for local dev is not a signer — it's routing the local relay
connection through it, which `useAuth.ts` already does (`connectRelay()` runs after
`loginWithDevelopmentMode()` succeeds, same as the Okta path).

## G. Local development architecture (proposed connection, no bunker needed)

```
npm run tauri dev
  ↓
LoginView → "Continue in Development Mode" (dev build only, already gated)
  ↓
DevAuthService + DevSigningService (already real, already isolated — src/features/signing/signingService.dev.ts)
  ↓
RelayConnectionService.connect(VITE_RELAY_URL)   — .env.local: VITE_RELAY_URL=ws://localhost:3000
  ↓
local buzz-relay  (../buzz, from Git Bash: `just setup && just relay` — see
                    docs/LOCAL_DEVELOPMENT.md for the Windows-specific `just`/PATH setup,
                    or `docker compose -f deploy/compose/compose.yml -f deploy/compose/compose.dev.yml up`)
  ↓ (optional, for agent-UI testing)
examples/countdown-bot  (standalone auth mode — see §L)
```

Everything in this diagram already exists in `swf buzz` today except one missing piece:
**`.env.local` has never actually been created in this working copy** (only `.env.example` is
committed, by design — see `docs/SECURITY.md`). That's the only actual gap for local dev to work
right now, and it's a one-line `cp .env.example .env.local`, no code change.

## H. Production architecture (unchanged, still blocked on the same two things)

```
SWF Buzz → Okta (PKCE) → src-tauri oidc.rs → employee identity
SWF Buzz → NIP-46 bunker → remote signer   ← NO BUNKER EXISTS (confirmed, not just "not configured")
SWF Buzz → wss://<real relay host> → buzz-relay
```

Unchanged from `docs/DECISIONS.md` D2/D3/D9. This reconnaissance did not find a bunker hiding
anywhere in `../buzz` — it found more precise evidence that one genuinely doesn't exist there
(§F, and `BUZZ_INFRASTRUCTURE_DISCOVERY.md` §5).

## I. Environment variables

Proposed `.env.example` structure — **additive only**, nothing here removes or replaces the
existing Okta/NIP-46 variables:

```sh
# --- Relay (already implemented) ---
VITE_RELAY_URL=ws://localhost:3000

# --- Okta (already implemented, untouched) ---
VITE_OKTA_ISSUER=
VITE_OKTA_CLIENT_ID=
SWF_BUZZ_OKTA_ISSUER=
SWF_BUZZ_OKTA_CLIENT_ID=

# --- NIP-46 (already implemented, untouched) ---
# No env var today — a bunker:// URI is entered interactively at pairing time
# (LoginView.vue's "Connect signer" step), not read from environment. This is
# correct as-is: a bunker URI is per-user pairing state, not build config.

# --- Development Mode (already implemented, no new vars needed) ---
# Gated entirely by `import.meta.env.DEV` (Vite's own build-mode flag) — there
# is deliberately no separate "enable dev auth" toggle to avoid a
# misconfiguration that leaves it on in a production build. See SECURITY.md.

# --- ACP (not needed — see §D; no client-facing ACP config exists or should) ---
```

The one thing genuinely missing is not a new variable — it's that no `.env.local` exists in this
checkout yet.

## J. What is already available

- A real local relay, launchable from `../buzz` with either `just relay` (Hermit + Justfile) or
  Docker Compose (`deploy/compose/compose.yml` + `compose.dev.yml`).
- A real, working Development Mode auth+signing path in `swf buzz` already (§E/§F) — it was built
  and tested (unit tests) in earlier sessions, not invented for this task.
- A real test agent (`examples/countdown-bot`) for exercising the agent UI without needing an
  LLM-backed ACP instance or API keys.
- All the env var _names_ the relay actually reads (`BUZZ_INFRASTRUCTURE_DISCOVERY.md` §10).

## K. What we need from the team

1. Whether `https://buzz.lmdconsulting.com/` is meant to be used for SWF Buzz development at all,
   and if so, its real WebSocket URL and `BUZZ_CORS_ORIGINS` setting — see
   `BUZZ_INFRASTRUCTURE_DISCOVERY.md` §12. Not required to start local development (§L doesn't need
   it), only for testing against that specific deployment.
2. A NIP-46 bunker — still doesn't exist anywhere found, this reconnaissance just narrowed down
   _where it would live if it existed_ (nowhere in `../buzz`) rather than closing the gap.
3. Okta tenant details — unchanged ask from `docs/DECISIONS.md` D3.

## L. Exact commands for local development (no external URL needed)

```sh
# 1. Start a local relay (from ../buzz) — in Git Bash on Windows, not
#    PowerShell/cmd, and with `just` installed via `cargo install just`
#    (Hermit's bin/ shims don't work on a Windows checkout) — see
#    docs/LOCAL_DEVELOPMENT.md for why, verified on a real Windows machine.
cd ../buzz
just setup
just relay                         # relay at ws://localhost:3000

# 2. Configure SWF Buzz (from ./swf buzz — one-time)
cd "../swf buzz"
cp .env.example .env.local         # VITE_RELAY_URL already defaults to ws://localhost:3000

# 3. Run SWF Buzz
npm install
npm run tauri dev
# → sign in via "Continue in Development Mode" (dev build only)

# 4. Optional: a test agent to mention/reply against
cd ../buzz
BUZZ_RELAY_URL=ws://localhost:3000 \
BUZZ_CHANNEL_ID=<channel-uuid-from-swf-buzz-after-creating-a-channel> \
BUZZ_BOT_PRIVATE_KEY=<any-64-hex-secret-you-generate-locally> \
BUZZ_BOT_AUTH_MODE=standalone \
cargo run --manifest-path examples/countdown-bot/Cargo.toml
```

Nothing above requires Okta, a NIP-46 bunker, or `buzz.lmdconsulting.com`.

## M. Open blockers

- `buzz.lmdconsulting.com`'s real purpose/URLs — unconfirmed (`BUZZ_INFRASTRUCTURE_DISCOVERY.md`).
- NIP-46 bunker — confirmed absent, not just unconfigured.
- Okta tenant — unavailable (unchanged, D3).
- None of the above block local development against a self-hosted relay + Development Mode, which
  is fully possible today with zero code changes (§L).
