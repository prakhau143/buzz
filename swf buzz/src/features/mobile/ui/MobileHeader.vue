<script setup lang="ts">
import AppIcon from "@/components/AppIcon.vue";

/** A mobile screen header: optional back, title + subtitle, trailing actions. */
defineProps<{ title: string; subtitle?: string | null; back?: boolean; backLabel?: string }>();
const emit = defineEmits<{ back: [] }>();
</script>

<template>
  <div class="m-bar">
    <button
      v-if="back"
      type="button"
      class="m-icon-btn"
      :aria-label="backLabel ?? 'Back'"
      data-testid="mobile-back"
      @click="emit('back')"
    >
      <AppIcon name="chevron-left" :size="24" />
    </button>
    <div class="m-titles" :class="{ inset: !back }">
      <slot name="title">
        <h1 class="m-title" data-testid="mobile-title">{{ title }}</h1>
      </slot>
      <p v-if="subtitle" class="m-subtitle">{{ subtitle }}</p>
    </div>
    <div class="m-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.m-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 56px;
  padding: 0 var(--space-2);
}
.m-titles {
  flex: 1;
  min-width: 0;
}
.m-titles.inset {
  padding-left: var(--space-2);
}
.m-title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 700;
  line-height: var(--line-height-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-subtitle {
  margin: 1px 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.m-icon-btn,
.m-actions :deep(.m-icon-btn) {
  flex: none;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.m-icon-btn:active,
.m-actions :deep(.m-icon-btn:active) {
  background: var(--color-surface-muted);
}
.m-icon-btn:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}
</style>
