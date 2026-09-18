import { onMounted, onUnmounted } from "vue";
import { presenceService } from "./PresenceService";
import { logError } from "@/services/errors";

const HEARTBEAT_INTERVAL_MS = 60_000;

/** Publishes "online" once on mount and on a heartbeat interval. Call once, from AppShell. */
export function usePresenceHeartbeat(): void {
  let timer: ReturnType<typeof setInterval> | null = null;

  function beat(): void {
    presenceService.publish("online").catch((err) => logError("usePresenceHeartbeat", err));
  }

  onMounted(() => {
    beat();
    timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });
}
