/**
 * Agent identity + activity signal. docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §10.
 *
 * There is no pubkey-level "is agent" flag in the protocol — agent-ness is
 * established by resolving kind:30177 (or kind:30175) for a pubkey. Mentions
 * are a plain `p` tag, identical to human mentions (see protocol/messages.ts
 * `mentionPubkeys`) — no distinct protocol mechanism exists here.
 */
import { KIND_AGENT_OBSERVER_FRAME, KIND_MANAGED_AGENT, KIND_PERSONA } from "./kinds";
import { firstTagValue, type NostrFilter, type RawNostrEvent } from "./types";

export function buildManagedAgentFilter(pubkey: string): NostrFilter {
  return { kinds: [KIND_MANAGED_AGENT], "#d": [pubkey], limit: 1 };
}

export function buildPersonaFilter(slug: string): NostrFilter {
  return { kinds: [KIND_PERSONA], "#d": [slug], limit: 1 };
}

export interface ManagedAgentBinding {
  agentPubkey: string;
  raw: Record<string, unknown>;
}

/** A kind:30177 event's `d` tag is the agent's own pubkey — its presence badges that pubkey as an agent. */
export function parseManagedAgentEvent(event: RawNostrEvent): ManagedAgentBinding | null {
  const agentPubkey = firstTagValue(event, "d");
  if (!agentPubkey) return null;
  try {
    return { agentPubkey, raw: JSON.parse(event.content) as Record<string, unknown> };
  } catch {
    return { agentPubkey, raw: {} };
  }
}

/**
 * Observer frame (kind:24200) — ephemeral, never stored, NIP-44-encrypted
 * agent↔owner. This is the primary "agent is working" signal; kind:20002
 * typing (see protocol/typing.ts) is the documented fallback when this
 * stream is unavailable — e.g. before a NIP-46 bunker supports decrypting
 * third-party (agent) senders. See docs/DECISIONS.md D6.
 */
export function buildAgentObserverFrameFilter(ownerPubkey: string): NostrFilter {
  return { kinds: [KIND_AGENT_OBSERVER_FRAME], "#p": [ownerPubkey] };
}

export interface AgentObserverFramePayload {
  type: string;
  turnId?: string;
  [key: string]: unknown;
}

/** Decrypts and parses an observer frame's ciphertext content. Caller supplies the decrypt fn (SigningService.nip44Decrypt). */
export async function decryptObserverFrame(
  event: RawNostrEvent,
  decrypt: (senderPubkey: string, ciphertext: string) => Promise<string>,
): Promise<AgentObserverFramePayload | null> {
  try {
    const plaintext = await decrypt(event.pubkey, event.content);
    return JSON.parse(plaintext) as AgentObserverFramePayload;
  } catch {
    return null;
  }
}

export function observerFrameKind(
  event: Pick<RawNostrEvent, "tags">,
): "telemetry" | "control" | undefined {
  const frame = firstTagValue(event, "frame");
  return frame === "telemetry" || frame === "control" ? frame : undefined;
}
