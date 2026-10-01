<script setup lang="ts">
import type { ConnectStep } from "@/features/communities/useCommunityConnect";

/**
 * "Connecting to <community>" progress: Identity → Relay → Membership. Driven
 * by the real session lifecycle, so a slow NIP-42 handshake reads as a step in
 * progress rather than a frozen button. State is spelled out in text for
 * assistive tech — the icons are decoration.
 */
defineProps<{ steps: ConnectStep[]; host?: string | null; opening?: boolean }>();

const ICON: Record<ConnectStep["state"], string> = { done: "✓", active: "", failed: "!", pending: "" };
const SPOKEN: Record<ConnectStep["state"], string> = {
  done: "done",
  active: "in progress",
  failed: "failed",
  pending: "not started",
};
</script>

<template>
  <div class="stepper" data-testid="connect-stepper">
    <p class="title">Connecting{{ host ? ` to ${host}` : "" }}</p>
    <ol class="steps" aria-live="polite">
      <li v-for="step in steps" :key="step.label" class="step" :class="step.state" data-testid="connect-step">
        <span class="marker" aria-hidden="true">
          <span v-if="step.state === 'active'" class="spinner" />
          <template v-else>{{ ICON[step.state] }}</template>
        </span>
        <span class="label">{{ step.label }}</span>
        <span class="sr-only">— {{ SPOKEN[step.state] }}</span>
      </li>
    </ol>
    <p v-if="opening" class="opening">Opening community…</p>
  </div>
</template>

<style scoped>
.stepper {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}
.title {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
  overflow-wrap: anywhere;
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.step {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-subtle);
}
.step.done,
.step.active {
  color: var(--color-text);
}
.step.failed {
  color: var(--color-danger);
}
.marker {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  border: 1.5px solid var(--color-border-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
}
.step.done .marker {
  background: var(--color-success);
  border-color: var(--color-success);
  color: var(--color-text-on-accent);
}
.step.failed .marker {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: var(--color-text-on-accent);
}
.step.active .marker {
  border-color: var(--color-primary);
}
.spinner {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  border: 2px solid var(--color-primary);
  border-right-color: transparent;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
.opening {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
