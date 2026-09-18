<script setup lang="ts">
/**
 * Scoped to routed content only — `App.vue` wraps just `<RouterView>` with
 * this, keeping `AppHeader` (brand/nav/sign-out) outside it, so a crash
 * here never takes navigation down with it (P0/P2 fix).
 *
 * "Retry" doesn't just clear the error and re-render the same broken
 * state — it also bumps `retryKey`, which is used as a `:key` on the
 * wrapped slot content so Vue fully unmounts and remounts the crashed
 * subtree. That re-runs every composable's mount-time fetch, which is the
 * generic way to "retry whatever failed" without this component needing
 * to know what any specific view was trying to load.
 */
import { computed, onErrorCaptured, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { logError } from "@/services/errors";
import BaseButton from "./BaseButton.vue";

const error = ref<unknown>(null);
const retryKey = ref(0);
const showStack = ref(false);
const route = useRoute();
const router = useRouter();

const isDev = import.meta.env.DEV;

onErrorCaptured((err) => {
  error.value = err;
  logError("ErrorBoundary", err);
  return false;
});

// A crashed view left behind on one route must not keep showing its stale
// error after the user navigates elsewhere and (maybe) back.
watch(
  () => route.fullPath,
  () => {
    if (error.value) reset();
  },
);

function reset() {
  error.value = null;
  showStack.value = false;
  retryKey.value += 1;
}

function goToDashboard() {
  reset();
  void router.push({ name: "home" });
}

const errorMessage = computed(() => {
  const err = error.value;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unexpected error occurred.";
});

const errorStack = computed(() => (error.value instanceof Error ? error.value.stack : undefined));
</script>

<template>
  <div v-if="error" class="error-boundary" role="alert">
    <p class="title">This part of the app hit a problem</p>
    <p class="description">Try again, or go back to the dashboard.</p>

    <template v-if="isDev">
      <p class="dev-message">{{ errorMessage }}</p>
      <button
        v-if="errorStack"
        type="button"
        class="stack-toggle"
        @click="showStack = !showStack"
      >
        {{ showStack ? "Hide" : "Show" }} stack trace
      </button>
      <pre v-if="showStack && errorStack" class="stack-trace">{{ errorStack }}</pre>
    </template>

    <div class="actions">
      <BaseButton variant="secondary" @click="reset">Retry</BaseButton>
      <BaseButton variant="primary" @click="goToDashboard">Go to dashboard</BaseButton>
    </div>
  </div>
  <div v-else :key="retryKey" class="error-boundary-content">
    <slot />
  </div>
</template>

<style scoped>
.error-boundary-content {
  height: 100%;
  min-height: 0;
}
.error-boundary {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-6);
  text-align: center;
}
.title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
}
.description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
.dev-message {
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-3);
  background: var(--color-danger-muted);
  color: var(--color-danger);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  max-width: 640px;
}
.stack-toggle {
  border: none;
  background: none;
  color: var(--color-text-subtle);
  font-size: var(--font-size-xs);
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}
.stack-trace {
  max-width: 640px;
  max-height: 240px;
  overflow: auto;
  text-align: left;
  padding: var(--space-3);
  background: var(--color-surface-muted);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  white-space: pre-wrap;
}
.actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
