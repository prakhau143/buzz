import { nextTick, onBeforeUnmount, onMounted, type Ref } from "vue";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside a modal dialog while it is open (WAI-ARIA
 * dialog pattern, accessibility baseline P0/Phase M):
 *
 *  - on mount, focus moves INTO the dialog (the first focusable element, or the
 *    container itself as a fallback) so a keyboard user is not left on the
 *    now-inert page behind it;
 *  - Tab / Shift+Tab wrap within the dialog instead of escaping to the page;
 *  - on unmount, focus RETURNS to whatever had it before the dialog opened
 *    (typically the button that opened it), so closing never drops focus at
 *    `<body>`.
 *
 * Escape-to-close stays in `useEscapeKey` — the two compose. Pass the ref of
 * the element carrying `role="dialog"`.
 */
export function useFocusTrap(container: Ref<HTMLElement | null>): void {
  let previouslyFocused: Element | null = null;

  function focusables(): HTMLElement[] {
    const root = container.value;
    if (!root) return [];
    // Explicit hiding only — layout-based checks (offsetParent) are unreliable
    // in headless/jsdom environments and unnecessary for our dialogs.
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
    );
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const root = container.value;
    if (!root) return;
    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      root.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && root.contains(active);
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onMounted(async () => {
    previouslyFocused = document.activeElement;
    document.addEventListener("keydown", onKeydown);
    await nextTick();
    const root = container.value;
    if (!root) return;
    if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
    const [first] = focusables();
    (first ?? root).focus();
  });

  onBeforeUnmount(() => {
    document.removeEventListener("keydown", onKeydown);
    const back = previouslyFocused as HTMLElement | null;
    if (back && typeof back.focus === "function" && document.contains(back)) {
      back.focus();
    }
  });
}
