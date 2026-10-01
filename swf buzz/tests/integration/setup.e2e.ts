/**
 * E2E-only setup: neutralise ONE known nostr-tools re-throw.
 *
 * `Relay._onmessage`'s AUTH branch does this (nostr-tools/lib/esm/relay.js):
 *
 *   this.auth(this.onauth).catch((err) => {
 *     if (!(err instanceof SendingOnClosedConnection)) {
 *       throw err;                       // <- re-throw INSIDE a .catch
 *     }
 *   });
 *
 * Re-throwing inside a `.catch` handler produces a *new* rejected promise that
 * nothing is attached to, so any AUTH refusal — `OK false "restricted: not a
 * relay member"`, which is a legitimate, expected relay answer — is reported by
 * Node as an unhandled rejection. The suite then exits non-zero with zero test
 * failures, which makes the E2E gate useless as a gate.
 *
 * The application does NOT depend on this: `RelayConnectionService` calls
 * `relay.auth()` itself, receives the same cached promise, and handles the
 * denial (sets `error` status, records the denial kind, declines to reconnect).
 * `liveRelay.e2e.spec.ts` asserts that behaviour. The rejection suppressed here
 * is strictly the library's duplicate of an outcome already handled and tested.
 *
 * Deliberately narrow, and deliberately in the test harness rather than in app
 * code: only rejections whose message matches a relay AUTH refusal are ignored,
 * and the handler re-raises anything else so a genuine unhandled rejection
 * still fails the run. A blanket swallow would be the wrong fix.
 */

import { relayConnectionService } from "@/services/RelayConnectionService";
import { setActiveRelay } from "@/features/communities/relayCommunities";

/**
 * Mirror the app's connect invariant: the socket and the selected community are
 * always the same relay. The app only connects through `beginIdentitySession` /
 * `useAuth`, both of which call `setActiveRelay(url)` immediately before
 * `connect(url)`. The live specs call `connect` directly, which left
 * `activeRelayUrl` at the build default while the socket sat on the test
 * community — harmless while every read went over the socket, but channel/DM
 * history and moderation are HTTP-bridge calls tenant-scoped by
 * `activeRelayUrl`, so they landed on the bootstrap tenant and got
 * `403 relay_membership_required` (see `moderation.e2e.spec.ts`, which already
 * did this by hand). This restores the app's pairing; it asserts nothing and
 * relaxes nothing.
 */
const connect = relayConnectionService.connect.bind(relayConnectionService);
relayConnectionService.connect = async (url: string) => {
  setActiveRelay(url);
  return connect(url);
};

/** Relay AUTH refusals — NIP-42 prefixes plus nostr-tools' own auth timeout. */
const RELAY_AUTH_REFUSAL = /^(restricted|blocked|auth-required|invalid):|^auth timed out$/i;

process.on("unhandledRejection", (reason) => {
  const message =
    reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";

  if (RELAY_AUTH_REFUSAL.test(message)) {
    // Expected: the app asserts this outcome through its own handled path.
    return;
  }

  // Anything else is a real unhandled rejection. Restore the default failure
  // behaviour rather than hiding it.
  throw reason;
});
