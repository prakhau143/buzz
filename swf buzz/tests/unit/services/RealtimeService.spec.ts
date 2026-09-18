import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getStoredSessionTokenMock = vi.fn();
vi.mock("@/services/ApiClient", () => ({
  getStoredSessionToken: () => getStoredSessionTokenMock(),
}));

/** A controllable fake WebSocket — real event-driven behavior, no network. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  triggerOpen() {
    this.onopen?.();
  }
  triggerMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  triggerClose() {
    this.onclose?.();
  }
}

describe("RealtimeService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getStoredSessionTokenMock.mockReset();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not open a socket when there is no stored session token", async () => {
    getStoredSessionTokenMock.mockResolvedValueOnce(null);
    const { realtimeService } = await import("@/services/RealtimeService");

    await realtimeService.connect();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(realtimeService.status).toBe("disconnected");
  });

  it("connects with the token as a ?token= query param and reaches 'connected' on open", async () => {
    getStoredSessionTokenMock.mockResolvedValue("tok-123");
    const { realtimeService } = await import("@/services/RealtimeService");

    await realtimeService.connect();
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toContain("token=tok-123");
    expect(socket.url).toContain("/ws?");

    socket.triggerOpen();
    expect(realtimeService.status).toBe("connected");

    realtimeService.disconnect();
  });

  it("dispatches a parsed event to every registered listener", async () => {
    getStoredSessionTokenMock.mockResolvedValue("tok-123");
    const { realtimeService } = await import("@/services/RealtimeService");
    await realtimeService.connect();
    const socket = FakeWebSocket.instances[0];
    socket.triggerOpen();

    const received: unknown[] = [];
    const unsubscribe = realtimeService.onEvent((e) => received.push(e));

    socket.triggerMessage({ type: "message.created", channel_id: "ch1", message: { id: "m1" } });

    expect(received).toEqual([{ type: "message.created", channel_id: "ch1", message: { id: "m1" } }]);
    unsubscribe();
    realtimeService.disconnect();
  });

  it("schedules a reconnect with capped exponential backoff after an unexpected close", async () => {
    getStoredSessionTokenMock.mockResolvedValue("tok-123");
    const { realtimeService } = await import("@/services/RealtimeService");
    await realtimeService.connect();
    FakeWebSocket.instances[0].triggerOpen();

    FakeWebSocket.instances[0].triggerClose();
    expect(realtimeService.status).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(1000); // base backoff
    expect(FakeWebSocket.instances).toHaveLength(2);

    realtimeService.disconnect();
  });

  it("disconnect() prevents any scheduled reconnect from firing", async () => {
    getStoredSessionTokenMock.mockResolvedValue("tok-123");
    const { realtimeService } = await import("@/services/RealtimeService");
    await realtimeService.connect();
    FakeWebSocket.instances[0].triggerOpen();
    FakeWebSocket.instances[0].triggerClose();

    realtimeService.disconnect();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(FakeWebSocket.instances).toHaveLength(1); // no second socket ever opened
  });

  it("reconnect() tears down the current socket and opens a fresh one", async () => {
    getStoredSessionTokenMock.mockResolvedValue("tok-123");
    const { realtimeService } = await import("@/services/RealtimeService");
    await realtimeService.connect();
    const first = FakeWebSocket.instances[0];
    first.triggerOpen();

    await realtimeService.reconnect();

    expect(first.closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    realtimeService.disconnect();
  });
});
