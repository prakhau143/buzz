import { defineStore } from "pinia";
import type { ConnectionStatus } from "@/types/domain";

export const useConnectionStore = defineStore("connection", {
  state: () => ({
    status: "connecting" as ConnectionStatus,
    lastError: null as string | null,
    reconnectAttempt: 0,
  }),
  getters: {
    isUsable: (state) => state.status === "connected",
  },
  actions: {
    setStatus(status: ConnectionStatus, lastError: string | null = null) {
      this.status = status;
      this.lastError = lastError;
      if (status === "connected") this.reconnectAttempt = 0;
    },
    incrementReconnectAttempt() {
      this.reconnectAttempt += 1;
    },
  },
});
