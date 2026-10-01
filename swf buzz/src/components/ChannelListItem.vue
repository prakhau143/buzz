<script setup lang="ts">
import AppIcon from "@/components/AppIcon.vue";
import type { Channel } from "@/types/domain";

defineProps<{
  channel: Channel;
  active: boolean;
  /** Unread count from the NIP-RS read state — 0 until hydrated (stores/readState.ts). */
  unreadCount?: number;
  hasMention?: boolean;
}>();
</script>

<template>
  <button
    type="button"
    class="channel-item"
    :class="{ active, unread: !!unreadCount }"
    :aria-current="active ? 'page' : undefined"
  >
    <AppIcon :name="channel.visibility === 'private' ? 'lock' : 'hash'" :size="16" class="glyph" />
    <span class="name">{{ channel.name }}</span>
    <span v-if="channel.visibility === 'private'" class="sr-only">(private channel)</span>
    <span
      v-if="hasMention"
      class="badge badge--mention"
      :aria-label="`${unreadCount} unread, including a mention`"
      >{{ unreadCount }}</span
    >
    <span
      v-else-if="unreadCount"
      class="badge badge--unread"
      :aria-label="`${unreadCount} unread`"
      >{{ unreadCount }}</span
    >
  </button>
</template>

<style scoped>
.channel-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 32px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}
.channel-item:hover {
  background: var(--color-surface-hover);
}
.channel-item:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: calc(-1 * var(--focus-ring-width));
}
.channel-item.unread {
  color: var(--color-text);
  font-weight: 600;
}
.channel-item.active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.glyph {
  flex-shrink: 0;
  color: var(--color-text-subtle);
}
.channel-item.active .glyph,
.channel-item.unread .glyph {
  color: var(--color-text-muted);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.badge {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

.badge--unread {
  background: var(--color-primary);
  color: var(--color-text-on-accent);
}

.badge--mention {
  background: var(--color-danger);
  color: var(--color-text-on-accent);
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
