<script setup lang="ts">
/**
 * Row-shaped loading placeholder for mobile lists (Inbox, Search results):
 * avatar + three text lines at the exact row metrics, so the real rows replace
 * it without a jump. A busy status for assistive tech; no motion when reduced.
 */
withDefaults(defineProps<{ rows?: number; label?: string }>(), { rows: 6, label: "Loading" });

const WIDTHS = [
  [38, 22, 86],
  [30, 18, 64],
  [44, 26, 78],
  [34, 20, 58],
  [40, 24, 72],
  [28, 16, 68],
];
</script>

<template>
  <ul class="m-list-skeleton" role="status" aria-busy="true" :aria-label="label" data-testid="list-skeleton">
    <li v-for="i in rows" :key="i" class="sk-row" aria-hidden="true">
      <span class="sk-avatar" />
      <span class="sk-text">
        <span class="sk-line strong" :style="{ width: `${WIDTHS[(i - 1) % WIDTHS.length][0]}%` }" />
        <span class="sk-line" :style="{ width: `${WIDTHS[(i - 1) % WIDTHS.length][1]}%` }" />
        <span class="sk-line" :style="{ width: `${WIDTHS[(i - 1) % WIDTHS.length][2]}%` }" />
      </span>
    </li>
  </ul>
</template>

<style scoped>
.m-list-skeleton {
  list-style: none;
  margin: 0;
  padding: var(--space-2) 0;
}
.sk-row {
  display: flex;
  gap: var(--space-3);
  min-height: 76px;
  padding: var(--space-3) var(--space-4);
}
.sk-avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  animation: sk-pulse 1.4s ease-in-out infinite;
}
.sk-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
}
.sk-line {
  display: block;
  height: 10px;
  border-radius: 5px;
  background: var(--color-surface-muted);
  animation: sk-pulse 1.4s ease-in-out infinite;
}
.sk-line.strong {
  height: 12px;
}
@keyframes sk-pulse {
  50% {
    opacity: 0.5;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk-avatar,
  .sk-line {
    animation: none;
  }
}
</style>
