<script setup lang="ts" generic="T extends string">
/** A single-choice segmented control (radiogroup) with arrow-key support. */
import type { IconName } from "@/components/AppIcon.vue";
import AppIcon from "@/components/AppIcon.vue";

const props = defineProps<{
  modelValue: T;
  options: { value: T; label: string; icon?: IconName }[];
  label: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: T] }>();

function onKey(event: KeyboardEvent, index: number) {
  const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (!delta) return;
  event.preventDefault();
  const next = props.options[(index + delta + props.options.length) % props.options.length];
  emit("update:modelValue", next.value);
  const group = (event.currentTarget as HTMLElement).parentElement;
  (group?.children[(index + delta + props.options.length) % props.options.length] as HTMLElement | undefined)?.focus();
}
</script>

<template>
  <div class="segmented" role="radiogroup" :aria-label="label">
    <button
      v-for="(option, index) in options"
      :key="option.value"
      type="button"
      role="radio"
      class="segment"
      :class="{ active: option.value === modelValue }"
      :aria-checked="option.value === modelValue"
      :tabindex="option.value === modelValue ? 0 : -1"
      :data-testid="`segment-${option.value}`"
      @click="emit('update:modelValue', option.value)"
      @keydown="onKey($event, index)"
    >
      <AppIcon v-if="option.icon" :name="option.icon" :size="16" />
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  max-width: 100%;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface-muted);
}
.segment {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  min-width: 44px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 550;
  cursor: pointer;
  transition:
    background 150ms ease,
    color 150ms ease,
    box-shadow 150ms ease;
}
.segment:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}
.segment:hover {
  color: var(--color-text);
}
.segment.active {
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.12),
    0 0 0 1px var(--color-border);
}
</style>
