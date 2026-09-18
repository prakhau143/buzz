/**
 * A minimal, generic NIP-01 WebSocket relay used ONLY as a wire-level test
 * fixture for RelayConnectionService's own plumbing (connect, publish/OK,
 * subscribe/EOSE, live delivery, reconnect-on-close). It implements bare
 * NIP-01 framing only — no Buzz-specific side effects (no NIP-29 channel/
 * membership synthesis, no NIP-42 auth, no reaction channel derivation, no
 * presence/typing semantics). It is NOT buzz-relay and must never be
 * described as verifying Buzz protocol/business-logic correctness — see
 * docs/E2E_TEST_RESULTS.md for what this does and doesn't prove.
 */
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";

interface StoredEvent {
  id: string;
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
  sig: string;
}

interface Filter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
}

function matchesFilter(event: StoredEvent, filter: Filter): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since && event.created_at < filter.since) return false;
  if (filter.until && event.created_at > filter.until) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith("#") || !values) continue;
    const tagName = key.slice(1);
    const eventValues = event.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
    if (!(values as string[]).some((v) => eventValues.includes(v))) return false;
  }
  return true;
}

export class MinimalNostrRelay {
  readonly url: string;
  private readonly wss: WebSocketServer;
  private readonly events: StoredEvent[] = [];
  private readonly subscriptions = new Map<WebSocket, Map<string, Filter[]>>();
  private stopped = false;

  private constructor(wss: WebSocketServer, port: number) {
    this.wss = wss;
    this.url = `ws://127.0.0.1:${port}`;
  }

  static async start(): Promise<MinimalNostrRelay> {
    return new Promise((resolve) => {
      const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => {
        const port = (wss.address() as AddressInfo).port;
        const relay = new MinimalNostrRelay(wss, port);
        relay.attachHandlers();
        resolve(relay);
      });
    });
  }

  private attachHandlers(): void {
    this.wss.on("connection", (socket) => {
      this.subscriptions.set(socket, new Map());
      socket.on("message", (raw) => this.handleMessage(socket, raw.toString()));
      socket.on("close", () => this.subscriptions.delete(socket));
    });
  }

  private handleMessage(socket: WebSocket, raw: string): void {
    let msg: unknown[];
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const [type, ...rest] = msg;

    if (type === "EVENT") {
      const event = rest[0] as StoredEvent;
      this.events.push(event);
      socket.send(JSON.stringify(["OK", event.id, true, ""]));
      for (const [peer, subs] of this.subscriptions) {
        for (const [subId, filters] of subs) {
          if (filters.some((f) => matchesFilter(event, f))) {
            peer.send(JSON.stringify(["EVENT", subId, event]));
          }
        }
      }
      return;
    }

    if (type === "REQ") {
      const [subId, ...filters] = rest as [string, ...Filter[]];
      this.subscriptions.get(socket)?.set(subId, filters);
      for (const event of this.events) {
        if (filters.some((f) => matchesFilter(event, f))) {
          socket.send(JSON.stringify(["EVENT", subId, event]));
        }
      }
      socket.send(JSON.stringify(["EOSE", subId]));
      return;
    }

    if (type === "CLOSE") {
      const [subId] = rest as [string];
      this.subscriptions.get(socket)?.delete(subId);
    }
  }

  /** Forcibly drops every open connection without closing the server — simulates a relay-side disconnect. */
  dropAllConnections(): void {
    for (const client of this.wss.clients) {
      client.terminate();
    }
  }

  /** Idempotent — safe to call again (e.g. once explicitly in a test, once more from a shared afterEach). */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.dropAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
