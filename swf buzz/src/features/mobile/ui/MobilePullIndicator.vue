<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import type { PullPhase } from "../gestures/usePullToRefresh";

/**
 * The pull-to-refresh indicator: a small disc that drops in over the top of
 * the content (it never pushes the content — no layout shift), following
 * `--ptr-pull` from the host. Its state is announced once per change.
 */
const props = defineProps<{ phase: PullPhase }>();

const LABEL: Record<PullPhase, string> = {
  idle: "",
  pulling: "Pull to refresh",
  armed: "Release to refresh",
  refreshing: "Refreshing…",
  done: "Updated",
  error: "Couldn't refresh",
};
const label = computed(() => LABEL[props.phase]);
</script>

<template>
  <div class="ptr" :class="phase" aria-hidden="true" data-testid="pull-indicator">
    <span class="disc">
      <span v-if="phase === 'refreshing'" class="spinner" />
      <AppIcon v-else-if="phase === 'done'" name="check" :size="20" />
      <AppIcon v-else-if="phase === 'error'" name="warning" :size="20" />
      <AppIcon v-else name="refresh" :size="20" class="arrow" />
    </span>
  </div>
  <p class="ptr-status" role="status" aria-live="polite" data-testid="pull-status">{{ phase === "pulling" ? "" : label }}</p>
</template>

<style scoped>
.ptr {
  position: absolute;
  top: 0;
  left: 50%;
  z-index: 2;
  pointer-events: none;
  transform: translate3d(-50%, calc(var(--ptr-pull, 0px) - 44px), 0);
  opacity: 0;
}
.ptr:not(.idle) {
  opacity: 1;
}
.ptr.idle {
  transition:
    transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 160ms ease;
}
.disc {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.arrow {
  transition: transform 160ms ease;
}
.armed .arrow {
  transform: rotate(180deg);
}
.error .disc {
  color: var(--color-danger);
}
.done .disc {
  color: var(--color-success);
}
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: ptr-spin 700ms linear infinite;
}
@keyframes ptr-spin {
  to {
    transform: rotate(360deg);
  }
}
.ptr-status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .ptr.idle,
  .arrow {
    transition: none;
  }
  .spinner {
    animation-duration: 1.6s;
  }
}
</style>
