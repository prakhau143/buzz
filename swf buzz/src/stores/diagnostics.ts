import { defineStore } from "pinia";

/**
 * Identity diagnostics — PUBLIC information only, recorded by the sign-in path
 * so the development-only diagnostics panel (`IdentityDiagnosticsPanel.vue`)
 * and the E2E tests can show, for the current attempt, exactly what the relay
 * was asked and what it answered. Nothing here is authority and nothing here
 * is a secret: public keys, HTTP statuses, route names, timestamps.
 *
 * Never persisted. Cleared with the session (`endIdentitySession`).
 */

export interface OperatorProbeRecord {
  /** Which identity the app believed it was probing for. */
  forPubkey: string | null;
  /** The pubkey on the signed NIP-98 event — who actually signed the probe. */
  signerPubkey: string | null;
  /** HTTP status the relay answered, or `null` when the request never completed. */
  status: number | null;
  /** `network` / `unauthenticated` / … when the request failed before an answer. */
  error: string | null;
  /** The relay origin that was asked. */
  origin: string;
  at: number;
}

export interface AccessDecisionRecord {
  pubkey: string;
  kind: "route" | "unreachable" | "mismatch";
  destination: string | null;
  membershipCount: number;
  at: number;
}

export const useDiagnosticsStore = defineStore("diagnostics", {
  state: () => ({
    lastOperatorProbe: null as OperatorProbeRecord | null,
    lastAccessDecision: null as AccessDecisionRecord | null,
    /** Set when the sign-in path refused to continue because the signer was not the identity being signed in. */
    lastIdentityMismatch: null as { expected: string; signer: string; at: number } | null,
  }),
  actions: {
    recordOperatorProbe(record: OperatorProbeRecord) {
      this.lastOperatorProbe = record;
    },
    recordAccessDecision(record: AccessDecisionRecord) {
      this.lastAccessDecision = record;
    },
    recordIdentityMismatch(expected: string, signer: string) {
      this.lastIdentityMismatch = { expected, signer, at: Date.now() };
    },
    clear() {
      this.lastOperatorProbe = null;
      this.lastAccessDecision = null;
      this.lastIdentityMismatch = null;
    },
  },
});

/** Store access that tolerates "no active Pinia" (plain service code, some unit tests). */
export function diagnostics(): ReturnType<typeof useDiagnosticsStore> | null {
  try {
    return useDiagnosticsStore();
  } catch {
    return null;
  }
}
