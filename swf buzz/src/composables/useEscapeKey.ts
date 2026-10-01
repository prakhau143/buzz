import { onBeforeUnmount, onMounted } from "vue";

/**
 * Closes a modal/panel/menu on Escape regardless of which element inside it
 * currently has focus (a search input, a button, the overlay itself) —
 * accessibility baseline for every dismissible overlay (Phase 3.9).
 *
 * `{ modal: true }` is for a surface that sits ON TOP of everything else (the
 * mobile bottom sheets): modal surfaces form a stack, only the top one closes,
 * and the press is consumed before any ordinary handler sees it — so closing a
 * message's action sheet never also closes the thread beneath it.
 */
const modalStack: (() => void)[] = [];
const consumed = new WeakSet<Event>();

function onModalKeydown(event: KeyboardEvent) {
  const top = modalStack[modalStack.length - 1];
  if (event.key !== "Escape" || !top) return;
  event.preventDefault();
  consumed.add(event);
  top();
}

export function useEscapeKey(onEscape: () => void, opts: { modal?: boolean } = {}): void {
  if (opts.modal) {
    onMounted(() => {
      if (modalStack.push(onEscape) === 1) document.addEventListener("keydown", onModalKeydown, true);
    });
    onBeforeUnmount(() => {
      const i = modalStack.lastIndexOf(onEscape);
      if (i >= 0) modalStack.splice(i, 1);
      if (modalStack.length === 0) document.removeEventListener("keydown", onModalKeydown, true);
    });
    return;
  }
  function handler(event: KeyboardEvent) {
    if (event.key !== "Escape" || consumed.has(event)) return;
    // Mark it handled, so an outer surface (e.g. full-screen Settings, which
    // closes on Escape too) knows a dialog already consumed this press.
    event.preventDefault();
    onEscape();
  }
  onMounted(() => document.addEventListener("keydown", handler));
  onBeforeUnmount(() => document.removeEventListener("keydown", handler));
}
