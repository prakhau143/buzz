<script setup lang="ts">
import { ref } from "vue";
import { useProfile } from "@/composables/useProfile";
import type { AgentActivity } from "@/types/domain";

const props = defineProps<{ activity: AgentActivity[] }>();
const expanded = ref(false);

const { data: firstProfile } = useProfile(() => props.activity[0]?.agentPubkey ?? null);
</script>

<template>
  <div v-if="activity.length" class="agent-activity-bar">
    <button type="button" class="summary" @click="expanded = !expanded">
      <span class="dot" />
      <span>
        {{
          activity.length === 1
            ? (firstProfile?.displayName ?? "An agent")
            : `${activity.length} agents`
        }}
        {{ activity.length === 1 ? "is" : "are" }} working…
      </span>
      <span v-if="activity.some((a) => a.detail)" class="expand-hint">{{
        expanded ? "Hide detail" : "Show detail"
      }}</span>
    </button>
    <ul v-if="expanded" class="detail-list">
      <li v-for="a in activity" :key="a.agentPubkey">
        {{ a.agentPubkey.slice(0, 8) }}: {{ a.detail ?? "working" }}
        <span class="source"
          >({{ a.source === "observer_frame" ? "live status" : "inferred from typing" }})</span
        >
      </li>
    </ul>
  </div>
</template>

<style scoped>
.agent-activity-bar {
  background: var(--color-agent-muted);
  border-top: 1px solid var(--color-border);
}

.summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-1) var(--space-4);
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--color-agent);
  text-align: left;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-agent);
  animation: pulse 1.2s ease-in-out infinite;
}

.expand-hint {
  margin-left: auto;
  text-decoration: underline;
}

.detail-list {
  list-style: none;
  margin: 0;
  padding: 0 var(--space-4) var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.source {
  color: var(--color-text-subtle);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
