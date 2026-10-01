<script setup lang="ts">
import { computed } from "vue";
import type { PresenceStatus } from "@/protocol/presence";

/**
 * The one presence dot. Colours follow OLD BUZZ (`presence.ts`): online green,
 * away amber, offline grey — offline is "not here", not an error, so no red.
 * Labelled for hover and screen readers.
 */
const props = defineProps<{ status: PresenceStatus }>();

const LABELS: Record<PresenceStatus, string> = { online: "Online", away: "Away", offline: "Offline" };
const label = computed(() => LABELS[props.status]);
</script>

<template>
  <span
    class="presence-dot"
    :class="status"
    role="img"
    :aria-label="label"
    :title="label"
    :data-presence="status"
  />
</template>

<style scoped>
.presence-dot {
  display: inline-block;
  border-radius: 50%;
  background: var(--color-text-subtle);
}
.presence-dot.online {
  background: var(--color-success);
}
.presence-dot.away {
  background: var(--color-warning);
}
</style>
