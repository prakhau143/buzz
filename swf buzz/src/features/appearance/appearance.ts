import { computed, readonly, ref, watch } from "vue";

/**
 * Appearance preferences -- DEVICE-LOCAL (like OLD BUZZ's font size, density and
 * zoom; docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md \u00A74). They are a property of
 * this screen, not of the person or the community, so they are neither synced
 * to a relay nor cleared on sign-out.
 *
 * Applied as attributes on <html> (`data-theme`, `data-color-scheme`,
 * `data-accent`, `data-font-size`, `data-density`) which `appearance.css`
 * turns into the token values every component already consumes. Applied
 * before the app mounts (`initAppearance`, main.ts) so there is no flash.
 *
 * Only settings SWF can actually honour are offered: there are no link
 * previews, focus-thread layout or window vibrancy in SWF, so OLD BUZZ's
 * controls for those are not copied.
 */

export type ColorMode = "system" | "light" | "dark";
export type LightTheme = "swf-light" | "paper" | "sky";
export type DarkTheme = "swf-dark" | "midnight" | "graphite" | "ocean";
export type Accent = "terracotta" | "indigo" | "emerald" | "violet" | "rose" | "amber" | "cyan";
export type FontSize = "smaller" | "default" | "larger";
export type Density = "compact" | "comfortable" | "spacious";

export interface AppearancePrefs {
  mode: ColorMode;
  lightTheme: LightTheme;
  darkTheme: DarkTheme;
  accent: Accent;
  fontSize: FontSize;
  density: Density;
  /** Whole-app zoom, 0.8\u20131.5 in 0.1 steps. */
  zoom: number;
}

export const LIGHT_THEMES: { id: LightTheme; label: string }[] = [
  { id: "swf-light", label: "SWF Light" },
  { id: "paper", label: "Paper" },
  { id: "sky", label: "Sky" },
];
export const DARK_THEMES: { id: DarkTheme; label: string }[] = [
  { id: "swf-dark", label: "SWF Dark" },
  { id: "midnight", label: "Midnight" },
  { id: "graphite", label: "Graphite" },
  { id: "ocean", label: "Ocean" },
];
export const ACCENTS: { id: Accent; label: string }[] = [
  { id: "terracotta", label: "Terracotta" },
  { id: "indigo", label: "Indigo" },
  { id: "emerald", label: "Emerald" },
  { id: "violet", label: "Violet" },
  { id: "rose", label: "Rose" },
  { id: "amber", label: "Amber" },
  { id: "cyan", label: "Cyan" },
];

export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.1;

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  mode: "system",
  lightTheme: "swf-light",
  darkTheme: "swf-dark",
  accent: "terracotta",
  fontSize: "default",
  density: "comfortable",
  zoom: 1,
};

export const APPEARANCE_STORAGE_KEY = "swf-buzz:appearance.v1";

const oneOf = <T extends string>(value: unknown, allowed: readonly { id: T }[] | readonly T[], fallback: T): T => {
  const ids = (allowed as readonly (T | { id: T })[]).map((a) => (typeof a === "string" ? a : a.id));
  return ids.includes(value as T) ? (value as T) : fallback;
};

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped)) * 10) / 10;
}

/** Parse stored JSON defensively: every field falls back on its own. */
export function sanitizeAppearance(raw: unknown): AppearancePrefs {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    mode: oneOf(v.mode, ["system", "light", "dark"] as const, DEFAULT_APPEARANCE.mode),
    lightTheme: oneOf(v.lightTheme, LIGHT_THEMES, DEFAULT_APPEARANCE.lightTheme),
    darkTheme: oneOf(v.darkTheme, DARK_THEMES, DEFAULT_APPEARANCE.darkTheme),
    accent: oneOf(v.accent, ACCENTS, DEFAULT_APPEARANCE.accent),
    fontSize: oneOf(v.fontSize, ["smaller", "default", "larger"] as const, DEFAULT_APPEARANCE.fontSize),
    density: oneOf(v.density, ["compact", "comfortable", "spacious"] as const, DEFAULT_APPEARANCE.density),
    zoom: typeof v.zoom === "number" ? clampZoom(v.zoom) : DEFAULT_APPEARANCE.zoom,
  };
}

function load(): AppearancePrefs {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return raw ? sanitizeAppearance(JSON.parse(raw)) : { ...DEFAULT_APPEARANCE };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

const prefs = ref<AppearancePrefs>(load());
const systemPrefersDark = ref(false);
/** Set when the last write to storage failed, so the UI never claims "Saved" falsely. */
const persistError = ref<string | null>(null);

export const resolvedScheme = computed<"light" | "dark">(() =>
  prefs.value.mode === "system" ? (systemPrefersDark.value ? "dark" : "light") : prefs.value.mode,
);
export const activeTheme = computed(() =>
  resolvedScheme.value === "dark" ? prefs.value.darkTheme : prefs.value.lightTheme,
);

export function applyAppearance(root: HTMLElement = document.documentElement): void {
  const p = prefs.value;
  root.dataset.theme = activeTheme.value;
  root.dataset.colorScheme = resolvedScheme.value;
  root.dataset.accent = p.accent;
  root.dataset.fontSize = p.fontSize;
  root.dataset.density = p.density;
  root.style.colorScheme = resolvedScheme.value;
  // CSS zoom scales the whole webview uniformly (text, spacing, hit targets).
  root.style.setProperty("zoom", p.zoom === 1 ? "" : String(p.zoom));
}

function persist(next: AppearancePrefs): boolean {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
    persistError.value = null;
    return true;
  } catch {
    persistError.value = "Couldn't save this preference on this device.";
    return false;
  }
}

/** Change one or more preferences. Returns whether it was saved (it is applied either way). */
export function setAppearance(patch: Partial<AppearancePrefs>): boolean {
  const next = sanitizeAppearance({ ...prefs.value, ...patch });
  prefs.value = next;
  return persist(next);
}

export function resetAppearance(): boolean {
  prefs.value = { ...DEFAULT_APPEARANCE };
  return persist(prefs.value);
}

export function zoomBy(direction: 1 | -1 | 0): boolean {
  return setAppearance({ zoom: direction === 0 ? 1 : clampZoom(prefs.value.zoom + direction * ZOOM_STEP) });
}

let initialized = false;

/** Apply stored preferences and follow the OS scheme. Call once, before mount. */
export function initAppearance(): void {
  if (initialized || typeof document === "undefined") return;
  initialized = true;
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (media) {
    systemPrefersDark.value = media.matches;
    media.addEventListener?.("change", (event) => (systemPrefersDark.value = event.matches));
  }
  applyAppearance();
  watch([prefs, resolvedScheme], () => applyAppearance(), { deep: true });
  // Another window of the app changed it.
  window.addEventListener("storage", (event) => {
    if (event.key === APPEARANCE_STORAGE_KEY) prefs.value = load();
  });
}

export function useAppearance() {
  return {
    prefs: readonly(prefs),
    resolvedScheme,
    activeTheme,
    persistError: readonly(persistError),
    set: setAppearance,
    reset: resetAppearance,
    zoomBy,
  };
}

/** Test helper. */
export function __setAppearanceForTests(next: AppearancePrefs, prefersDark = false): void {
  prefs.value = next;
  systemPrefersDark.value = prefersDark;
}
