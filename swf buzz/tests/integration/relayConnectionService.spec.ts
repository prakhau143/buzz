// @vitest-environment node
/**
 * Integration test for RelayConnectionService's own wire-level plumbing —
 * connect, publish/OK, subscribe/EOSE, live event delivery, and
 * reconnect-after-drop — against a real WebSocket socket.
 *
 * IMPORTANT SCOPE NOTE (see docs/E2E_TEST_RESULTS.md): the server here
 * (tests/integration/helpers/minimalNostrRelay.ts) is a minimal, generic
 * NIP-01 relay, NOT buzz-relay. It proves RelayConnectionService's own
 * connection/reconnect/pub-sub code works against a real socket. It does
 * NOT prove anything about Buzz-specific protocol business logic (channel
 * creation side effects, NIP-29 membership, NIP-42 auth, reaction channel
 * derivation, presence/typing semantics) — those require the real
 * buzz-relay, which could not be started in this environment (no Docker).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { RelayConnectionService } from "@/services/RelayConnectionService";
import { useConnectionStore } from "@/stores/connection";
import { MinimalNostrRelay } from "./helpers/minimalNostrRelay";
import type { SignedEvent } from "@/features/signing/types";

let relay: MinimalNostrRelay;
let service: RelayConnectionService;

beforeEach(async () => {
  setActivePinia(createPinia());
  relay = await MinimalNostrRelay.start();
  service = new RelayConnectionService();
});

afterEach(async () => {
  service.disconnect();
  await relay.stop();
});

function signTestEvent(kind: number, content: string, tags: string[][] = []): SignedEvent {
  const secretKey = generateSecretKey();
  return finalizeEvent(
    { kind, content, tags, created_at: Math.floor(Date.now() / 1000) },
    secretKey,
  );
}

describe("RelayConnectionService — wire-level plumbing", () => {
  it("connects and reports connected status", async () => {
    await service.connect(relay.url);
    expect(useConnectionStore().status).toBe("connected");
  });

  it("publishes a signed event and receives an OK", async () => {
    await service.connect(relay.url);
    const event = signTestEvent(1, "hello");
    await expect(service.publish(event)).resolves.toBe("");
  });

  it("delivers EOSE for a subscription with no matching events", async () => {
    await service.connect(relay.url);
    const eosed = await new Promise<boolean>((resolve) => {
      service.subscribe("test", [{ kinds: [1] }], {
        onEvent: () => {},
        onEose: () => resolve(true),
      });
    });
    expect(eosed).toBe(true);
  });

  it("delivers a live event to a matching subscription after it's published", async () => {
    await service.connect(relay.url);
    const received = new Promise<{ kind: number; content: string }>((resolve) => {
      service.subscribe("test", [{ kinds: [1] }], { onEvent: (e) => resolve(e) });
    });

    const event = signTestEvent(1, "live delivery works");
    await service.publish(event);

    const delivered = await received;
    expect(delivered.content).toBe("live delivery works");
  });

  it("replays a preloaded (already-published) event on a fresh subscription", async () => {
    await service.connect(relay.url);
    const event = signTestEvent(1, "already here before you subscribed");
    await service.publish(event);

    const replayed = await new Promise<{ content: string }>((resolve) => {
      service.subscribe("test", [{ kinds: [1] }], { onEvent: (e) => resolve(e) });
    });
    expect(replayed.content).toBe("already here before you subscribed");
  });

  it("rejects publish when not connected", async () => {
    const event = signTestEvent(1, "never sent");
    await expect(service.publish(event)).rejects.toThrow();
  });

  it("reconnects with backoff after the relay drops the connection", async () => {
    await service.connect(relay.url);
    expect(useConnectionStore().status).toBe("connected");

    relay.dropAllConnections();

    // handleClose fires asynchronously on the socket's close event.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(useConnectionStore().status).toBe("disconnected");
    expect(useConnectionStore().reconnectAttempt).toBeGreaterThan(0);

    // First backoff is ~1000ms (BASE_BACKOFF_MS) — wait past it for the retry.
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (useConnectionStore().status === "connected") {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
    expect(useConnectionStore().status).toBe("connected");
  }, 10000);

  it("re-issues an active subscription after reconnecting", async () => {
    await service.connect(relay.url);

    let eventCount = 0;
    service.subscribe("test", [{ kinds: [1] }], { onEvent: () => eventCount++ });

    relay.dropAllConnections();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (useConnectionStore().status === "connected") {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    const event = signTestEvent(1, "after reconnect");
    await service.publish(event);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(eventCount).toBe(1);
  }, 10000);
});

describe("SigningService + RelayConnectionService — publish round trip", () => {
  it("a properly signed event round-trips through publish and a live subscription", async () => {
    await service.connect(relay.url);

    const event = signTestEvent(9, "channel message", [["h", "channel-1"]]);

    const received = new Promise<{ pubkey: string; kind: number }>((resolve) => {
      service.subscribe("test", [{ kinds: [9], "#h": ["channel-1"] }], {
        onEvent: (e) => resolve(e),
      });
    });

    await service.publish(event);
    const delivered = await received;
    expect(delivered.kind).toBe(9);
    expect(delivered.pubkey).toBe(event.pubkey);
  });
});

describe("RelayConnectionService — connection-failure messaging", () => {
  it("surfaces a specific 'local relay not running' message for a refused loopback connection", async () => {
    // Port 0-in-a-connect-string doesn't work as a target; use a port nothing
    // is listening on instead (the just-stopped relay's own former port).
    const deadUrl = relay.url;
    await relay.stop();

    await service.connect(deadUrl);
    const store = useConnectionStore();
    expect(store.status).toBe("error");
    expect(store.lastError).toMatch(/local buzz relay/i);
  }, 15000);
});
