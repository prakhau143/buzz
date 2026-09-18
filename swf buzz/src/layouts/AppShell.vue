<script setup lang="ts">
/**
 * The per-view content layout (secondary sidebar / main pane / details
 * pane). The persistent header/primary-nav used to live here too — moved
 * to `AppHeader.vue` (rendered by `App.vue`, outside `ErrorBoundary`) so a
 * crash in this view's content doesn't take navigation down with it. The
 * "Show/Hide details" toggle (`showDetailsToggle`) stays here, as a small
 * bar at the top of the main pane, since it's specific to this layout's
 * own details-pane, not app-wide navigation.
 */
import { storeToRefs } from "pinia";
import { useUiStore } from "@/stores/ui";
import BaseButton from "@/components/BaseButton.vue";

const uiStore = useUiStore();
const { sidebarCollapsed, detailsPaneOpen } = storeToRefs(uiStore);

defineProps<{ showDetailsToggle?: boolean }>();
</script>

<template>
  <div class="app-shell">
    <div class="body" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
      <aside v-if="!sidebarCollapsed" class="sidebar">
        <slot name="sidebar" />
      </aside>

      <main class="main-pane">
        <div v-if="showDetailsToggle" class="details-toggle-bar">
          <BaseButton variant="ghost" @click="uiStore.toggleDetailsPane()">
            {{ detailsPaneOpen ? "Hide details" : "Show details" }}
          </BaseButton>
        </div>
        <slot name="main" />
      </main>

      <aside v-if="detailsPaneOpen" class="details-pane">
        <slot name="details" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg);
}

.body {
  flex: 1;
  display: grid;
  grid-template-columns: 260px 1fr;
  min-height: 0;
}

.body:has(.details-pane) {
  grid-template-columns: 260px 1fr 300px;
}

.body.sidebar-collapsed {
  grid-template-columns: 1fr;
}
.body.sidebar-collapsed:has(.details-pane) {
  grid-template-columns: 1fr 300px;
}

.sidebar {
  border-right: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  overflow-y: auto;
  min-width: 0;
}

.main-pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}

.details-toggle-bar {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-2) var(--space-3) 0;
  flex-shrink: 0;
}

.details-pane {
  border-left: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow-y: auto;
}

@media (max-width: 860px) {
  .body {
    grid-template-columns: 1fr;
  }
  .sidebar,
  .details-pane {
    position: absolute;
    inset: 0;
    z-index: 10;
  }
}
</style>
