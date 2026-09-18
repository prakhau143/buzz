import { defineStore } from "pinia";
import type { AgentActivity } from "@/types/domain";

/**
 * Client-only, session-scoped agent activity state — keyed by agent pubkey.
 * Fed by features/agents/useAgentObserverFeed.ts (kind:24200, real signal
 * when available) and read by features/agents/useAgentActivity.ts (which
 * also layers in the kind:20002 typing-indicator fallback per
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §10).
 */
export const useAgentActivityStore = defineStore("agentActivity", {
  state: () => ({
    byPubkey: {} as Record<string, AgentActivity>,
  }),
  actions: {
    setActivity(activity: AgentActivity) {
      this.byPubkey[activity.agentPubkey] = activity;
    },
  },
});
