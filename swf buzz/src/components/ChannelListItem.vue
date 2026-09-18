<script setup lang="ts">
import type { Channel } from "@/types/domain";

defineProps<{ channel: Channel; active: boolean }>();
</script>

<template>
  <button type="button" class="channel-item" :class="{ active }">
    <span class="hash">{{ channel.visibility === "private" ? "🔒" : "#" }}</span>
    <span class="name">{{ channel.name }}</span>
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
  font-size: var(--font-size-sm);
  cursor: pointer;
  text-align: left;
}
.channel-item:hover {
  background: var(--color-surface-hover);
}
.channel-item.active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.hash {
  color: var(--color-text-subtle);
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
