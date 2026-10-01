<script setup lang="ts">
/**
 * The persistent header, rendered in `App.vue` OUTSIDE `ErrorBoundary` so
 * it stays usable when a routed view crashes. Hidden on full-screen routes
 * (Settings), which is why presence lives in `app/SessionServices.vue`, not here.
 *
 * A navigation shell only: [sidebar] [back] [forward] | [SWF Buzz].
 * Account and connection state deliberately live elsewhere — sign-out in the
 * bottom-left profile menu, connection status in the community switcher (it is
 * a property of ONE community, not of the app) — so the top bar never carries
 * a duplicate, global "Connected" pill, avatar or Sign out.
 */
import AppIcon from "@/components/AppIcon.vue";
import BrandLogo from "@/components/BrandLogo.vue";
import { useUiStore } from "@/stores/ui";
import { useAppNavigation } from "@/features/navigation/useAppNavigation";
import { shortcutHint } from "@/features/shortcuts/shortcutRegistry";

const uiStore = useUiStore();
const { canGoBack, canGoForward, back, forward } = useAppNavigation();
const backHint = shortcutHint("go-back");
const forwardHint = shortcutHint("go-forward");
</script>

<template>
  <header class="app-header">
    <div class="header-nav">
      <button
        type="button"
        class="icon-button"
        :aria-label="uiStore.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'"
        :title="uiStore.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'"
        :aria-pressed="!uiStore.sidebarCollapsed"
        data-testid="header-sidebar-toggle"
        @click="uiStore.toggleSidebar()"
      >
        <AppIcon name="menu" :size="20" />
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="Back"
        :title="`Back (${backHint})`"
        :disabled="!canGoBack"
        data-testid="header-back"
        @click="back"
      >
        <AppIcon name="chevron-left" :size="20" />
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="Forward"
        :title="`Forward (${forwardHint})`"
        :disabled="!canGoForward"
        data-testid="header-forward"
        @click="forward"
      >
        <AppIcon name="chevron-right" :size="20" />
      </button>
    </div>
    <span class="divider" aria-hidden="true" />
    <BrandLogo />
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 48px;
  padding: 0 var(--space-3);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  min-width: 0;
}
.header-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    background 140ms ease,
    color 140ms ease;
}
.icon-button:hover:not(:disabled) {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.icon-button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
.icon-button:disabled {
  color: var(--color-text-subtle);
  opacity: 0.45;
  cursor: default;
}
.divider {
  width: 1px;
  height: 20px;
  margin: 0 var(--space-1);
  background: var(--color-border);
  flex-shrink: 0;
}
@media (prefers-reduced-motion: reduce) {
  .icon-button {
    transition: none;
  }
}
</style>
