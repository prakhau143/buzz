<script setup lang="ts">
/**
 * Initial-load placeholder for a mobile conversation: a few message-shaped
 * rows (avatar + name line + 1–2 text lines of varied width) in the SAME
 * metrics as a real message row, so the list lands without a jump. Shown only
 * while a conversation has nothing yet — never for paging, sending or a
 * refresh of what is already on screen.
 */
const ROWS: { name: number; lines: number[] }[] = [
  { name: 28, lines: [82, 46] },
  { name: 22, lines: [64] },
  { name: 34, lines: [90, 72] },
  { name: 26, lines: [56] },
  { name: 30, lines: [78, 38] },
];
</script>

<template>
  <div class="m-skeleton" role="status" aria-busy="true" aria-label="Loading conversation" data-testid="conversation-skeleton">
    <div v-for="(row, i) in ROWS" :key="i" class="sk-row" aria-hidden="true">
      <span class="sk-avatar" />
      <span class="sk-body">
        <span class="sk-line sk-name" :style="{ width: `${row.name}%` }" />
        <span v-for="(w, j) in row.lines" :key="j" class="sk-line" :style="{ width: `${w}%` }" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.m-skeleton {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end; /* a feed opens at its latest message: fill from the bottom */
  padding-bottom: var(--space-2);
  overflow: hidden;
}
/* Same box as a real MessageItem row: 32px avatar, 12px gap, 8px/16px padding. */
.sk-row {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
}
.sk-avatar {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
}
.sk-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 3px;
}
.sk-line {
  display: block;
  height: 11px;
  border-radius: var(--radius-sm);
}
.sk-name {
  height: 10px;
}
.sk-avatar,
.sk-line {
  background: var(--color-surface-muted);
  animation: sk-pulse 1.4s ease-in-out infinite;
}
.sk-row:nth-child(2n) .sk-line,
.sk-row:nth-child(2n) .sk-avatar {
  animation-delay: 0.15s;
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
