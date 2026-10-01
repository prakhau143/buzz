/**
 * The pure models behind Appearance, Notifications, Mobile pairing and
 * Custom emoji.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  __setAppearanceForTests,
  applyAppearance,
  clampZoom,
  sanitizeAppearance,
} from "@/features/appearance/appearance";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationSettings,
  notificationStorageKey,
  sanitizeNotificationSettings,
  updateNotificationSettings,
} from "@/features/notifications/notificationSettings";
import { shouldAlert } from "@/features/notifications/desktopNotifier";
import { pairingReducer, type PairingStep } from "@/features/mobilePairing/pairing";
import { normalizeShortcode, suggestShortcode, unionPalette } from "@/features/customEmoji/customEmoji";
import type { RawNostrEvent } from "@/protocol/types";

beforeEach(() => localStorage.clear());

describe("appearance", () => {
  it("sanitizes stored values field by field", () => {
    expect(sanitizeAppearance({ mode: "dark", accent: "nope", zoom: 9, fontSize: "larger" })).toEqual({
      ...DEFAULT_APPEARANCE,
      mode: "dark",
      fontSize: "larger",
      zoom: 1.5,
    });
    expect(sanitizeAppearance("garbage")).toEqual(DEFAULT_APPEARANCE);
  });

  it("zoom snaps to 10% steps within 80–150%", () => {
    expect(clampZoom(1.04)).toBe(1);
    expect(clampZoom(0.1)).toBe(0.8);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("applies the theme for the resolved scheme as attributes the CSS consumes", () => {
    const root = document.createElement("html");
    __setAppearanceForTests({ ...DEFAULT_APPEARANCE, mode: "system", darkTheme: "midnight", density: "compact" }, true);
    applyAppearance(root);
    expect(root.dataset.theme).toBe("midnight");
    expect(root.dataset.colorScheme).toBe("dark");
    expect(root.dataset.density).toBe("compact");
    __setAppearanceForTests({ ...DEFAULT_APPEARANCE, mode: "light" }, true);
    applyAppearance(root);
    expect(root.dataset.theme).toBe("swf-light");
  });
});

describe("notifications", () => {
  it("are stored per identity and fall back safely", () => {
    loadNotificationSettings("ABC");
    expect(updateNotificationSettings({ notifyWhileViewing: true, slots: { dm: false } })).toBe(true);
    expect(JSON.parse(localStorage.getItem(notificationStorageKey("abc"))!)).toMatchObject({ notifyWhileViewing: true, slots: { dm: false } });
    expect(sanitizeNotificationSettings({ slots: { mention: "yes" } })).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    // No agent job slots are carried over from OLD BUZZ.
    expect(Object.keys(DEFAULT_NOTIFICATION_SETTINGS.slots)).toEqual(["dm", "mention", "thread_reply", "needs_action"]);
  });

  it("alert rules: master switch, per-slot switch, and notify-while-viewing", () => {
    const s = { ...DEFAULT_NOTIFICATION_SETTINGS, slots: { ...DEFAULT_NOTIFICATION_SETTINGS.slots } };
    expect(shouldAlert({ slot: "dm", viewing: false }, s)).toBe(true);
    expect(shouldAlert({ slot: "dm", viewing: true }, s, true)).toBe(false);
    expect(shouldAlert({ slot: "dm", viewing: true }, { ...s, notifyWhileViewing: true }, true)).toBe(true);
    expect(shouldAlert({ slot: "dm", viewing: true }, s, false)).toBe(true); // window in background
    expect(shouldAlert({ slot: "mention", viewing: false }, { ...s, slots: { ...s.slots, mention: false } })).toBe(false);
    expect(shouldAlert({ slot: "dm", viewing: false }, { ...s, desktopEnabled: false })).toBe(false);
  });
});

describe("mobile pairing state", () => {
  const started = { qrUri: "nostrpair://x", pairingRelay: "ws://localhost:3000/pair", expiresInSecs: 120 };
  const run = (signals: Parameters<typeof pairingReducer>[1][]) =>
    signals.reduce<PairingStep>((s, sig) => pairingReducer(s, sig), { step: "idle" });

  it("walks start → QR → code → confirm → phone confirms", () => {
    const s = run([
      { type: "start" },
      { type: "started", started, now: 0 },
      { type: "sas", sas: "123456" },
      { type: "confirm" },
      { type: "confirmed", now: 1 },
      { type: "complete" },
    ]);
    expect(s).toEqual({ step: "done" });
  });

  it("never reports success without the phone's confirmation", () => {
    expect(run([{ type: "start" }, { type: "started", started, now: 0 }, { type: "complete" }]).step).toBe("qr");
    expect(run([{ type: "start" }, { type: "started", started, now: 0 }, { type: "sas", sas: "1" }, { type: "complete" }]).step).toBe("sas");
  });

  it("expires after two minutes and maps timeouts/aborts to their own states", () => {
    expect(run([{ type: "start" }, { type: "started", started, now: 0 }, { type: "tick", now: 120_000 }]).step).toBe("expired");
    expect(run([{ type: "start" }, { type: "started", started, now: 0 }, { type: "error", message: "Session timed out" }]).step).toBe("expired");
    expect(run([{ type: "start" }, { type: "started", started, now: 0 }, { type: "aborted", message: "codes didn't match" }])).toEqual({
      step: "aborted",
      message: "codes didn't match",
    });
    // Late events after a reset are ignored.
    expect(run([{ type: "start" }, { type: "reset" }, { type: "aborted", message: "late" }]).step).toBe("idle");
  });
});

describe("custom emoji", () => {
  it("normalizes shortcodes and suggests one from a filename", () => {
    expect(normalizeShortcode(":Party_Parrot:")).toBe("party_parrot");
    expect(normalizeShortcode("has space")).toBeNull();
    expect(normalizeShortcode("x".repeat(65))).toBeNull();
    expect(suggestShortcode("My Cat (1).PNG")).toBe("my_cat_1");
  });

  it("the palette is the union of members' sets; newest wins per shortcode", () => {
    const set = (pubkey: string, created_at: number, emoji: [string, string][]): RawNostrEvent =>
      ({ id: pubkey, pubkey, kind: 30030, created_at, content: "", sig: "s", tags: [["d", "buzz:custom-emoji"], ...emoji.map(([c, u]) => ["emoji", c, u])] }) as RawNostrEvent;
    const palette = unionPalette([
      set("a".repeat(64), 10, [["fire", "https://c/1.png"], ["cool", "https://c/2.png"]]),
      set("b".repeat(64), 20, [["fire", "https://c/3.png"], ["bad code", "https://c/4.png"], ["x", "javascript:alert(1)"]]),
    ]);
    expect(palette.map((e) => [e.shortcode, e.url])).toEqual([
      ["cool", "https://c/2.png"],
      ["fire", "https://c/3.png"],
    ]);
  });
});
