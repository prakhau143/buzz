<script setup lang="ts">
/**
 * Accessible on/off switch (`role="switch"`). The button is a 44 px touch
 * target; the 40 × 22 track inside it is the visual.
 */
const props = defineProps<{ modelValue: boolean; label: string; disabled?: boolean; id?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
function toggle() {
  if (!props.disabled) emit("update:modelValue", !props.modelValue);
}
</script>

<template>
  <button
    :id="id"
    type="button"
    role="switch"
    class="toggle"
    :class="{ on: modelValue }"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="track" aria-hidden="true"><span class="thumb" /></span>
  </button>
</template>

<style scoped>
.toggle {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  min-height: 44px;
  padding: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  cursor: pointer;
}
.track {
  position: relative;
  display: block;
  width: 40px;
  height: 22px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}
.toggle.on .track {
  border-color: var(--color-primary);
  background: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
}
.thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  transition: transform 180ms cubic-bezier(0.3, 0.7, 0.4, 1);
}
.toggle.on .thumb {
  transform: translateX(18px);
  background: #fff;
}
.toggle:focus-visible {
  outline: none;
}
.toggle:focus-visible .track {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}
.toggle:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
@media (prefers-reduced-motion: reduce) {
  .track,
  .thumb {
    transition: none;
  }
}
</style>
