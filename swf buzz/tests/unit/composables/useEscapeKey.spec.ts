import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { useEscapeKey } from "@/composables/useEscapeKey";

/** A surface that closes on Escape; `modal` = a bottom sheet on top of the screen. */
const Surface = defineComponent({
  props: { onEsc: { type: Function, required: true }, modal: { type: Boolean, default: false } },
  setup(props) {
    useEscapeKey(() => (props.onEsc as () => void)(), { modal: props.modal });
    return () => h("div");
  },
});

const mounted: VueWrapper[] = [];
const open = (onEsc: () => void, modal = false) => {
  const w = mount(Surface, { props: { onEsc, modal }, attachTo: document.body });
  mounted.push(w);
  return w;
};
function escape() {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.body.dispatchEvent(ev);
  return ev;
}
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe("useEscapeKey", () => {
  it("an ordinary surface closes on Escape and marks the press handled", () => {
    const panel = vi.fn();
    open(panel);
    expect(escape().defaultPrevented).toBe(true);
    expect(panel).toHaveBeenCalledOnce();
  });

  it("a sheet over a thread: Escape closes ONLY the sheet, the thread underneath stays", () => {
    const thread = vi.fn();
    const sheet = vi.fn();
    open(thread);
    const s = open(sheet, true);
    escape();
    expect(sheet).toHaveBeenCalledOnce();
    expect(thread).not.toHaveBeenCalled();
    // Sheet gone: the next Escape is the thread's again.
    s.unmount();
    mounted.splice(mounted.indexOf(s), 1);
    escape();
    expect(thread).toHaveBeenCalledOnce();
    expect(sheet).toHaveBeenCalledOnce();
  });

  it("stacked sheets close one at a time, top first", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    open(lower, true);
    const u = open(upper, true);
    escape();
    expect(upper).toHaveBeenCalledOnce();
    expect(lower).not.toHaveBeenCalled();
    u.unmount();
    mounted.splice(mounted.indexOf(u), 1);
    escape();
    expect(lower).toHaveBeenCalledOnce();
  });

  it("removes its document listener when the last sheet closes", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const w = open(vi.fn(), true);
    w.unmount();
    mounted.splice(mounted.indexOf(w), 1);
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    remove.mockRestore();
  });
});
