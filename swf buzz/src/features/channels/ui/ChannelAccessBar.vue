<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import type { ChannelAccess } from "../channelAccess";

/**
 * The channel's access line under its header — the same component on desktop
 * and mobile, driven by `channelAccess.ts`:
 *
 *   not_member → "You're not a member of this channel yet." + Join  (authoritative only)
 *   checking   → "Checking channel access…" — only if it takes a while, so a
 *                normal open never flashes anything
 *   error      → "Couldn't verify your access" + Retry (no negative claim)
 *   member / unknown → nothing
 */
const props = defineProps<{ access: ChannelAccess; isJoining?: boolean; mobile?: boolean }>();
const emit = defineEmits<{ join: []; retry: [] }>();

/** Below this, a check is invisible — no flicker on an ordinary channel open. */
const CHECKING_DELAY_MS = 400;
const showChecking = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => props.access.status,
  (status) => {
    clearTimeout(timer);
    showChecking.value = false;
    if (status === "checking") timer = setTimeout(() => (showChecking.value = true), CHECKING_DELAY_MS);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div
    v-if="access.status === 'not_member'"
    class="access-bar join"
    :class="{ mobile }"
    data-testid="channel-join-bar"
  >
    <span>You're not a member of this channel yet.</span>
    <BaseButton variant="primary" :disabled="isJoining" data-testid="channel-join" @click="emit('join')">
      {{ mobile ? "Join" : "Join channel" }}
    </BaseButton>
  </div>
  <div
    v-else-if="access.status === 'error'"
    class="access-bar"
    :class="{ mobile }"
    role="status"
    data-testid="channel-access-error"
  >
    <span>Couldn't verify your access to this channel.</span>
    <BaseButton variant="ghost" data-testid="channel-access-retry" @click="emit('retry')">Retry</BaseButton>
  </div>
  <div
    v-else-if="access.status === 'checking' && showChecking"
    class="access-bar checking"
    :class="{ mobile }"
    role="status"
    data-testid="channel-access-checking"
  >
    <span class="pulse" aria-hidden="true" />
    <span>Checking channel access…</span>
  </div>
</template>

<style scoped>
.access-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 44px;
  padding: var(--space-2) var(--space-4);
  background: var(--color-surface-muted);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  flex: none;
}
.access-bar.mobile {
  border-bottom: none;
  border-top: 1px solid var(--color-border);
}
.access-bar.mobile :deep(button) {
  min-height: 44px;
}
.access-bar.checking {
  justify-content: flex-start;
  gap: var(--space-2);
  background: transparent;
  font-size: var(--font-size-xs);
}
.pulse {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  animation: access-pulse 1.1s ease-in-out infinite;
}
@keyframes access-pulse {
  50% {
    opacity: 0.3;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pulse {
    animation: none;
  }
}
</style>
