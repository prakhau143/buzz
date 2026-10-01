/**
 * Shared "fetch once" helper: opens a subscription, collects events until
 * EOSE (or a timeout, in case the relay never sends one), then closes it.
 * Used as the Vue Query `queryFn` for every relay-backed list — gives us
 * loading/error/retry via Vue Query without hand-rolling it per feature.
 * Live updates after the initial fetch are a separate, longer-lived
 * subscription — see each feature's composable.
 *
 * A fetch belongs to the community session it started in: if the user switches
 * community before it settles, it rejects with `StaleCommunitySessionError`
 * rather than resolving with a partial answer from the old community.
 */
import { relayConnectionService, type RelaySubscriptionHandle } from "./RelayConnectionService";
import type { NostrFilter, RawNostrEvent } from "@/protocol/types";
import {
  currentCommunityGeneration,
  isCurrentCommunitySession,
  StaleCommunitySessionError,
} from "@/features/communities/communitySession";

/**
 * The relay did not give a complete answer: it ended the request without EOSE
 * (`CLOSED`, e.g. "auth-required:" while a new session is still
 * authenticating) or never answered within the timeout. Only thrown in
 * `requireEose` mode — the result must not be read as "the relay has nothing".
 */
export class IncompleteRelayAnswerError extends Error {
  constructor(readonly reason: "closed" | "timeout", readonly detail?: string) {
    super(reason === "closed" ? `The relay closed the request: ${detail ?? ""}`.trim() : "The relay did not answer in time.");
    this.name = "IncompleteRelayAnswerError";
  }
}

/**
 * `requireEose`: an answer is accepted ONLY when the relay ends it with EOSE.
 * Without it (the historical default, kept for lists where partial is fine) a
 * timeout resolves with whatever arrived. Use it wherever "no events" is itself
 * the answer — e.g. a channel roster, where an empty list means "you are not a
 * member" and must never be produced by a slow or refusing relay.
 */
export function fetchEventsOnce(
  filters: NostrFilter[],
  opts?: { timeoutMs?: number; requireEose?: boolean },
): Promise<RawNostrEvent[]> {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const strict = opts?.requireEose === true;
  const session = currentCommunityGeneration();

  return new Promise((resolve, reject) => {
    const events: RawNostrEvent[] = [];
    let settled = false;
    let handle: RelaySubscriptionHandle | null = null;
    // Declared up front (not const at the arm site): a synchronous EOSE runs
    // finish() before the arm site is reached.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined = undefined;

    function finish(incomplete?: IncompleteRelayAnswerError): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      handle?.close();
      if (!isCurrentCommunitySession(session)) reject(new StaleCommunitySessionError());
      else if (incomplete && strict) reject(incomplete);
      else resolve(events);
    }

    // The timer is armed only once the subscription exists. Arming it first
    // meant a synchronous throw from subscribe() rejected the promise but left
    // the timer live, and when it fired `finish()` touched `handle` before its
    // initialization — an uncaught ReferenceError long after the caller had
    // already handled the rejection.
    try {
      handle = relayConnectionService.subscribe("fetch-once", filters, {
        onEvent: (event) => events.push(event),
        onEose: () => finish(),
        // Lenient callers keep the old behaviour (wait for the timeout, which
        // also lets a re-issued subscription still answer); strict ones fail now.
        ...(strict ? { onClosed: (reason: string) => finish(new IncompleteRelayAnswerError("closed", reason)) } : {}),
      });
    } catch (err) {
      settled = true;
      reject(err);
      return;
    }
    // EOSE delivered synchronously, before `handle` was assigned.
    if (settled) {
      handle.close();
      return;
    }
    timeoutHandle = setTimeout(() => finish(new IncompleteRelayAnswerError("timeout")), timeoutMs);
  });
}
