/**
 * The grow-only guarantee for the RELAY-HOSTED frontier.
 *
 * `publishReadState` is a transport: NIP-33 addressable semantics mean it
 * replaces our coordinate with whatever it is handed, including a lower value.
 * That is correct for the service. The guarantee that we never *hand* it a
 * rewind therefore has to live here, in the store.
 *
 * It did not. `markUnreadFrom` rewinds `lastSeenAt[channel]` locally (by
 * design — see the store's own comment), but `publishFrontier` published the
 * whole `lastSeenAt` map, so the next advance in ANY other channel shipped the
 * rewound value to the relay. Caught by the real-relay E2E in
 * `tests/integration/readState.e2e.spec.ts`; pinned here at the layer that owns
 * the invariant, because a unit test can state it precisely and cheaply.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const publishReadState = vi.fn(async () => {});
const fetchReadState = vi.fn(async () => ({ contexts: {}, hydrated: true }));

vi.mock("@/services/ReadStateService", () => ({
  publishReadState: (...args: unknown[]) => publishReadState(...(args as [])),
  fetchReadState: (...args: unknown[]) => fetchReadState(...(args as [])),
}));

vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ pubkey: "a".repeat(64) }),
}));

import { useReadStateStore } from "@/stores/readState";

function lastPublishedContexts(): Record<string, number> {
  const calls = publishReadState.mock.calls;
  return (calls[calls.length - 1] as unknown as [string, Record<string, number>])[1];
}

beforeEach(() => {
  setActivePinia(createPinia());
  publishReadState.mockClear();
  fetchReadState.mockClear();
  localStorage.clear();
});

describe("read state — the published frontier is grow-only", () => {
  it("publishes an advance", async () => {
    const store = useReadStateStore();
    store.markChannelSeen("channel-a", 1_700_000_500);
    await vi.waitFor(() => expect(publishReadState).toHaveBeenCalled());
    expect(lastPublishedContexts()["channel-a"]).toBe(1_700_000_500);
  });

  it("a local mark-unread is NOT published, even via a later advance elsewhere", async () => {
    const store = useReadStateStore();

    store.markChannelSeen("channel-a", 1_700_000_500);
    await vi.waitFor(() => expect(publishReadState).toHaveBeenCalled());
    publishReadState.mockClear();

    // Rewind channel-a locally. This must stay on this device.
    store.markUnreadFrom("channel-a", 1_600_000_000, 3);
    expect(store.lastSeenAt["channel-a"]).toBe(1_599_999_999);

    // An unrelated channel advances, which triggers a publish of the frontier.
    store.markChannelSeen("channel-b", 1_700_000_900);
    await vi.waitFor(() => expect(publishReadState).toHaveBeenCalled());

    const published = lastPublishedContexts();
    expect(published["channel-b"]).toBe(1_700_000_900);
    // The rewind must not have ridden along.
    expect(published["channel-a"]).toBe(1_700_000_500);
  });

  it("hydrating from the relay raises the published frontier", async () => {
    fetchReadState.mockResolvedValueOnce({
      contexts: { "channel-c": 1_800_000_000 },
      hydrated: true,
    });
    const store = useReadStateStore();
    await store.hydrateFromRelay();

    store.markChannelSeen("channel-d", 1_700_000_100);
    await vi.waitFor(() => expect(publishReadState).toHaveBeenCalled());

    // The hydrated value is part of what we publish, not dropped.
    expect(lastPublishedContexts()["channel-c"]).toBe(1_800_000_000);
  });

  it("local state still shows the rewind to the user", async () => {
    const store = useReadStateStore();
    store.markChannelSeen("channel-a", 1_700_000_500);
    store.markUnreadFrom("channel-a", 1_600_000_000, 2);

    // The UI reads lastSeenAt — mark-unread must still work locally.
    expect(store.lastSeenFor("channel-a")).toBe(1_599_999_999);
    expect(store.unreadCounts["channel-a"]).toBe(2);
  });
});
