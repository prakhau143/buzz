import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { getActiveSigningService } from "@/features/signing/signingServiceRegistry";
import {
  buildAgentObserverFrameFilter,
  decryptObserverFrame,
  type AgentObserverFramePayload,
} from "@/protocol/agents";
import type { RawNostrEvent } from "@/protocol/types";

/**
 * kind:24200 observer frames — the primary "agent is working" signal, per
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §10. Decryption requires the
 * active signer to support nip44_decrypt against an arbitrary sender
 * (the agent's pubkey), which is an open question for whichever NIP-46
 * bunker SWF Buzz ends up using — see docs/DECISIONS.md D6. When decryption
 * fails, this silently drops the frame rather than erroring; callers should
 * combine this with the kind:20002 typing-indicator fallback (also
 * documented in the protocol reference), not treat this as the only signal.
 */
class AgentActivityService {
  subscribe(
    myPubkey: string,
    onFrame: (agentPubkey: string, payload: AgentObserverFramePayload) => void,
  ): RelaySubscriptionHandle {
    return relayConnectionService.subscribe(
      "agent-observer-frames",
      [{ ...buildAgentObserverFrameFilter(myPubkey), since: Math.floor(Date.now() / 1000) }],
      {
        onEvent: (event: RawNostrEvent) => {
          void this.handleFrame(event, onFrame);
        },
      },
    );
  }

  private async handleFrame(
    event: RawNostrEvent,
    onFrame: (agentPubkey: string, payload: AgentObserverFramePayload) => void,
  ): Promise<void> {
    let signer;
    try {
      signer = getActiveSigningService();
    } catch {
      return;
    }
    const payload = await decryptObserverFrame(event, (senderPubkey, ciphertext) =>
      signer.nip44Decrypt(senderPubkey, ciphertext),
    );
    if (!payload) {
      // Expected and non-fatal when the bunker can't decrypt third-party (agent) senders — see D6.
      return;
    }
    onFrame(event.pubkey, payload);
  }
}

export const agentActivityService = new AgentActivityService();
