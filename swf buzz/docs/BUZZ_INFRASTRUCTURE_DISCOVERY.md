# Buzz Infrastructure Discovery — `https://buzz.lmdconsulting.com/`

**Method**: read-only search of `../buzz` (working tree + full git history via `git log --all -p`).
`../buzz` was not modified. Every claim below is either a direct citation (file:line) or explicitly
marked as inference from the reference architecture — never a guess about the specific deployment
at `buzz.lmdconsulting.com`.

**Headline finding**: the string `lmdconsulting` (any case) does not appear anywhere in `../buzz` —
not in the working tree, not in any commit in the full git history. **This URL is not documented,
configured, or referenced anywhere in the reference repository.** Everything below about what it
_probably_ is comes from matching its shape against the reference deployment architecture, not from
any direct evidence about this specific host.

---

## 1. Known URL

`https://buzz.lmdconsulting.com/` — provided by the user. Not found in `../buzz` in any form
(no config file, no doc, no test fixture, no commit message, no code comment).

## 2. What the URL actually represents

**Not found in repository** — cannot be determined directly. Based on the reference deployment
architecture (§3 below), the single most likely explanation is that this is a production/staging
instance of the `buzz` relay image (`ghcr.io/block/buzz`) sitting behind a reverse proxy — i.e. the
HTTP(S) front door of a `buzz-relay` deployment, not a separate "web app" service. **This is an
inference from the reference architecture's shape, not a confirmed fact about this specific host.**
It could equally be a fork, an unrelated internal tool, or a differently-configured deployment —
nothing in `../buzz` names or fingerprints this host.

## 3. Relay architecture (as built in `../buzz` — confirmed)

The reference deployment exposes **exactly one public-facing service**, and that service is the
relay itself, serving both HTTP and WebSocket traffic on the same port:

- `deploy/compose/compose.yml:4-24` — the `relay` service is the only one with a published port
  (`${BUZZ_HTTP_PORT:-3000}:3000`); Postgres/Redis/MinIO are internal-only.
- `deploy/compose/Caddyfile:1-5` — the entire Caddy reverse proxy is:
  ```
  {$BUZZ_DOMAIN} {
    encode zstd gzip
    reverse_proxy relay:3000
  }
  ```
  One host, one upstream, no path-based routing to a different backend.
- `deploy/charts/buzz/templates/ingress.yaml:28-42` — the Kubernetes Ingress routes a single
  default host (`{{ include "buzz.relayHost" . }}`) and path (`/`) to the one `service.port`
  (3000) — again, one service, no separate route for anything else.
- `deploy/compose/.env.example:9-13` — confirms the URL-derived settings that go with one domain:
  ```
  BUZZ_DOMAIN=buzz.example.com
  RELAY_URL=wss://buzz.example.com
  BUZZ_MEDIA_BASE_URL=https://buzz.example.com/media
  BUZZ_CORS_ORIGINS=https://buzz.example.com
  ```
  Same host for the HTTPS media base URL and the `wss://` relay URL.

**Conclusion for the reference architecture**: in this deployment pattern, the public HTTPS origin
_is_ the relay's HTTP surface, and the WebSocket relay endpoint is the _same host_ with `wss://`
instead of `https://` (standard HTTP/WebSocket upgrade on the same port, per `relay.bindAddr:
"0.0.0.0:3000"` in `deploy/charts/buzz/values.yaml:106` handling both). **If** `buzz.lmdconsulting.com`
follows this same pattern, the relay WebSocket URL would be `wss://buzz.lmdconsulting.com/` — but
this is a conditional inference from the reference pattern, not a verified fact about that host.
**Do not hardcode this into SWF Buzz without confirming it against the actual deployment** (e.g. by
checking whether a WebSocket upgrade at that URL succeeds, or asking the team).

## 4. ACP architecture (confirmed)

`buzz-acp` is **not a server** in this codebase — it is a Nostr **relay client** (an agent harness
process that connects outbound to a relay, the same way any bot/client would):

- `crates/buzz-acp/src/config.rs:246` — `#[arg(long, env = "BUZZ_RELAY_URL", default_value =
"ws://localhost:3000")]` — ACP's own config takes a relay URL to connect _to_; it does not bind
  or expose one of its own.
- `crates/buzz-acp/src/relay.rs` — implements the relay subscription/publish logic (subscribes to
  mention-triggering filters, publishes replies) — client-side Nostr protocol code, not an HTTP/WS
  server.
- No `deploy/` file (Helm templates, Docker Compose) defines an ACP Service, Ingress, Route, or
  published port anywhere in `../buzz`. The only externally-reachable component in the reference
  deployment is the relay (§3).

**Conclusion**: ACP is reached _through_ the relay (it's a relay subscriber), not via its own
network endpoint. There is nothing for a desktop client to connect to "for ACP" directly — the
desktop client talks to the relay, and the relay is how agent-triggering events reach an ACP
instance that happens to be subscribed. **Not found in repository**: any standalone "ACP endpoint"
URL, because none appears to exist by design.

## 5. NIP-46 / Bunker architecture (confirmed — and this is the most important finding)

**No NIP-46 bunker/remote-signer service exists in `../buzz`.** What does exist is a different,
related protocol that is easy to confuse with it:

- `crates/buzz-core/src/pairing/NIP-AB.md` — a Buzz-authored NIP, **"NIP-AB: Device Pairing"**. This
  is a QR-code-initiated, end-to-end-encrypted **one-time secret transfer** protocol between two of
  a user's own devices, over any generic NIP-01 relay (called the "pairing relay" in the spec — a
  plain relay, not a signer). Explicitly, from the spec itself (NIP-AB.md:44-49): _"NIP-46 solves
  ongoing delegation: the key stays on one device and signs remotely. This NIP solves one-time
  transfer: the key moves to the new device... They are complementary — this NIP can even
  bootstrap a NIP-46 session as one of its payload types."_
- The payload NIP-AB transfers can be one of `nsec` (raw/encrypted private key), `bunker` (a
  `bunker://...` URI, if one exists), `connect` (a `nostrconnect://...` URI, if one exists), or
  `custom` (NIP-AB.md:334-341). **NIP-AB can carry a bunker URI if you already have a bunker to
  point it at — it does not create or run one.**
- `crates/buzz-pair-relay/` — the actual Rust implementation of the **pairing relay** referenced
  above: a plain relay for `kind:24134` ephemeral pairing events. It is not a NIP-46 signer.
- `deploy/charts/buzz/templates/pairing-relay.yaml` — deploys `buzz-pair-relay` as an **optional**
  component, running the `/usr/local/bin/buzz-pair-relay` binary, bound via
  `BUZZ_PAIR_RELAY_BIND_ADDR`, exposing one port (`websocket`).
- `deploy/charts/buzz/values.yaml:216-218` — `pairingRelay.enabled: false` by default, `url: ""`.
  **It is off unless an operator explicitly turns it on**, and even then it's a generic pairing
  relay, not a bunker/signer. The comment above it (values.yaml:212-215) also notes a "legacy
  same-host `/pair` convention" the main relay can serve instead of standing up a separate pairing
  relay — still not a NIP-46 signer either way.
- Confirmed absent: no `bunker`, `nostrconnect`, or NIP-46 RPC-handling code exists anywhere in
  `../buzz` outside of NIP-AB.md's _mention_ of those URI schemes as pass-through payload types.

**Conclusion, stated plainly**: there is no NIP-46 bunker/remote-signer infrastructure in the Buzz
stack today, deployed or otherwise. A `buzz-pair-relay` (device secret-transfer relay) exists and
is optional/off-by-default — it is not a substitute for a bunker; it can only _carry_ a bunker's
`bunker://` URI to another device if that bunker already exists elsewhere, which it doesn't. **This
is a genuine infrastructure gap, not something discoverable by searching harder** — it must be
built or acquired before SWF Buzz's production NIP-46 signing (`Nip46SigningService`) can be used
for real. This matches (and is now confirmed more precisely than) `docs/DECISIONS.md` D2 in this
project.

## 6. Authentication architecture (confirmed)

The relay's own auth is **Nostr-native**, unrelated to Okta:

- `deploy/compose/.env.example:16-18` — `BUZZ_REQUIRE_AUTH_TOKEN=true`,
  `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`, `BUZZ_ALLOW_NIP_OA_AUTH=true` (production defaults).
- `crates/buzz-relay/src/config.rs:797-802` — if `BUZZ_REQUIRE_AUTH_TOKEN` is false, only the REST
  API bypasses token auth; WebSocket protocol auth (NIP-42-style pubkey auth, per this project's
  earlier `PROTOCOL_IMPLEMENTATION_REFERENCE.md` reconnaissance) is unaffected either way.
- `deploy/compose/.env.example:23-24` — `RELAY_OWNER_PUBKEY` (a Nostr pubkey) is the relay's owner
  identity; `BUZZ_RELAY_PRIVATE_KEY` is the relay's own signing key for relay-authored events
  (discovery/membership/system messages, per this project's protocol reference).
- **Okta**: a case-insensitive search for `okta` across `../buzz` returned only incidental
  substring matches inside unrelated words (e.g. inside SQL/schema identifiers) — **no actual Okta
  OIDC integration exists in `../buzz`**. This is expected: Okta is an SWF-Buzz-specific
  requirement layered on top of the relay's own pubkey-based auth, not something the Buzz backend
  itself provides or needs to know about. Consistent with this project's own `RECONNAISSANCE.md`
  finding that the reference Buzz Desktop app has no Okta integration either.

## 7. Request flow

```
Browser/Desktop
  ↓ HTTPS
{$BUZZ_DOMAIN}  (Caddy, or equivalent ingress/reverse proxy)
  ↓ reverse_proxy relay:3000  (single upstream, no path splitting)
buzz-relay  (HTTP surface: NIP-11 doc, health/metrics, media, REST)
```

`../buzz` defines no second HTTPS backend anything gets routed to — the relay's HTTP router
(`crates/buzz-relay/src/router.rs`, per this project's earlier protocol reconnaissance) serves
everything at that one origin.

## 8. WebSocket flow

```
Client (Nostr protocol)
  ↓ wss://{$BUZZ_DOMAIN}/  (same host as HTTPS, upgraded connection, same port 3000 in-cluster)
buzz-relay  (WebSocket: REQ/EVENT/CLOSE, NIP-42-style auth, all the kinds in
             docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md)
```

## 9. Agent message flow

```
buzz-relay  ──publishes kind:9 (mention-tagged)──►  buzz-acp (subscribed as a relay client,
                                                       BUZZ_RELAY_URL points it at the relay)
buzz-acp  ──runs the agent, publishes its reply as kind:9──►  buzz-relay
buzz-relay  ──delivers to subscribers (including the desktop client)
```

No separate "agent endpoint" a client calls — agents only ever appear as relay traffic (§4).

## 10. Configuration / environment variables (confirmed, from `../buzz`)

| Variable                        | Where                                                                                 | Purpose                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `BUZZ_DOMAIN`                   | `deploy/compose/.env.example:9`                                                       | Public hostname; drives Caddy + the URL-derived vars below                                                                   |
| `RELAY_URL`                     | `deploy/compose/.env.example:10`                                                      | `wss://` form of the same domain, for client config generation                                                               |
| `BUZZ_MEDIA_BASE_URL`           | `deploy/compose/.env.example:11`                                                      | `https://` media base, same domain + `/media`                                                                                |
| `BUZZ_CORS_ORIGINS`             | `deploy/compose/.env.example:13`, parsed at `crates/buzz-relay/src/config.rs:804-809` | Comma-separated allow-list; **relay defaults to permissive (allow-any) if unset**, per `crates/buzz-relay/src/router.rs:510` |
| `BUZZ_REQUIRE_AUTH_TOKEN`       | `.env.example:16`                                                                     | REST API token auth (WebSocket auth unaffected either way)                                                                   |
| `BUZZ_REQUIRE_RELAY_MEMBERSHIP` | `.env.example:17`                                                                     | Closed-relay membership enforcement                                                                                          |
| `BUZZ_ALLOW_NIP_OA_AUTH`        | `.env.example:18`                                                                     | Enables a NIP-OA-style auth path (not investigated further this pass)                                                        |
| `RELAY_OWNER_PUBKEY`            | `.env.example:24`                                                                     | Relay owner's Nostr pubkey                                                                                                   |
| `BUZZ_RELAY_PRIVATE_KEY`        | `.env.example:27`                                                                     | Relay's own signing key (relay-authored events)                                                                              |
| `BUZZ_PAIR_RELAY_BIND_ADDR`     | `deploy/charts/buzz/templates/pairing-relay.yaml:37-38`                               | Bind address for the _optional_ device-pairing relay (not a bunker)                                                          |
| `BUZZ_RELAY_URL`                | `crates/buzz-acp/src/config.rs:246`                                                   | The relay URL an ACP instance connects _to_ (default `ws://localhost:3000`)                                                  |

## 11. What SWF Buzz can use immediately

- **Nothing about `buzz.lmdconsulting.com` specifically** — it isn't in the repository, so nothing
  here can be confirmed as pointing SWF Buzz at it safely.
- The **local dev pattern** is fully usable today: `docker compose -f deploy/compose/compose.yml
-f deploy/compose/compose.dev.yml up` (or the simpler `just relay`, per this project's earlier
  reconnaissance) gives a real local relay at `ws://localhost:3000` — this is what SWF Buzz's own
  `.env.example` (`VITE_RELAY_URL=ws://localhost:3000`) already targets.
- The env var _names_ above (§10) are safe to reuse verbatim in SWF Buzz's own docs/config, since
  they're the relay's actual interface, not guesses.

## 12. What we need from the backend/team

1. **Confirm what `https://buzz.lmdconsulting.com/` actually is** — production relay? Staging?
   Something else entirely? Nothing in `../buzz` answers this.
2. **If it is a relay deployment**: confirm the exact WebSocket URL (likely `wss://` same host, per
   §3, but must be confirmed, not assumed) and its `BUZZ_CORS_ORIGINS` value (needed for a Tauri
   webview origin — see this project's `docs/SECURITY.md`/§30 of the original SWF Buzz brief on
   `tauri://localhost` / `http://tauri.localhost`).
3. **NIP-46 bunker**: confirm whether one exists _outside_ this repository (this reconnaissance can
   only speak to what's in `../buzz`) — if not, this is the same D2 gap already tracked, now with
   more precise evidence that it isn't hiding somewhere in the deployment config either.
4. **Auth model for that specific deployment**: is `BUZZ_REQUIRE_AUTH_TOKEN`/membership enforcement
   on? Is it an open or closed relay? Affects whether SWF Buzz can even connect without being
   pre-provisioned as a member.

## 13. Exact remaining blockers

- Identity/purpose of `buzz.lmdconsulting.com` — unconfirmed, not in `../buzz`.
- No NIP-46 bunker exists in `../buzz`, deployed or configured — confirmed absent, not just
  unconfigured (§5).
- No direct ACP endpoint exists or is needed — confirmed architecturally unnecessary (§4), not a
  blocker at all, just a corrected assumption.

---

## Diagram (only components verified from `../buzz`)

```
SWF Buzz (client)
   ↓  HTTPS + wss:// (same host, per §3 — confirmed for the REFERENCE architecture,
   ↓                  NOT confirmed for buzz.lmdconsulting.com specifically)
[reverse proxy: Caddy / Ingress — single upstream, no path splitting]
   ↓
buzz-relay  (HTTP surface + WebSocket, one process/service)
   ↓  (relay-internal: Postgres, Redis, S3/MinIO — not client-reachable)
   ↓  (relay pub/sub, not a direct connection)
buzz-acp  (relay CLIENT, not a server — subscribes via BUZZ_RELAY_URL)
   ↓
Agent (runs inside buzz-acp's process, replies published back through buzz-relay)
```

No NIP-46 bunker node appears in this diagram — none exists in `../buzz` to draw.
