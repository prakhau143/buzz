import { onMounted, onUnmounted } from "vue";
import { presenceService } from "./PresenceService";
import { logError } from "@/services/errors";
import {
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  PRESENCE_IDLE_TIMEOUT_MS,
  type PresenceStatus,
} from "@/protocol/presence";

/** How often idle is re-evaluated (OLD BUZZ `PRESENCE_STATUS_TICK_INTERVAL_MS`). */
const STATUS_TICK_MS = 30_000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "wheel", "keydown", "focus"] as const;

/**
 * Publishes this identity's presence the way OLD BUZZ does (`usePresenceSession`):
 * "online", or "away" after 10 minutes without activity; sent on every change
 * and re-sent every 60 s so the relay's 180 s entry never lapses while the app
 * is open. Window blur does NOT mean away — only inactivity does. On quit the
 * relay clears presence itself when the last connection closes.
 *
 * Activity is in-app input (OLD BUZZ's fallback path; its primary source is an
 * OS idle probe SWF Buzz does not have). Call once, from AppHeader.
 */
export function usePresenceHeartbeat(): void {
  let lastActivity = Date.now();
  let lastSent: PresenceStatus | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const current = (): PresenceStatus =>
    Date.now() - lastActivity >= PRESENCE_IDLE_TIMEOUT_MS ? "away" : "online";

  function send(status: PresenceStatus): void {
    lastSent = status;
    presenceService.publish(status).catch((err) => logError("usePresenceHeartbeat", err));
  }

  function onActivity(): void {
    lastActivity = Date.now();
    if (lastSent === "away") send("online");
  }

  onMounted(() => {
    send(current());
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
    tick = setInterval(() => {
      const status = current();
      if (status !== lastSent) send(status);
    }, STATUS_TICK_MS);
    heartbeat = setInterval(() => send(current()), PRESENCE_HEARTBEAT_INTERVAL_MS);
  });

  onUnmounted(() => {
    for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
    if (tick) clearInterval(tick);
    if (heartbeat) clearInterval(heartbeat);
  });
}
