import { invoke, isTauri } from "@tauri-apps/api/core";
import { currentNotificationSettings, type NotificationSlot } from "./notificationSettings";
import type { NotificationTarget } from "./notificationEngine";
import { pushInAppToast, type InAppToast } from "./inAppToasts";

/**
 * OS notifications — the ACTION step of the pipeline (notificationEngine.ts).
 *
 * Desktop app: the native `show_notification` command (src-tauri/src/notifications.rs)
 * — a real Windows toast whose click focuses the app and routes to the target.
 * Browser build: the web Notification API. Never an in-page HTML imitation.
 *
 * Exactly ONE sound per alert: the native toast plays the Windows notification
 * sound (or is silent when Sound is off); the synthesized chime is only used
 * where there is no OS sound (browser build) and for Settings → Preview.
 *
 * Permission on Windows is the real OS setting (`ToastNotifier.Setting`):
 * "denied" when notifications are off for the app, for the user, or by policy.
 * Windows has no permission prompt, so "requesting" re-reads that state.
 */
export type PermissionState = "granted" | "denied" | "default" | "unsupported";

export async function notificationPermission(): Promise<PermissionState> {
  if (isTauri()) {
    try {
      return (await invoke<string>("notification_permission")) === "denied" ? "denied" : "granted";
    } catch {
      return "unsupported";
    }
  }
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission as PermissionState;
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (isTauri()) return notificationPermission();
  if (typeof Notification === "undefined") return "unsupported";
  return (await Notification.requestPermission()) as PermissionState;
}

export interface AlertInput {
  slot: NotificationSlot;
  title: string;
  body: string;
  /** Whether the person is currently looking at where this happened. */
  viewing: boolean;
  /** Where a click on the toast should land (ids only). */
  target?: NotificationTarget;
  /**
   * What an in-app toast needs beyond title/body. Without it the alert can only
   * go native (e.g. Settings → Test, which must exercise the real OS path).
   */
  inApp?: Pick<InAppToast, "id" | "context" | "authorPubkey" | "authorName" | "createdAt" | "mentions" | "mentionsEveryone">;
}

/** Where an alert is shown. Exactly one surface per event — never both. */
export type AlertSurface = "native" | "in-app";

/**
 * SWF window focused (the person is in the app) → the in-app toast; background,
 * minimized or another app in front → the Windows toast (+ taskbar dot).
 */
export function pickSurface(windowFocused: boolean, hasInApp: boolean): AlertSurface {
  return windowFocused && hasInApp ? "in-app" : "native";
}

export function isWindowFocused(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden" && document.hasFocus();
}

/** Decide (pure) whether an event should raise an OS alert under these settings. */
export function shouldAlert(input: Pick<AlertInput, "slot" | "viewing">, settings = currentNotificationSettings(), windowFocused = true): boolean {
  if (!settings.desktopEnabled || !settings.slots[input.slot]) return false;
  if (input.viewing && windowFocused && !settings.notifyWhileViewing) return false;
  return true;
}

/**
 * A short, soft two-note chime, synthesized once into a tiny in-memory WAV and
 * played with a plain <audio> element — no audio asset, and no Web Audio
 * graph (the product boundary excludes audio capture/processing entirely).
 */
function chimeWav(): Blob {
  const rate = 22050;
  const notes = [660, 880];
  const noteLen = Math.floor(rate * 0.18);
  const samples = new Int16Array(noteLen * notes.length);
  notes.forEach((freq, n) => {
    for (let i = 0; i < noteLen; i++) {
      const t = i / rate;
      const envelope = Math.min(1, i / (rate * 0.01)) * Math.exp(-t * 14);
      samples[n * noteLen + i] = Math.round(Math.sin(2 * Math.PI * freq * t) * envelope * 0.25 * 32767);
    }
  });
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, value: string) => [...value].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  header.setUint32(4, 36 + samples.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, samples.byteLength, true);
  return new Blob([header.buffer, samples.buffer], { type: "audio/wav" });
}

let chimeUrl: string | null = null;
export function playChime(): void {
  try {
    chimeUrl ??= URL.createObjectURL(chimeWav());
    void new Audio(chimeUrl).play().catch(() => undefined);
  } catch {
    // Audio unavailable — the visual alert still happened.
  }
}

/**
 * Raise an alert if the settings allow it, on ONE surface (see `pickSurface`).
 * Returns the surface used, or null when nothing was shown.
 *
 * One sound per alert: the Windows toast carries the system sound; an in-app
 * toast (or the browser build) plays the chime instead.
 */
export async function alertIfAllowed(input: AlertInput): Promise<AlertSurface | null> {
  const settings = currentNotificationSettings();
  const focused = isWindowFocused();
  if (!shouldAlert(input, settings, focused)) return null;

  if (pickSurface(focused, !!input.inApp) === "in-app" && input.inApp) {
    pushInAppToast({ ...input.inApp, slot: input.slot, title: input.title, body: input.body, target: input.target });
    if (settings.soundEnabled) playChime();
    return "in-app";
  }

  if ((await notificationPermission()) !== "granted") return null;
  try {
    if (isTauri()) {
      const { title, body, target } = input;
      await invoke("show_notification", {
        title,
        body,
        target: target ? JSON.stringify(target) : null,
        sound: settings.soundEnabled,
      });
      return "native"; // the toast carried the (single) sound
    }
    new Notification(input.title, { body: input.body, silent: true });
  } catch {
    return null;
  }
  if (settings.soundEnabled) playChime();
  return "native";
}

/** Windows taskbar overlay (red dot). No-op outside the desktop app. */
export async function setTaskbarIndicator(show: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("set_unread_indicator", { show });
  } catch {
    // Non-Windows / no window: nothing to show.
  }
}
