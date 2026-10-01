/**
 * In-app toasts: one surface per event (focused → in-app, background →
 * Windows), stacking (max 3, newest first), auto-dismiss with hover pause,
 * Esc / × dismiss, click routes to the exact target, reduced motion.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const invoke = vi.fn(async (cmd: string) => (cmd === "notification_permission" ? "granted" : undefined));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: (cmd: string, args?: unknown) => invoke(cmd, args) }));
vi.mock("@/features/profile/profileStore", () => ({ profileFor: () => null }));

const { alertIfAllowed, pickSurface } = await import("@/features/notifications/desktopNotifier");
const toastsMod = await import("@/features/notifications/inAppToasts");
const { loadNotificationSettings, updateNotificationSettings } = await import("@/features/notifications/notificationSettings");
const InAppToastStack = (await import("@/features/notifications/ui/InAppToastStack.vue")).default;
const { MAX_VISIBLE_TOASTS, TOAST_DISMISS_MS, clearInAppToasts, inAppToasts, pushInAppToast, setInAppToastOpener } = toastsMod;

const now = Math.floor(Date.now() / 1000);
const toast = (id: string) => ({
  id,
  slot: "dm" as const,
  title: `Sender ${id}`,
  body: `Body ${id}`,
  context: "Direct message",
  authorName: `Sender ${id}`,
  createdAt: now,
  target: { v: "1" as const, identity: "a".repeat(16), community: "wss://x.example", kind: "dm" as const, channelId: "dm-1", messageId: id },
});
const inApp = (id: string) => ({ id, context: "Direct message", authorName: "Rahul", createdAt: now });
let focused = true;

beforeEach(() => {
  setActivePinia(createPinia());
  clearInAppToasts();
  invoke.mockClear();
  loadNotificationSettings(null);
  updateNotificationSettings({ soundEnabled: false });
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  window.HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
});
afterEach(() => vi.useRealTimers());

describe("surface selection (no duplicates)", () => {
  it("focused → in-app; background → Windows; never both", async () => {
    expect(pickSurface(true, true)).toBe("in-app");
    expect(pickSurface(false, true)).toBe("native");
    expect(pickSurface(true, false)).toBe("native"); // e.g. Settings → Test

    const shown = await alertIfAllowed({ slot: "dm", title: "Rahul", body: "hi", viewing: false, inApp: inApp("e1") });
    expect(shown).toBe("in-app");
    expect(inAppToasts.value.map((t) => t.id)).toEqual(["e1"]);
    expect(invoke).not.toHaveBeenCalledWith("show_notification", expect.anything());

    focused = false;
    const bg = await alertIfAllowed({ slot: "dm", title: "Rahul", body: "hi", viewing: false, inApp: inApp("e2") });
    expect(bg).toBe("native");
    expect(invoke).toHaveBeenCalledWith("show_notification", expect.objectContaining({ title: "Rahul", body: "hi" }));
    expect(inAppToasts.value.map((t) => t.id)).toEqual(["e1"]); // not also in-app
  });

  it("settings govern both surfaces", async () => {
    updateNotificationSettings({ desktopEnabled: false });
    expect(await alertIfAllowed({ slot: "dm", title: "R", body: "b", viewing: false, inApp: inApp("x") })).toBeNull();
    updateNotificationSettings({ desktopEnabled: true, slots: { dm: false } });
    expect(await alertIfAllowed({ slot: "dm", title: "R", body: "b", viewing: false, inApp: inApp("y") })).toBeNull();
    updateNotificationSettings({ slots: { dm: true } });
    // Notify while viewing OFF: the open conversation stays quiet while focused.
    expect(await alertIfAllowed({ slot: "dm", title: "R", body: "b", viewing: true, inApp: inApp("z") })).toBeNull();
    expect(inAppToasts.value).toHaveLength(0);
  });

  it("the Settings test always uses the real Windows path", async () => {
    const shown = await alertIfAllowed({ slot: "mention", title: "SWF Buzz", body: "This is how alerts will look.", viewing: false });
    expect(shown).toBe("native");
    expect(invoke).toHaveBeenCalledWith("show_notification", expect.anything());
  });

  it("the same event never stacks twice", () => {
    pushInAppToast(toast("a"));
    pushInAppToast(toast("a"));
    expect(inAppToasts.value).toHaveLength(1);
  });
});

describe("InAppToastStack", () => {
  const mountStack = () => mount(InAppToastStack, { attachTo: document.body });

  it("stacks newest first, max 3 visible", async () => {
    const w = mountStack();
    for (const id of ["1", "2", "3", "4"]) pushInAppToast(toast(id));
    await w.vm.$nextTick();
    const titles = w.findAll("[data-testid=in-app-toast] .toast-title").map((t) => t.text());
    expect(MAX_VISIBLE_TOASTS).toBe(3);
    expect(titles).toEqual(["Sender 4", "Sender 3", "Sender 2"]);
    w.unmount();
  });

  it("shows sender, preview, context and time", async () => {
    const w = mountStack();
    pushInAppToast(toast("1"));
    await w.vm.$nextTick();
    const card = w.find("[data-testid=in-app-toast]");
    expect(card.text()).toContain("Sender 1");
    expect(card.text()).toContain("Body 1");
    expect(card.text()).toContain("Direct message · just now");
    w.unmount();
  });

  it("auto-dismisses after ~6 s, paused while hovered", async () => {
    vi.useFakeTimers();
    const w = mountStack();
    pushInAppToast(toast("1"));
    await w.vm.$nextTick();
    await w.find("[data-testid=in-app-toast]").trigger("mouseenter");
    vi.advanceTimersByTime(TOAST_DISMISS_MS + 1000);
    expect(inAppToasts.value).toHaveLength(1); // hovered: stays
    await w.find("[data-testid=in-app-toast]").trigger("mouseleave");
    vi.advanceTimersByTime(TOAST_DISMISS_MS);
    expect(inAppToasts.value).toHaveLength(0);
    w.unmount();
  });

  it("× and Esc dismiss; Esc does not reach the page (a thread stays open)", async () => {
    const w = mountStack();
    pushInAppToast(toast("1"));
    pushInAppToast(toast("2"));
    await w.vm.$nextTick();
    await w.find("[data-testid=in-app-toast-close]").trigger("click");
    expect(inAppToasts.value.map((t) => t.id)).toEqual(["1"]);
    const pageEsc = vi.fn();
    document.addEventListener("keydown", pageEsc);
    await w.find("[data-testid=in-app-toast]").trigger("keydown", { key: "Escape" });
    expect(inAppToasts.value).toHaveLength(0);
    expect(pageEsc).not.toHaveBeenCalled();
    document.removeEventListener("keydown", pageEsc);
    w.unmount();
  });

  it("click opens the exact target (DM / thread) through the session router, then dismisses", async () => {
    const opened = vi.fn();
    setInAppToastOpener(opened);
    const w = mountStack();
    const t = toast("m1");
    t.target = { ...t.target, kind: "dm", messageId: "m1" };
    pushInAppToast(t);
    await w.vm.$nextTick();
    await w.find("[data-testid=in-app-toast-open]").trigger("click");
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ kind: "dm", channelId: "dm-1", messageId: "m1" }));
    expect(inAppToasts.value).toHaveLength(0);
    setInAppToastOpener(null);
    w.unmount();
  });

  it("never blocks the app: the stack ignores pointer events, only cards take them; reduced motion is instant", () => {
    const src = readFileSync(join(process.cwd(), "src/features/notifications/ui/InAppToastStack.vue"), "utf8");
    expect(src).toMatch(/\.toast-stack \{[^}]*pointer-events: none/);
    expect(src).toMatch(/\.toast \{[^}]*pointer-events: auto/);
    expect(src).toMatch(/max-width|min\(380px, calc\(100vw - 32px\)\)/);
    expect(src).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.toast-enter-active/);
  });
});
