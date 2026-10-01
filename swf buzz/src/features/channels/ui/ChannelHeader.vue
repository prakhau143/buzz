<script setup lang="ts">
import type { Channel } from "@/types/domain";
import { useUiStore } from "@/stores/ui";
import AppIcon from "@/components/AppIcon.vue";

defineProps<{ channel: Channel | null; memberCount: number }>();
const emit = defineEmits<{ "open-members": []; "open-menu": [] }>();
const ui = useUiStore();
</script>

<template>
  <div class="channel-header">
    <div class="title">
      <button
        type="button"
        class="sidebar-toggle"
        aria-label="Toggle sidebar"
        title="Toggle sidebar"
        @click="ui.toggleSidebar()"
      >
        <AppIcon name="menu" :size="20" />
      </button>
      <!-- Private vs public: an icon, not a coloured emoji that differs per OS. -->
      <span class="visibility-icon">
        <AppIcon :name="channel?.visibility === 'private' ? 'lock' : 'hash'" :size="16" />
      </span>
      <h1>{{ channel?.name ?? "Channel" }}</h1>
    </div>
    <div class="actions">
      <button
        type="button"
        class="member-count"
        :aria-label="`View channel members (${memberCount})`"
        :title="`${memberCount} members`"
        @click="emit('open-members')"
      >
        <AppIcon name="users" :size="16" />
        {{ memberCount }}
      </button>
      <button
        type="button"
        class="menu-button"
        aria-label="Channel menu"
        title="Channel menu"
        @click="emit('open-menu')"
      >
        <AppIcon name="more" :size="20" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.channel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.visibility-icon {
  color: var(--color-text-subtle);
  flex-shrink: 0;
}

.title h1 {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.sidebar-toggle,
.member-count,
.menu-button {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  border-radius: var(--radius-md);
  height: 28px;
  padding: 0 var(--space-2);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.sidebar-toggle:hover,
.member-count:hover,
.menu-button:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}
.sidebar-toggle:focus-visible,
.member-count:focus-visible,
.menu-button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

/* Only useful as an explicit toggle once the sidebar can be hidden — see
   AppShell.vue's responsive breakpoints; harmless no-op above 1024px where
   the sidebar is always visible by default. */
.sidebar-toggle {
  display: none;
}
@media (max-width: 1024px) {
  .sidebar-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
  }
}

.menu-button {
  font-size: var(--font-size-md);
  font-weight: 700;
  width: 28px;
  padding: 0;
}
</style>
