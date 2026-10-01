import { ref, type Ref } from "vue";

/**
 * Resizable panel widths (docs/PANEL_RESIZE_IMPLEMENTATION.md).
 *
 * Every divider is VERTICAL and is dragged HORIZONTALLY: only widths change,
 * only `clientX` is read. Widths are a DEVICE-local layout preference (like
 * appearance) — never part of a Nostr profile, never per community.
 *
 * Defaults are the widths the UI already rendered before resizing existed
 * (AppShell 260px sidebar / 300px details, Inbox 365px list), so nobody's
 * layout moves until they drag.
 */
export type PanelId = "sidebar" | "details" | "inboxList";

export interface PanelSpec {
  min: number;
  default: number;
  max: number;
}

export const PANEL_SPECS: Record<PanelId, PanelSpec> = {
  sidebar: { min: 200, default: 260, max: 420 },
  details: { min: 280, default: 300, max: 640 },
  inboxList: { min: 300, default: 365, max: 520 },
};

/** The conversation / message column never gets narrower than this while panels are in-flow. */
export const MAIN_MIN_WIDTH = 360;
/** The Inbox detail column's floor (it sits inside the main pane). */
export const INBOX_DETAIL_MIN_WIDTH = 320;

export const KEY_STEP = 10;
export const KEY_STEP_LARGE = 50;

export const panelStorageKey = (id: PanelId) => `swf-buzz:layout.${id}-width.v1`;
/** Pre-existing Inbox key — read once as a fallback so a saved width survives. */
const LEGACY_KEYS: Partial<Record<PanelId, string>> = { inboxList: "swf-buzz:inbox-list-width" };

export function clamp(n: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(n, min), Math.max(min, max)));
}

export function clampPanel(id: PanelId, width: number): number {
  const s = PANEL_SPECS[id];
  return clamp(Number.isFinite(width) ? width : s.default, s.min, s.max);
}

/**
 * Upper bound for a panel given the space it shares: its own max, or whatever
 * leaves `reserved` px for everything else — never below its own min.
 */
export function availableMax(id: PanelId, containerWidth: number, reserved: number): number {
  const s = PANEL_SPECS[id];
  if (!(containerWidth > 0)) return s.max;
  return Math.max(s.min, Math.min(s.max, Math.floor(containerWidth - reserved)));
}

/**
 * Fit the AppShell's in-flow panels into `total` px while leaving the main
 * column at least MAIN_MIN_WIDTH. The stored preferences are not changed —
 * a narrower window only renders them smaller. The details pane gives way
 * first (it is the transient one), then the sidebar; neither below its min.
 */
export function fitShellPanels(
  total: number,
  sidebar: number | null,
  details: number | null,
): { sidebar: number | null; details: number | null } {
  let s = sidebar === null ? null : clampPanel("sidebar", sidebar);
  let d = details === null ? null : clampPanel("details", details);
  if (!(total > 0)) return { sidebar: s, details: d };
  let overflow = (s ?? 0) + (d ?? 0) + MAIN_MIN_WIDTH - total;
  if (overflow > 0 && d !== null) {
    const give = Math.min(overflow, d - PANEL_SPECS.details.min);
    d -= give;
    overflow -= give;
  }
  if (overflow > 0 && s !== null) {
    s -= Math.min(overflow, s - PANEL_SPECS.sidebar.min);
  }
  return { sidebar: s, details: d };
}

/**
 * EXPANDED THREAD (docs/THREAD_EXPANDED_VIEW.md): the thread grows toward the
 * left while the conversation stays visible as a narrower column.
 *
 * - The conversation keeps at least EXPANDED_MAIN_MIN_WIDTH (readable names +
 *   message text; the composer still fits).
 * - The default split gives the conversation ~28% of the space right of the
 *   sidebar, never less than that floor.
 * - The docked width (`details`, persisted) is never touched: restoring
 *   returns to it. The expanded width is session-only.
 */
export const EXPANDED_MAIN_MIN_WIDTH = 300;
export const EXPANDED_MAIN_SHARE = 0.28;

export interface ExpandedThreadFit {
  sidebar: number | null;
  thread: number;
  min: number;
  max: number;
  /** The default expanded width for this space (double-click on the divider). */
  preferred: number;
}

export function fitExpandedThread(total: number, sidebar: number | null, chosen: number | null): ExpandedThreadFit {
  const min = PANEL_SPECS.details.min;
  let s = sidebar === null ? null : clampPanel("sidebar", sidebar);
  if (!(total > 0)) {
    const w = chosen ?? PANEL_SPECS.details.max;
    return { sidebar: s, thread: w, min, max: Math.max(min, w), preferred: w };
  }
  // Too tight for sidebar + floor + a minimal thread: the sidebar gives way first.
  const overflow = (s ?? 0) + EXPANDED_MAIN_MIN_WIDTH + min - total;
  if (overflow > 0 && s !== null) s -= Math.min(overflow, s - PANEL_SPECS.sidebar.min);
  const available = total - (s ?? 0);
  const max = Math.max(min, Math.floor(available - EXPANDED_MAIN_MIN_WIDTH));
  const main = Math.max(EXPANDED_MAIN_MIN_WIDTH, Math.round(available * EXPANDED_MAIN_SHARE));
  const preferred = clamp(available - main, min, max);
  return { sidebar: s, thread: clamp(chosen ?? preferred, min, max), min, max, preferred };
}

/**
 * Width after a horizontal drag. `edge` is where the handle sits on the panel:
 * "end" = right edge (a left-hand panel: dragging right grows it), "start" =
 * left edge (a right-hand panel: dragging right shrinks it).
 */
export function dragWidth(startWidth: number, startX: number, clientX: number, edge: "start" | "end"): number {
  const dx = clientX - startX;
  return edge === "end" ? startWidth + dx : startWidth - dx;
}

/**
 * Keyboard: the arrows move the DIVIDER in their direction (so on a right-hand
 * panel ArrowLeft makes it wider); Home/End go to the min/max width.
 * Returns null for keys the separator does not handle.
 */
export function keyWidth(
  key: string,
  shift: boolean,
  width: number,
  min: number,
  max: number,
  edge: "start" | "end",
): number | null {
  const step = shift ? KEY_STEP_LARGE : KEY_STEP;
  const sign = edge === "end" ? 1 : -1;
  switch (key) {
    case "ArrowRight":
      return clamp(width + sign * step, min, max);
    case "ArrowLeft":
      return clamp(width - sign * step, min, max);
    case "Home":
      return min;
    case "End":
      return max;
    default:
      return null;
  }
}

function readStored(id: PanelId): number {
  for (const key of [panelStorageKey(id), LEGACY_KEYS[id]]) {
    if (!key) continue;
    try {
      const raw = localStorage.getItem(key);
      const n = raw === null ? NaN : Number(raw);
      if (Number.isFinite(n) && n > 0) return clampPanel(id, n);
    } catch {
      // storage unavailable: defaults
    }
  }
  return PANEL_SPECS[id].default;
}

/** Returns whether it was written. */
export function persistPanelWidth(id: PanelId, width: number): boolean {
  try {
    localStorage.setItem(panelStorageKey(id), String(clampPanel(id, width)));
    return true;
  } catch {
    return false; // private mode / quota — the width still applies this session
  }
}

// One ref per panel, shared by every view: Channels, DMs and Inbox all show
// the same sidebar, so a width set in one is the width in the others.
const widths = new Map<PanelId, Ref<number>>();

export function usePanelWidth(id: PanelId) {
  let width = widths.get(id);
  if (!width) {
    width = ref(readStored(id));
    widths.set(id, width);
  }
  const w = width;
  return {
    width: w,
    spec: PANEL_SPECS[id],
    /** Live update while dragging — not persisted. */
    set: (n: number) => (w.value = clampPanel(id, n)),
    /** Persist the current width (pointerup, keyboard, reset). */
    commit: () => persistPanelWidth(id, w.value),
    reset: () => {
      w.value = PANEL_SPECS[id].default;
      persistPanelWidth(id, w.value);
    },
  };
}

/** Tests only. */
export function resetPanelWidthsForTest() {
  widths.clear();
}
