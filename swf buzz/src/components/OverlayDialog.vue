<script setup lang="ts">
/**
 * Modal shell: backdrop, focus trap, Escape-to-close, labelled close button.
 *
 * Extracted so a new overlay cannot accidentally ship without the keyboard
 * behaviour — every existing dialog wires `useEscapeKey` + `useFocusTrap` by
 * hand, and the next one to forget would be an accessibility regression nobody
 * notices until someone tries to leave it without a mouse.
 */
import { ref } from "vue";
import CloseButton from "@/components/CloseButton.vue";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { useFocusTrap } from "@/composables/useFocusTrap";

defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();

useEscapeKey(() => emit("close"));
const dialog = ref<HTMLElement | null>(null);
useFocusTrap(dialog);
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div
      ref="dialog"
      class="modal-card"
      :class="{ wide }"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <div class="modal-header">
        <h2>{{ title }}</h2>
        <CloseButton @click="emit('close')" />
      </div>
      <div class="modal-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: rgb(0 0 0 / 35%);
}

.modal-card {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(680px, 90vh);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg, 0 10px 30px rgb(0 0 0 / 15%));
  overflow: hidden;
}
.modal-card.wide {
  width: min(720px, 100%);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.modal-header h2 {
  margin: 0;
  font-size: var(--font-size-lg);
}

.modal-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* Full-screen on phones — a centred card with a backdrop wastes most of a
   375px viewport and puts the close button somewhere awkward. */
@media (max-width: 480px) {
  .modal-overlay {
    padding: 0;
  }
  .modal-card,
  .modal-card.wide {
    width: 100%;
    max-height: 100vh;
    height: 100vh;
    border: none;
    border-radius: 0;
  }
}
</style>
