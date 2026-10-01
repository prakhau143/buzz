<script setup lang="ts">
import { computed } from "vue";
import PresenceDot from "@/features/presence/PresenceDot.vue";
import { usePresenceOf } from "@/features/presence/presenceSync";
import type { PresenceStatus } from "@/protocol/presence";

const props = withDefaults(
  defineProps<{
    name: string;
    avatarUrl?: string;
    size?: number;
    isAgent?: boolean;
    /** Explicit status (rare). Normally pass `pubkey` and the presence store answers. */
    presence?: PresenceStatus;
    /**
     * Whose avatar this is. With it, the dot comes from the one presence store,
     * keyed by pubkey — so the same person shows the same status everywhere.
     */
    pubkey?: string | null;
    /** Opt out for avatars that are not a person's live status (e.g. a thread's participant stack). */
    showPresence?: boolean;
  }>(),
  { size: 32, isAgent: false, pubkey: null, showPresence: true, presence: undefined },
);

const storeStatus = usePresenceOf(() => (props.presence ? null : props.pubkey));
const status = computed(() => (props.showPresence ? (props.presence ?? storeStatus.value) : null));

// A parenthetical ("Scout (Support Agent)") is a qualifier, not part of the
// name — without this the second initial was a literal "(".
const initials = computed(() =>
  props.name
    .replace(/\([^)]*\)?/g, " ")
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
    <PresenceDot v-if="status" :status="status" class="avatar-presence" />
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

.avatar-presence {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 30%;
  height: 30%;
  min-width: 8px;
  min-height: 8px;
  max-width: 16px;
  max-height: 16px;
  border: 2px solid var(--color-surface);
}
</style>
