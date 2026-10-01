/**
 * Phase H — collision-aware placement (components/menuPlacement.ts) and the
 * PositionedContextMenu built on it: the message "⋮" menu can never be
 * clipped by the viewport or end up under the composer at the bottom.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { placeMenu, VIEWPORT_MARGIN, type Rect } from "@/components/menuPlacement";
import PositionedContextMenu from "@/components/PositionedContextMenu.vue";

const VIEW = { top: 0, left: 0, width: 1280, height: 800 };
const MENU = { width: 232, height: 300 };
const rect = (top: number, left: number, size = 22): Rect => ({ top, left, bottom: top + size, right: left + size });

function inside(p: { top: number; left: number; maxHeight: number | null }, size = MENU, view = VIEW) {
  const height = p.maxHeight ?? size.height;
  return (
    p.top >= view.top + VIEWPORT_MARGIN &&
    p.left >= view.left + VIEWPORT_MARGIN &&
    p.top + height <= view.top + view.height - VIEWPORT_MARGIN &&
    p.left + size.width <= view.left + view.width - VIEWPORT_MARGIN
  );
}

describe("placeMenu", () => {
  it("opens below the trigger when there is room (message mid-screen)", () => {
    const p = placeMenu(rect(200, 1000), MENU, VIEW);
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(200 + 22 + 4);
    expect(inside(p)).toBe(true);
  });

  it("3. near the bottom (composer) it opens ABOVE the trigger", () => {
    const p = placeMenu(rect(700, 1000), MENU, VIEW);
    expect(p.side).toBe("top");
    expect(p.top + MENU.height).toBeLessThanOrEqual(700 - 4);
    expect(inside(p)).toBe(true);
  });

  it("4. near the top it opens below", () => {
    const p = placeMenu(rect(10, 1000), MENU, VIEW);
    expect(p.side).toBe("bottom");
    expect(inside(p)).toBe(true);
  });

  it("5. right edge: right-aligned to the trigger, clamped; left edge: flips to left-aligned", () => {
    const right = placeMenu(rect(200, 1270, 10), MENU, VIEW);
    expect(right.left + MENU.width).toBeLessThanOrEqual(VIEW.width - VIEWPORT_MARGIN);
    const left = placeMenu(rect(200, 4, 22), MENU, VIEW);
    expect(left.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(inside(left)).toBe(true);
  });

  it("7. too tall for either side: caps the height so the menu scrolls inside itself", () => {
    const short = { ...VIEW, height: 420 };
    const p = placeMenu(rect(200, 1000), { width: 232, height: 900 }, short);
    expect(p.maxHeight).not.toBeNull();
    expect(inside(p, { width: 232, height: 900 }, short)).toBe(true);
  });

  it("2. stays inside the viewport for every trigger position (property sweep)", () => {
    for (let top = 0; top <= VIEW.height - 22; top += 37) {
      for (let left = 0; left <= VIEW.width - 22; left += 151) {
        expect(inside(placeMenu(rect(top, left), MENU, VIEW))).toBe(true);
      }
    }
  });

  it("respects a shrunken visual viewport (soft keyboard)", () => {
    const keyboardUp = { top: 0, left: 0, width: 390, height: 420 };
    const p = placeMenu(rect(380, 340), { width: 232, height: 280 }, keyboardUp);
    expect(inside(p, { width: 232, height: 280 }, keyboardUp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PositionedContextMenu
// ---------------------------------------------------------------------------

const wrappers: VueWrapper[] = [];
afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function setup(anchorTop = 700) {
  const anchor = document.createElement("button");
  anchor.textContent = "⋮";
  document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () => ({ ...rect(anchorTop, 1000), width: 22, height: 22, x: 1000, y: anchorTop, toJSON: () => ({}) }) as DOMRect;
  anchor.focus();
  const onClose = vi.fn();
  const w = mount(PositionedContextMenu, {
    attachTo: document.body,
    props: { anchor, label: "Message actions", onClose },
    slots: {
      default: () => [
        h("button", { role: "menuitem", id: "i1" }, "Reply"),
        h("button", { role: "menuitem", id: "i2" }, "Pin message"),
        h("button", { role: "menuitem", id: "i3" }, "Copy"),
      ],
    },
  });
  wrappers.push(w);
  return { w, anchor, onClose };
}
const panel = () => document.querySelector<HTMLElement>("[data-testid=context-menu]")!;
const press = (key: string) => panel().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

describe("PositionedContextMenu", () => {
  it("1/6. renders in <body> (outside any clipping container) with menu semantics", async () => {
    setup();
    await nextTick();
    await nextTick();
    expect(panel().parentElement).toBe(document.body);
    expect(panel().getAttribute("role")).toBe("menu");
    expect(panel().getAttribute("aria-label")).toBe("Message actions");
  });

  it("11. focuses the first item; arrows wrap; Home/End jump", async () => {
    setup();
    await new Promise((r) => setTimeout(r));
    expect(document.activeElement?.id).toBe("i1");
    press("ArrowDown");
    expect(document.activeElement?.id).toBe("i2");
    press("End");
    expect(document.activeElement?.id).toBe("i3");
    press("ArrowDown");
    expect(document.activeElement?.id).toBe("i1");
    press("ArrowUp");
    expect(document.activeElement?.id).toBe("i3");
    press("Home");
    expect(document.activeElement?.id).toBe("i1");
  });

  it("8. Escape closes", async () => {
    const { onClose } = setup();
    await nextTick();
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("9. an outside press closes; a press inside or on the trigger does not", async () => {
    const { onClose, anchor } = setup();
    await nextTick();
    panel().querySelector("button")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    anchor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("10. focus returns to the trigger when it closes", async () => {
    const { w, anchor } = setup();
    await new Promise((r) => setTimeout(r));
    expect(document.activeElement?.id).toBe("i1");
    w.unmount();
    wrappers.length = 0;
    expect(document.activeElement).toBe(anchor);
  });

  it("12/13. re-places on scroll and resize, and removes every listener on close", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");
    const { w } = setup();
    await new Promise((r) => setTimeout(r));
    const events = add.mock.calls.map((c) => c[0]);
    expect(events).toEqual(expect.arrayContaining(["resize", "scroll"]));
    w.unmount();
    wrappers.length = 0;
    const removed = remove.mock.calls.map((c) => c[0]);
    expect(removed).toEqual(expect.arrayContaining(["resize", "scroll"]));
    expect(docRemove.mock.calls.map((c) => c[0])).toContain("pointerdown");
  });

  it("3. with the trigger near the bottom the panel is placed above it", async () => {
    // jsdom has no layout: give the panel a real height for this case.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset?.testid === "context-menu" ? 200 : 0;
      },
    });
    try {
      setup(700);
      await new Promise((r) => setTimeout(r));
      const top = parseFloat(panel().style.top);
      expect(top + 200).toBeLessThanOrEqual(700);
      expect(panel().classList.contains("side-top")).toBe(true);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollHeight", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
  });
});
