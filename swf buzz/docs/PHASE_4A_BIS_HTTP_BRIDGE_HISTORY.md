# Phase 4A-bis — HTTP bridge channel history (PROPOSAL, NOT IMPLEMENTED)

**Date:** 2026-09-24
**Status:** documentation only. Nothing here is built. Phase 4A shipped the
WebSocket `before_id` keyset path instead; this records what a later migration
would buy, cost and risk.

## Why this exists

Phase 4A's plan named **kind:39006** as the authoritative end-of-history signal.
Tracing the relay showed it is emitted in exactly one place —
`crates/buzz-relay/src/api/bridge.rs:684` — the **HTTP bridge channel-window**.
It is never sent over the WebSocket REQ path, which is where SWF loads history
(`src/services/relayQuery.ts:24`). So 39006 was unreachable without moving the
history transport, and inventing a local substitute was explicitly ruled out.

**This is not a defect in the shipped 4A work.** With `before_id` the relay
excludes the page boundary server-side
(`crates/buzz-db/src/store/event.rs:626-636`), so an empty page is a genuine
empty result for the requested cursor and pagination is exhaustive and correct.

## What the bridge additionally offers

| Capability | Source | Value over WS |
|---|---|---|
| `before_id` keyset | `bridge.rs:508-690` | none — WS has it too (`protocol.rs:108-111`) |
| **`limit+1` probe** | `bridge.rs:508-690` | server knows whether more exists without a second round trip |
| **`has_more` / `next_cursor`** | same | authoritative, rather than inferred from an empty page |
| **kind:39006 `KIND_WINDOW_BOUNDS`** | `bridge.rs:684`, `kind.rs:437-439` | relay-signed exhaustion overlay — "the only authority on exhaustion; clients must not infer `has_more` from row counts" |
| **kind:39005 thread summaries** | `bridge.rs:643-666` | server-computed reply counts per row, no client aggregation |

The practical gain is one saved round trip at the end of history, and
server-computed thread counts — not correctness of the message set itself, which
4A already secured.

## Impact

**`MessageService`** — `fetchMessages` / `fetchOlderMessages` would move from
`fetchEventsOnce` (WS REQ) to a signed HTTP POST carrying the channel-window
extension fields, and would parse two overlay kinds (39005/39006) alongside
message events. `subscribeToChannel` stays on WS: the bridge is for paged
history only. The `messageCursor` module is unaffected — the cursor shape is
identical.

**`relayQuery`** — today a single WS "fetch once until EOSE" helper. A bridge
path needs a second helper with NIP-98 auth, HTTP error mapping and timeouts.
Two history transports would coexist unless every caller migrates.

**`ThreadService` / `ThreadServiceHttp`** — SWF already carries **two parallel
thread stacks** (Phase 4 audit §9), and the bridge is the same surface
`ThreadServiceHttp` reaches for. Migrating channel history without first
consolidating threads (assigned to **4G**) risks a third partly-overlapping path.
**Sequencing: consolidate threads first, then evaluate this.**

## Risks

1. **Transport split.** Live stays WS, history moves to HTTP — two auth paths
   (NIP-42 socket vs NIP-98 request) for one timeline.
2. **Larger blast radius.** Touches the module every message feature depends on,
   right after 4A stabilised it.
3. **Thread-stack collision** with 4G, as above.
4. **Auth differences.** The WS path is authenticated once per socket; each
   bridge call is signed individually — more failure modes per page.
5. **Interoperability.** `before_id` and the channel-window fields are Buzz
   extensions, not NIP-01. A non-Buzz relay ignores `before_id` and degrades to
   inclusive `until`; the bridge endpoint would simply not exist there. The WS
   path therefore degrades gracefully where the bridge path cannot.

## Recommendation

Defer. Revisit only after 4G consolidates the thread stacks, and only if
end-of-history round trips or client-side thread counting show up as real
problems. The correctness this phase existed to fix is already done.
