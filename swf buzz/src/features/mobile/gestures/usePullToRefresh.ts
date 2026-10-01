import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import { haptic } from "@/platform/haptics";
import {
  MOVE_TOLERANCE_PX,
  PULL_MAX_PX,
  PULL_THRESHOLD_PX,
  REFRESH_TIMEOUT_MS,
  beginTouchSequence,
  claimGesture,
  inHorizontalScroller,
  modalOpen,
  pointOf,
  releaseGesture,
} from "./gesturePolicy";

export type PullPhase = "idle" | "pulling" | "armed" | "refreshing" | "done" | "error";

/** Rubber-band resistance: the further you pull, the less it moves; capped at PULL_MAX_PX. */
export function resist(dy: number): number {
  if (dy <= 0) return 0;
  return PULL_MAX_PX * (1 - Math.exp(-dy / (PULL_MAX_PX * 1.6)));
}

/**
 * Pull down at the very top of a scroller → `onRefresh()` (the screen's
 * EXISTING refetch). The pull distance is written to `--ptr-pull` on the host
 * in rAF — only `phase` is reactive, and it changes a handful of times per
 * gesture. One refresh at a time; a refresh that never settles times out as an
 * error. Vertical-only: sideways intent, a sideways scroller, or anything not
 * at `scrollTop <= 0` leaves the touch to the browser.
 */
export function usePullToRefresh(
  host: Ref<HTMLElement | null>,
  opts: {
    enabled: () => boolean;
    scroller: () => HTMLElement | null;
    onRefresh: () => Promise<unknown>;
  },
) {
  const phase = ref<PullPhase>("idle");
  let start: { x: number; y: number } | null = null;
  let decided = false;
  let pull = 0;
  let frame = 0;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function write(px: number) {
    pull = px;
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        host.value?.style.setProperty("--ptr-pull", `${Math.round(pull)}px`);
      });
    }
  }
  function writeNow(px: number) {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pull = px;
    host.value?.style.setProperty("--ptr-pull", `${Math.round(px)}px`);
  }
  function end() {
    if (decided) releaseGesture("pull-refresh");
    start = null;
    decided = false;
  }
  function later(ms: number, fn: () => void) {
    if (settle) clearTimeout(settle);
    settle = setTimeout(() => {
      settle = null;
      if (!disposed) fn();
    }, ms);
  }

  /** Run the refresh once, with a timeout; never two at a time. */
  async function refresh(): Promise<void> {
    if (phase.value === "refreshing") return;
    phase.value = "refreshing";
    writeNow(PULL_THRESHOLD_PX);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        opts.onRefresh(),
        new Promise((_, reject) => (timeout = setTimeout(() => reject(new Error("timeout")), REFRESH_TIMEOUT_MS))),
      ]);
      if (disposed) return;
      phase.value = "done";
      haptic("success");
      later(600, () => {
        phase.value = "idle";
        writeNow(0);
      });
    } catch {
      if (disposed) return;
      phase.value = "error";
      haptic("error");
      later(1600, () => {
        phase.value = "idle";
        writeNow(0);
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function onStart(event: TouchEvent) {
    end();
    beginTouchSequence(event);
    if (!opts.enabled() || event.touches.length !== 1 || modalOpen()) return;
    if (phase.value === "refreshing" || phase.value === "done" || phase.value === "error") return;
    const scroller = opts.scroller();
    const target = event.target instanceof Element ? event.target : null;
    if (!scroller || !target || !scroller.contains(target) || scroller.scrollTop > 0) return;
    if (inHorizontalScroller(target, scroller)) return;
    start = pointOf(event);
  }
  function onMove(event: TouchEvent) {
    if (!start) return;
    const p = pointOf(event);
    if (!p) return;
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (!decided) {
      if (dy < -MOVE_TOLERANCE_PX || Math.abs(dx) > Math.max(dy, MOVE_TOLERANCE_PX)) return end();
      if (dy <= MOVE_TOLERANCE_PX) return;
      if ((opts.scroller()?.scrollTop ?? 1) > 0 || !claimGesture("pull-refresh")) return end();
      decided = true;
    }
    if (event.cancelable) event.preventDefault(); // no page bounce while we own the pull
    const distance = resist(dy - MOVE_TOLERANCE_PX);
    write(distance);
    const next: PullPhase = distance >= PULL_THRESHOLD_PX ? "armed" : "pulling";
    if (phase.value !== next) {
      if (next === "armed") haptic("selection");
      phase.value = next;
    }
  }
  function onEnd() {
    if (!decided) return end();
    const armed = phase.value === "armed";
    end();
    if (armed) void refresh();
    else {
      phase.value = "idle";
      writeNow(0);
    }
  }

  function attach(el: HTMLElement) {
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
  }
  function detach(el: HTMLElement) {
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
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
    disposed = true;
    if (host.value) detach(host.value);
    if (frame) cancelAnimationFrame(frame);
    if (settle) clearTimeout(settle);
    end();
  });

  return { phase, refresh };
}
