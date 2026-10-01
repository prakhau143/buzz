<script setup lang="ts">
/**
 * Timeout duration picker.
 *
 * The relay takes an absolute `expires_at`, so the durations here are a UI
 * affordance over that one field — not a separate protocol concept. Previously
 * every timeout was hard-coded to 24h, which made "time somebody out briefly"
 * impossible to express.
 */
import { ref } from "vue";
import { useEscapeKey } from "@/composables/useEscapeKey";

const emit = defineEmits<{ pick: [seconds: number]; close: [] }>();
useEscapeKey(() => emit("close"));

const PRESETS = [
  { label: "10 minutes", seconds: 10 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "24 hours", seconds: 24 * 60 * 60 },
] as const;

const customHours = ref("");
const customError = ref<string | null>(null);

function submitCustom() {
  const hours = Number(customHours.value);
  if (!Number.isFinite(hours) || hours <= 0) {
    customError.value = "Enter a number of hours greater than zero.";
    return;
  }
  // A timeout longer than a year is almost certainly a typo; a ban is the
  // right tool for that, and the relay would hold the row indefinitely.
  if (hours > 24 * 365) {
    customError.value = "That's longer than a year — use a ban instead.";
    return;
  }
  emit("pick", Math.round(hours * 3600));
}
</script>

<template>
  <div class="menu-overlay" @click.self="emit('close')">
    <div class="menu-card" role="menu" aria-label="Timeout duration">
      <button
        v-for="preset in PRESETS"
        :key="preset.seconds"
        type="button"
        class="menu-item"
        role="menuitem"
        :data-testid="`timeout-${preset.seconds}`"
        @click="emit('pick', preset.seconds)"
      >
        {{ preset.label }}
      </button>
      <div class="menu-divider" />
      <form class="custom" @submit.prevent="submitCustom">
        <label class="custom-label" for="timeout-custom">Custom (hours)</label>
        <input
          id="timeout-custom"
          v-model="customHours"
          class="custom-input"
          type="number"
          min="0.25"
          step="0.25"
          data-testid="timeout-custom"
        />
        <button type="submit" class="custom-submit">Apply</button>
      </form>
      <p v-if="customError" class="custom-error" role="alert">{{ customError }}</p>
    </div>
  </div>
</template>

<style scoped>
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-dropdown);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);
}
.menu-card {
  width: 240px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
}
.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--color-text);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.menu-item:hover,
.menu-item:focus-visible {
  background: var(--color-surface-hover);
}
.menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: var(--space-1) 0;
}
.custom {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
}
.custom-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.custom-input {
  height: 28px;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
}
.custom-submit {
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}
.custom-error {
  margin: 0;
  padding: 0 var(--space-2) var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
</style>
