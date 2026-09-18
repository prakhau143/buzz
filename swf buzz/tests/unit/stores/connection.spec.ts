import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionStore } from "@/stores/connection";

describe("useConnectionStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in the connecting state", () => {
    const store = useConnectionStore();
    expect(store.status).toBe("connecting");
    expect(store.isUsable).toBe(false);
  });

  it("resets reconnectAttempt when connected", () => {
    const store = useConnectionStore();
    store.incrementReconnectAttempt();
    store.incrementReconnectAttempt();
    expect(store.reconnectAttempt).toBe(2);

    store.setStatus("connected");
    expect(store.status).toBe("connected");
    expect(store.isUsable).toBe(true);
    expect(store.reconnectAttempt).toBe(0);
  });

  it("records lastError and leaves reconnectAttempt untouched on non-connected status", () => {
    const store = useConnectionStore();
    store.incrementReconnectAttempt();
    store.setStatus("error", "network down");
    expect(store.lastError).toBe("network down");
    expect(store.reconnectAttempt).toBe(1);
    expect(store.isUsable).toBe(false);
  });
});
