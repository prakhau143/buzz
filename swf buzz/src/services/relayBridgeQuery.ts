/**
 * The relay's HTTP query bridge: `POST {relay http base}/query`, NIP-98 signed
 * by the active identity (the private key stays in Rust; only the signed
 * kind:27235 header travels). Same authorization as the WebSocket — the relay
 * checks community membership and channel access for the signing pubkey.
 *
 * Exists for the filter extensions the WebSocket REQ path does not have, above
 * all OLD BUZZ's channel window (`top_level: true`): the relay excludes thread
 * replies server-side and answers with a relay-signed kind:39006 page boundary.
 * Reference: ../buzz desktop `src-tauri/src/commands/channel_window.rs` +
 * `relay.rs` (query_relay), relay `crates/buzz-relay/src/api/bridge.rs:508-690`.
 */
import { buildNip98AuthHeader } from "@/services/nip98";
import { AppError } from "@/services/errors";
import { activeRelayUrl, relayHttpBase } from "@/features/communities/relayCommunities";
import type { RawNostrEvent } from "@/protocol/types";
import { withinCommunitySession } from "@/features/communities/communitySession";

const BRIDGE_TIMEOUT_MS = 15_000;

/** Bridge filter: a NIP-01 filter plus the relay's extension keys. */
export type BridgeFilter = object;

/** Answers for the active community only — see `withinCommunitySession`. */
export function queryRelayBridge(filters: BridgeFilter[]): Promise<RawNostrEvent[]> {
  return withinCommunitySession(() => queryActiveRelayBridge(filters));
}

async function queryActiveRelayBridge(filters: BridgeFilter[]): Promise<RawNostrEvent[]> {
  const url = `${relayHttpBase(activeRelayUrl.value)}/query`;
  const body = JSON.stringify(filters);
  let response: Response;
  try {
    const authorization = await buildNip98AuthHeader(url, "POST", body);
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError("network", "Can't reach the Buzz server right now.", err);
  }
  if (!response.ok) {
    // The relay's reason (e.g. "relay_membership_required", a filter validation
    // error) is kept as the cause for the developer log; the user gets the short form.
    const detail = await response.text().catch(() => "");
    throw new AppError(
      "relay_rejected",
      "The server didn't return this conversation's messages.",
      new Error(`HTTP ${response.status} ${detail.slice(0, 300)}`),
      response.status,
    );
  }
  const events: unknown = await response.json();
  return Array.isArray(events) ? (events as RawNostrEvent[]) : [];
}
