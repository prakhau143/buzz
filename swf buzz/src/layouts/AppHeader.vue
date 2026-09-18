<script setup lang="ts">
/**
 * The one persistent header + primary nav, rendered in `App.vue` OUTSIDE
 * `ErrorBoundary` — so it stays usable (Home is always reachable) even
 * when the routed view underneath it crashes. Previously this markup
 * lived inside `AppShell.vue`, which is rendered *inside* each routed
 * view — meaning a view crash took the header down with it. See the P0/P2
 * fix this component is part of.
 *
 * `usePresenceHeartbeat`/`useAgentObserverFeed` moved here from
 * `AppShell.vue` for the same reason: this is the one place guaranteed to
 * render on every authenticated screen (including the new `HomeView`,
 * which doesn't use `AppShell`'s sidebar/main/details layout at all).
 */
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useUiStore } from "@/stores/ui";
import { useSessionStore } from "@/stores/session";
import { useAuth } from "@/features/auth/useAuth";
import ConnectionBadge from "@/components/ConnectionBadge.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import BrandLogo from "@/components/BrandLogo.vue";
import { usePresenceHeartbeat } from "@/features/presence/usePresenceHeartbeat";
import { useAgentObserverFeed } from "@/features/agents/useAgentObserverFeed";

const uiStore = useUiStore();
const sessionStore = useSessionStore();
const route = useRoute();
const { logout } = useAuth();

usePresenceHeartbeat();
useAgentObserverFeed();

const navLinks = [
  { to: "/", label: "Home", matchNames: ["home"] },
  { to: "/community", label: "Channels", matchNames: ["community-channels"] },
  { to: "/community-dm", label: "Direct Messages", matchNames: ["community-dm"] },
] as const;

function isActive(matchNames: readonly string[]): boolean {
  return matchNames.includes(String(route.name ?? ""));
}

const avatarName = computed(
  () =>
    sessionStore.applicationUser?.displayName ??
    sessionStore.applicationUser?.email ??
    sessionStore.employeeEmail ??
    "You",
);
</script>

<template>
  <header class="app-header">
    <div class="header-left">
      <button
        class="icon-button"
        type="button"
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
        @click="uiStore.toggleSidebar()"
      >
        ☰
      </button>
      <BrandLogo />
      <nav class="primary-nav" aria-label="Primary">
        <RouterLink
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="nav-link"
          :class="{ active: isActive(link.matchNames) }"
        >
          {{ link.label }}
        </RouterLink>
      </nav>
    </div>
    <div class="header-right">
      <ConnectionBadge />
      <AvatarCircle :name="avatarName" :size="28" />
      <button class="icon-button sign-out" type="button" title="Sign out" @click="logout">
        Sign out
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 var(--space-4);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.primary-nav {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: var(--space-2);
}

.nav-link {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text-muted);
  text-decoration: none;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.nav-link:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.nav-link.active {
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-weight: 600;
}

.icon-button {
  height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
  font-family: inherit;
}
.icon-button:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.sign-out {
  font-size: var(--font-size-sm);
}

@media (max-width: 720px) {
  .app-header {
    flex-wrap: wrap;
    height: auto;
    padding: var(--space-2) var(--space-3);
    gap: var(--space-2);
  }
  .primary-nav {
    margin-left: 0;
    flex-wrap: wrap;
  }
}
</style>
