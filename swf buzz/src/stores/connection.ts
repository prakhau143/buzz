import { defineStore } from "pinia";
import type { ConnectionStatus } from "@/types/domain";

/**
 * Why the relay refused this identity's NIP-42 AUTH, when it did. Lets the UI
 * offer "Join with invite" for a non-member instead of a dead-end error.
 */
export type AuthDenial = "not_member" | "banned" | "other";

export const useConnectionStore = defineStore("connection", {
  state: () => ({
    status: "connecting" as ConnectionStatus,
    lastError: null as string | null,
    reconnectAttempt: 0,
    authDenial: null as AuthDenial | null,
    /**
     * The `pubkey` of the kind:22242 AUTH event the active signer actually
     * produced for the current socket — recorded by `RelayConnectionService`
     * from the signed event itself, never from session state. This is the
     * only honest answer to "which identity is this connection authenticated
     * as": a `status === "connected"` alone says nothing about *whose* key
     * signed the challenge. `null` until an AUTH was signed, and again after
     * every disconnect. Public information only.
     */
    authenticatedPubkey: null as string | null,
  }),
  getters: {
    isUsable: (state) => state.status === "connected",
  },
  actions: {
    setStatus(status: ConnectionStatus, lastError: string | null = null) {
      this.status = status;
      this.lastError = lastError;
      if (status === "connected") {
        this.reconnectAttempt = 0;
        this.authDenial = null;
      }
      if (status === "disconnected") {
        this.authenticatedPubkey = null;
      }
    },
    setAuthDenial(denial: AuthDenial | null) {
      this.authDenial = denial;
    },
    setAuthenticatedPubkey(pubkey: string | null) {
      this.authenticatedPubkey = pubkey;
    },
    incrementReconnectAttempt() {
      this.reconnectAttempt += 1;
    },
    /** Identity-session teardown: nothing of the previous socket's verdicts may survive a switch. */
    resetForSignOut() {
      this.status = "disconnected";
      this.lastError = null;
      this.reconnectAttempt = 0;
      this.authDenial = null;
      this.authenticatedPubkey = null;
    },
  },
});
