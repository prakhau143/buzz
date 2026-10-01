<script setup lang="ts">
/**
 * Inline save state. "Saved" is shown ONLY for a persistence that actually
 * succeeded — callers set `state` from the real outcome, never optimistically.
 */
import AppIcon from "@/components/AppIcon.vue";

defineProps<{ state: "idle" | "saving" | "saved" | "error"; error?: string | null }>();
</script>

<template>
  <span class="save-indicator" :class="state" role="status" aria-live="polite" data-testid="save-indicator">
    <template v-if="state === 'saving'"><span class="spinner" aria-hidden="true" />Saving…</template>
    <template v-else-if="state === 'saved'"><AppIcon name="check" :size="16" />Saved</template>
    <template v-else-if="state === 'error'"><AppIcon name="warning" :size="16" />{{ error || "Couldn't save" }}</template>
  </span>
</template>

<style scoped>
.save-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.save-indicator.saved {
  color: var(--color-success);
}
.save-indicator.error {
  color: var(--color-danger);
}
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-border-strong);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
