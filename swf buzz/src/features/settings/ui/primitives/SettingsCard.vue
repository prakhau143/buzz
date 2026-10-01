<script setup lang="ts">
/**
 * A titled group of settings: heading + optional description + action above a
 * framed surface whose rows are separated by hairlines. `plain` drops the frame
 * for free-form content (grids, previews).
 */
defineProps<{ title?: string; description?: string; plain?: boolean }>();
</script>

<template>
  <div class="settings-card">
    <div v-if="title || $slots.action" class="card-head">
      <div class="card-titles">
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <div v-if="$slots.action" class="card-action"><slot name="action" /></div>
    </div>
    <div class="card-surface" :class="{ plain }">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.settings-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.card-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0 var(--space-1);
}
.card-titles {
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--color-text-muted);
}
.card-titles p {
  margin: 2px 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-subtle);
}
.card-surface {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 96%, var(--color-text) 4%) 0%, var(--color-surface) 38%);
  box-shadow: var(--shadow-sm);
}
.card-surface > :deep(* + .settings-row) {
  border-top: 1px solid var(--color-border);
}
.card-surface.plain {
  overflow: visible;
  border: none;
  background: none;
  box-shadow: none;
}
</style>
