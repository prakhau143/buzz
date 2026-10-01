import { onBeforeUnmount, watch, type Ref } from "vue";
import { haptic } from "@/platform/haptics";
import {
  LONG_PRESS_MS,
  MOVE_TOLERANCE_PX,
  beginTouchSequence,
  claimGesture,
  isInteractiveTarget,
  modalOpen,
  pointOf,
  releaseGesture,
} from "./gesturePolicy";

/**
 * Long-press a message (touch only) → `onLongPress(messageId)`, the same path
 * as the row's "⋯" button (which stays as the non-touch equivalent).
 *
 * One delegated set of listeners on the list host — never per row, never on
 * `document` — attached while the host exists and removed on unmount. The
 * press is abandoned on any real movement (so vertical scrolling is never
 * interrupted), on release, cancel, scroll, a second finger, the row leaving
 * the DOM, or when it started on a link / button / attachment / field. Once it
 * fires, the platform callout and the click that follows the release are
 * swallowed so nothing else reacts to the same touch.
 */
export function useMessageLongPress(
  host: Ref<HTMLElement | null>,
  opts: { enabled: () => boolean; onLongPress: (messageId: string) => void },
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let row: HTMLElement | null = null;
  let fired = false;
  let swallowUntil = 0;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }
  function cancel() {
    clearTimer();
    start = null;
    row = null;
    if (fired) releaseGesture("long-press");
    fired = false;
  }

  function onStart(event: TouchEvent) {
    cancel();
    beginTouchSequence(event);
    if (!opts.enabled() || event.touches.length !== 1 || modalOpen()) return;
    const el = host.value;
    const target = event.target instanceof Element ? event.target : null;
    const found = target?.closest<HTMLElement>("[data-message-id]") ?? null;
    if (!el || !found || !el.contains(found)) return;
    if (isInteractiveTarget(target, found)) return;
    start = pointOf(event);
    row = found;
    timer = setTimeout(() => {
      timer = null;
      const id = row?.dataset.messageId;
      if (!row || !id || !row.isConnected || !claimGesture("long-press")) return cancel();
      fired = true;
      haptic("lightTap");
      opts.onLongPress(id);
    }, LONG_PRESS_MS);
  }
  function onMove(event: TouchEvent) {
    if (!start || fired) return;
    const p = pointOf(event);
    if (p && Math.hypot(p.x - start.x, p.y - start.y) > MOVE_TOLERANCE_PX) cancel();
  }
  function onEnd(event: TouchEvent) {
    if (fired) {
      // The finger lifting after a long press is not a tap: suppress the
      // synthetic click entirely — otherwise it lands on whatever just opened
      // under the finger (the action sheet's rows).
      if (event.cancelable) event.preventDefault();
      swallowUntil = Date.now() + 450;
    }
    cancel();
  }
  /** A fired long press owns the release: the synthetic click after it is not a tap. */
  function onClick(event: MouseEvent) {
    if (Date.now() < swallowUntil) {
      event.preventDefault();
      event.stopPropagation();
      swallowUntil = 0;
    }
  }
  /** Android/iOS long-press callouts (text selection menu, link preview). */
  function onContextMenu(event: Event) {
    if (timer || fired || Date.now() < swallowUntil) event.preventDefault();
  }
  const onScroll = () => cancel();

  function attach(el: HTMLElement) {
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", cancel);
    el.addEventListener("click", onClick, true);
    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("scroll", onScroll, { capture: true, passive: true });
  }
  function detach(el: HTMLElement) {
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", cancel);
    el.removeEventListener("click", onClick, true);
    el.removeEventListener("contextmenu", onContextMenu);
    el.removeEventListener("scroll", onScroll, { capture: true });
  }

  watch(
    host,
    (el, old) => {
      if (old) detach(old);
      cancel();
      if (el) attach(el);
    },
    // Sync: listeners are on the element the moment it exists (and off the moment it goes).
    { immediate: true, flush: "sync" },
  );
  onBeforeUnmount(() => {
    if (host.value) detach(host.value);
    cancel();
  });

  return { cancel };
}
