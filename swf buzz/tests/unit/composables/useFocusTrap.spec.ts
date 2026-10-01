import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { useFocusTrap } from "@/composables/useFocusTrap";

/** A trapped dialog: two buttons by default, or nothing focusable with `empty`. */
const Dialog = defineComponent({
  props: { empty: { type: Boolean, default: false } },
  setup(props) {
    const dialog = ref<HTMLElement | null>(null);
    useFocusTrap(dialog);
    return () =>
      h(
        "div",
        { ref: dialog, role: "dialog", "aria-modal": "true" },
        props.empty ? "nothing to focus" : [h("button", { id: "first" }, "First"), h("button", { id: "last" }, "Last")],
      );
  },
});

function tab(shift = false) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true }));
}

describe("useFocusTrap (P0/Phase M accessibility baseline)", () => {
  it("moves focus into the dialog on open, wraps Tab/Shift+Tab inside it, and restores focus on close", async () => {
    const opener = document.createElement("button");
    opener.id = "opener";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const wrapper = mount(Dialog, { attachTo: document.body });
    await nextTick();
    await nextTick();
    const first = wrapper.find("#first").element as HTMLElement;
    const last = wrapper.find("#last").element as HTMLElement;
    expect(document.activeElement, "focus enters the dialog on open").toBe(first);

    // Tab from the last element wraps to the first, Shift+Tab from the first wraps to the last.
    last.focus();
    tab();
    expect(document.activeElement).toBe(first);
    tab(true);
    expect(document.activeElement).toBe(last);

    wrapper.unmount();
    expect(document.activeElement, "focus returns to the opener on close").toBe(opener);
    opener.remove();
  });

  it("focuses the container itself when the dialog has nothing focusable", async () => {
    const wrapper = mount(Dialog, { props: { empty: true }, attachTo: document.body });
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(wrapper.element);
    expect((wrapper.element as HTMLElement).getAttribute("tabindex")).toBe("-1");
    wrapper.unmount();
  });
});
