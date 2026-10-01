/**
 * Expanded thread (docs/THREAD_EXPANDED_VIEW.md): docked ⇄ expanded layout
 * mode, the conversation staying visible and usable, the one divider still
 * resizing horizontally, and the docked width surviving an expand/restore.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  EXPANDED_MAIN_MIN_WIDTH,
  PANEL_SPECS,
  fitExpandedThread,
  panelStorageKey,
  resetPanelWidthsForTest,
} from "@/features/layout/panelSizing";
import { SHORTCUTS } from "@/features/shortcuts/shortcutRegistry";
import { useUiStore } from "@/stores/ui";

vi.mock("@/features/threads/useThread", () => ({
  useThread: () => ({
    data: ref({ root: null, replies: [] }),
    isLoading: ref(false),
    isError: ref(false),
    refetch: vi.fn(),
  }),
}));
vi.mock("@/features/messages/useSendMessage", () => ({
  useSendMessage: () => ({ send: vi.fn(), isSending: ref(false), error: ref(null) }),
}));
const AppShell = (await import("@/layouts/AppShell.vue")).default;
const ThreadPanel = (await import("@/components/ThreadPanel.vue")).default;

/** jsdom has no layout: report a real window width to AppShell's observer. */
let observedWidth = 1440;
class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe() {
    this.cb([{ contentRect: { width: observedWidth } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  disconnect() {}
  unobserve() {}
}

function pointer(type: string, clientX: number, clientY = 0) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(e, "pointerId", { value: 1 });
  Object.defineProperty(e, "isPrimary", { value: true });
  return e;
}

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  resetPanelWidthsForTest();
  observedWidth = 1440;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe("thread view mode (ui store)", () => {
  it("defaults to docked, and a fresh session always starts docked (never persisted)", () => {
    const ui = useUiStore();
    ui.openThread("root");
    expect(ui.threadViewMode).toBe("docked");
    ui.setThreadViewMode("expanded");
    expect(ui.threadViewMode).toBe("expanded");
    setActivePinia(createPinia()); // "restart"
    const fresh = useUiStore();
    fresh.openThread("root");
    expect(fresh.threadViewMode).toBe("docked");
    expect(JSON.stringify({ ...localStorage })).not.toContain("expanded");
  });

  it("toggle expands and restores", () => {
    const ui = useUiStore();
    ui.openThread("root");
    ui.toggleThreadExpanded();
    expect(ui.threadViewMode).toBe("expanded");
    ui.toggleThreadExpanded();
    expect(ui.threadViewMode).toBe("docked");
  });

  it("only a thread can be expanded; leaving the thread resets to docked", () => {
    const ui = useUiStore();
    ui.setThreadViewMode("expanded");
    expect(ui.threadViewMode).toBe("docked"); // nothing open
    ui.openThread("root");
    ui.setThreadViewMode("expanded");
    ui.openProfile("pk");
    expect(ui.threadViewMode).toBe("docked");
    ui.openThread("root");
    expect(ui.threadViewMode).toBe("docked"); // next thread opens docked
    ui.setThreadViewMode("expanded");
    ui.closeContextPanel();
    ui.openThread("root");
    expect(ui.threadViewMode).toBe("docked");
    ui.setThreadViewMode("expanded");
    ui.resetForSignOut();
    expect(ui.threadExpanded).toBe(false);
  });

  it("opening another thread while expanded stays expanded", () => {
    const ui = useUiStore();
    ui.openThread("a");
    ui.setThreadViewMode("expanded");
    ui.openThread("b");
    expect(ui.threadViewMode).toBe("expanded");
  });
});

describe("expanded sizing", () => {
  it("1440 with a 260px sidebar: conversation ~28%, thread the rest", () => {
    const fit = fitExpandedThread(1440, 260, null);
    const main = 1440 - 260 - fit.thread;
    expect(main).toBeGreaterThanOrEqual(EXPANDED_MAIN_MIN_WIDTH);
    expect(main).toBe(Math.round((1440 - 260) * 0.28));
    expect(fit.thread).toBeGreaterThan(800);
  });

  it("never lets the thread take the conversation below its minimum", () => {
    for (const total of [1710, 1440, 1280, 1100]) {
      const fit = fitExpandedThread(total, 260, 5000);
      expect(fit.thread).toBe(fit.max);
      expect(total - 260 - fit.max).toBeGreaterThanOrEqual(EXPANDED_MAIN_MIN_WIDTH);
    }
  });

  it("a chosen width is kept within [min, max]", () => {
    expect(fitExpandedThread(1440, 260, 700).thread).toBe(700);
    expect(fitExpandedThread(1440, 260, 10).thread).toBe(PANEL_SPECS.details.min);
  });

  it("a tight window squeezes the sidebar first, never the conversation floor", () => {
    const fit = fitExpandedThread(800, 420, null);
    expect(fit.sidebar).toBeLessThan(420);
    expect(800 - (fit.sidebar ?? 0) - fit.thread).toBeGreaterThanOrEqual(EXPANDED_MAIN_MIN_WIDTH);
  });
});

describe("AppShell in expanded mode", () => {
  const mountShell = () =>
    mount(AppShell, {
      slots: {
        sidebar: "<nav>side</nav>",
        main: `<div class="feed"><div data-message-id="m1"><p class="text">hello</p></div><button class="act">React</button><div class="gap">empty</div></div>`,
        details: "<div>thread</div>",
      },
      attachTo: document.body,
    });
  const body = (w: ReturnType<typeof mountShell>) => w.find(".body").element as HTMLElement;
  const detailsWidth = (w: ReturnType<typeof mountShell>) => body(w).style.getPropertyValue("--shell-details-width");

  it("expands toward the left while the conversation column stays rendered", async () => {
    const w = mountShell();
    const ui = useUiStore();
    ui.openThread("root");
    await w.vm.$nextTick();
    expect(detailsWidth(w)).toBe("300px");
    ui.setThreadViewMode("expanded");
    await w.vm.$nextTick();
    const expected = fitExpandedThread(1440, 260, null).thread;
    expect(detailsWidth(w)).toBe(`${expected}px`);
    expect(w.find("[data-testid=main-pane]").isVisible()).toBe(true);
    expect(w.find("[data-testid=main-pane]").text()).toContain("hello");
    expect(w.find("[data-testid=details-pane]").classes()).toContain("expanded");
    expect(body(w).classList.contains("thread-expanded")).toBe(true);
    w.unmount();
  });

  it("the conversation stays interactive: messages and buttons do not collapse the thread", async () => {
    const w = mountShell();
    const ui = useUiStore();
    ui.openThread("root");
    ui.setThreadViewMode("expanded");
    await w.vm.$nextTick();
    const onAct = vi.fn();
    w.find(".act").element.addEventListener("click", onAct);
    await w.find(".act").trigger("click");
    expect(onAct).toHaveBeenCalled(); // the action ran
    await w.find(".text").trigger("click");
    expect(ui.threadViewMode).toBe("expanded");
    // Clicking empty conversation space restores the docked layout.
    await w.find(".gap").trigger("click");
    expect(ui.threadViewMode).toBe("docked");
    w.unmount();
  });

  it("the same divider resizes the expanded thread horizontally (clientX), without touching the docked width", async () => {
    localStorage.setItem(panelStorageKey("details"), "420");
    resetPanelWidthsForTest();
    const w = mountShell();
    const ui = useUiStore();
    ui.openThread("root");
    await w.vm.$nextTick();
    expect(detailsWidth(w)).toBe("420px");
    ui.setThreadViewMode("expanded");
    await w.vm.$nextTick();
    const start = fitExpandedThread(1440, 260, null).thread;
    const el = w.find("[data-testid=details-resize]").element as HTMLElement;
    // Divider on the thread's LEFT edge: dragging left widens, right narrows.
    el.dispatchEvent(pointer("pointerdown", 500, 10));
    el.dispatchEvent(pointer("pointermove", 450, 400)); // a big clientY change must not matter
    await w.vm.$nextTick();
    expect(detailsWidth(w)).toBe(`${Math.min(start + 50, fitExpandedThread(1440, 260, null).max)}px`);
    el.dispatchEvent(pointer("pointermove", 700, 10));
    await w.vm.$nextTick();
    expect(detailsWidth(w)).toBe(`${start - 200}px`);
    el.dispatchEvent(pointer("pointerup", 700, 10));
    expect(localStorage.getItem(panelStorageKey("details"))).toBe("420"); // expanded width is not persisted
    // Restore → the previous docked width.
    ui.setThreadViewMode("docked");
    await w.vm.$nextTick();
    expect(detailsWidth(w)).toBe("420px");
    w.unmount();
  });

  it("dragging can't push the conversation below its floor", async () => {
    const w = mountShell();
    const ui = useUiStore();
    ui.openThread("root");
    ui.setThreadViewMode("expanded");
    await w.vm.$nextTick();
    const el = w.find("[data-testid=details-resize]").element as HTMLElement;
    el.dispatchEvent(pointer("pointerdown", 500));
    el.dispatchEvent(pointer("pointermove", -2000));
    el.dispatchEvent(pointer("pointerup", -2000));
    await w.vm.$nextTick();
    const width = parseInt(detailsWidth(w), 10);
    expect(1440 - 260 - width).toBe(EXPANDED_MAIN_MIN_WIDTH);
    w.unmount();
  });
});

describe("ThreadPanel header", () => {
  const mountPanel = () => {
    const ui = useUiStore();
    ui.openThread("root");
    return mount(ThreadPanel, {
      props: { rootEventId: "root", channelId: "c1", channelName: "general" },
      attachTo: document.body,
      // MessageComposer reads Vue Query; give it a client (no network is used).
      global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } }) }]] },
    });
  };

  it("the expand button sits LEFT of the thread title, close on the right", () => {
    const w = mountPanel();
    const header = w.find(".thread-header").element;
    const order = [...header.children].map((c) => c.getAttribute("data-testid"));
    expect(order).toEqual(["thread-expand", "thread-heading", "thread-close"]);
    w.unmount();
  });

  it("a real, labelled button toggles expand / restore (Enter/Space are native to <button>)", async () => {
    const w = mountPanel();
    const btn = w.find("[data-testid=thread-expand]");
    expect(btn.element.tagName).toBe("BUTTON");
    expect(btn.attributes("type")).toBe("button");
    expect(btn.attributes("aria-label")).toBe("Expand thread");
    expect(btn.attributes("title")).toContain("Expand thread");
    await btn.trigger("click");
    expect(useUiStore().threadViewMode).toBe("expanded");
    expect(btn.attributes("aria-label")).toBe("Restore thread");
    // Same element in both modes, so focus stays on it after Restore.
    (btn.element as HTMLButtonElement).focus();
    await btn.trigger("click");
    expect(useUiStore().threadViewMode).toBe("docked");
    expect(document.activeElement).toBe(btn.element);
    w.unmount();
  });

  it("Escape restores an expanded thread first, then closes a docked one", async () => {
    const w = mountPanel();
    useUiStore().setThreadViewMode("expanded");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(useUiStore().threadViewMode).toBe("docked");
    expect(w.emitted("close")).toBeUndefined();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.emitted("close")).toHaveLength(1);
    w.unmount();
  });

  it("the composer and the thread body are the same instances in both modes (scroll kept)", async () => {
    const w = mountPanel();
    const bodyBefore = w.find(".thread-body").element;
    await w.find("[data-testid=thread-expand]").trigger("click");
    expect(w.find(".thread-body").element).toBe(bodyBefore);
    expect(w.find("textarea, [contenteditable], .composer, form").exists()).toBe(true);
    w.unmount();
  });

  it("Ctrl+Shift+E is registered and conflicts with no other shortcut", () => {
    const def = SHORTCUTS.find((s) => s.id === "toggle-thread-expanded")!;
    const e = new KeyboardEvent("keydown", { key: "E", ctrlKey: true, shiftKey: true });
    expect(def.matches!(e, false)).toBe(true);
    const others = SHORTCUTS.filter((s) => s.id !== def.id && s.matches?.(e, false));
    expect(others).toEqual([]);
  });
});

describe("guards", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("no modal: no full-viewport fixed thread, no blocking backdrop, no disabled conversation", () => {
    const shell = src("src/layouts/AppShell.vue");
    const expandedCss = shell.slice(shell.indexOf("Expanded thread (docs/THREAD_EXPANDED_VIEW.md) ---- */"));
    expect(expandedCss.slice(0, 1200)).not.toMatch(/100vw|pointer-events:\s*none|backdrop-filter/);
    expect(shell).toMatch(/\.body\.thread-expanded \.main-pane \{\s*opacity: 0\.92/);
  });
  it("reduced motion switches instantly", () => {
    const shell = src("src/layouts/AppShell.vue");
    expect(shell).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.body\.switching/);
  });
  it("the expand button hides on phones, where the thread is already full-screen", () => {
    expect(src("src/components/ThreadPanel.vue")).toMatch(/max-width: 768px\)\s*\{\s*\.expand-btn\s*\{\s*display: none/);
  });
});
