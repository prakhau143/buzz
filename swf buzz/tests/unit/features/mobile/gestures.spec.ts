/**
 * Phase F — the shared gesture policy and its three gestures (long press,
 * edge swipe-back, pull-to-refresh) plus haptics: thresholds, cancellation,
 * conflicts (fields, links, attachments, sideways scrollers, open sheets, one
 * owner per touch), reduced motion, duplicate-refresh prevention, timeouts,
 * and no listener / timer left behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref, type Ref } from "vue";

const { useMessageLongPress } = await import("@/features/mobile/gestures/useMessageLongPress");
const { useSwipeBack } = await import("@/features/mobile/gestures/useSwipeBack");
const { usePullToRefresh, resist } = await import("@/features/mobile/gestures/usePullToRefresh");
const policy = await import("@/features/mobile/gestures/gesturePolicy");
const haptics = await import("@/platform/haptics");

/** A TouchEvent stand-in jsdom can dispatch (it has no Touch constructor). */
function touch(el: Element, type: string, x: number, y: number, opts: { fingers?: number; timeStamp?: number } = {}) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y };
  const ended = type === "touchend" || type === "touchcancel";
  Object.defineProperty(ev, "touches", { value: ended ? [] : Array.from({ length: opts.fingers ?? 1 }, () => point) });
  Object.defineProperty(ev, "changedTouches", { value: [point] });
  if (opts.timeStamp !== undefined) Object.defineProperty(ev, "timeStamp", { value: opts.timeStamp });
  el.dispatchEvent(ev);
  return ev;
}

let vibrate: ReturnType<typeof vi.fn>;
/** Every harness mounted in a test is unmounted after it (screens never outlive their test). */
const mounted: { unmount: () => void }[] = [];
const track = <T extends { unmount: () => void }>(w: T): T => (mounted.push(w), w);
let reducedMotion = false;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
  reducedMotion = false;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") ? reducedMotion : false, addEventListener() {}, removeEventListener() {} }));
  policy.resetGesturesForTests();
  haptics.resetHapticsForTests();
  document.body.innerHTML = "";
});
afterEach(() => {
  for (const w of mounted.splice(0)) {
    try {
      w.unmount();
    } catch {
      // already unmounted by the test itself
    }
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One host component for every harness: `use` wires a gesture to the host ref, `view` renders its content. */
const Host = defineComponent({
  props: {
    use: { type: Function, required: true },
    view: { type: Function, required: true },
  },
  setup(props) {
    const host = ref<HTMLElement | null>(null);
    (props.use as (r: typeof host) => void)(host);
    return () => (props.view as (r: typeof host) => ReturnType<typeof h>)(host);
  },
});

// ---------------------------------------------------------------------------
function longPressHarness(opts: { enabled?: boolean } = {}) {
  const pressed: string[] = [];
  const w = track(mount(Host, {
    attachTo: document.body,
    props: {
      use: (host: Ref<HTMLElement | null>) => useMessageLongPress(host, { enabled: () => opts.enabled ?? true, onLongPress: (id) => pressed.push(id) }),
      view: (host: Ref<HTMLElement | null>) =>
        h("div", { ref: host, class: "list" }, [
          h("div", { "data-message-id": "m1", class: "row" }, [
            h("p", { class: "text" }, "hello"),
            h("a", { href: "https://x.example", class: "link" }, "link"),
            h("button", { class: "btn" }, "b"),
            h("div", { class: "attachments" }, [h("span", { class: "att" }, "img")]),
          ]),
          h("div", { "data-message-id": "m2", class: "row2" }, [h("p", { class: "text2" }, "second")]),
        ]),
    },
  }));
  return { w, pressed, text: () => w.find(".text").element, host: () => w.find(".list").element };
}

describe("long press", () => {
  it("fires at 500 ms (not before) with a light haptic, for that message", () => {
    const { pressed, text } = longPressHarness();
    touch(text(), "touchstart", 100, 200);
    vi.advanceTimersByTime(policy.LONG_PRESS_MS - 1);
    expect(pressed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(pressed).toEqual(["m1"]);
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it("a small wobble is still a press; real movement (a scroll) cancels it", () => {
    const { pressed, text } = longPressHarness();
    touch(text(), "touchstart", 100, 200);
    touch(text(), "touchmove", 104, 203);
    vi.advanceTimersByTime(600);
    expect(pressed).toEqual(["m1"]);
    touch(text(), "touchend", 104, 203);
    touch(text(), "touchstart", 100, 200);
    touch(text(), "touchmove", 100, 230);
    vi.advanceTimersByTime(600);
    expect(pressed).toEqual(["m1"]);
  });

  it("releasing early, a scroll event, or a second finger cancels", () => {
    const { pressed, text, host } = longPressHarness();
    touch(text(), "touchstart", 1, 1);
    vi.advanceTimersByTime(300);
    touch(text(), "touchend", 1, 1);
    vi.advanceTimersByTime(600);
    touch(text(), "touchstart", 1, 1);
    host().dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(600);
    touch(text(), "touchstart", 1, 1, { fingers: 2 });
    vi.advanceTimersByTime(600);
    expect(pressed).toEqual([]);
  });

  it("links, buttons and attachments keep their own touch; a row removed mid-press never fires", () => {
    const { pressed, w } = longPressHarness();
    for (const sel of [".link", ".btn", ".att"]) {
      touch(w.find(sel).element, "touchstart", 1, 1);
      vi.advanceTimersByTime(600);
    }
    expect(pressed).toEqual([]);
    touch(w.find(".text2").element, "touchstart", 1, 1);
    w.find(".row2").element.remove();
    vi.advanceTimersByTime(600);
    expect(pressed).toEqual([]);
  });

  it("disabled (desktop) or with a sheet open: nothing", () => {
    let h1 = longPressHarness({ enabled: false });
    touch(h1.text(), "touchstart", 1, 1);
    vi.advanceTimersByTime(600);
    expect(h1.pressed).toEqual([]);
    h1.w.unmount();
    h1 = longPressHarness();
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    touch(h1.text(), "touchstart", 1, 1);
    vi.advanceTimersByTime(600);
    expect(h1.pressed).toEqual([]);
  });

  it("after firing, the release's click and the platform callout are swallowed", () => {
    const { text } = longPressHarness();
    touch(text(), "touchstart", 1, 1);
    const ctx = new Event("contextmenu", { bubbles: true, cancelable: true });
    text().dispatchEvent(ctx);
    expect(ctx.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(600);
    const end = touch(text(), "touchend", 1, 1);
    // No synthetic click at all: it would otherwise land on the sheet that just opened under the finger.
    expect(end.defaultPrevented).toBe(true);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    text().dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const later = new MouseEvent("click", { bubbles: true, cancelable: true });
    text().dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it("owns the touch while pressed: a swipe-back cannot also claim it", () => {
    const { text } = longPressHarness();
    touch(text(), "touchstart", 1, 1);
    vi.advanceTimersByTime(600);
    expect(policy.gestureOwner()).toBe("long-press");
    expect(policy.claimGesture("swipe-back")).toBe(false);
    touch(text(), "touchend", 1, 1);
    expect(policy.gestureOwner()).toBeNull();
  });

  it("a release that never arrives (row removed under the finger) cannot lock out the next touch", () => {
    const { text } = longPressHarness();
    touch(text(), "touchstart", 1, 1);
    vi.advanceTimersByTime(600);
    expect(policy.gestureOwner()).toBe("long-press");
    // The row is re-rendered away: its touchend fires on a detached node and never reaches the list.
    // The next single-finger touch anywhere starts a new sequence with no owner.
    const other = document.createElement("div");
    document.body.appendChild(other);
    policy.beginTouchSequence(touch(other, "touchstart", 5, 5) as unknown as TouchEvent);
    expect(policy.gestureOwner()).toBeNull();
    expect(policy.claimGesture("swipe-back")).toBe(true);
  });

  it("a second finger joining does not clear the current owner", () => {
    policy.claimGesture("pull-refresh");
    const ev = new Event("touchstart") as unknown as TouchEvent;
    Object.defineProperty(ev, "touches", { value: [{}, {}] });
    policy.beginTouchSequence(ev);
    expect(policy.gestureOwner()).toBe("pull-refresh");
  });
});

// ---------------------------------------------------------------------------
function swipeHarness(opts: { enabled?: boolean } = {}) {
  const back = vi.fn();
  const w = track(mount(Host, {
    attachTo: document.body,
    props: {
      use: (host: Ref<HTMLElement | null>) => useSwipeBack(host, { enabled: () => opts.enabled ?? true, onBack: back }),
      view: (host: Ref<HTMLElement | null>) =>
        h("div", { ref: host, class: "screen" }, [
          h("p", { class: "content" }, "x"),
          h("input", { class: "field" }),
          h("div", { class: "chips", "data-hscroll": "" }, [h("span", { class: "chip" }, "c")]),
        ]),
    },
  }));
  Object.defineProperty(w.find(".screen").element, "clientWidth", { value: 390 });
  return { w, back, el: (sel = ".content") => w.find(sel).element, screen: () => w.find(".screen").element as HTMLElement };
}

describe("swipe-back", () => {
  it("from the left edge past 35 % of the width → back (the header's back)", () => {
    const { back, el } = swipeHarness();
    touch(el(), "touchstart", 8, 300, { timeStamp: 0 });
    touch(el(), "touchmove", 60, 302, { timeStamp: 200 });
    touch(el(), "touchmove", 150, 305, { timeStamp: 600 });
    touch(el(), "touchend", 150, 305, { timeStamp: 900 });
    expect(back).toHaveBeenCalledOnce();
  });

  it("released short and slow → springs back, no navigation", () => {
    const { back, el, screen } = swipeHarness();
    touch(el(), "touchstart", 8, 300, { timeStamp: 0 });
    touch(el(), "touchmove", 100, 300, { timeStamp: 800 });
    vi.advanceTimersByTime(20);
    expect(screen().style.transform).toContain("92px");
    touch(el(), "touchend", 100, 300, { timeStamp: 1000 });
    expect(back).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(screen().style.transform).toBe("");
  });

  it("a quick flick commits even when short", () => {
    const { back, el } = swipeHarness();
    touch(el(), "touchstart", 5, 300, { timeStamp: 0 });
    touch(el(), "touchmove", 70, 300, { timeStamp: 60 });
    touch(el(), "touchend", 70, 300, { timeStamp: 100 });
    expect(back).toHaveBeenCalledOnce();
  });

  it("not from the edge, not vertical, not in a field, a sideways scroller, or under a sheet", () => {
    const { back, el } = swipeHarness();
    const swipe = (target: Element, x0: number, dx: number, dy = 0) => {
      touch(target, "touchstart", x0, 300, { timeStamp: 0 });
      touch(target, "touchmove", x0 + dx, 300 + dy, { timeStamp: 100 });
      touch(target, "touchend", x0 + dx, 300 + dy, { timeStamp: 150 });
    };
    swipe(el(), 60, 200); // mid-screen
    swipe(el(), 8, 30, 80); // vertical scroll
    swipe(el(".field"), 8, 200);
    swipe(el(".chip"), 8, 200); // filter chips scroll sideways
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    swipe(el(), 8, 200);
    expect(back).not.toHaveBeenCalled();
  });

  it("once it owns the gesture it stops the page scrolling under it", () => {
    const { el } = swipeHarness();
    touch(el(), "touchstart", 8, 300);
    const move = touch(el(), "touchmove", 80, 302);
    expect(move.defaultPrevented).toBe(true);
    expect(policy.gestureOwner()).toBe("swipe-back");
  });

  it("reduced motion: same decision, no follow-the-finger transform", () => {
    reducedMotion = true;
    const { back, el, screen } = swipeHarness();
    touch(el(), "touchstart", 8, 300, { timeStamp: 0 });
    touch(el(), "touchmove", 200, 300, { timeStamp: 500 });
    vi.advanceTimersByTime(20);
    expect(screen().style.transform).toBe("");
    touch(el(), "touchend", 200, 300, { timeStamp: 600 });
    expect(back).toHaveBeenCalledOnce();
  });

  it("the edge zone starts inside the safe-area padding (landscape notch)", () => {
    const { back, el, screen } = swipeHarness();
    screen().style.paddingLeft = "44px";
    touch(el(), "touchstart", 60, 300, { timeStamp: 0 }); // 44 px inset + 16 px: still the edge
    touch(el(), "touchmove", 260, 300, { timeStamp: 300 });
    touch(el(), "touchend", 260, 300, { timeStamp: 400 });
    expect(back).toHaveBeenCalledOnce();
    touch(el(), "touchstart", 80, 300, { timeStamp: 1000 }); // past inset + 24 px: not the edge
    touch(el(), "touchmove", 300, 300, { timeStamp: 1300 });
    touch(el(), "touchend", 300, 300, { timeStamp: 1400 });
    expect(back).toHaveBeenCalledOnce();
  });

  it("no back handler → no swipe", () => {
    const { back, el } = swipeHarness({ enabled: false });
    touch(el(), "touchstart", 8, 300, { timeStamp: 0 });
    touch(el(), "touchmove", 250, 300, { timeStamp: 100 });
    touch(el(), "touchend", 250, 300, { timeStamp: 150 });
    expect(back).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
function pullHarness(onRefresh: () => Promise<unknown>) {
  let api!: ReturnType<typeof usePullToRefresh>;
  const w = track(mount(Host, {
    attachTo: document.body,
    props: {
      use: (host: Ref<HTMLElement | null>) => (api = usePullToRefresh(host, { enabled: () => true, scroller: () => host.value, onRefresh })),
      view: (host: Ref<HTMLElement | null>) =>
        h("div", { ref: host, class: "scroller" }, [h("p", { class: "row" }, "r"), h("div", { class: "chips", "data-hscroll": "" }, "c")]),
    },
  }));
  const el = w.find(".row").element;
  const pull = (dy: number, dx = 0) => {
    touch(el, "touchstart", 100, 100);
    touch(el, "touchmove", 100 + dx / 2, 100 + dy / 2);
    touch(el, "touchmove", 100 + dx, 100 + dy);
    touch(el, "touchend", 100 + dx, 100 + dy);
  };
  return { w, api: () => api, pull, scroller: () => w.find(".scroller").element as HTMLElement };
}

describe("pull-to-refresh", () => {
  it("resistance is monotonic and capped", () => {
    expect(resist(0)).toBe(0);
    expect(resist(50)).toBeLessThan(resist(100));
    expect(resist(10_000)).toBeLessThanOrEqual(policy.PULL_MAX_PX);
  });

  it("past the threshold at the top: one refresh, refreshing → done → idle, with a success haptic", async () => {
    let resolve!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const { api, pull } = pullHarness(onRefresh);
    pull(260);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(api().phase.value).toBe("refreshing");
    pull(260); // a second pull while refreshing is ignored
    await api().refresh(); // …and so is a direct second call
    expect(onRefresh).toHaveBeenCalledOnce();
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(api().phase.value).toBe("done");
    expect(vibrate).toHaveBeenLastCalledWith([10, 40, 12]);
    await vi.advanceTimersByTimeAsync(700);
    expect(api().phase.value).toBe("idle");
  });

  it("below the threshold, scrolled down, pulling up or sideways, or on a chip row: no refresh", () => {
    const onRefresh = vi.fn(async () => undefined);
    const { pull, scroller, w } = pullHarness(onRefresh);
    pull(60); // resisted distance stays under 64
    pull(-200);
    pull(40, 200);
    Object.defineProperty(scroller(), "scrollTop", { value: 40, configurable: true });
    pull(300);
    Object.defineProperty(scroller(), "scrollTop", { value: 0, configurable: true });
    const chip = w.find(".chips").element;
    touch(chip, "touchstart", 1, 1);
    touch(chip, "touchmove", 1, 300);
    touch(chip, "touchend", 1, 300);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("the pull stops the page from bouncing", () => {
    const { w } = pullHarness(async () => undefined);
    const el = w.find(".row").element;
    touch(el, "touchstart", 100, 100);
    const move = touch(el, "touchmove", 100, 200);
    expect(move.defaultPrevented).toBe(true);
  });

  it("a failed refresh ends in the error state with an error haptic", async () => {
    const { api, pull } = pullHarness(() => Promise.reject(new Error("offline")));
    pull(260);
    await vi.advanceTimersByTimeAsync(0);
    expect(api().phase.value).toBe("error");
    expect(vibrate).toHaveBeenLastCalledWith([24, 50, 24, 50, 24]);
    await vi.advanceTimersByTimeAsync(1700);
    expect(api().phase.value).toBe("idle");
  });

  it("a refresh that never settles times out as an error", async () => {
    const { api, pull } = pullHarness(() => new Promise(() => {}));
    pull(260);
    await vi.advanceTimersByTimeAsync(policy.REFRESH_TIMEOUT_MS + 10);
    expect(api().phase.value).toBe("error");
  });
});

// ---------------------------------------------------------------------------
describe("native history swipe", () => {
  it("is held off while a screen with swipe-back is up, and restored after the last one", () => {
    const a = swipeHarness();
    const b = swipeHarness();
    expect(document.documentElement.style.getPropertyValue("overscroll-behavior-x")).toBe("none");
    a.w.unmount();
    expect(document.documentElement.style.getPropertyValue("overscroll-behavior-x")).toBe("none");
    b.w.unmount();
    expect(document.documentElement.style.getPropertyValue("overscroll-behavior-x")).toBe("");
  });
});

describe("haptics", () => {
  it("platforms without vibration: a silent no-op", () => {
    Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true, writable: true });
    expect(haptics.hapticsSupported()).toBe(false);
    expect(() => haptics.haptic("success")).not.toThrow();
    expect(haptics.haptic("success")).toBe(false);
  });
  it("where supported: the pattern for the meaning, throttled against bursts", () => {
    expect(haptics.haptic("selection", 1000)).toBe(true);
    expect(haptics.haptic("selection", 1030)).toBe(false);
    expect(haptics.haptic("warning", 1200)).toBe(true);
    expect(vibrate.mock.calls).toEqual([[5], [[18, 60, 18]]]);
  });
});

// ---------------------------------------------------------------------------
describe("no listeners left behind", () => {
  it("every gesture removes exactly what it added when its screen unmounts", () => {
    const added = new Map<string, number>();
    const removed = new Map<string, number>();
    const origAdd = HTMLElement.prototype.addEventListener;
    const origRemove = HTMLElement.prototype.removeEventListener;
    HTMLElement.prototype.addEventListener = function (type: string, ...rest: unknown[]) {
      if (type.startsWith("touch") || ["click", "contextmenu", "scroll"].includes(type)) added.set(type, (added.get(type) ?? 0) + 1);
      return (origAdd as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof origAdd;
    HTMLElement.prototype.removeEventListener = function (type: string, ...rest: unknown[]) {
      if (type.startsWith("touch") || ["click", "contextmenu", "scroll"].includes(type)) removed.set(type, (removed.get(type) ?? 0) + 1);
      return (origRemove as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof origRemove;
    try {
      const a = longPressHarness();
      const b = swipeHarness();
      const c = pullHarness(async () => undefined);
      touch(a.text(), "touchstart", 1, 1); // a pending timer too
      a.w.unmount();
      b.w.unmount();
      c.w.unmount();
      expect(Object.fromEntries(removed)).toEqual(Object.fromEntries(added));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      HTMLElement.prototype.addEventListener = origAdd;
      HTMLElement.prototype.removeEventListener = origRemove;
    }
  });
});
