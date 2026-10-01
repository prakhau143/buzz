import { onBeforeUnmount, watch, type Ref } from "vue";
import {
  EDGE_WIDTH_PX,
  MOVE_TOLERANCE_PX,
  SWIPE_COMMIT_RATIO,
  SWIPE_MIN_FLICK_PX,
  SWIPE_VELOCITY,
  beginTouchSequence,
  claimGesture,
  holdNativeHistorySwipe,
  inHorizontalScroller,
  modalOpen,
  pointOf,
  prefersReducedMotion,
  releaseGesture,
} from "./gesturePolicy";

const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Edge swipe → `onBack()` — the SAME back the header button performs, so the
 * router history (and Android's system back) stays the one navigation stack.
 *
 * Starts only within the left edge; vertical intent hands the touch back to
 * scrolling; never starts in a field, a sideways scroller (filter chips) or
 * while a sheet / dialog is open. The screen follows the finger via a
 * transform written in rAF (no per-frame reactive state); release past 35 %
 * of the width, or a quick flick, commits — anything else springs back.
 * Reduced motion: no follow-the-finger movement, the decision is the same.
 */
export function useSwipeBack(
  host: Ref<HTMLElement | null>,
  opts: { enabled: () => boolean; onBack: () => void },
) {
  let start: { x: number; y: number; t: number } | null = null;
  let decided = false;
  let dx = 0;
  let frame = 0;
  let settle: ReturnType<typeof setTimeout> | null = null;
  // The app's back swipe replaces the browser's history swipe while this screen is up.
  const releaseNative = holdNativeHistorySwipe();

  function paint() {
    frame = 0;
    const el = host.value;
    if (!el || prefersReducedMotion()) return;
    el.style.transition = "none";
    el.style.transform = `translate3d(${Math.max(0, dx)}px, 0, 0)`;
    el.style.boxShadow = "-12px 0 24px rgba(0, 0, 0, 0.12)";
  }
  function clearPaint(animate: boolean) {
    const el = host.value;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!el) return;
    if (animate && !prefersReducedMotion() && el.style.transform) {
      el.style.transition = "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "translate3d(0, 0, 0)";
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        el.style.transition = "";
        el.style.transform = "";
        el.style.boxShadow = "";
      }, 200);
    } else {
      el.style.transition = "";
      el.style.transform = "";
      el.style.boxShadow = "";
    }
  }
  function reset(animate: boolean) {
    if (decided) releaseGesture("swipe-back");
    start = null;
    decided = false;
    dx = 0;
    clearPaint(animate);
  }

  /** The edge zone starts inside the frame's safe-area padding (landscape notches). */
  function edgeLimit(): number {
    const el = host.value;
    const inset = el ? parseFloat(getComputedStyle(el).paddingLeft) || 0 : 0;
    return EDGE_WIDTH_PX + inset;
  }

  function onStart(event: TouchEvent) {
    if (start) reset(false);
    beginTouchSequence(event);
    if (!opts.enabled() || event.touches.length !== 1 || modalOpen()) return;
    const p = pointOf(event);
    if (!p || p.x > edgeLimit()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(FIELD) || inHorizontalScroller(target, host.value)) return;
    start = { ...p, t: event.timeStamp ?? Date.now() };
    decided = false;
    dx = 0;
  }
  function onMove(event: TouchEvent) {
    if (!start) return;
    const p = pointOf(event);
    if (!p) return;
    const mx = p.x - start.x;
    const my = p.y - start.y;
    if (!decided) {
      if (Math.abs(my) > MOVE_TOLERANCE_PX && Math.abs(my) >= Math.abs(mx)) return reset(false);
      if (mx > MOVE_TOLERANCE_PX && mx > Math.abs(my)) {
        if (!claimGesture("swipe-back")) return reset(false);
        decided = true;
      } else return;
    }
    if (event.cancelable) event.preventDefault(); // the page must not scroll under a back swipe
    dx = mx;
    if (!frame) frame = requestAnimationFrame(paint);
  }
  function onEnd(event: TouchEvent) {
    if (!start || !decided) return reset(false);
    const elapsed = Math.max(1, (event.timeStamp ?? Date.now()) - start.t);
    const width = host.value?.clientWidth || window.innerWidth;
    const commit = dx >= width * SWIPE_COMMIT_RATIO || (dx >= SWIPE_MIN_FLICK_PX && dx / elapsed >= SWIPE_VELOCITY);
    reset(!commit);
    if (commit) opts.onBack();
  }
  const onCancel = () => reset(true);

  function attach(el: HTMLElement) {
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
  }
  function detach(el: HTMLElement) {
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onCancel);
  }
  watch(
    host,
    (el, old) => {
      if (old) detach(old);
      if (el) attach(el);
    },
    // Sync: listeners are on the element the moment it exists (and off the moment it goes).
    { immediate: true, flush: "sync" },
  );
  onBeforeUnmount(() => {
    if (host.value) detach(host.value);
    if (settle) clearTimeout(settle);
    reset(false);
    releaseNative();
  });
}
