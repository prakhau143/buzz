<script setup lang="ts">
import { computed } from "vue";
import { useProfile } from "@/composables/useProfile";

const props = defineProps<{ pubkeys: string[] }>();

// Resolve at most the first few — a long typing list degrades to "N people are typing".
const { data: firstProfile } = useProfile(() => props.pubkeys[0] ?? null);

const label = computed(() => {
  if (props.pubkeys.length === 0) return "";
  if (props.pubkeys.length === 1) {
    return `${firstProfile.value?.displayName ?? "Someone"} is typing…`;
  }
  return `${props.pubkeys.length} people are typing…`;
});
</script>

<template>
  <p v-if="pubkeys.length" class="typing-indicator">{{ label }}</p>
</template>

<style scoped>
.typing-indicator {
  margin: 0;
  padding: 0 var(--space-4) var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  font-style: italic;
  background: var(--color-surface);
}
</style>
