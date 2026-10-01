import { ref } from "vue";
import { userMessageFor } from "@/services/errors";
import { ensureLocalSigner } from "@/features/auth/useAuth";
import { InviteError, relayInviteService, type ClaimResult, type ParsedInvite } from "./RelayInviteService";
import { addCommunity } from "./relayCommunities";

export interface JoinedCommunity extends ClaimResult {
  relay: string;
}

/**
 * Claim an invite with the local identity.
 *
 * The claim is one NIP-98-signed HTTP request (no WebSocket, no membership
 * needed yet). The relay verifies the invite and creates the membership row for
 * the *signing key* with role `member`; repeating it is safe (`already_member`).
 * On success the community's address is remembered on this device. Nothing here
 * signs the user in — the caller does that next (NIP-42) — and nothing accepts a
 * public key as proof of identity.
 */
export function useJoinInvite() {
  const busy = ref(false);
  const error = ref<string | null>(null);
  const result = ref<JoinedCommunity | null>(null);

  async function claim(invite: ParsedInvite): Promise<JoinedCommunity | null> {
    busy.value = true;
    error.value = null;
    result.value = null;
    try {
      // Only the local identity's own signer can sign the claim.
      const pubkey = await ensureLocalSigner();
      if (!pubkey) {
        throw new InviteError("unauthenticated", "Create or import your identity first.");
      }
      const claimed = await relayInviteService.claimInvite(invite.relay, invite.code, invite.policyReceipt);
      addCommunity(invite.relay);
      result.value = { ...claimed, relay: invite.relay };
      return result.value;
    } catch (err) {
      error.value = err instanceof InviteError ? err.message : userMessageFor(err);
      return null;
    } finally {
      busy.value = false;
    }
  }

  /** Forget the previous attempt's outcome and error (a new link arrived). */
  function reset() {
    error.value = null;
    result.value = null;
  }

  return { busy, error, result, claim, reset };
}
