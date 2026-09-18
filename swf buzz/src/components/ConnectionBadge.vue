<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useConnectionStore } from "@/stores/connection";

const connectionStore = useConnectionStore();
const { status, lastError } = storeToRefs(connectionStore);

const label = computed(() => {
  switch (status.value) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "disconnected":
      return "Disconnected";
    case "auth_failed":
      return "Sign-in required";
    case "error":
      return "Connection error";
    default:
      return "Unknown";
  }
});

// Only error/disconnected states carry a meaningful lastError — don't show a
// stale message from a previous failure once we're connected/connecting again.
const detail = computed(() => {
  if (status.value === "error" || status.value === "disconnected") {
    return lastError.value;
  }
  return null;
});
</script>

<template>
  <div class="connection-badge" :class="status" :title="detail ?? label">
    <span class="dot" />
    <span class="label">{{ label }}</span>
    <span v-if="detail" class="detail">{{ detail }}</span>
  </div>
</template>

<style scoped>
.connection-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 320px;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-subtle);
  flex-shrink: 0;
}

.connected .dot {
  background: var(--color-success);
}
.connecting .dot,
.reconnecting .dot {
  background: var(--color-warning);
  animation: pulse 1.2s ease-in-out infinite;
}
.disconnected .dot,
.error .dot,
.auth_failed .dot {
  background: var(--color-danger);
}

.label {
  flex-shrink: 0;
}

.detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-danger);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
