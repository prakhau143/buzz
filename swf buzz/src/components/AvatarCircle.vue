<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    name: string;
    avatarUrl?: string;
    size?: number;
    isAgent?: boolean;
    presence?: "online" | "away" | "offline";
  }>(),
  { size: 32, isAgent: false },
);

const initials = computed(() =>
  props.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join(""),
);
</script>

<template>
  <div class="avatar-wrapper" :style="{ width: `${size}px`, height: `${size}px` }">
    <div class="avatar-circle" :class="{ agent: isAgent }" :style="{ fontSize: `${size * 0.4}px` }">
      <img v-if="avatarUrl" :src="avatarUrl" :alt="name" />
      <span v-else>{{ initials || "?" }}</span>
    </div>
    <span v-if="presence" class="presence-dot" :class="presence" />
  </div>
</template>

<style scoped>
.avatar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.avatar-circle {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.avatar-circle.agent {
  background: var(--color-agent-muted);
  color: var(--color-agent);
  border-color: var(--color-agent);
}

.avatar-circle img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.presence-dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 30%;
  height: 30%;
  min-width: 8px;
  min-height: 8px;
  border-radius: 50%;
  border: 2px solid var(--color-surface);
  background: var(--color-text-subtle);
}
.presence-dot.online {
  background: var(--color-success);
}
.presence-dot.away {
  background: var(--color-warning);
}
</style>
