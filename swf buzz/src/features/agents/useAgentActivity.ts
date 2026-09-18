import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useAgentActivityStore } from "@/stores/agentActivity";
import type { AgentActivity } from "@/types/domain";

/**
 * Agents (from `agentPubkeysInScope`, e.g. the current channel's members who
 * are agents) currently shown as "working" — real kind:24200 signal when
 * available, else the kind:20002 typing-indicator fallback, per
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §10's documented degradation path.
 */
export function useAgentActivity(
  agentPubkeysInScope: MaybeRefOrGetter<string[]>,
  typingPubkeys: MaybeRefOrGetter<string[]>,
) {
  const store = useAgentActivityStore();

  return computed<AgentActivity[]>(() => {
    const agents = toValue(agentPubkeysInScope);
    const typing = new Set(toValue(typingPubkeys));

    return agents
      .map((agentPubkey): AgentActivity | null => {
        const observed = store.byPubkey[agentPubkey];
        if (observed?.state === "working") return observed;
        if (typing.has(agentPubkey)) {
          return { agentPubkey, state: "working", source: "typing_fallback" };
        }
        return null;
      })
      .filter((a): a is AgentActivity => a !== null);
  });
}
