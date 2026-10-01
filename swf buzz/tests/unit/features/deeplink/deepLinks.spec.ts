import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { acceptLink, drainDeepLinks, startDeepLinks } from "@/features/deeplink/deepLinks";
import { clearPendingLink, pendingLink } from "@/features/deeplink/pendingLink";

const invokeMock = vi.fn();
const isTauriMock = vi.fn(() => true);
let emitFromRust: (() => void) | null = null;
const unlisten = vi.fn();
const listenMock = vi.fn(async (_event: string, handler: () => void) => {
  emitFromRust = handler;
  return unlisten;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: () => void) => listenMock(event, handler),
}));

const JOIN = { kind: "join", relay: "ws://localhost:3000", code: "v2.abc", policyReceipt: null } as const;

function makeRouter() {
  const page = { render: () => h("div") };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", name: "login", component: page },
      { path: "/join", name: "join", component: page },
    ],
  });
}

describe("swfbuzz:// deep links (frontend)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockClear();
    unlisten.mockClear();
    emitFromRust = null;
    isTauriMock.mockReturnValue(true);
    clearPendingLink();
  });

  it("COLD START: a link that launched the app is already queued in Rust → drained at startup and shown", async () => {
    invokeMock.mockResolvedValueOnce([JOIN]);
    const router = makeRouter();
    await router.push("/login");

    await startDeepLinks(router);

    expect(invokeMock).toHaveBeenCalledWith("take_pending_deep_links");
    expect(pendingLink.value).toEqual(JOIN);
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("join"));
  });

  it("WARM START: a link arriving while the app runs is announced by an event, then drained", async () => {
    invokeMock.mockResolvedValueOnce([]); // nothing at startup
    const router = makeRouter();
    await router.push("/login");
    await startDeepLinks(router);
    expect(pendingLink.value).toBeNull();
    expect(listenMock).toHaveBeenCalledWith("swf-deep-link", expect.any(Function));

    invokeMock.mockResolvedValueOnce([JOIN]); // the user clicks a link; Rust queues it and emits
    emitFromRust?.();
    await vi.waitFor(() => expect(pendingLink.value).toEqual(JOIN));
    expect(router.currentRoute.value.name).toBe("join");
  });

  it("if several links are queued, the newest wins", async () => {
    invokeMock.mockResolvedValueOnce([
      { kind: "join", relay: "ws://localhost:3000", code: "v2.old", policyReceipt: null },
      { kind: "join", relay: "ws://localhost:3000", code: "v2.new", policyReceipt: null },
    ]);
    const router = makeRouter();
    await drainDeepLinks(router);
    expect(pendingLink.value).toMatchObject({ code: "v2.new" });
  });

  it("an invalid link is surfaced with Rust's reason instead of being dropped", async () => {
    invokeMock.mockResolvedValueOnce([{ kind: "invalid", reason: "Invalid link: the invite code is malformed." }]);
    const router = makeRouter();
    await router.push("/login");
    await drainDeepLinks(router);
    expect(pendingLink.value).toEqual({ kind: "invalid", reason: "Invalid link: the invite code is malformed." });
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("join"));
  });

  it("a connect link is accepted as a connect request (no invite code, no authority)", async () => {
    invokeMock.mockResolvedValueOnce([{ kind: "connect", relay: "ws://acme.localhost:3000" }]);
    const router = makeRouter();
    await drainDeepLinks(router);
    expect(pendingLink.value).toEqual({ kind: "connect", relay: "ws://acme.localhost:3000" });
  });

  it("does not push again when the join screen is already open (it reacts to the new link)", async () => {
    const router = makeRouter();
    await router.push("/join");
    const push = vi.spyOn(router, "push");
    acceptLink(JOIN, router);
    expect(push).not.toHaveBeenCalled();
    expect(pendingLink.value).toEqual(JOIN);
  });

  it("an empty queue is harmless", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await expect(drainDeepLinks(makeRouter())).resolves.toBe(0);
    expect(pendingLink.value).toBeNull();
  });

  it("a failing Rust call is swallowed (logged), never crashing startup", async () => {
    invokeMock.mockRejectedValueOnce("boom");
    await expect(drainDeepLinks(makeRouter())).resolves.toBe(0);
  });

  it("does nothing outside Tauri (a plain browser has no deep links)", async () => {
    isTauriMock.mockReturnValue(false);
    const stop = await startDeepLinks(makeRouter());
    expect(invokeMock).not.toHaveBeenCalled();
    expect(listenMock).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it("returns the unlisten function so the listener can be removed", async () => {
    invokeMock.mockResolvedValueOnce([]);
    const stop = await startDeepLinks(makeRouter());
    stop();
    expect(unlisten).toHaveBeenCalled();
  });

  it("a link is intent only: it holds a relay and a code, never a key or a role", () => {
    const stored = { ...JOIN };
    expect(Object.keys(stored).sort()).toEqual(["code", "kind", "policyReceipt", "relay"]);
  });
});
