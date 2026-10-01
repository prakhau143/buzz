/**
 * Collision-aware placement for a floating menu anchored to a trigger.
 * Pure geometry (no DOM), so every edge case is unit-tested.
 * docs/PHASE_H_MESSAGE_ACTIONS_RICH_LINKS.md §Collision strategy.
 *
 * Vertical: below the trigger when the whole menu fits there; otherwise above
 * when it fits there; otherwise on the roomier side with `maxHeight` capped to
 * that space (the menu then scrolls inside itself). Horizontal: right edges
 * aligned (the trigger sits at the row's right), flipped to left-aligned when
 * that would leave the viewport, then clamped. The result is ALWAYS inside the
 * viewport minus `margin` — the menu can never be cut off.
 */

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The visible area. On mobile/zoom this is the visual viewport, which a soft keyboard shrinks. */
export interface Viewport {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  /** Set only when the menu must scroll to fit. */
  maxHeight: number | null;
  side: "bottom" | "top";
}

export const MENU_GAP = 4;
export const VIEWPORT_MARGIN = 8;

export function placeMenu(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: Viewport,
  opts: { gap?: number; margin?: number } = {},
): Placement {
  const gap = opts.gap ?? MENU_GAP;
  const margin = opts.margin ?? VIEWPORT_MARGIN;
  const minTop = viewport.top + margin;
  const maxBottom = viewport.top + viewport.height - margin;
  const minLeft = viewport.left + margin;
  const maxRight = viewport.left + viewport.width - margin;

  const width = Math.min(size.width, Math.max(0, maxRight - minLeft));
  const spaceBelow = Math.max(0, maxBottom - (anchor.bottom + gap));
  const spaceAbove = Math.max(0, anchor.top - gap - minTop);

  let side: Placement["side"];
  let height = size.height;
  let maxHeight: number | null = null;
  if (size.height <= spaceBelow) side = "bottom";
  else if (size.height <= spaceAbove) side = "top";
  else {
    side = spaceBelow >= spaceAbove ? "bottom" : "top";
    const room = Math.max(spaceBelow, spaceAbove);
    // Not even the larger side fits: cap to the whole usable height at worst.
    maxHeight = Math.max(Math.min(room, maxBottom - minTop), Math.min(size.height, maxBottom - minTop, 120));
    height = maxHeight;
  }

  let top = side === "bottom" ? anchor.bottom + gap : anchor.top - gap - height;
  top = clamp(top, minTop, Math.max(minTop, maxBottom - height));

  let left = anchor.right - width;
  if (left < minLeft) left = anchor.left;
  left = clamp(left, minLeft, Math.max(minLeft, maxRight - width));

  return { top, left, maxHeight, side };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The current visible area — the visual viewport where supported (keyboard, pinch zoom). */
export function currentViewport(): Viewport {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (vv) return { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height };
  return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
}
