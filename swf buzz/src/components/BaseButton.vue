<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost" | "danger";
    disabled?: boolean;
    type?: "button" | "submit";
  }>(),
  { variant: "secondary", disabled: false, type: "button" },
);
</script>

<template>
  <button :type="type" class="base-button" :class="variant" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: 36px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  font-family: inherit;
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    opacity var(--transition-fast);
}

.base-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.base-button.primary {
  background: var(--color-primary);
  color: var(--color-text-on-accent);
}
.base-button.primary:not(:disabled):hover {
  background: var(--color-primary-hover);
}

.base-button.secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border-color: var(--color-border);
}
.base-button.secondary:not(:disabled):hover {
  background: var(--color-surface-hover);
}

.base-button.ghost {
  background: transparent;
  color: var(--color-text-muted);
}
.base-button.ghost:not(:disabled):hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}

.base-button.danger {
  background: var(--color-danger);
  color: var(--color-text-on-accent);
}
.base-button.danger:not(:disabled):hover {
  opacity: 0.9;
}
</style>
