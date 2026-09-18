<script setup lang="ts">
/**
 * `AppHeader` renders OUTSIDE `ErrorBoundary` deliberately — a crash in any
 * routed view must not take the header/primary-nav down with it (P0/P2 fix,
 * see AppHeader.vue and ErrorBoundary.vue's own doc comments). Only shown
 * once a session exists — `/login`/`/callback`/`/invite/:token` render
 * without it, matching the router's `meta.public` set.
 */
import { RouterView } from "vue-router";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import AppHeader from "@/layouts/AppHeader.vue";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();
</script>

<template>
  <div class="app-root">
    <AppHeader v-if="session.isReady" />
    <div class="app-body">
      <ErrorBoundary>
        <RouterView />
      </ErrorBoundary>
    </div>
  </div>
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
}
.app-body {
  flex: 1;
  min-height: 0;
}
</style>
