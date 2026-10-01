<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { useFocusTrap } from "@/composables/useFocusTrap";

/**
 * The mobile bottom sheet frame: backdrop (tap closes), grabber, rounded top,
 * safe-area bottom padding, focus trapped inside, Escape closes, focus moves
 * into it on open. Content is the slot — message actions, profile, etc.
 */
const props = defineProps<{ label: string; testid?: string }>();
const emit = defineEmits<{ close: [] }>();

const sheet = ref<HTMLElement | null>(null);
useEscapeKey(() => emit("close"), { modal: true });
useFocusTrap(sheet);
onMounted(async () => {
  await nextTick();
  sheet.value?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="m-sheet-scrim" data-testid="mobile-sheet-scrim" @click="emit('close')" />
    <section
      ref="sheet"
      class="m-sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="props.label"
      tabindex="-1"
      :data-testid="testid ?? 'mobile-sheet'"
    >
      <div class="m-grabber" aria-hidden="true" />
      <slot />
    </section>
  </Teleport>
</template>

<style scoped>
.m-sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--color-overlay);
  animation: m-fade 160ms ease-out;
}
.m-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: calc(var(--z-modal) + 1);
  max-height: 85dvh;
  overflow-y: auto;
  padding: var(--space-2) max(var(--space-3), env(safe-area-inset-right)) calc(var(--space-3) + env(safe-area-inset-bottom))
    max(var(--space-3), env(safe-area-inset-left));
  border-radius: 20px 20px 0 0;
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-lg);
  outline: none;
  animation: m-rise 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* A sideways drag on a sheet is never the browser's history swipe (see MobileLayout). */
.m-sheet-scrim,
.m-sheet,
.m-sheet :deep(*) {
  touch-action: pan-y pinch-zoom;
}
.m-sheet :deep([data-hscroll]),
.m-sheet :deep([data-hscroll] *),
.m-sheet :deep(input),
.m-sheet :deep(textarea) {
  touch-action: manipulation;
}
.m-grabber {
  width: 36px;
  height: 4px;
  margin: 0 auto var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-border-strong);
}
@keyframes m-rise {
  from {
    transform: translateY(100%);
  }
}
@keyframes m-fade {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .m-sheet,
  .m-sheet-scrim {
    animation: none;
  }
}

/* Shared sheet rows (used by the sheets' slot content). */
.m-sheet :deep(.sheet-row) {
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-md);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.m-sheet :deep(.sheet-row:active) {
  background: var(--color-surface-muted);
}
.m-sheet :deep(.sheet-row:focus-visible) {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}
.m-sheet :deep(.sheet-row.danger) {
  color: var(--color-danger);
}
.m-sheet :deep(.sheet-row .row-icon) {
  flex: none;
  color: var(--color-text-muted);
}
.m-sheet :deep(.sheet-row.danger .row-icon) {
  color: var(--color-danger);
}
.m-sheet :deep(.sheet-divider) {
  height: 1px;
  margin: var(--space-1) var(--space-2);
  background: var(--color-border);
}
</style>
