<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import CommunityAvatar from "@/features/communities/ui/CommunityAvatar.vue";
import { activeRelayUrl, communities, relayHost } from "@/features/communities/relayCommunities";
import {
  clearCommunitySwitchError,
  communitySwitchError,
  communitySwitchFailedTarget,
  communitySwitchingFrom,
  communitySwitchingTo,
  useCommunitySwitch,
} from "@/features/communities/useCommunitySwitch";

/**
 * The mobile community-switch screen. A switch deliberately tears the current
 * community's session down before the next is authenticated (NIP-42 + the
 * relay's membership verdict), so the app has nothing to show in between —
 * this covers that gap with a real status instead of a blank flash. It only
 * PRESENTS the shared switch state (`useCommunitySwitch`); the lifecycle,
 * membership verification and restore-on-failure are untouched and nothing
 * here claims a connection that hasn't happened.
 *
 * On failure you are back in the previous community already (the switch
 * restored it); "Retry" runs the same verified switch again, "Stay" dismisses.
 */
const { retryFailed } = useCommunitySwitch();

const nameOf = (url: string | null) =>
  url ? (communities.value.find((c) => c.relayUrl === url)?.name ?? relayHost(url)) : "";
const switching = computed(() => communitySwitchingTo.value);
const failed = computed(() => (!switching.value && communitySwitchError.value && communitySwitchFailedTarget.value ? communitySwitchFailedTarget.value : null));
const target = computed(() => switching.value ?? failed.value);
const currentName = computed(() => nameOf(communitySwitchingFrom.value ?? activeRelayUrl.value));

const retrying = ref(false);
async function retry() {
  retrying.value = true;
  try {
    await retryFailed();
  } finally {
    retrying.value = false;
  }
}

// Move focus to the action when a failure appears, so a keyboard / screen-reader user lands on it.
const retryButton = ref<HTMLButtonElement | null>(null);
watch(failed, async (url) => {
  if (!url) return;
  await nextTick();
  retryButton.value?.focus();
});
</script>

<template>
  <Transition name="m-switch">
    <div v-if="target" class="m-switch" data-testid="mobile-switch-overlay">
      <div v-if="switching" class="panel" role="status" aria-live="polite" aria-busy="true" data-testid="mobile-switch-connecting">
        <CommunityAvatar :relay-url="switching" :name="nameOf(switching)" :size="64" />
        <p class="title">{{ nameOf(switching) }}</p>
        <p class="sub">Connecting to community…</p>
        <div class="sk" aria-hidden="true">
          <span class="sk-line" style="width: 72%" />
          <span class="sk-line" style="width: 54%" />
          <span class="sk-line" style="width: 64%" />
        </div>
        <p class="hint">Verifying your membership. Please wait.</p>
      </div>

      <div v-else class="panel" role="alertdialog" aria-labelledby="m-switch-title" aria-describedby="m-switch-detail" data-testid="mobile-switch-failed">
        <span class="fail-icon" aria-hidden="true"><AppIcon name="warning" :size="24" /></span>
        <p id="m-switch-title" class="title">Unable to connect</p>
        <p class="sub">{{ nameOf(failed) }} is unavailable right now.</p>
        <p id="m-switch-detail" class="detail" data-testid="mobile-switch-reason">{{ communitySwitchError }}</p>
        <p class="stay-note">You're still in <strong>{{ currentName }}</strong>.</p>
        <button
          ref="retryButton"
          type="button"
          class="btn primary"
          :disabled="retrying"
          data-testid="mobile-switch-retry"
          @click="retry"
        >
          {{ retrying ? "Retrying…" : "Retry" }}
        </button>
        <button type="button" class="btn" data-testid="mobile-switch-stay" @click="clearCommunitySwitchError">
          Stay in {{ currentName }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.m-switch {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-modal) + 5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(var(--space-5), env(safe-area-inset-top)) max(var(--space-4), env(safe-area-inset-right))
    max(var(--space-5), env(safe-area-inset-bottom)) max(var(--space-4), env(safe-area-inset-left));
  background: var(--color-bg);
  color: var(--color-text);
}
.panel {
  width: min(360px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  text-align: center;
}
.title {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-xl);
  font-weight: 700;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
}
.hint,
.detail,
.stay-note {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.detail {
  overflow-wrap: anywhere;
}
.stay-note {
  margin-bottom: var(--space-3);
}
.stay-note strong {
  color: var(--color-text);
}
.sk {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: var(--space-4) 0 var(--space-3);
}
.sk-line {
  display: block;
  height: 12px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  animation: sk-pulse 1.4s ease-in-out infinite;
}
.fail-icon {
  width: 56px;
  height: 56px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--color-danger-muted);
  color: var(--color-danger);
}
.btn {
  width: 100%;
  min-height: 48px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn.primary {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.btn:disabled {
  opacity: 0.7;
}
.btn:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}
@keyframes sk-pulse {
  50% {
    opacity: 0.5;
  }
}
.m-switch-enter-active,
.m-switch-leave-active {
  transition: opacity 180ms ease;
}
.m-switch-enter-from,
.m-switch-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .sk-line {
    animation: none;
  }
  .m-switch-enter-active,
  .m-switch-leave-active {
    transition: none;
  }
}
</style>
