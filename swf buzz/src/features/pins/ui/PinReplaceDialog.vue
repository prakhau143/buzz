<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import OverlayDialog from "@/components/OverlayDialog.vue";
import MobileSheet from "@/features/mobile/ui/MobileSheet.vue";

/**
 * "Replace pinned message?" — the one pin action that asks first, because a
 * conversation has a single pin and replacing it silently is easy to do by
 * accident. Desktop: the shared modal shell; touch: the shared bottom sheet.
 */
defineProps<{ mobile?: boolean }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const replaceButton = ref<HTMLButtonElement | null>(null);
onMounted(async () => {
  await nextTick();
  replaceButton.value?.focus();
});
</script>

<template>
  <MobileSheet v-if="mobile" label="Replace pinned message" testid="pin-replace-sheet" @close="emit('cancel')">
    <div class="confirm" role="alertdialog" aria-labelledby="pin-replace-title" aria-describedby="pin-replace-body">
      <p id="pin-replace-title" class="confirm-title">Replace pinned message?</p>
      <p id="pin-replace-body" class="confirm-body">The current pinned message will be replaced with this one.</p>
      <button ref="replaceButton" type="button" class="confirm-btn primary" data-testid="pin-replace-confirm" @click="emit('confirm')">
        Replace
      </button>
      <button type="button" class="confirm-btn" data-testid="pin-replace-cancel" @click="emit('cancel')">Cancel</button>
    </div>
  </MobileSheet>
  <OverlayDialog v-else title="Replace pinned message?" @close="emit('cancel')">
    <div class="dialog-body" data-testid="pin-replace-dialog">
      <p id="pin-replace-body" class="confirm-body">The current pinned message will be replaced with this one.</p>
      <div class="dialog-actions">
        <button type="button" class="btn" data-testid="pin-replace-cancel" @click="emit('cancel')">Cancel</button>
        <button ref="replaceButton" type="button" class="btn primary" data-testid="pin-replace-confirm" @click="emit('confirm')">
          Replace
        </button>
      </div>
    </div>
  </OverlayDialog>
</template>

<style scoped>
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}
.confirm-body {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.btn {
  height: 32px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.btn:hover {
  background: var(--color-surface-hover);
}
.btn.primary {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.btn.primary:hover {
  background: var(--color-primary-hover);
}
.btn:focus-visible,
.confirm-btn:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2) var(--space-1);
}
.confirm-title {
  margin: 0;
  font-weight: 700;
}
.confirm-btn {
  min-height: 48px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-weight: 600;
}
.confirm-btn.primary {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
</style>
