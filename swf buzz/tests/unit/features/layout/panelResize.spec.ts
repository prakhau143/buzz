/**
 * Vertical dividers, horizontal drag (docs/PANEL_RESIZE_IMPLEMENTATION.md):
 * the sizing model, the shared handle, and the AppShell / Inbox wiring.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import {
  MAIN_MIN_WIDTH,
  PANEL_SPECS,
  availableMax,
  clampPanel,
  dragWidth,
  fitShellPanels,
  keyWidth,
  panelStorageKey,
  persistPanelWidth,
  resetPanelWidthsForTest,
  usePanelWidth,
} from "@/features/layout/panelSizing";
import PanelResizeHandle from "@/features/layout/ui/PanelResizeHandle.vue";
import AppShell from "@/layouts/AppShell.vue";
import { useUiStore } from "@/stores/ui";

beforeEach(() => {
  localStorage.clear();
  resetPanelWidthsForTest();
  document.body.className = "";
});

/** jsdom's PointerEvent support varies — build one from a MouseEvent. */
function pointer(type: string, clientX: number, extra: Partial<{ clientY: number; button: number; pointerId: number; isPrimary: boolean }> = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: extra.clientY ?? 0, button: extra.button ?? 0 });
  Object.defineProperty(e, "pointerId", { value: extra.pointerId ?? 1 });
  Object.defineProperty(e, "isPrimary", { value: extra.isPrimary ?? true });
  return e;
}

describe("sizing model", () => {
  it("defaults match the pre-resizer layout and are inside their bounds", () => {
    expect(PANEL_SPECS.sidebar.default).toBe(260);
    expect(PANEL_SPECS.details.default).toBe(300);
    expect(PANEL_SPECS.inboxList.default).toBe(365);
    for (const s of Object.values(PANEL_SPECS)) {
      expect(s.min).toBeLessThanOrEqual(s.default);
      expect(s.default).toBeLessThanOrEqual(s.max);
    }
  });

  it("clamps to min/max and rejects junk", () => {
    expect(clampPanel("sidebar", 50)).toBe(PANEL_SPECS.sidebar.min);
    expect(clampPanel("sidebar", 9999)).toBe(PANEL_SPECS.sidebar.max);
    expect(clampPanel("sidebar", NaN)).toBe(PANEL_SPECS.sidebar.default);
    expect(clampPanel("details", 333.6)).toBe(334);
  });

  it("drag math is horizontal and edge-aware", () => {
    expect(dragWidth(260, 100, 150, "end")).toBe(310); // left panel, drag right → wider
    expect(dragWidth(300, 800, 750, "start")).toBe(350); // right panel, drag left → wider
    expect(dragWidth(300, 800, 850, "start")).toBe(250);
  });

  it("keyboard: arrows move the divider ±10 / Shift ±50, Home/End to the bounds", () => {
    expect(keyWidth("ArrowRight", false, 260, 200, 420, "end")).toBe(270);
    expect(keyWidth("ArrowLeft", true, 260, 200, 420, "end")).toBe(210);
    expect(keyWidth("ArrowLeft", false, 300, 280, 640, "start")).toBe(310); // divider left = right panel wider
    expect(keyWidth("ArrowRight", true, 300, 280, 640, "start")).toBe(280); // clamped
    expect(keyWidth("Home", false, 300, 280, 640, "start")).toBe(280);
    expect(keyWidth("End", false, 300, 280, 640, "start")).toBe(640);
    expect(keyWidth("ArrowUp", false, 300, 280, 640, "start")).toBeNull(); // not a horizontal key
    expect(keyWidth("Enter", false, 300, 280, 640, "start")).toBeNull();
  });

  it("keeps the conversation column at its minimum, details giving way first", () => {
    // 1100px, sidebar 420 + details 640 wanted → main must still get 360.
    const fit = fitShellPanels(1100, 420, 640);
    expect(fit.details).toBe(1100 - 420 - MAIN_MIN_WIDTH);
    expect(fit.sidebar).toBe(420);
    // So tight that details hits its min — the sidebar gives the rest.
    const tight = fitShellPanels(900, 420, 640);
    expect(tight.details).toBe(PANEL_SPECS.details.min);
    expect(tight.sidebar).toBe(900 - PANEL_SPECS.details.min - MAIN_MIN_WIDTH);
    // Never below a panel's own min.
    const tiny = fitShellPanels(600, 420, 640);
    expect(tiny).toEqual({ sidebar: PANEL_SPECS.sidebar.min, details: PANEL_SPECS.details.min });
    // Plenty of room: untouched; hidden panels stay null.
    expect(fitShellPanels(1710, 300, 400)).toEqual({ sidebar: 300, details: 400 });
    expect(fitShellPanels(1710, 300, null)).toEqual({ sidebar: 300, details: null });
  });

  it("availableMax leaves room for the rest, never below min", () => {
    expect(availableMax("sidebar", 1710, 300 + MAIN_MIN_WIDTH)).toBe(PANEL_SPECS.sidebar.max);
    expect(availableMax("sidebar", 1000, 300 + MAIN_MIN_WIDTH)).toBe(340);
    expect(availableMax("sidebar", 500, 300 + MAIN_MIN_WIDTH)).toBe(PANEL_SPECS.sidebar.min);
    expect(availableMax("sidebar", 0, 0)).toBe(PANEL_SPECS.sidebar.max); // unmeasured
  });
});

describe("persistence (device-local)", () => {
  it("reads the saved width, clamped; defaults when missing or corrupt", () => {
    localStorage.setItem(panelStorageKey("sidebar"), "9999");
    expect(usePanelWidth("sidebar").width.value).toBe(PANEL_SPECS.sidebar.max);
    localStorage.setItem(panelStorageKey("details"), "garbage");
    expect(usePanelWidth("details").width.value).toBe(PANEL_SPECS.details.default);
  });

  it("migrates the old Inbox key", () => {
    localStorage.setItem("swf-buzz:inbox-list-width", "410");
    expect(usePanelWidth("inboxList").width.value).toBe(410);
  });

  it("set() is live only; commit() persists; reset() restores the default and persists", () => {
    const p = usePanelWidth("sidebar");
    p.set(333);
    expect(p.width.value).toBe(333);
    expect(localStorage.getItem(panelStorageKey("sidebar"))).toBeNull();
    p.commit();
    expect(localStorage.getItem(panelStorageKey("sidebar"))).toBe("333");
    p.reset();
    expect(p.width.value).toBe(260);
    expect(localStorage.getItem(panelStorageKey("sidebar"))).toBe("260");
  });

  it("is one shared width per panel across views", () => {
    usePanelWidth("sidebar").set(300);
    expect(usePanelWidth("sidebar").width.value).toBe(300);
  });

  it("survives storage failure", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    try {
      expect(persistPanelWidth("sidebar", 300)).toBe(false);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});

describe("PanelResizeHandle", () => {
  const mountHandle = (edge: "start" | "end" = "end") =>
    mount(PanelResizeHandle, { props: { width: 260, min: 200, max: 420, edge, label: "Resize sidebar" }, attachTo: document.body });

  it("is an accessible vertical separator", () => {
    const w = mountHandle();
    const el = w.element as HTMLElement;
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.getAttribute("aria-valuenow")).toBe("260");
    expect(el.getAttribute("aria-valuemin")).toBe("200");
    expect(el.getAttribute("aria-valuemax")).toBe("420");
    expect(el.getAttribute("tabindex")).toBe("0");
    w.unmount();
  });

  it("drags on clientX only, clamps, and commits once on pointerup", () => {
    const w = mountHandle();
    const el = w.element as HTMLElement;
    el.dispatchEvent(pointer("pointerdown", 260));
    expect(document.body.classList.contains("is-resizing")).toBe(true);
    // Vertical movement alone changes nothing.
    el.dispatchEvent(pointer("pointermove", 260, { clientY: 500 }));
    expect(w.emitted("resize")?.at(-1)).toEqual([260]);
    el.dispatchEvent(pointer("pointermove", 300, { clientY: 10 }));
    expect(w.emitted("resize")?.at(-1)).toEqual([300]);
    el.dispatchEvent(pointer("pointermove", 2000));
    expect(w.emitted("resize")?.at(-1)).toEqual([420]);
    el.dispatchEvent(pointer("pointermove", -500));
    expect(w.emitted("resize")?.at(-1)).toEqual([200]);
    expect(w.emitted("commit")).toBeUndefined(); // nothing persisted mid-drag
    el.dispatchEvent(pointer("pointerup", -500));
    expect(w.emitted("commit")).toHaveLength(1);
    expect(document.body.classList.contains("is-resizing")).toBe(false);
    // After the drag, moves do nothing.
    const n = w.emitted("resize")!.length;
    el.dispatchEvent(pointer("pointermove", 350));
    expect(w.emitted("resize")!.length).toBe(n);
    w.unmount();
  });

  it("right-hand panel: dragging left widens it", () => {
    const w = mountHandle("start");
    const el = w.element as HTMLElement;
    el.dispatchEvent(pointer("pointerdown", 900));
    el.dispatchEvent(pointer("pointermove", 850));
    expect(w.emitted("resize")?.at(-1)).toEqual([310]);
    el.dispatchEvent(pointer("pointercancel", 850));
    expect(w.emitted("commit")).toHaveLength(1);
    w.unmount();
  });

  it("ignores secondary buttons and other pointers", () => {
    const w = mountHandle();
    const el = w.element as HTMLElement;
    el.dispatchEvent(pointer("pointerdown", 260, { button: 2 }));
    expect(document.body.classList.contains("is-resizing")).toBe(false);
    el.dispatchEvent(pointer("pointerdown", 260));
    el.dispatchEvent(pointer("pointermove", 300, { pointerId: 7 }));
    expect(w.emitted("resize")).toBeUndefined();
    el.dispatchEvent(pointer("pointerup", 300));
    w.unmount();
  });

  it("double-click resets; keys resize and commit", async () => {
    const w = mountHandle();
    await w.trigger("dblclick");
    expect(w.emitted("reset")).toHaveLength(1);
    await w.trigger("keydown", { key: "ArrowRight", shiftKey: true });
    expect(w.emitted("resize")?.at(-1)).toEqual([310]);
    await w.trigger("keydown", { key: "Home" });
    expect(w.emitted("resize")?.at(-1)).toEqual([200]);
    await w.trigger("keydown", { key: "ArrowDown" });
    expect(w.emitted("commit")).toHaveLength(2);
    w.unmount();
  });

  it("unmounting mid-drag clears the global resizing state", () => {
    const w = mountHandle();
    (w.element as HTMLElement).dispatchEvent(pointer("pointerdown", 260));
    w.unmount();
    expect(document.body.classList.contains("is-resizing")).toBe(false);
  });
});

describe("AppShell integration", () => {
  const mountShell = () => {
    setActivePinia(createPinia());
    return mount(AppShell, {
      slots: { sidebar: "<nav>side</nav>", main: "<div>main</div>", details: "<div>details</div>" },
      attachTo: document.body,
    });
  };

  it("sidebar divider sizes the sidebar column and persists on release", async () => {
    const w = mountShell();
    const handle = w.find("[data-testid=sidebar-resize]");
    expect(handle.exists()).toBe(true);
    expect(w.find("[data-testid=details-resize]").exists()).toBe(false); // no details open
    const el = handle.element as HTMLElement;
    el.dispatchEvent(pointer("pointerdown", 260));
    el.dispatchEvent(pointer("pointermove", 320));
    await w.vm.$nextTick();
    expect((w.find(".body").element as HTMLElement).style.getPropertyValue("--shell-sidebar-width")).toBe("320px");
    expect(localStorage.getItem(panelStorageKey("sidebar"))).toBeNull();
    el.dispatchEvent(pointer("pointerup", 320));
    expect(localStorage.getItem(panelStorageKey("sidebar"))).toBe("320");
    w.unmount();
  });

  it("details divider appears with a context panel and sizes it independently", async () => {
    const w = mountShell();
    useUiStore().openThread("root");
    await w.vm.$nextTick();
    const el = w.find("[data-testid=details-resize]").element as HTMLElement;
    el.dispatchEvent(pointer("pointerdown", 1000));
    el.dispatchEvent(pointer("pointermove", 900));
    el.dispatchEvent(pointer("pointerup", 900));
    await w.vm.$nextTick();
    const body = w.find(".body").element as HTMLElement;
    expect(body.style.getPropertyValue("--shell-details-width")).toBe("400px");
    expect(body.style.getPropertyValue("--shell-sidebar-width")).toBe("260px");
    expect(localStorage.getItem(panelStorageKey("details"))).toBe("400");
    w.unmount();
  });

  it("no sidebar divider while the sidebar is collapsed", async () => {
    const w = mountShell();
    useUiStore().setSidebarCollapsed(true);
    await w.vm.$nextTick();
    expect(w.find("[data-testid=sidebar-resize]").exists()).toBe(false);
    w.unmount();
  });
});

describe("axis guard", () => {
  // The whole feature is horizontal: no vertical resize idioms may creep in.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(vue|ts)$/.test(name)) files.push(p);
    }
  };
  walk(join(process.cwd(), "src/features/layout"));
  it.each(files)("%s uses no vertical resize APIs", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/row-resize|clientY|movementY|pageY|offsetHeight/);
  });
  it("AppShell and Inbox use no vertical resize cursor", () => {
    for (const f of ["src/layouts/AppShell.vue", "src/views/InboxView.vue"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8")).not.toMatch(/row-resize|clientY|movementY/);
    }
  });
});
