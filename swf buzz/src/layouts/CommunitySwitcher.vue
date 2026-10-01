<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AnchoredPopover from "@/components/AnchoredPopover.vue";
import AppIcon from "@/components/AppIcon.vue";
import CommunityAvatar from "@/features/communities/ui/CommunityAvatar.vue";
import { relayHost } from "@/features/communities/relayCommunities";
import { useCommunitySwitch } from "@/features/communities/useCommunitySwitch";

/**
 * Top-left community switcher. Switching is NOT sign-out: the identity stays,
 * the previous community's session ends (socket, community-scoped caches and
 * selection — `beginIdentitySession` tears it down), and the new community is
 * authenticated from scratch (NIP-42 + the relay's membership verdict).
 *
 * "Other communities" lists ONLY communities the relay has just confirmed this
 * identity is an owner, admin or member of (`useAccessibleCommunities`). The
 * device's recent addresses are candidates, never the list itself — a remembered
 * relay you don't belong to (or that is unreachable) simply isn't shown.
 * Membership is re-checked when the menu opens and again right before a switch,
 * and the current community is left untouched unless the target confirms.
 * "Add community" goes to the URL flow on "Choose a community".
 *
 * The switch itself (verify → switch → restore on failure) lives in
 * `useCommunitySwitch`, shared with the community rail.
 */
const {
  current,
  others,
  connected,
  verifying,
  verified,
  refresh,
  switchTo: switchCommunityTo,
  switchingTo,
  switchError,
  clearError,
  openAddCommunity,
  isLoading,
} = useCommunitySwitch();

const trigger = ref<HTMLElement | null>(null);
const open = ref(false);
const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;
// Ask the relays again every time the menu opens: membership can change (removed, left).
watch(open, (isOpen) => {
  if (isOpen) {
    clearError();
    void refresh();
  }
});
const statusLabel = computed(() => {
  if (switchingTo.value) return `Switching to ${relayHost(switchingTo.value)}…`;
  return connected.value ? "Connected" : "Connecting…";
});

async function switchTo(relayUrl: string) {
  if (await switchCommunityTo(relayUrl)) open.value = false;
}

function addCommunity() {
  open.value = false;
  openAddCommunity();
}
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="switcher"
    aria-haspopup="menu"
    :aria-expanded="open"
    :aria-label="`Community: ${current.name}. Switch community`"
    data-testid="community-switcher"
    @click="open = !open"
  >
    <CommunityAvatar :relay-url="current.url" :name="current.name" :size="32" />
    <span class="text">
      <span class="name" data-testid="community-switcher-name">{{ current.name }}</span>
      <span class="status">
        <span class="dot" :class="{ on: connected && !switchingTo }" aria-hidden="true" />
        <span data-testid="community-switcher-status">{{ statusLabel }}</span>
      </span>
    </span>
    <span class="caret" aria-hidden="true">▾</span>
  </button>

  <AnchoredPopover
    v-if="open"
    :anchor="trigger"
    align="start"
    label="Communities"
    :width="280"
    @close="open = false"
  >
    <div class="group-label">Current</div>
    <div
      class="menu-item current"
      role="menuitem"
      aria-disabled="true"
      data-testid="community-switcher-current"
    >
      <CommunityAvatar :relay-url="current.url" :name="current.name" :size="24" />
      <span class="item-label"
        >{{ current.name }}<span class="host">{{ current.host }}</span></span
      >
      <span class="dot" :class="{ on: connected }" aria-hidden="true" />
    </div>

    <p
      v-if="verifying && !verified"
      class="checking"
      role="status"
      data-testid="community-switcher-checking"
    >
      Checking your communities…
    </p>
    <template v-if="others.length">
      <div class="menu-divider" />
      <div class="group-label">Other communities</div>
      <button
        v-for="c in others"
        :key="c.relayUrl"
        type="button"
        role="menuitem"
        class="menu-item"
        :disabled="isLoading || !!switchingTo"
        data-testid="community-switcher-item"
        @click="switchTo(c.relayUrl)"
      >
        <CommunityAvatar :relay-url="c.relayUrl" :name="c.name" :size="24" />
        <span class="item-label"
          >{{ c.name }}<span class="host">{{ relayHost(c.relayUrl) }}</span></span
        >
        <span v-if="switchingTo === c.relayUrl" class="busy">Switching…</span>
        <span v-else class="role" data-testid="community-switcher-role">{{
          ROLE_LABEL[c.role as keyof typeof ROLE_LABEL]
        }}</span>
      </button>
    </template>
    <p v-if="switchError" class="error" role="alert" data-testid="community-switcher-error">
      {{ switchError }}
    </p>

    <div class="menu-divider" />
    <button
      type="button"
      role="menuitem"
      class="menu-item"
      data-testid="community-switcher-add"
      @click="addCommunity"
    >
      <AppIcon name="plus" :size="16" class="item-icon" />
      <span class="item-label">Add community</span>
    </button>
  </AnchoredPopover>
</template>

<style scoped>
.switcher {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
  padding: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}
.switcher:hover,
.switcher[aria-expanded="true"] {
  background: var(--color-surface-hover);
}
.switcher:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.name {
  font-weight: 700;
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-text-subtle);
  flex-shrink: 0;
}
.dot.on {
  background: var(--color-success);
}
.caret {
  color: var(--color-text-subtle);
  font-size: 12px;
}
.group-label {
  padding: var(--space-2) var(--space-3) var(--space-1);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-subtle);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 40px;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}
.menu-item.current {
  cursor: default;
}
.menu-item:not(.current):hover,
.menu-item:focus-visible {
  background: var(--color-surface-muted);
  outline: none;
}
.menu-item:disabled {
  opacity: 0.6;
  cursor: progress;
}
.item-icon {
  width: 24px;
  flex-shrink: 0;
  text-align: center;
}
.item-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.host {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.busy {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.menu-divider {
  height: 1px;
  margin: var(--space-1) var(--space-2);
  background: var(--color-border);
}
.error {
  margin: var(--space-1) var(--space-3);
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
.checking {
  margin: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.role {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
</style>
