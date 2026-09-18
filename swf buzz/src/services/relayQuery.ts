/**
 * Shared "fetch once" helper: opens a subscription, collects events until
 * EOSE (or a timeout, in case the relay never sends one), then closes it.
 * Used as the Vue Query `queryFn` for every relay-backed list — gives us
 * loading/error/retry via Vue Query without hand-rolling it per feature.
 * Live updates after the initial fetch are a separate, longer-lived
 * subscription — see each feature's composable.
 */
import { relayConnectionService } from "./RelayConnectionService";
import type { NostrFilter, RawNostrEvent } from "@/protocol/types";

export function fetchEventsOnce(
  filters: NostrFilter[],
  opts?: { timeoutMs?: number },
): Promise<RawNostrEvent[]> {
  const timeoutMs = opts?.timeoutMs ?? 8000;

  return new Promise((resolve) => {
    const events: RawNostrEvent[] = [];
    let settled = false;

    const timeoutHandle = setTimeout(() => finish(), timeoutMs);

    const handle = relayConnectionService.subscribe("fetch-once", filters, {
      onEvent: (event) => events.push(event),
      onEose: () => finish(),
    });

    function finish(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      handle.close();
      resolve(events);
    }
  });
}
