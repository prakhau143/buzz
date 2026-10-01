/**
 * Phase G — context-panel ownership (features/navigation/contextPanelPolicy.ts).
 *
 * The bug: open a thread in #channel, click Inbox → Inbox rendered with the
 * old `contextPanel = thread`, and AppShell kept the details column for it: a
 * blank right third of the window. Fix: (1) leaving a view closes its panel,
 * centrally, at the router; (2) the shell only reserves the column for a panel
 * the current view owns. These tests drive a real router + the real AppShell.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { defineComponent, h, nextTick } from "vue";
import AppShell from "@/layouts/AppShell.vue";
import { useUiStore } from "@/stores/ui";
import {
  installContextPanelInvariant,
  ownedPanelKinds,
  panelShownOn,
  viewSupportsContextPanel,
} from "@/features/navigation/contextPanelPolicy";

/** A view that renders the shell with (or without) its own details content. */
const view = (name: string, details?: () => unknown) =>
  defineComponent({
    name,
    setup() {
      return () =>
        h(AppShell, null, {
          main: () => h("div", { "data-testid": `main-${name}` }, name),
          ...(details ? { details } : {}),
        });
    },
  });

const ThreadDetails = () => {
  const ui = useUiStore();
  return ui.contextPanel.kind === "thread" ? h("div", { "data-testid": "thread-panel" }, "thread") : null;
};
const ProfileDetails = () => {
  const ui = useUiStore();
  return ui.contextPanel.kind === "profile" ? h("div", { "data-testid": "profile-panel" }, "profile") : null;
};

function setup(): { router: Router; mountApp: () => ReturnType<typeof mount> } {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/channels", name: "channels", component: view("channels", ThreadDetails) },
      { path: "/dm", name: "dm", component: view("dm", ThreadDetails) },
      { path: "/inbox", name: "inbox", component: view("inbox", ProfileDetails) },
      { path: "/settings", name: "settings", component: view("settings") },
      { path: "/communities", name: "communities", component: view("communities") },
      { path: "/m/inbox", name: "mobile-inbox", component: view("mobile-inbox") },
      { path: "/m/c/:channelId", name: "mobile-channel", component: view("mobile-channel") },
    ],
  });
  installContextPanelInvariant(router, () => useUiStore().closeContextPanel());
  return { router, mountApp: () => mount(RouterView, { global: { plugins: [router] }, attachTo: document.body }) };
}

const pane = () => document.querySelector("[data-testid=details-pane]");
const handle = () => document.querySelector("[data-testid=details-resize]");

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
  // Wide desktop: the details pane is an inline, resizable grid column.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width: 1025px"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

async function go(router: Router, path: string) {
  await router.push(path);
  await flushPromises();
  await nextTick();
}

describe("policy", () => {
  it("conversations own their panels; global views own none (or only their own)", () => {
    expect(ownedPanelKinds("channels")).toEqual(["thread", "profile", "channelDetails"]);
    expect(ownedPanelKinds("dm")).toEqual(["thread", "profile"]);
    expect(ownedPanelKinds("inbox")).toEqual(["profile"]);
    for (const name of ["settings", "communities", "operator", "platform-admin", "login", undefined]) {
      expect(viewSupportsContextPanel(name)).toBe(false);
    }
    expect(panelShownOn("inbox", { kind: "thread", rootEventId: "r" })).toBe(false);
    expect(panelShownOn("channels", { kind: "thread", rootEventId: "r" })).toBe(true);
    expect(panelShownOn("channels", { kind: "none" })).toBe(false);
  });
});

describe("navigation closes the previous view's panel", () => {
  it("1/9/11. channel → thread → Inbox: full-width Inbox, no column, no resize handle", async () => {
    const { router, mountApp } = setup();
    await go(router, "/channels");
    mountApp();
    await flushPromises();
    const ui = useUiStore();
    ui.openThread("root-1");
    await nextTick();
    expect(document.querySelector("[data-testid=thread-panel]")).not.toBeNull();
    expect(pane()).not.toBeNull();
    expect(handle()).not.toBeNull();

    await go(router, "/inbox");
    expect(document.querySelector("[data-testid=main-inbox]")).not.toBeNull();
    expect(ui.contextPanel).toEqual({ kind: "none" });
    expect(pane()).toBeNull();
    expect(handle()).toBeNull();
    expect(document.querySelector(".body")?.classList.contains("thread-expanded")).toBe(false);
  });

  it("2. DM → thread → Inbox", async () => {
    const { router, mountApp } = setup();
    await go(router, "/dm");
    mountApp();
    const ui = useUiStore();
    ui.openThread("root-1");
    await go(router, "/inbox");
    expect(ui.contextPanel.kind).toBe("none");
    expect(pane()).toBeNull();
  });

  it("4/5/13/14. channel → thread → Settings / community picker: full width", async () => {
    const { router, mountApp } = setup();
    await go(router, "/channels");
    mountApp();
    const ui = useUiStore();
    for (const path of ["/settings", "/communities"]) {
      await go(router, "/channels");
      ui.openThread("root-1");
      await nextTick();
      await go(router, path);
      expect(ui.contextPanel.kind).toBe("none");
      expect(pane()).toBeNull();
    }
  });

  it("an expanded thread does not survive either", async () => {
    const { router, mountApp } = setup();
    await go(router, "/channels");
    mountApp();
    const ui = useUiStore();
    ui.openThread("root-1");
    ui.setThreadViewMode("expanded");
    await go(router, "/inbox");
    expect(ui.threadViewMode).toBe("docked");
  });

  it("6/20. thread → Inbox → channel: no stale thread comes back", async () => {
    const { router, mountApp } = setup();
    await go(router, "/channels");
    mountApp();
    const ui = useUiStore();
    ui.openThread("root-1");
    await go(router, "/inbox");
    await go(router, "/channels");
    expect(ui.contextPanel.kind).toBe("none");
    expect(pane()).toBeNull();
  });

  it("7/8. rapid thread → Inbox → channel → Inbox, and Inbox → Inbox", async () => {
    const { router, mountApp } = setup();
    await go(router, "/channels");
    mountApp();
    const ui = useUiStore();
    ui.openThread("root-1");
    const hops = [router.push("/inbox"), router.push("/channels"), router.push("/inbox")];
    await Promise.allSettled(hops);
    await flushPromises();
    await go(router, "/inbox?item=x");
    expect(ui.contextPanel.kind).toBe("none");
    expect(pane()).toBeNull();
  });

  it("a view's OWN panel stays: Inbox → open a profile → stays open while in Inbox", async () => {
    const { router, mountApp } = setup();
    await go(router, "/inbox");
    mountApp();
    const ui = useUiStore();
    ui.openProfile("a".repeat(64));
    await go(router, "/inbox?item=y"); // same view, different item
    expect(ui.contextPanel.kind).toBe("profile");
    expect(document.querySelector("[data-testid=profile-panel]")).not.toBeNull();
    expect(pane()).not.toBeNull();
  });

  it("17/18. a reveal into a thread (MessageTarget / notification) still opens it on arrival", async () => {
    const { router, mountApp } = setup();
    await go(router, "/inbox");
    mountApp();
    const ui = useUiStore();
    // The channel view opens the target's thread from its own watcher, AFTER arrival.
    await go(router, "/channels?channelId=c&threadRootId=r&messageId=m");
    ui.openThread("r");
    await nextTick();
    expect(ui.contextPanel).toEqual({ kind: "thread", rootEventId: "r" });
    expect(pane()).not.toBeNull();
  });
});

describe("10. the layout never reserves a column for a panel the view cannot show", () => {
  it("a thread panel opened while on Inbox (shared surface) takes no space", async () => {
    const { router, mountApp } = setup();
    await go(router, "/inbox");
    mountApp();
    useUiStore().openThread("r");
    await nextTick();
    expect(pane()).toBeNull();
    expect(handle()).toBeNull();
  });

  it("15/16. the resize handle exists while a thread is open in a conversation", async () => {
    const { router, mountApp } = setup();
    await go(router, "/channels");
    mountApp();
    useUiStore().openThread("r");
    await nextTick();
    expect(handle()?.getAttribute("role")).toBeTruthy();
  });
});

describe("19. mobile", () => {
  it("mobile channel → Inbox clears a thread/profile panel from the desktop state", async () => {
    const { router, mountApp } = setup();
    await go(router, "/m/c/ch");
    mountApp();
    const ui = useUiStore();
    ui.openThread("r");
    await go(router, "/m/inbox");
    expect(ui.contextPanel.kind).toBe("none");
  });
});
