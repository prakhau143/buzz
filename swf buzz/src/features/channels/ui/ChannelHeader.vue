<script setup lang="ts">
import type { Channel } from "@/types/domain";

defineProps<{ channel: Channel | null; memberCount: number }>();
const emit = defineEmits<{ "open-members": []; "open-menu": [] }>();
</script>

<template>
  <div class="channel-header">
    <div class="title">
      <span class="visibility-icon">{{ channel?.visibility === "private" ? "🔒" : "#" }}</span>
      <h1>{{ channel?.name ?? "Channel" }}</h1>
    </div>
    <div class="actions">
      <button type="button" class="member-count" @click="emit('open-members')">
        👥 {{ memberCount }}
      </button>
      <button type="button" class="menu-button" aria-label="Channel menu" @click="emit('open-menu')">
        ⋮
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
.member-count:hover,
.menu-button:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.menu-button {
  font-size: var(--font-size-md);
  font-weight: 700;
  width: 28px;
  padding: 0;
}
</style>
