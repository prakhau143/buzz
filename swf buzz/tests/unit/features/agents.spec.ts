import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAgentActivity } from "@/features/agents/useAgentActivity";
import { useAgentActivityStore } from "@/stores/agentActivity";

const AGENT_A = "agent-a";
const AGENT_B = "agent-b";

describe("useAgentActivity", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("returns nothing when no agent is in scope", () => {
    const activity = useAgentActivity([], []);
    expect(activity.value).toEqual([]);
  });

  it("prefers a real observer-frame signal over the typing fallback", () => {
    const store = useAgentActivityStore();
    store.setActivity({
      agentPubkey: AGENT_A,
      state: "working",
      detail: "turn_started",
      source: "observer_frame",
    });

    const activity = useAgentActivity([AGENT_A], [AGENT_A]);
    expect(activity.value).toEqual([
      { agentPubkey: AGENT_A, state: "working", detail: "turn_started", source: "observer_frame" },
    ]);
  });

  it("falls back to the typing indicator when there is no observer-frame signal", () => {
    const activity = useAgentActivity([AGENT_A], [AGENT_A]);
    expect(activity.value).toEqual([
      { agentPubkey: AGENT_A, state: "working", source: "typing_fallback" },
    ]);
  });

  it("excludes an agent that is idle and not typing", () => {
    const store = useAgentActivityStore();
    store.setActivity({ agentPubkey: AGENT_A, state: "idle", source: "observer_frame" });

    const activity = useAgentActivity([AGENT_A, AGENT_B], []);
    expect(activity.value).toEqual([]);
  });

  it("only reports agents actually in scope, even if others are typing", () => {
    const activity = useAgentActivity([AGENT_A], [AGENT_A, AGENT_B, "human-1"]);
    expect(activity.value.map((a) => a.agentPubkey)).toEqual([AGENT_A]);
  });
});
