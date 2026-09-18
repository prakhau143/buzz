# SWF Buzz — Architecture

SWF Buzz is a lightweight employee desktop client for the self-hosted Buzz backend (`buzz-relay`, `buzz-acp`, `buzz-db`, Redis). It is a **client only**: it does not host agents, does not implement relay/DB/pub-sub logic, and does not manage local agent subprocesses. See `PROTOCOL_IMPLEMENTATION_REFERENCE.md` for the wire protocol and `RECONNAISSANCE.md` for how this differs from the existing (React-based) Buzz Desktop, which was used only as a reference, never copied.

## 1. High-level shape

```
                 SWF BUZZ DESKTOP
                        │
              ┌─────────┴─────────┐
              │                   │
         Vue 3 UI             Tauri 2
              │                   │
       Pinia / Vue Query         Rust
              │                   │
          Services         Native/Secure APIs
              │
        Protocol Layer
              │
        Nostr client lib
              │
          WebSocket
              │
         buzz-relay
```

The desktop client is not the relay, not the database, and not the agent host.

## 2. Frontend layering

Vue components never contain protocol logic. The call chain is always:

```
Vue Component → Composable (feature hook) → Application Service → Protocol Adapter → Nostr client / Relay
```

Example (send a channel message):

```
MessageComposer.vue → useSendMessage() → MessageService.send() → ChannelProtocol.publishMessage() → relay
```

Example (channel messages list):

```
ChannelView.vue → useChannelMessages() → ChannelService.subscribe() → ChannelProtocol → relay (Vue Query cache)
```

### Directory structure

```
swf buzz/
├── src/
│   ├── app/                # App shell, router, providers (Pinia, Vue Query, error boundary)
│   ├── components/         # Shared, protocol-agnostic UI primitives (Button, Avatar, Modal, ...)
│   ├── layouts/             # AppShell (top bar / sidebar / main / details panes)
│   ├── views/                # Route-level views composed from features
│   ├── stores/                # Pinia: session, ui, connection — small, client-only state
│   ├── services/                # Cross-feature application services (SigningService, RelayService)
│   ├── composables/               # Cross-feature composables (useConnectionStatus, useTheme)
│   ├── types/                      # Shared TS types/interfaces (domain models, not wire types)
│   ├── protocol/                    # Nostr wire-format layer — kinds, event builders/parsers,
│   │                                  tag helpers. Mirrors PROTOCOL_IMPLEMENTATION_REFERENCE.md 1:1.
│   ├── features/
│   │   ├── auth/                       # Okta OIDC + PKCE adapter, session state
│   │   ├── signing/                       # SigningService abstraction + NIP-46 bunker adapter
│   │   ├── channels/                        # Discovery, list, view, membership, join
│   │   ├── messages/                          # Send/receive, pagination
│   │   ├── threads/                             # Root/reply resolution, thread view
│   │   ├── dm/                                    # DmService + DmTransport abstraction
│   │   ├── reactions/
│   │   ├── invites/
│   │   ├── presence/
│   │   └── agents/                                     # Agent identity, mentions, status/activity
│   └── main.ts
│
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs
│   │   ├── commands/         # One module per domain; narrow, typed commands only
│   │   ├── services/           # Rust-side orchestration (e.g. secure-storage service)
│   │   ├── security/             # Secret handling, IPC guards
│   │   ├── auth/                    # OIDC loopback helper (if native browser-based login is used)
│   │   └── storage/                   # OS keychain wrapper
│   └── tauri.conf.json
│
├── docs/
├── tests/
├── package.json, vite.config.ts, tsconfig.json
```

Each `features/<name>/` module owns its composables, services, and protocol adapters for that domain, and exposes only composables (hooks) to the view layer — never raw protocol types.

## 3. State management split

- **Pinia** — small, client-only UI/session state only: current user/session, selected channel/DM id, sidebar collapsed state, theme, connection status. Never a message cache.
- **`@tanstack/vue-query`** — all relay-backed server state: channel list, channel messages, DM list/messages, members, invites, agent profile/persona lookups, thread summaries. Standard query keys:
  ```
  ['channels']
  ['channel', channelId]
  ['channel-messages', channelId]
  ['thread', rootEventId]
  ['dm-list']
  ['dm', conversationId]
  ['members', channelId]
  ['agent-profile', pubkey]
  ['reactions', channelId]
  ```
  Live relay events update the cache via `queryClient.setQueryData`/`invalidateQueries` from the protocol layer's subscription handlers — components never touch the relay socket directly.

This mirrors the pattern actually used by the reference Buzz Desktop (TanStack Query for all server state, small local stores/singletons for UI-only state) even though that app is React — the Vue equivalents (`@tanstack/vue-query` + Pinia) are structurally identical.

## 4. Protocol layer

`src/protocol/` is the only place that knows about Nostr event kinds, tags, and filters. It is organized to mirror `PROTOCOL_IMPLEMENTATION_REFERENCE.md`'s sections exactly (`channels.ts`, `membership.ts`, `messages.ts`, `reactions.ts`, `presence.ts`, `typing.ts`, `invites.ts`, `dm.ts`, `threads.ts`, `agents.ts`, `kinds.ts` for the constant registry). Each file exports:

- Typed event **builders** (produce an unsigned event template) — signing itself always goes through `SigningService` (§6), never inline.
- Typed event **parsers** (raw relay event → domain model in `src/types/`).
- Filter builders for subscriptions.

No feature module hand-rolls a kind number or tag literal outside `src/protocol/`.

### Nostr client library

Prefer a mature client library (e.g. NDK or `nostr-tools`) for envelope framing, filters, and — critically — its existing NIP-46 signer implementation, rather than hand-rolling relay message framing or crypto. The relay connection itself (raw WebSocket open/send/reconnect/backoff) can live in the frontend directly (this is what Buzz's own `web/` client does) — there is no requirement to route the raw socket through Rust the way the reference Buzz Desktop does; that split exists there for reasons specific to its scale (webview-reload survival, multi-community background sync) that don't apply to SWF Buzz's smaller scope. Rust is reserved for what only Rust/native can do: secure storage, OS integration, and (if needed) a loopback HTTP server for OIDC browser-based login.

## 5. Tauri / Rust boundary

Rust handles only:

- Secure OS storage (session material — never a raw private key; see `SECURITY.md`).
- The OIDC Authorization Code + PKCE loopback flow, if a system-browser-based login is used (pattern: bind an ephemeral `127.0.0.1` listener, open the system browser, receive the redirect locally, exchange the code) — this mirrors a proven pattern in the reference app's Builderlab login (`desktop/src-tauri/src/builderlab.rs`), generalized for Okta instead of a proprietary backend.
- Native window/OS integration (tray, window state, notifications) as needed for the in-scope features.

Tauri commands are grouped by domain (`commands/auth.rs`, `commands/secure_storage.rs`) and are narrowly typed — no generic `execute_anything`/`run_shell_command`/`read_any_file` commands. `tauri.conf.json` capabilities grant only what specific commands need (mirrors the reference app's minimal `capabilities/default.json` — no blanket fs/shell/http permission).

Everything else — UI, application state, protocol orchestration, relay communication — lives in the frontend.

## 6. Auth + signing architecture

```
UI
 ↓
AuthService (Okta OIDC, Authorization Code + PKCE)
 ↓
authenticated session (identity claim, not a Nostr key)
 ↓
SigningService (abstraction)
 ↓
NIP-46 bunker connection (nostrconnect:// / bunker:// URI)
 ↓
remote signer
```

`SigningService` is an interface (`sign(event): Promise<SignedEvent>`, `nip44Encrypt`/`nip44Decrypt`, `getPublicKey()`), with:

- **Production implementation**: NIP-46 remote signer client (via the chosen Nostr client library), holding only an ephemeral local _transport_ keypair used to encrypt the NIP-46 RPC channel to the bunker — never the account's actual Nostr identity key. That transport keypair is generated client-side and stored via Tauri secure storage; it authorizes nothing on its own without the bunker's cooperation.
- **Development implementation**: a clearly-labeled mock signer (in-memory ephemeral keypair, ok for local dev against a test relay, never for anything resembling production data) — see `SECURITY.md` for the labeling requirement.

The frontend never imports or touches a raw Nostr private key at any layer — see `SECURITY.md`.

Okta's role is authenticating _the employee_ to the company; the NIP-46 bunker's role is authorizing _Nostr protocol actions_. These are deliberately separate concerns connected only by "the signed-in employee's session determines which bunker/identity they're allowed to connect to" — the exact linkage (e.g. does Okta group membership select a pre-provisioned bunker?) is an open product question, see `DECISIONS.md`.

## 7. Connection management

A single `RelayConnectionService` (in `src/services/`) owns the WebSocket lifecycle and exposes connection state (`connecting | connected | disconnected | reconnecting | auth_failed | error`) via a small Pinia store consumed by a top-bar indicator (`ConnectionBadge.vue`). Reconnection uses capped exponential backoff (1s base, 30s cap, doubling), guarded so only one reconnect timer is ever pending and a manual `disconnect()` stops the loop outright — a temporarily-unavailable relay produces a controlled, capped retry loop, never an uncontrolled one (verified by a real WebSocket integration test, `tests/integration/relayConnectionService.spec.ts`). Subscriptions are re-issued on reconnect from a small in-memory registry of "active filters" (channel list, currently open channel/DM, presence) rather than a page reload. A connection-generation counter discards the result of a stale in-flight `connect()` call if a newer one supersedes it before it resolves, so calling `connect()` again while one is already in flight can't leave two live sockets. Failure messages are context-aware: a loopback URL (`ws://localhost:...`) that refuses to connect surfaces "Can't reach the local Buzz relay. Make sure it's running" rather than a generic network error, since that's almost always what a refused loopback connection means in local development. Keep this as a single well-tested class initially per `RECONNAISSANCE.md`'s explicit recommendation against over-splitting into many single-purpose files before it's proven necessary.

## 8. Error handling

Every feature composable returns `{data, isLoading, isError, error, retry}` (Vue Query's native shape covers most of this). Errors from Tauri commands are normalized into typed `AppError`s in a single `src/services/errors.ts` boundary — raw Rust error strings/stack traces are never shown to the user. Developer-facing logs may include diagnostic detail but must never include secrets/keys/tokens (see `SECURITY.md`).

## 9. Design system

Centralized CSS custom properties (`src/app/theme/tokens.css`) define the cream/white enterprise palette (`--color-bg`, `--color-surface`, `--color-surface-muted`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-primary`, `--color-danger`, `--color-success`). Components consume tokens only — no hard-coded hex values in component files. This keeps a future theme (e.g. dark mode) a token-file change, not a component rewrite.

## 10. Agent interaction

Agents are ordinary Nostr participants from the protocol's point of view (§10 of `PROTOCOL_IMPLEMENTATION_REFERENCE.md`). The `features/agents/` module is responsible for:

- Resolving which pubkeys are agents (via `kind:30177`/`kind:30175` lookups, cached in Vue Query) and exposing an `isAgent(pubkey)` helper + badge component.
- `@mention` autocomplete that resolves a typed name to a pubkey and inserts the correct `p` tag (§10 tag convention) — purely a compose-time UI convenience, not a new protocol feature.
- A status/activity indicator (not a chat message) driven by `kind:24200` observer frames with `kind:20002` typing as fallback, per the product requirement to never dump agent execution telemetry into the message timeline.

The client never spawns, configures, or manages an agent process — it only publishes/subscribes to the events above.
