<script setup lang="ts">
import AppIcon from "@/components/AppIcon.vue";

/**
 * The deep-reveal status line above a conversation: a compact "Finding
 * message…" while history loads, or "Message unavailable" when the target
 * can't be shown (deleted, no longer accessible, beyond history, or invalid) —
 * never a fabricated message.
 */
defineProps<{ status: "idle" | "finding" | "unavailable" }>();
const emit = defineEmits<{ dismiss: [] }>();
</script>

<template>
  <div v-if="status === 'finding'" class="notice finding" role="status" data-testid="reveal-finding">
    <span class="pulse" aria-hidden="true" />Finding message…
  </div>
  <div v-else-if="status === 'unavailable'" class="notice unavailable" role="alert" data-testid="reveal-unavailable">
    <AppIcon name="info" :size="16" class="icon" />
    <span class="text">
      <strong>Message unavailable</strong>
      <span>It may have been deleted, or you may no longer have access to it.</span>
    </span>
    <button type="button" class="dismiss" aria-label="Dismiss" data-testid="reveal-dismiss" @click="emit('dismiss')">
      <AppIcon name="close" :size="16" />
    </button>
  </div>
</template>

<style scoped>
.notice {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-2) var(--space-3) 0;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  animation: notice-in 180ms ease-out;
}
.finding {
  min-height: 36px;
  color: var(--color-text-muted);
  background: var(--color-surface-muted);
}
.unavailable {
  min-height: 52px;
  padding-right: 0;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}
.icon {
  flex: none;
  color: var(--color-text-muted);
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.text strong {
  font-size: var(--font-size-sm);
  color: var(--color-text);
}
.dismiss {
  flex: none;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
}
.pulse {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
@keyframes notice-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .notice,
  .pulse {
    animation: none;
  }
}
</style>
