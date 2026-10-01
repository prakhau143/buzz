<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import CommunityAvatar from "@/features/communities/ui/CommunityAvatar.vue";
import { communities, relayHost } from "@/features/communities/relayCommunities";
import { useCommunitySwitch } from "@/features/communities/useCommunitySwitch";

/**
 * The community rail — FAST switching (OLD BUZZ's far-left rail, in SWF's
 * design language). The sidebar's community switcher stays the place for
 * context and management; both drive the one `useCommunitySwitch`, so a switch
 * from either updates both and they can never disagree about the active
 * community.
 *
 * Lists the current community plus the ones the relays have confirmed this
 * identity belongs to (`access.memberships`, set at sign-in and re-asked when
 * the switcher opens) — the device's remembered addresses are candidates, never
 * the list. Order is the order communities were added, so icons never jump
 * around when you switch. "+" opens the existing Add Community flow.
 */
const { current, accessible, connected, switchTo, switchingTo, switchError, clearError, openAddCommunity, refreshIfStale } =
  useCommunitySwitch();

const items = computed(() => {
  const byUrl = new Map(accessible.value.map((m) => [m.relayUrl, m]));
  const currentUrl = current.value.url;
  const urls = new Set<string>([...(currentUrl ? [currentUrl] : []), ...byUrl.keys()]);
  const addedOrder = communities.value.map((c) => c.relayUrl);
  const rank = (url: string) => {
    const i = addedOrder.indexOf(url);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...urls]
    .sort((a, b) => rank(a) - rank(b))
    .map((url) => {
      const saved = communities.value.find((c) => c.relayUrl === url);
      const name = url === currentUrl ? current.value.name : (saved?.name ?? byUrl.get(url)?.name ?? relayHost(url));
      return { url, name, host: relayHost(url), active: url === currentUrl };
    });
});

// Membership is authoritative on the relay; re-asked occasionally, not on every mount.
onMounted(refreshIfStale);

async function select(url: string, active: boolean) {
  if (active || switchingTo.value) return;
  await switchTo(url);
}

// ---- tooltip (fixed-position, so the rail's own scroll never clips it) ----
const tip = ref<{ text: string; sub: string; top: number; left: number } | null>(null);
function showTip(event: Event, text: string, sub = "") {
  const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tip.value = { text, sub, top: r.top + r.height / 2, left: r.right + 10 };
}
function hideTip() {
  tip.value = null;
}

// ---- arrow keys move between rail buttons (Tab still leaves the rail) ----
const rail = ref<HTMLElement | null>(null);
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const buttons = [...(rail.value?.querySelectorAll<HTMLButtonElement>("button.rail-item") ?? [])];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at === -1) return;
  event.preventDefault();
  const next = event.key === "ArrowDown" ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
  void nextTick(() => buttons[next]?.focus());
}
</script>

<template>
  <nav ref="rail" class="community-rail" aria-label="Communities" data-testid="community-rail" @keydown="onKeydown">
    <ul class="rail-list">
      <li v-for="item in items" :key="item.url" class="rail-slot">
        <span v-if="item.active" class="active-bar" aria-hidden="true" />
        <button
          type="button"
          class="rail-item"
          :class="{ active: item.active, busy: switchingTo === item.url }"
          :aria-current="item.active ? 'true' : undefined"
          :aria-label="item.active ? `${item.name}, current community` : `Switch to ${item.name}`"
          :aria-busy="switchingTo === item.url || undefined"
          :disabled="!!switchingTo && switchingTo !== item.url"
          data-testid="community-rail-item"
          :data-relay="item.url"
          @click="select(item.url, item.active)"
          @mouseenter="showTip($event, item.name, item.active ? (connected ? 'Connected' : 'Connecting…') : item.host)"
          @focus="showTip($event, item.name, item.active ? (connected ? 'Connected' : 'Connecting…') : item.host)"
          @mouseleave="hideTip"
          @blur="hideTip"
        >
          <CommunityAvatar :relay-url="item.url" :name="item.name" :size="36" />
          <span v-if="item.active" class="status-dot" :class="{ on: connected }" aria-hidden="true" />
          <span v-if="switchingTo === item.url" class="spinner" aria-hidden="true" />
        </button>
      </li>
      <li class="rail-slot">
        <button
          type="button"
          class="rail-item add"
          aria-label="Add community"
          data-testid="community-rail-add"
          @click="openAddCommunity"
          @mouseenter="showTip($event, 'Add community')"
          @focus="showTip($event, 'Add community')"
          @mouseleave="hideTip"
          @blur="hideTip"
        >
          <AppIcon name="plus" :size="20" />
        </button>
      </li>
    </ul>

    <div v-if="switchError" class="rail-error" role="alert" data-testid="community-rail-error">
      <span>{{ switchError }}</span>
      <button type="button" class="error-dismiss" aria-label="Dismiss" @click="clearError">
        <AppIcon name="close" :size="16" />
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="tip"
        class="rail-tip"
        role="tooltip"
        :style="{ top: `${tip.top}px`, left: `${tip.left}px` }"
        data-testid="community-rail-tooltip"
      >
        <span class="tip-title">{{ tip.text }}</span>
        <span v-if="tip.sub" class="tip-sub">{{ tip.sub }}</span>
      </div>
    </Teleport>
  </nav>
</template>

<style scoped>
.community-rail {
  position: relative;
  flex: none;
  width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-3) 0;
  border-right: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface-muted) 70%, var(--color-bg));
}

/* Only the list scrolls, so the error bubble beside the rail is never clipped. */
.rail-list {
  list-style: none;
  margin: 0;
  padding: 3px 0;
  max-height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
}
.rail-slot {
  position: relative;
  width: 100%;
  display: flex;
  justify-content: center;
}

/* Active: a 3px accent pill on the rail's edge, plus an accent ring. */
.active-bar {
  position: absolute;
  left: 0;
  top: 50%;
  width: 3px;
  height: 24px;
  transform: translateY(-50%);
  border-radius: 0 3px 3px 0;
  background: var(--color-primary);
}

.rail-item {
  position: relative;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}
.rail-item:hover:not(:disabled) {
  background: var(--color-surface-hover);
}
.rail-item.active {
  border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}
.rail-item:not(.active) :deep(.community-avatar) {
  opacity: 0.82;
}
.rail-item:not(.active):hover :deep(.community-avatar) {
  opacity: 1;
}
.rail-item:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}
.rail-item:disabled {
  cursor: default;
  opacity: 0.55;
}

.rail-item.add {
  border: 1px dashed var(--color-border-strong);
  color: var(--color-text-muted);
}
.rail-item.add:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-muted);
}

.status-dot {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  border: 2px solid var(--color-surface);
  background: var(--color-text-subtle);
}
.status-dot.on {
  background: var(--color-success);
}

.spinner {
  position: absolute;
  inset: -3px;
  border-radius: 16px;
  border: 2px solid transparent;
  border-top-color: var(--color-primary);
  animation: rail-spin 800ms linear infinite;
}
@keyframes rail-spin {
  to {
    transform: rotate(360deg);
  }
}

.rail-error {
  position: absolute;
  left: 68px;
  top: var(--space-3);
  z-index: var(--z-dropdown);
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  width: 240px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-danger);
  font-size: var(--font-size-xs);
  box-shadow: var(--shadow-md);
}
.error-dismiss {
  flex: none;
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
}

.rail-tip {
  position: fixed;
  z-index: var(--z-toast);
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-text);
  color: var(--color-surface);
  box-shadow: var(--shadow-md);
  pointer-events: none;
  white-space: nowrap;
}
.tip-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
}
.tip-sub {
  font-size: 11px;
  opacity: 0.75;
}

@media (prefers-reduced-motion: reduce) {
  .rail-item {
    transition: none;
  }
  .spinner {
    animation-duration: 2s;
  }
}
</style>
