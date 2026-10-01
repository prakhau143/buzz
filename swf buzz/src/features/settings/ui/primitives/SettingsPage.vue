<script setup lang="ts">
/** One settings page: a single h1, a one-line description, then its cards. */
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <section class="settings-page" :aria-label="title">
    <header class="page-header">
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
      <div v-if="$slots.actions" class="page-actions"><slot name="actions" /></div>
    </header>
    <div class="page-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  animation: page-in 180ms ease both;
}
.page-header {
  display: grid;
  grid-template-columns: 1fr auto;
  column-gap: var(--space-4);
  row-gap: var(--space-1);
}
h1 {
  margin: 0;
  font-size: calc(var(--font-size-xl) + 6px);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: var(--line-height-tight);
  color: var(--color-text);
}
.page-header p {
  grid-column: 1;
  margin: 0;
  /* The page is full width; its sentence keeps a readable line length. */
  max-width: 70ch;
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
}
.page-actions {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
}
.page-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
@keyframes page-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .settings-page {
    animation: none;
  }
}
</style>
