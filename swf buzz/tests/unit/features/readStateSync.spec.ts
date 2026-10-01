import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchEventsOnce = vi.fn();
const signAndPublish = vi.fn();
const getActiveSigningService = vi.fn();

vi.mock("@/services/relayQuery", () => ({
  fetchEventsOnce: (...args: unknown[]) => fetchEventsOnce(...args),
}));
vi.mock("@/services/publish", () => ({
  signAndPublish: (...args: unknown[]) => signAndPublish(...args),
}));
vi.mock("@/features/signing/signingServiceRegistry", () => ({
  getActiveSigningService: () => getActiveSigningService(),
}));

import {
  buildReadStateBlob,
  buildReadStateTags,
  generateSlotId,
  READ_STATE_KIND,
} from "@/protocol/readState";
import { fetchReadState, publishReadState } from "@/services/ReadStateService";
import { useReadStateStore } from "@/stores/readState";
import { useSessionStore } from "@/stores/session";

const PUBKEY = "b".repeat(64);

/**
 * A signer that "seals" by tagging the plaintext, so a test can assert the
 * content was encrypted without depending on real NIP-44 output. Anything
 * not carrying the marker is treated as another identity's payload and
 * rejected, mirroring a real decrypt failure.
 */
const SEAL = "sealed:";
function fakeSigner() {
  return {
    nip44Encrypt: vi.fn(async (_pk: string, plaintext: string) => `${SEAL}${plaintext}`),
    nip44Decrypt: vi.fn(async (_pk: string, ciphertext: string) => {
      if (!ciphertext.startsWith(SEAL)) throw new Error("not ours");
      return ciphertext.slice(SEAL.length);
    }),
  };
}

function readStateEvent(contexts: Record<string, number>, overrides: Record<string, unknown> = {}) {
  const blob = buildReadStateBlob("other-device", contexts);
  return {
    id: "e".repeat(64),
    pubkey: PUBKEY,
    kind: READ_STATE_KIND,
    created_at: 1_700_000_000,
    tags: buildReadStateTags(generateSlotId()),
    content: `${SEAL}${JSON.stringify(blob)}`,
    sig: "s".repeat(128),
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  fetchEventsOnce.mockReset();
  signAndPublish.mockReset();
  getActiveSigningService.mockReset();
  getActiveSigningService.mockReturnValue(fakeSigner());
  signAndPublish.mockResolvedValue({ id: "x" });
});

describe("ReadStateService — fetch", () => {
  it("asks the relay for this author's read-state events only", async () => {
    fetchEventsOnce.mockResolvedValue([]);
    await fetchReadState(PUBKEY);

    expect(fetchEventsOnce).toHaveBeenCalledWith([
      { kinds: [READ_STATE_KIND], authors: [PUBKEY], "#t": ["read-state"] },
    ]);
  });

  it("merges every coordinate, so a second device's frontier is picked up", async () => {
    fetchEventsOnce.mockResolvedValue([
      readStateEvent({ "chan-a": 100, "chan-b": 10 }),
      readStateEvent({ "chan-a": 50, "chan-b": 80 }),
    ]);

    const { contexts, hydrated } = await fetchReadState(PUBKEY);
    // Max per context across coordinates — not last-writer-wins.
    expect(contexts).toEqual({ "chan-a": 100, "chan-b": 80 });
    expect(hydrated).toBe(true);
  });

  it("ignores foreign kind:30078 events that share the kind number", async () => {
    // NIP-78 is a shared namespace; another app's blob is expected here.
    fetchEventsOnce.mockResolvedValue([
      { ...readStateEvent({ mine: 5 }), content: "someone-elses-ciphertext" },
    ]);

    const { contexts, hydrated } = await fetchReadState(PUBKEY);
    expect(contexts).toEqual({});
    expect(hydrated).toBe(false);
  });

  it("ignores structurally invalid events before attempting to decrypt", async () => {
    const signer = fakeSigner();
    getActiveSigningService.mockReturnValue(signer);
    fetchEventsOnce.mockResolvedValue([
      readStateEvent({ a: 1 }, { tags: [["t", "read-state"]] }), // no d tag
      readStateEvent({ a: 1 }, { tags: [["d", "read-state:nothex"], ["t", "read-state"]] }),
      readStateEvent({ a: 1 }, { tags: buildReadStateTags(generateSlotId()) }), // ok
    ]);

    await fetchReadState(PUBKEY);
    // Only the well-formed one reaches the (relatively costly) decrypt.
    expect(signer.nip44Decrypt).toHaveBeenCalledTimes(1);
  });

  it("skips an event authored by someone else", async () => {
    fetchEventsOnce.mockResolvedValue([readStateEvent({ a: 1 }, { pubkey: "c".repeat(64) })]);
    const { contexts } = await fetchReadState(PUBKEY);
    expect(contexts).toEqual({});
  });

  it("survives a malformed blob without losing the valid ones", async () => {
    fetchEventsOnce.mockResolvedValue([
      { ...readStateEvent({}), content: `${SEAL}not-json` },
      readStateEvent({ good: 42 }),
    ]);
    const { contexts } = await fetchReadState(PUBKEY);
    expect(contexts).toEqual({ good: 42 });
  });
});

describe("ReadStateService — publish", () => {
  it("publishes a sealed, correctly tagged addressable event", async () => {
    await publishReadState(PUBKEY, { "chan-a": 123 });

    expect(signAndPublish).toHaveBeenCalledTimes(1);
    const event = signAndPublish.mock.calls[0][0];
    expect(event.kind).toBe(READ_STATE_KIND);
    expect(event.tags.filter((t: string[]) => t[0] === "d")).toHaveLength(1);
    expect(event.tags).toContainEqual(["t", "read-state"]);
    expect(event.tags[0][1]).toMatch(/^read-state:[0-9a-f]{32}$/);
  });

  it("never puts the frontier on the wire in the clear", async () => {
    await publishReadState(PUBKEY, { "secret-channel-name": 123 });
    const { content } = signAndPublish.mock.calls[0][0];
    expect(content.startsWith(SEAL)).toBe(true);
    // The marker is the test's stand-in for encryption; what matters is that
    // the raw JSON is not what gets published.
    expect(content).not.toBe(JSON.stringify({ "secret-channel-name": 123 }));
  });

  it("reuses the same slot id across publishes for this identity", async () => {
    await publishReadState(PUBKEY, { a: 1 });
    await publishReadState(PUBKEY, { a: 2 });
    const first = signAndPublish.mock.calls[0][0].tags[0][1];
    const second = signAndPublish.mock.calls[1][0].tags[0][1];
    // A new slot id per publish would orphan a coordinate every time.
    expect(second).toBe(first);
  });
});

describe("readState store — relay hydration", () => {
  function signIn() {
    useSessionStore().pubkey = PUBKEY;
  }

  it("merges the relay frontier into local state", async () => {
    signIn();
    const store = useReadStateStore();
    store.ensureLoaded();
    store.lastSeenAt = { "chan-a": 10 };

    fetchEventsOnce.mockResolvedValue([readStateEvent({ "chan-a": 99, "chan-b": 5 })]);
    await store.hydrateFromRelay();

    expect(store.lastSeenAt).toEqual({ "chan-a": 99, "chan-b": 5 });
    expect(store.hydratedFromRelay).toBe(true);
  });

  it("never rewinds a local mark that is ahead of the relay", async () => {
    signIn();
    const store = useReadStateStore();
    store.ensureLoaded();
    store.lastSeenAt = { "chan-a": 500 };

    fetchEventsOnce.mockResolvedValue([readStateEvent({ "chan-a": 100 })]);
    await store.hydrateFromRelay();

    expect(store.lastSeenAt["chan-a"]).toBe(500);
  });

  it("clears the unread badge for a channel read on another device", async () => {
    signIn();
    const store = useReadStateStore();
    store.ensureLoaded();
    store.lastSeenAt = { "chan-a": 10 };
    store.unreadCounts = { "chan-a": 7 };
    store.hasMention = { "chan-a": true };

    fetchEventsOnce.mockResolvedValue([readStateEvent({ "chan-a": 900 })]);
    await store.hydrateFromRelay();

    expect(store.unreadCounts["chan-a"]).toBe(0);
    expect(store.hasMention["chan-a"]).toBe(false);
  });

  it("leaves local state intact when the relay is unreachable", async () => {
    signIn();
    const store = useReadStateStore();
    store.ensureLoaded();
    store.lastSeenAt = { "chan-a": 10 };

    fetchEventsOnce.mockRejectedValue(new Error("offline"));
    await store.hydrateFromRelay();

    expect(store.lastSeenAt).toEqual({ "chan-a": 10 });
    expect(store.hydratedFromRelay).toBe(false);
  });

  it("discards a result that arrives after the identity changed", async () => {
    signIn();
    const store = useReadStateStore();
    store.ensureLoaded();

    let release: (v: unknown) => void = () => {};
    fetchEventsOnce.mockReturnValue(new Promise((r) => (release = r)));
    const pending = store.hydrateFromRelay();

    // Sign-out / switch happens while the fetch is in flight.
    useSessionStore().pubkey = null;
    release([readStateEvent({ "chan-a": 900 })]);
    await pending;

    // Applying it would show one identity's read state under another's.
    expect(store.lastSeenAt["chan-a"]).toBeUndefined();
  });

  it("does nothing when signed out", async () => {
    useSessionStore().pubkey = null;
    await useReadStateStore().hydrateFromRelay();
    expect(fetchEventsOnce).not.toHaveBeenCalled();
  });
});

describe("readState store — publishing on change", () => {
  function signIn() {
    useSessionStore().pubkey = PUBKEY;
  }

  it("publishes when the frontier actually advances", async () => {
    signIn();
    const store = useReadStateStore();
    store.markChannelSeen("chan-a", 100);
    await vi.waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
  });

  it("does not publish when re-opening an already-read channel", async () => {
    signIn();
    const store = useReadStateStore();
    store.markChannelSeen("chan-a", 100);
    await vi.waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));

    signAndPublish.mockClear();
    store.markChannelSeen("chan-a", 50); // older than what we've seen
    expect(signAndPublish).not.toHaveBeenCalled();
  });

  it("retries on the next change after a failed publish", async () => {
    signIn();
    const store = useReadStateStore();
    signAndPublish.mockRejectedValueOnce(new Error("relay down"));

    store.markChannelSeen("chan-a", 100);
    await vi.waitFor(() => expect(store.publishPending).toBe(true));

    signAndPublish.mockResolvedValue({ id: "x" });
    // Same channel, no advance — but the pending flag must still force a retry.
    store.markChannelSeen("chan-a", 100);
    await vi.waitFor(() => expect(store.publishPending).toBe(false));
  });

  it("keeps mark-unread local — a rewind is never published", async () => {
    signIn();
    const store = useReadStateStore();
    store.markChannelSeen("chan-a", 100);
    await vi.waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));

    signAndPublish.mockClear();
    store.markUnreadFrom("chan-a", 50, 3);

    // Publishing a lower value is a no-op under the grow-only merge rule, and
    // our own next hydrate would undo it. Pinned so nobody "fixes" this into
    // a publish that appears to sync and silently does not.
    expect(signAndPublish).not.toHaveBeenCalled();
    expect(store.lastSeenAt["chan-a"]).toBe(49);
    expect(store.unreadCounts["chan-a"]).toBe(3);
  });
});
