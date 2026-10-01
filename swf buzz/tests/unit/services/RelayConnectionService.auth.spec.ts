import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionStore } from "@/stores/connection";
import {
  RelayConnectionService,
  authDenialFrom,
  authDenialMessage,
} from "@/services/RelayConnectionService";
import {
  clearActiveSigningService,
  setActiveSigningService,
} from "@/features/signing/signingServiceRegistry";

// A fake nostr-tools Relay: no sockets. `control.auth` decides what the relay's
// verdict on our NIP-42 AUTH is, mirroring what `relay.auth()` returns/rejects.
const { FakeRelay, instances, control } = vi.hoisted(() => {
  const instances: Array<{ closed: boolean; subscribeCalls: number }> = [];
  const control = { auth: (): Promise<unknown> => Promise.resolve("") };
  class FakeRelay {
    connected = true;
    closed = false;
    subscribeCalls = 0;
    onauth?: (event: unknown) => Promise<unknown>;
    onclose?: () => void;
    constructor(_url: string) {
      instances.push(this);
    }
    async connect() {
      // The relay's challenge arrives right after the socket opens.
      void this.onauth?.({ kind: 22242, content: "", tags: [], created_at: 1 });
    }
    auth() {
      return control.auth();
    }
    close() {
      this.closed = true;
    }
    subscribe() {
      this.subscribeCalls += 1;
      return { close() {} };
    }
    async publish() {
      return "";
    }
  }
  return { FakeRelay, instances, control };
});

vi.mock("nostr-tools/relay", () => ({ Relay: FakeRelay }));

const signer = {
  mode: "production" as const,
  getPublicKey: async () => "pk",
  signEvent: async (event: { kind: number; content: string; tags: string[][]; created_at?: number }) => ({
    ...event,
    id: "id",
    pubkey: "pk",
    sig: "sig",
    created_at: event.created_at ?? 1,
  }),
  nip44Encrypt: async () => "",
  nip44Decrypt: async () => "",
};

describe("authDenialFrom", () => {
  it("returns the relay's reason for a refusal", () => {
    expect(authDenialFrom(new Error("restricted: not a relay member"))).toBe(
      "restricted: not a relay member",
    );
    expect(authDenialFrom("blocked: you are banned from this community")).toContain("banned");
  });

  it("is not a refusal when the relay sent no challenge or the AUTH timed out", () => {
    expect(authDenialFrom(new Error("can't perform auth, no challenge was received"))).toBeNull();
    expect(authDenialFrom(new Error("auth timed out"))).toBeNull();
  });
});

describe("authDenialMessage", () => {
  it("explains a non-member refusal without leaking the raw reason", () => {
    const message = authDenialMessage("restricted: not a relay member");
    expect(message).toContain("isn't a member");
    expect(message).not.toContain("restricted:");
  });

  it("explains a ban and falls back to a generic message otherwise", () => {
    expect(authDenialMessage("blocked: you are banned from this community")).toContain("blocked");
    expect(authDenialMessage("something else")).toBe("The Buzz server didn't accept this identity.");
  });
});

describe("RelayConnectionService — the relay's AUTH verdict decides 'connected'", () => {
  let service: RelayConnectionService;

  beforeEach(() => {
    setActivePinia(createPinia());
    setActiveSigningService(signer);
    instances.length = 0;
    control.auth = () => Promise.resolve("");
    service = new RelayConnectionService();
  });

  afterEach(() => {
    service.disconnect();
    clearActiveSigningService();
    vi.useRealTimers();
  });

  it("member: AUTH accepted → connected, and registered subscriptions are issued", async () => {
    service.subscribe("s", [{ kinds: [1] }], { onEvent: () => {} });

    await service.connect("ws://relay.test");

    expect(useConnectionStore().status).toBe("connected");
    expect(instances[0].closed).toBe(false);
    expect(instances[0].subscribeCalls).toBe(1);
  });

  it("non-member: AUTH refused → error status with a clear message, socket closed, nothing subscribed", async () => {
    control.auth = () => Promise.reject(new Error("restricted: not a relay member"));
    service.subscribe("s", [{ kinds: [1] }], { onEvent: () => {} });

    await service.connect("ws://relay.test");

    const store = useConnectionStore();
    expect(store.status).toBe("error");
    expect(store.isUsable).toBe(false);
    expect(store.lastError).toContain("isn't a member of this community");
    expect(instances[0].closed).toBe(true);
    expect(instances[0].subscribeCalls, "must not issue subscriptions on a refused connection").toBe(0);
  });

  it("does not keep reconnecting after a refusal (a refused identity is not transient)", async () => {
    vi.useFakeTimers();
    control.auth = () => Promise.reject(new Error("restricted: not a relay member"));

    await service.connect("ws://relay.test");
    await vi.advanceTimersByTimeAsync(120_000);

    expect(instances.length, "no reconnect attempt after a refusal").toBe(1);
    expect(useConnectionStore().status).toBe("error");
  });

  it("banned identity: reports a blocked message", async () => {
    control.auth = () => Promise.reject(new Error("blocked: you are banned from this community"));

    await service.connect("ws://relay.test");

    expect(useConnectionStore().lastError).toContain("blocked");
  });

  it("relay without NIP-42 (no challenge): behaves as before → connected", async () => {
    control.auth = () => Promise.reject(new Error("can't perform auth, no challenge was received"));

    await service.connect("ws://relay.test");

    expect(useConnectionStore().status).toBe("connected");
  });

  it("no verdict within the timeout: does not block the connection", async () => {
    vi.useFakeTimers();
    control.auth = () => new Promise(() => {}); // relay never answers the AUTH

    const connecting = service.connect("ws://relay.test");
    await vi.advanceTimersByTimeAsync(5_000);
    await connecting;

    expect(useConnectionStore().status).toBe("connected");
  });
});
