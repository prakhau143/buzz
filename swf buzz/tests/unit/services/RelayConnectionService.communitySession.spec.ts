/**
 * The transport half of community-switch isolation (communitySession.ts):
 * every subscription and one-shot fetch belongs to the community session it
 * was opened in. Whatever arrives for an ended session — an event already on
 * the wire when community A was left, an EOSE that lands after the switch — is
 * dropped, so it can never be written into community B's state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { RelayConnectionService } from "@/services/RelayConnectionService";
import {
  clearActiveSigningService,
  setActiveSigningService,
} from "@/features/signing/signingServiceRegistry";
import {
  beginCommunitySession,
  endCommunitySession,
  StaleCommunitySessionError,
} from "@/features/communities/communitySession";
import type { RawNostrEvent } from "@/protocol/types";

interface FakeSub {
  onevent: (event: unknown) => void;
  oneose?: () => void;
  closed: boolean;
}

const { FakeRelay, relays } = vi.hoisted(() => {
  const relays: Array<{ subs: FakeSub[] }> = [];
  class FakeRelay {
    connected = true;
    subs: FakeSub[] = [];
    onauth?: (event: unknown) => Promise<unknown>;
    onclose?: () => void;
    constructor(_url: string) {
      relays.push(this);
    }
    async connect() {
      void this.onauth?.({ kind: 22242, content: "", tags: [], created_at: 1 });
    }
    auth() {
      return Promise.resolve("");
    }
    close() {
      this.connected = false;
    }
    subscribe(_filters: unknown, handlers: { onevent: (e: unknown) => void; oneose?: () => void }) {
      const sub: FakeSub = { ...handlers, closed: false };
      this.subs.push(sub);
      return { close: () => (sub.closed = true) };
    }
    async publish() {
      return "";
    }
  }
  return { FakeRelay, relays };
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

const event = (id: string): RawNostrEvent =>
  ({ id, pubkey: "p", kind: 9, content: id, tags: [], created_at: 1, sig: "s" }) as RawNostrEvent;

beforeEach(() => {
  setActivePinia(createPinia());
  setActiveSigningService(signer);
  relays.length = 0;
});
afterEach(() => {
  clearActiveSigningService();
});

async function connectedService(url: string): Promise<RelayConnectionService> {
  beginCommunitySession(url);
  const service = new RelayConnectionService();
  await service.connect(url);
  return service;
}

describe("RelayConnectionService: events belong to the community session they were subscribed in", () => {
  it("delivers events for the current session", async () => {
    const service = await connectedService("wss://a.example");
    const received: string[] = [];
    service.subscribe("s", [{ kinds: [9] }], { onEvent: (e) => received.push(e.id) });

    relays[0]!.subs[0]!.onevent(event("a-1"));
    expect(received).toEqual(["a-1"]);
  });

  it("drops an event and an EOSE that arrive after the session ended (already on the wire)", async () => {
    const service = await connectedService("wss://a.example");
    const received: string[] = [];
    let eose = 0;
    service.subscribe("s", [{ kinds: [9] }], { onEvent: (e) => received.push(e.id), onEose: () => eose++ });
    const aSub = relays[0]!.subs[0]!;

    // Switch A → B: the session ends before the socket is torn down.
    endCommunitySession();
    beginCommunitySession("wss://b.example");

    aSub.onevent(event("a-late"));
    aSub.oneose?.();
    expect(received).toEqual([]);
    expect(eose).toBe(0);
  });

  it("does not re-issue an ended session's subscription on a new socket", async () => {
    const service = await connectedService("wss://a.example");
    service.subscribe("s", [{ kinds: [9] }], { onEvent: () => {} });
    expect(relays[0]!.subs).toHaveLength(1);

    endCommunitySession();
    beginCommunitySession("wss://a.example");
    await service.connect("wss://a.example");

    expect(relays[1]!.subs).toHaveLength(0);
  });
});

describe("fetchEventsOnce: a fetch belongs to its community session", () => {
  it("resolves for the current session", async () => {
    const { relayConnectionService } = await import("@/services/RelayConnectionService");
    const { fetchEventsOnce } = await import("@/services/relayQuery");
    beginCommunitySession("wss://a.example");
    await relayConnectionService.connect("wss://a.example");
    const relay = relays.at(-1)!;

    const pending = fetchEventsOnce([{ kinds: [9] }]);
    relay.subs.at(-1)!.onevent(event("a-1"));
    relay.subs.at(-1)!.oneose?.();
    await expect(pending).resolves.toHaveLength(1);
    relayConnectionService.disconnect();
  });

  it("rejects with StaleCommunitySessionError when the community changed before it settled", async () => {
    vi.useFakeTimers();
    try {
      const { relayConnectionService } = await import("@/services/RelayConnectionService");
      const { fetchEventsOnce } = await import("@/services/relayQuery");
      beginCommunitySession("wss://a.example");
      const connecting = relayConnectionService.connect("wss://a.example");
      await vi.advanceTimersByTimeAsync(3_000);
      await connecting;
      const relay = relays.at(-1)!;

      const pending = fetchEventsOnce([{ kinds: [9] }], { timeoutMs: 1_000 });
      const settled = expect(pending).rejects.toBeInstanceOf(StaleCommunitySessionError);
      relay.subs.at(-1)!.onevent(event("a-1"));

      endCommunitySession();
      beginCommunitySession("wss://b.example");
      // The A subscription can no longer deliver its EOSE; the timeout settles it.
      await vi.advanceTimersByTimeAsync(1_000);
      await settled;
      relayConnectionService.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});
