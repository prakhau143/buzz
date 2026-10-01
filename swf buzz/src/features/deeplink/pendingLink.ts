import { ref } from "vue";

/**
 * A `swfbuzz://` link the user opened and has not yet acted on. Held in memory
 * only. It is *intent*, not authority: it names a community server and (for
 * `join`) an invite code, and does nothing until the signed-in user confirms —
 * at which point their own private key signs the claim.
 */
export type PendingLink =
  | {
      kind: "join";
      relay: string;
      code: string;
      policyReceipt?: string | null;
      /** From the link, unverified by the relay — show as "named in the link". */
      communityName?: string | null;
      /** From the link, unverified — the inviter's public key (hex). */
      invitedBy?: string | null;
    }
  | {
      kind: "connect";
      relay: string;
      /** From the link, unverified. */
      communityName?: string | null;
    }
  | { kind: "invalid"; reason: string };

export const pendingLink = ref<PendingLink | null>(null);

export function setPendingLink(link: PendingLink): void {
  pendingLink.value = link;
}

export function clearPendingLink(): void {
  pendingLink.value = null;
}
