<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppIcon, { type IconName } from "@/components/AppIcon.vue";
import { useInboxBadge } from "@/features/inbox/useInboxBadge";

/**
 * The four top-level mobile destinations. Communities are NOT a tab: Home owns
 * the community context (its community card opens the selector). The Inbox
 * badge is the same rule as the desktop sidebar's (`useInboxBadge`).
 */
const route = useRoute();
const inboxOpen = computed(() => route.name === "mobile-inbox");
const inboxBadge = useInboxBadge(inboxOpen);

const items = computed<{ name: string; label: string; icon: IconName; badge: number; active: boolean }[]>(() => [
  {
    name: "mobile-home",
    label: "Home",
    icon: "home",
    badge: 0,
    // Home stays lit through its own stack (conversation, thread).
    active: ["mobile-home", "mobile-channel", "mobile-thread", "mobile-dm", "mobile-dm-thread"].includes(String(route.name)),
  },
  { name: "mobile-inbox", label: "Inbox", icon: "inbox", badge: inboxBadge.value, active: inboxOpen.value },
  { name: "mobile-search", label: "Search", icon: "search", badge: 0, active: route.name === "mobile-search" },
  { name: "mobile-profile", label: "Profile", icon: "user", badge: 0, active: route.name === "mobile-profile" },
]);
</script>

<template>
  <nav class="bottom-nav" aria-label="Main" data-testid="mobile-bottom-nav">
    <RouterLink
      v-for="item in items"
      :key="item.name"
      :to="{ name: item.name }"
      replace
      class="tab"
      :class="{ active: item.active }"
      :aria-current="item.active ? 'page' : undefined"
      :aria-label="item.badge ? `${item.label}, ${item.badge} unread` : item.label"
      :data-testid="`mobile-tab-${item.label.toLowerCase()}`"
    >
      <span class="icon-wrap">
        <AppIcon :name="item.icon" :size="24" />
        <span v-if="item.badge" class="badge" aria-hidden="true" data-testid="mobile-tab-badge">{{
          item.badge > 99 ? "99+" : item.badge
        }}</span>
      </span>
      <span class="label">{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.bottom-nav {
  flex: none;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 4px max(8px, env(safe-area-inset-right)) calc(4px + env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.tab {
  position: relative;
  min-height: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: var(--radius-md);
  color: var(--color-text-subtle);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: color 120ms ease;
}
.tab:active {
  background: var(--color-surface-muted);
}
.tab.active {
  color: var(--color-primary);
}
.tab.active::before {
  content: "";
  position: absolute;
  top: -5px;
  width: 24px;
  height: 3px;
  border-radius: 0 0 3px 3px;
  background: var(--color-primary);
}
.tab:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}
.icon-wrap {
  position: relative;
  display: inline-flex;
}
.label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
/* A small count pill riding the icon's corner: compact, tabular, ringed in the bar colour. */
.badge {
  position: absolute;
  top: -3px;
  left: 15px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  box-sizing: content-box;
  border: 2px solid var(--color-surface);
  border-radius: var(--radius-full);
  background: var(--color-danger);
  color: var(--color-text-on-accent);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  text-align: center;
  letter-spacing: -0.01em;
}
@media (prefers-reduced-motion: reduce) {
  .tab {
    transition: none;
  }
}
</style>
