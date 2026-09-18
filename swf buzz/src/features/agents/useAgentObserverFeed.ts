import { onMounted, onUnmounted } from "vue";
import { agentActivityService } from "./AgentActivityService";
import { useAgentActivityStore } from "@/stores/agentActivity";
import { useSessionStore } from "@/stores/session";

/** A turn is considered "working" until a completion/error signal, capped at this long. */
const WORKING_TIMEOUT_MS = 45_000;

/** Mount once (in AppShell, like the presence heartbeat) — not per-view. */
export function useAgentObserverFeed(): void {
  const session = useSessionStore();
  const store = useAgentActivityStore();
  let sub: ReturnType<typeof agentActivityService.subscribe> | null = null;
  const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

  onMounted(() => {
    if (!session.pubkey) return;
    sub = agentActivityService.subscribe(session.pubkey, (agentPubkey, payload) => {
      // UNVERIFIED HEURISTIC (see docs/KNOWN_LIMITATIONS.md): the protocol
      // reference confirms only one example payload type ("turn_started").
      // The full set of real buzz-acp observer-frame `type` values has not
      // been enumerated/verified — this regex is a best guess at which ones
      // mean "done" and may misclassify real frames until confirmed against
      // a live buzz-acp instance.
      const isFinished =
        typeof payload.type === "string" && /finish|complet|error|result/i.test(payload.type);
      store.setActivity({
        agentPubkey,
        state: isFinished ? "idle" : "working",
        detail: typeof payload.type === "string" ? payload.type : undefined,
        source: "observer_frame",
      });

      const existing = timeouts.get(agentPubkey);
      if (existing) clearTimeout(existing);
      if (!isFinished) {
        timeouts.set(
          agentPubkey,
          setTimeout(() => {
            store.setActivity({ agentPubkey, state: "idle", source: "observer_frame" });
          }, WORKING_TIMEOUT_MS),
        );
      }
    });
  });

  onUnmounted(() => {
    sub?.close();
    for (const timer of timeouts.values()) clearTimeout(timer);
  });
}
