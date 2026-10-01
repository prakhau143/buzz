<script setup lang="ts">
/**
 * The one close control for every dialog, modal, drawer and panel.
 *
 * Deliberately an inline **SVG**, not a Unicode glyph in markup or a CSS
 * `content:` pseudo-element. A multiplication-sign glyph is multi-byte UTF-8
 * (E2 9C 95), so any tool that re-saves the file in a single-byte encoding
 * silently turns it into three junk characters — which is exactly what happened
 * here, garbling the close control in five separate dialogs at once. An SVG
 * path is pure ASCII, depends on no icon font, and cannot be corrupted that way.
 *
 * Also gives every close control the same affordances: a real `<button>`, an
 * accessible name, a visible focus ring, and a 44×44 hit area (WCAG 2.5.8)
 * even though the glyph itself is small.
 */
withDefaults(defineProps<{ label?: string }>(), { label: "Close" });
defineEmits<{ click: [] }>();
</script>

<template>
  <button
    type="button"
    class="close-button"
    :aria-label="label"
    :title="label"
    data-testid="close-button"
    @click="$emit('click')"
  >
    <svg
      class="close-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6 L18 18 M18 6 L6 18" />
    </svg>
  </button>
</template>

<style scoped>
.close-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Small glyph, comfortable target (WCAG 2.5.8). */
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  flex-shrink: 0;
}
.close-button:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.close-button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  color: var(--color-text);
}
.close-icon {
  display: block;
}
</style>
