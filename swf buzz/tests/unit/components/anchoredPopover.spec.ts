/** AnchoredPopover places itself from the anchor's real rectangle, flips and clamps inside the viewport. */
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import AnchoredPopover from "@/components/AnchoredPopover.vue";

function anchorAt(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement("button");
  el.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

async function placed(anchor: HTMLElement, props: Record<string, unknown> = {}) {
  const w = mount(AnchoredPopover, {
    props: { anchor, label: "Menu", width: 280, ...props },
    slots: { default: '<button role="menuitem">One</button>' },
    attachTo: document.body,
  });
  await flushPromises();
  const panel = document.querySelector<HTMLElement>("[role=menu]")!;
  return { w, left: parseFloat(panel.style.left), top: parseFloat(panel.style.top), panel };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AnchoredPopover", () => {
  it("opens to the right of the anchor", async () => {
    Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
    const { left } = await placed(anchorAt({ left: 16, top: 700, width: 240, height: 72 }));
    expect(left).toBe(16 + 240 + 8);
  });

  it("flips to the left when there is no room on the right, and never leaves the viewport", async () => {
    Object.assign(window, { innerWidth: 900, innerHeight: 800 });
    const { left } = await placed(anchorAt({ left: 700, top: 300, width: 180, height: 40 }));
    expect(left).toBe(700 - 8 - 280);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it("clamps into a narrow window", async () => {
    Object.assign(window, { innerWidth: 320, innerHeight: 600 });
    const { left, panel } = await placed(anchorAt({ left: 10, top: 500, width: 200, height: 60 }));
    expect(left).toBeGreaterThanOrEqual(8);
    expect(parseFloat(panel.style.width)).toBeLessThanOrEqual(320 - 16);
  });

  it("focuses the first item and emits close on Escape", async () => {
    Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
    const { w, panel } = await placed(anchorAt({ left: 16, top: 700, width: 240, height: 72 }));
    expect(document.activeElement?.textContent).toBe("One");
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(w.emitted("close")).toHaveLength(1);
  });
});
