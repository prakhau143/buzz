import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Found by the Phase 4 final QA (three consecutive full runs): the unit suite
 * passed 1016/1016 yet exited 1 on an uncaught
 * `ReferenceError: Cannot access 'handle' before initialization` out of
 * `fetchEventsOnce`. The timeout was armed BEFORE `subscribe()`, so when
 * subscribe threw synchronously the promise rejected (handled by the caller)
 * but the timer stayed live and, on firing, touched `handle` in its TDZ —
 * crashing seconds later in whatever happened to be running. Timing-dependent,
 * which is why a single run did not show it.
 */
const subscribe = vi.fn();
vi.mock("@/services/RelayConnectionService", () => ({
  relayConnectionService: { subscribe: (...a: unknown[]) => subscribe(...a) },
}));

const { fetchEventsOnce } = await import("@/services/relayQuery");

beforeEach(() => {
  vi.useFakeTimers();
  subscribe.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("fetchEventsOnce", () => {
  it("rejects when subscribe throws, and leaves no timer behind to fire later", async () => {
    subscribe.mockImplementation(() => {
      throw new Error("not connected");
    });

    await expect(fetchEventsOnce([{ kinds: [9] }])).rejects.toThrow("not connected");
    expect(vi.getTimerCount()).toBe(0);
    // Pre-fix this is where the ReferenceError escaped.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });

  it("resolves and closes the subscription when EOSE arrives synchronously", async () => {
    const close = vi.fn();
    subscribe.mockImplementation((_id: string, _f: unknown, h: { onEose: () => void }) => {
      h.onEose();
      return { close };
    });

    await expect(fetchEventsOnce([{ kinds: [9] }])).resolves.toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves with collected events on timeout when the relay never sends EOSE", async () => {
    const close = vi.fn();
    subscribe.mockImplementation((_id: string, _f: unknown, h: { onEvent: (e: unknown) => void }) => {
      h.onEvent({ id: "x" });
      return { close };
    });

    const pending = fetchEventsOnce([{ kinds: [9] }], { timeoutMs: 500 });
    vi.advanceTimersByTime(500);
    await expect(pending).resolves.toEqual([{ id: "x" }]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
