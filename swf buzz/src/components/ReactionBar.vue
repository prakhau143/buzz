<script setup lang="ts">
import type { Reaction } from "@/types/domain";

defineProps<{ reactions: Reaction[] }>();
const emit = defineEmits<{ toggle: [emoji: string] }>();
</script>

<template>
  <div v-if="reactions.length" class="reaction-bar">
    <button
      v-for="reaction in reactions"
      :key="reaction.emoji"
      type="button"
      class="reaction-pill"
      :class="{ mine: reaction.reactedByMe }"
      :title="reaction.reactorPubkeys.length + ' reacted'"
      @click="emit('toggle', reaction.emoji)"
    >
      <span>{{ reaction.emoji }}</span>
      <span class="count">{{ reaction.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.reaction-bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.reaction-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 22px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  cursor: pointer;
}
.reaction-pill:hover {
  background: var(--color-surface-hover);
}
.reaction-pill.mine {
  border-color: var(--color-primary);
  background: var(--color-primary-muted);
  color: var(--color-primary);
}

.count {
  font-weight: 600;
}
</style>
