<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import CommunityAvatar from "@/features/communities/ui/CommunityAvatar.vue";
import { relayHost } from "@/features/communities/relayCommunities";
import { useCommunitySwitch } from "@/features/communities/useCommunitySwitch";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { useFocusTrap } from "@/composables/useFocusTrap";

/**
 * Mobile community selector — a bottom sheet over Home. The SAME switch as the
 * desktop rail and sidebar switcher (`useCommunitySwitch`): same verified list,
 * same verify → switch → restore-on-failure, same in-progress state and error,
 * same Add Community flow. No second source of truth.
 */
const emit = defineEmits<{ close: [] }>();

const {
  current,
  others,
  connected,
  verifying,
  verified,
  refresh,
  switchTo,
  switchingTo,
  switchError,
  clearError,
  openAddCommunity,
} = useCommunitySwitch();
const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;

const sheet = ref<HTMLElement | null>(null);
useEscapeKey(() => emit("close"), { modal: true });
useFocusTrap(sheet);
onMounted(async () => {
  clearError();
  void refresh(); // membership can change; ask again whenever the selector opens
  await nextTick();
  sheet.value?.focus();
});

async function choose(relayUrl: string) {
  if (await switchTo(relayUrl)) emit("close");
}

function add() {
  emit("close");
  openAddCommunity();
}
</script>

<template>
  <Teleport to="body">
    <div class="sheet-scrim" data-testid="community-sheet-scrim" @click="emit('close')" />
    <section
      ref="sheet"
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="community-sheet-title"
      tabindex="-1"
      data-testid="community-sheet"
    >
      <div class="grabber" aria-hidden="true" />
      <header class="sheet-head">
        <h2 id="community-sheet-title">Select community</h2>
        <button type="button" class="close" aria-label="Close" @click="emit('close')">
          <AppIcon name="close" :size="20" />
        </button>
      </header>

      <p class="group">Current</p>
      <div class="row current" data-testid="community-sheet-current">
        <CommunityAvatar :relay-url="current.url" :name="current.name" :size="40" />
        <span class="text">
          <span class="name">{{ current.name }}</span>
          <span class="meta">
            <span class="dot" :class="{ on: connected && !switchingTo }" aria-hidden="true" />
            {{ switchingTo ? `Switching to ${relayHost(switchingTo)}…` : connected ? "Connected" : "Connecting…" }}
          </span>
        </span>
        <AppIcon name="check" :size="20" class="check" />
      </div>

      <p v-if="verifying && !verified && !others.length" class="note" role="status">Checking your communities…</p>
      <template v-if="others.length">
        <p class="group">Other communities</p>
        <button
          v-for="c in others"
          :key="c.relayUrl"
          type="button"
          class="row"
          :disabled="!!switchingTo"
          :aria-busy="switchingTo === c.relayUrl || undefined"
          data-testid="community-sheet-item"
          @click="choose(c.relayUrl)"
        >
          <CommunityAvatar :relay-url="c.relayUrl" :name="c.name" :size="40" />
          <span class="text">
            <span class="name">{{ c.name }}</span>
            <span class="meta">{{
              switchingTo === c.relayUrl ? "Switching…" : ROLE_LABEL[c.role as keyof typeof ROLE_LABEL]
            }}</span>
          </span>
          <AppIcon name="chevron-right" :size="20" class="chev" />
        </button>
      </template>

      <p v-if="switchError" class="error" role="alert" data-testid="community-sheet-error">{{ switchError }}</p>

      <div class="divider" />
      <button type="button" class="row add" data-testid="community-sheet-add" @click="add">
        <span class="add-icon"><AppIcon name="plus" :size="20" /></span>
        <span class="text"><span class="name">Add community</span></span>
      </button>
    </section>
  </Teleport>
</template>

<style scoped>
.sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--color-overlay);
  animation: fade 160ms ease-out;
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: calc(var(--z-modal) + 1);
  max-height: 85dvh;
  overflow-y: auto;
  padding: var(--space-2) max(var(--space-4), env(safe-area-inset-right)) calc(var(--space-4) + env(safe-area-inset-bottom))
    max(var(--space-4), env(safe-area-inset-left));
  border-radius: 20px 20px 0 0;
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-lg);
  outline: none;
  animation: rise 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.grabber {
  width: 36px;
  height: 4px;
  margin: 0 auto var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-border-strong);
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sheet-head h2 {
  margin: 0;
  font-size: var(--font-size-lg);
}
.close {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.group {
  margin: var(--space-3) 0 var(--space-1);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-subtle);
}
.row {
  width: 100%;
  min-height: 60px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
button.row:active:not(:disabled) {
  background: var(--color-surface-muted);
}
button.row:disabled {
  opacity: 0.6;
}
.row.current {
  background: var(--color-mention-bg);
  box-shadow: inset 0 0 0 1px var(--color-mention-border);
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
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
}
.dot.on {
  background: var(--color-success);
}
.check {
  color: var(--color-primary);
}
.chev {
  color: var(--color-text-subtle);
}
.note,
.error {
  margin: var(--space-2) var(--space-2) 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.error {
  color: var(--color-danger);
}
.divider {
  height: 1px;
  margin: var(--space-3) 0 var(--space-1);
  background: var(--color-border);
}
.add-icon {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--color-border-strong);
  border-radius: 28%;
  color: var(--color-text-muted);
}
@keyframes rise {
  from {
    transform: translateY(24px);
    opacity: 0.4;
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sheet,
  .sheet-scrim {
    animation: none;
  }
}
</style>
