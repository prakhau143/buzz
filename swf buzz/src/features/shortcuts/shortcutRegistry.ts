/**
 * THE keyboard-shortcut registry -- one source of truth for both the handlers
 * and Settings -> Shortcuts.
 *
 * OLD BUZZ kept a display list separate from its handlers, and they drifted:
 * shortcuts shown with no handler, handlers never shown
 * (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md \u00A76). Here a shortcut is shown only
 * because it is defined here, and:
 *
 *  - `scope: "global"` entries are dispatched by `useShortcutDispatcher` from
 *    this very definition (`matches`) to whichever component registered a
 *    handler with `useShortcut(id, ...)`;
 *  - component-scoped entries (composer, dialog) name the file that handles the
 *    key, and a unit test checks that file really does.
 *
 * Nothing for excluded features (agents, huddles, terminal, git) is listed.
 */

export type ShortcutCategory = "Navigation" | "View" | "Messages" | "Dialogs";
export type ShortcutScope = "global" | "composer" | "dialog";

export interface ShortcutDef {
  id: string;
  label: string;
  category: ShortcutCategory;
  scope: ShortcutScope;
  /** Key caps to display, per platform. */
  keys: { mac: string[]; other: string[] };
  /** Global shortcuts: does this keydown trigger it? */
  matches?: (event: KeyboardEvent, isMac: boolean) => boolean;
  /** Component-scoped shortcuts: the source file that handles the key. */
  handledIn?: string;
  /** Fires even while typing in an input/textarea/contenteditable. */
  allowInEditable?: boolean;
}

/** Cmd on macOS, Ctrl elsewhere -- and never both. */
function primary(event: KeyboardEvent, isMac: boolean): boolean {
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

function key(event: KeyboardEvent, ...names: string[]): boolean {
  return names.includes(event.key.length === 1 ? event.key.toLowerCase() : event.key);
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: "open-settings",
    label: "Open settings",
    category: "Navigation",
    scope: "global",
    keys: { mac: ["\u2318", ","], other: ["Ctrl", ","] },
    matches: (e, mac) => primary(e, mac) && !e.altKey && !e.shiftKey && key(e, ","),
    allowInEditable: true,
  },
  {
    id: "quick-search",
    label: "Search channels, people and messages",
    category: "Navigation",
    scope: "global",
    keys: { mac: ["\u2318", "K"], other: ["Ctrl", "K"] },
    matches: (e, mac) => primary(e, mac) && !e.altKey && !e.shiftKey && key(e, "k"),
    allowInEditable: true,
  },
  {
    id: "new-channel",
    label: "Create a channel",
    category: "Navigation",
    scope: "global",
    keys: { mac: ["\u21E7", "\u2318", "N"], other: ["Shift", "Ctrl", "N"] },
    matches: (e, mac) => primary(e, mac) && !e.altKey && e.shiftKey && key(e, "n"),
  },
  {
    id: "go-inbox",
    label: "Go to Inbox",
    category: "Navigation",
    scope: "global",
    keys: { mac: ["\u21E7", "\u2318", "A"], other: ["Shift", "Ctrl", "A"] },
    matches: (e, mac) => primary(e, mac) && !e.altKey && e.shiftKey && key(e, "a"),
  },
  {
    id: "go-back",
    label: "Go back",
    category: "Navigation",
    scope: "global",
    keys: { mac: ["\u2325", "\u2190"], other: ["Alt", "\u2190"] },
    matches: (e) => e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === "ArrowLeft",
    allowInEditable: true,
  },
  {
    id: "go-forward",
    label: "Go forward",
    category: "Navigation",
    scope: "global",
    keys: { mac: ["\u2325", "\u2192"], other: ["Alt", "\u2192"] },
    matches: (e) => e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === "ArrowRight",
    allowInEditable: true,
  },
  {
    id: "toggle-sidebar",
    label: "Show or hide the sidebar",
    category: "View",
    scope: "global",
    keys: { mac: ["\u2318", "B"], other: ["Ctrl", "B"] },
    matches: (e, mac) => primary(e, mac) && !e.altKey && !e.shiftKey && key(e, "b"),
  },
  {
    id: "toggle-thread-expanded",
    label: "Expand or restore the open thread",
    category: "View",
    scope: "global",
    keys: { mac: ["\u21E7", "\u2318", "E"], other: ["Shift", "Ctrl", "E"] },
    matches: (e, mac) => primary(e, mac) && !e.altKey && e.shiftKey && key(e, "e"),
  },
  {
    id: "zoom-in",
    label: "Zoom in",
    category: "View",
    scope: "global",
    keys: { mac: ["\u2318", "+"], other: ["Ctrl", "+"] },
    matches: (e, mac) => primary(e, mac) && !e.altKey && key(e, "+", "="),
    allowInEditable: true,
  },
  {
    id: "zoom-out",
    label: "Zoom out",
    category: "View",
    scope: "global",
    keys: { mac: ["\u2318", "\u2212"], other: ["Ctrl", "\u2212"] },
    matches: (e, mac) => primary(e, mac) && !e.altKey && key(e, "-", "_"),
    allowInEditable: true,
  },
  {
    id: "zoom-reset",
    label: "Reset zoom",
    category: "View",
    scope: "global",
    keys: { mac: ["\u2318", "0"], other: ["Ctrl", "0"] },
    matches: (e, mac) => primary(e, mac) && !e.altKey && !e.shiftKey && key(e, "0"),
    allowInEditable: true,
  },
  {
    id: "send-message",
    label: "Send message",
    category: "Messages",
    scope: "composer",
    keys: { mac: ["Enter"], other: ["Enter"] },
    handledIn: "src/components/MessageComposer.vue",
  },
  {
    id: "new-line",
    label: "New line in a message",
    category: "Messages",
    scope: "composer",
    keys: { mac: ["\u21E7", "Enter"], other: ["Shift", "Enter"] },
    handledIn: "src/components/MessageComposer.vue",
  },
  {
    id: "close-dialog",
    label: "Close a dialog, menu or panel",
    category: "Dialogs",
    scope: "dialog",
    keys: { mac: ["Esc"], other: ["Esc"] },
    handledIn: "src/composables/useEscapeKey.ts",
  },
];

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = ["Navigation", "View", "Messages", "Dialogs"];

export function shortcutById(id: string): ShortcutDef | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function shortcutKeys(def: ShortcutDef, mac = isMacPlatform()): string[] {
  return mac ? def.keys.mac : def.keys.other;
}

/** "Ctrl+," / "\u2318," -- for tooltips and aria-keyshortcuts-style hints. */
export function shortcutHint(id: string, mac = isMacPlatform()): string {
  const def = shortcutById(id);
  if (!def) return "";
  return shortcutKeys(def, mac).join(mac ? "" : "+");
}
