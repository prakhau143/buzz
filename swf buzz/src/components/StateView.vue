<script setup lang="ts">
/**
 * Shared loading / empty / error state presentation.
 * Every feature composable should map onto one of these three, per
 * docs/ARCHITECTURE.md §8 — never leave the UI silently blank on error.
 */
withDefaults(
  defineProps<{
    kind: "loading" | "empty" | "error";
    title?: string;
    description?: string;
    retryLabel?: string;
  }>(),
  { retryLabel: "Retry" },
);

const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="state-view" :class="kind">
    <div v-if="kind === 'loading'" class="spinner" role="status" aria-label="Loading" />
    <p class="title">
      {{
        title ??
        (kind === "loading"
          ? "Loading…"
          : kind === "empty"
            ? "Nothing here yet"
            : "Something went wrong")
      }}
    </p>
    <p v-if="description" class="description">{{ description }}</p>
    <button v-if="kind === 'error'" class="retry" type="button" @click="emit('retry')">
      {{ retryLabel }}
    </button>
  </div>
</template>

<style scoped>
.state-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-6);
  text-align: center;
  color: var(--color-text-muted);
}

.title {
  margin: 0;
  font-weight: 600;
  color: var(--color-text);
}

.description {
  margin: 0;
  max-width: 320px;
  font-size: var(--font-size-sm);
}

.error .title {
  color: var(--color-danger);
}

.spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  animation: spin 0.7s linear infinite;
}

.retry {
  margin-top: var(--space-2);
  height: 32px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  cursor: pointer;
  font-size: var(--font-size-sm);
}
.retry:hover {
  background: var(--color-surface-hover);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
