<script setup lang="ts">
/**
 * Label + sub-copy on the left, control on the right. Stacks vertically when
 * the card is narrow (container query), so no control ever overflows sideways.
 */
defineProps<{ label: string; description?: string; forId?: string; stack?: boolean }>();
</script>

<template>
  <div class="settings-row" :class="{ stack }">
    <div class="row-text">
      <label v-if="forId" :for="forId" class="row-label">{{ label }}</label>
      <span v-else class="row-label">{{ label }}</span>
      <span v-if="description" class="row-description">{{ description }}</span>
      <slot name="below-label" />
    </div>
    <div v-if="$slots.default" class="row-control"><slot /></div>
  </div>
</template>

<style scoped>
.settings-row {
  container-type: inline-size;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 60px;
  padding: var(--space-3) var(--space-4);
  transition: background var(--transition-fast);
}
.settings-row:hover {
  background: color-mix(in srgb, var(--color-surface-muted) 55%, transparent);
}
.row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.row-label {
  font-size: var(--font-size-md);
  font-weight: 550;
  color: var(--color-text);
}
.row-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.row-control {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  max-width: 100%;
}
.settings-row.stack {
  flex-direction: column;
  align-items: stretch;
}
@container (max-width: 520px) {
  .settings-row:not(.no-stack) {
    flex-wrap: wrap;
  }
  .row-control {
    flex-shrink: 1;
  }
}
</style>
