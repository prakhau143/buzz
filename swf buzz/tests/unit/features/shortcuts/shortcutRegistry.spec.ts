/**
 * One shortcut registry for handlers AND Settings → Shortcuts. OLD BUZZ's
 * list drifted from its handlers (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md §6);
 * these tests make that impossible here: every displayed shortcut has a real
 * handler, and dispatch is driven by the same definitions that are displayed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SHORTCUTS, shortcutHint } from "@/features/shortcuts/shortcutRegistry";
import { dispatchShortcut, registerShortcutHandler, resetShortcutHandlersForTests } from "@/features/shortcuts/useShortcuts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|vue)$/.test(name) ? [path] : [];
  });
}
const allSource = sourceFiles("src")
  .filter((f) => !f.includes("shortcutRegistry") && !f.includes("useShortcuts"))
  .map((f) => readFileSync(f, "utf-8"))
  .join("\n");

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => new KeyboardEvent("keydown", { key: k, cancelable: true, ...mods });

afterEach(() => resetShortcutHandlersForTests());

describe("shortcut registry = what actually works", () => {
  it("every GLOBAL shortcut is bound somewhere with useShortcut(id)", () => {
    for (const s of SHORTCUTS.filter((d) => d.scope === "global")) {
      expect(s.matches, s.id).toBeTypeOf("function");
      expect(allSource.includes(`useShortcut("${s.id}"`), `no handler for ${s.id}`).toBe(true);
    }
  });

  it("every component-scoped shortcut names a file that really handles that key", () => {
    for (const s of SHORTCUTS.filter((d) => d.scope !== "global")) {
      const file = readFileSync(s.handledIn!, "utf-8");
      const keyName = s.keys.other[s.keys.other.length - 1] === "Esc" ? "Escape" : s.keys.other[s.keys.other.length - 1];
      expect(file.includes(keyName) || file.toLowerCase().includes(keyName.toLowerCase()), `${s.id} in ${s.handledIn}`).toBe(true);
    }
  });

  it("no shortcut for an excluded feature (agents, huddle, terminal, git)", () => {
    for (const s of SHORTCUTS) {
      expect(`${s.id} ${s.label}`.toLowerCase()).not.toMatch(/agent|huddle|push-to-talk|terminal|git/);
    }
  });

  it("ids are unique and every shortcut has keys for both platforms", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUTS) {
      expect(s.keys.mac.length, s.id).toBeGreaterThan(0);
      expect(s.keys.other.length, s.id).toBeGreaterThan(0);
    }
  });
});

describe("dispatch", () => {
  it("routes Ctrl+, to open-settings on Windows and Cmd+, on macOS, and consumes the key", () => {
    const handler = vi.fn();
    registerShortcutHandler("open-settings", handler);
    const win = key(",", { ctrlKey: true });
    expect(dispatchShortcut(win, false)).toBe("open-settings");
    expect(win.defaultPrevented).toBe(true);
    expect(dispatchShortcut(key(",", { metaKey: true }), true)).toBe("open-settings");
    expect(dispatchShortcut(key(",", { metaKey: true }), false)).toBeNull(); // Meta is not primary off macOS
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no component currently handles the shortcut", () => {
    expect(dispatchShortcut(key("k", { ctrlKey: true }), false)).toBeNull();
  });

  it("the most recently mounted handler wins, and unregistering restores the previous one", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerShortcutHandler("quick-search", first);
    const off = registerShortcutHandler("quick-search", second);
    dispatchShortcut(key("k", { ctrlKey: true }), false);
    expect(second).toHaveBeenCalledTimes(1);
    off();
    dispatchShortcut(key("k", { ctrlKey: true }), false);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("shortcuts not meant for text fields don't fire while typing", () => {
    const handler = vi.fn();
    registerShortcutHandler("new-channel", handler);
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = key("n", { ctrlKey: true, shiftKey: true });
    Object.defineProperty(event, "target", { value: input });
    expect(dispatchShortcut(event, false)).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("an event a component already handled is left alone", () => {
    const handler = vi.fn();
    registerShortcutHandler("quick-search", handler);
    const event = key("k", { ctrlKey: true });
    event.preventDefault();
    expect(dispatchShortcut(event, false)).toBeNull();
  });

  it("hints are built from the same definitions", () => {
    expect(shortcutHint("open-settings", false)).toBe("Ctrl+,");
    expect(shortcutHint("go-back", false)).toBe("Alt+←");
  });
});
