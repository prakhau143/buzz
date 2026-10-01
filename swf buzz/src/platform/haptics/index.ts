/**
 * Haptic feedback, used sparingly (a long-press sheet opening, a reaction, a
 * refresh result, a destructive confirmation). The platform layer is the Web
 * Vibration API where it exists (Android WebView, Android browsers); iOS
 * WebViews and desktops don't expose one, so every call is a silent no-op
 * there — no dependency, no permission prompt, nothing thrown.
 *
 * Throttled so a burst of the SAME feedback can never become a buzz (a
 * different meaning — e.g. an error right after a selection tick — still plays).
 */
export type HapticKind = "lightTap" | "selection" | "success" | "warning" | "error";

const PATTERNS: Record<HapticKind, number | number[]> = {
  lightTap: 8,
  selection: 5,
  success: [10, 40, 12],
  warning: [18, 60, 18],
  error: [24, 50, 24, 50, 24],
};
const MIN_GAP_MS = 80;
let last = 0;
let lastKind: HapticKind | null = null;

export function hapticsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/** Fire one haptic. Returns whether the platform accepted it (false = no-op). */
export function haptic(kind: HapticKind, now: number = Date.now()): boolean {
  if (!hapticsSupported()) return false;
  if (kind === lastKind && now - last < MIN_GAP_MS) return false;
  last = now;
  lastKind = kind;
  try {
    return navigator.vibrate(PATTERNS[kind]);
  } catch {
    return false;
  }
}

export function resetHapticsForTests(): void {
  last = 0;
  lastKind = null;
}
