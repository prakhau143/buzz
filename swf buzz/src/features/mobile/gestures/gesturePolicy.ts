/**
 * THE touch-gesture policy for the mobile app: every gesture (long press,
 * swipe-back, pull-to-refresh) reads its thresholds and its "leave this touch
 * alone" rules from here, and claims a touch sequence through the same owner
 * slot — so one finger movement is interpreted by exactly one gesture, never
 * by several components at once.
 *
 * Touch events only: the desktop (mouse / pen) keeps hover rows, menus and
 * normal text selection; these gestures never run there.
 */

export const LONG_PRESS_MS = 500;
/** Finger travel that turns a press into a scroll / swipe (cancels a long press). */
export const MOVE_TOLERANCE_PX = 10;
/** Swipe-back must start this close to the left edge (plus the safe-area inset). */
export const EDGE_WIDTH_PX = 24;
/** Commit a swipe-back past this share of the screen width… */
export const SWIPE_COMMIT_RATIO = 0.35;
/** …or with a flick at least this fast (px / ms) over a minimum distance. */
export const SWIPE_VELOCITY = 0.45;
export const SWIPE_MIN_FLICK_PX = 40;
/** Pull-to-refresh: how far (after resistance) triggers a refresh, and the cap. */
export const PULL_THRESHOLD_PX = 64;
export const PULL_MAX_PX = 110;
export const REFRESH_TIMEOUT_MS = 12_000;

export type GestureKind = "long-press" | "swipe-back" | "pull-refresh";

let owner: GestureKind | null = null;

/** Claim the current touch sequence; false if another gesture already has it. */
export function claimGesture(kind: GestureKind): boolean {
  if (owner && owner !== kind) return false;
  owner = kind;
  return true;
}
export function releaseGesture(kind: GestureKind): void {
  if (owner === kind) owner = null;
}
/**
 * A new single-finger touch sequence has begun: any claim still held is from a
 * finished sequence whose release never reached its gesture (e.g. the row
 * under the finger was removed, so `touchend` fired on a detached node and
 * never bubbled to the host). Without this, a lost release would leave every
 * other gesture locked out until that same gesture ran again.
 */
export function beginTouchSequence(event: TouchEvent): void {
  if (event.touches.length === 1) owner = null;
}
export const gestureOwner = () => owner;
export function resetGesturesForTests(): void {
  owner = null;
}

const INTERACTIVE =
  'a[href], button, input, textarea, select, label, [contenteditable=""], [contenteditable="true"], video, audio, [role="button"], [role="switch"], [role="slider"], .attachments, [data-no-gesture]';

/** Links, buttons, fields, media and attachment controls keep their own touch behaviour. */
export function isInteractiveTarget(target: EventTarget | null, within?: Element | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  const hit = el.closest(INTERACTIVE);
  return !!hit && (!within || within.contains(hit));
}

/** Is the touch inside something that scrolls sideways (filter chips, tab rows, carousels)? */
export function inHorizontalScroller(target: EventTarget | null, stopAt?: Element | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== stopAt && el !== document.body) {
    if (el instanceof HTMLElement) {
      if (el.dataset.hscroll !== undefined) return true;
      const ox = getComputedStyle(el).overflowX;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1) return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * While an app swipe-back is active, the browser's own horizontal overscroll
 * history gesture (Chrome / WebKit "swipe to go back") must not also fire —
 * otherwise a sideways drag (e.g. on filter chips at their scroll edge) leaves
 * the app. Reference-counted; restored when the last screen with swipe-back
 * unmounts. Tauri WebViews don't enable that gesture; this covers browsers.
 */
let nativeHistoryHolds = 0;
export function holdNativeHistorySwipe(): () => void {
  const root = document.documentElement;
  if (nativeHistoryHolds++ === 0) root.style.setProperty("overscroll-behavior-x", "none");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--nativeHistoryHolds === 0) root.style.removeProperty("overscroll-behavior-x");
  };
}

/** A sheet or dialog owns the screen: page gestures stand down. */
export const modalOpen = () => !!document.querySelector('[aria-modal="true"]');

export const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** First touch point of a TouchEvent (touchend reports it in `changedTouches`). */
export function pointOf(event: TouchEvent): { x: number; y: number } | null {
  const t = event.touches?.[0] ?? event.changedTouches?.[0];
  return t ? { x: t.clientX, y: t.clientY } : null;
}
