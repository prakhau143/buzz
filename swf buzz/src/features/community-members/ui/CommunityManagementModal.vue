<script setup lang="ts">
/**
 * Community-wide administration — members/roles, moderation, invites.
 * Deliberately separate from channel conversation UI (`ChannelDetailsPanel.vue`
 * etc.): community role and channel role are two independent authorization
 * planes (see `../../channels/channelPermissions.ts`'s doc comment), and
 * conflating them in one always-visible tab strip inside every channel was
 * the biggest UX issue with the previous layout.
 */
import { ref } from "vue";
import CommunityMembersPanelHttp from "@/features/communities/ui/CommunityMembersPanelHttp.vue";
import ModerationQueuePanel from "@/features/moderation/ui/ModerationQueuePanel.vue";
import CreateInvitePanel from "@/features/communities/ui/CreateInvitePanel.vue";

defineProps<{ selectedChannelId: string | null }>();
defineEmits<{ close: [] }>();

const tab = ref<"community" | "moderation" | "invites">("community");
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Community management">
      <div class="modal-header">
        <h2>Community</h2>
        <button type="button" class="close-button" aria-label="Close" @click="$emit('close')">✕</button>
      </div>

      <div class="tabs">
        <button type="button" class="tab" :class="{ active: tab === 'community' }" @click="tab = 'community'">
          Members
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'moderation' }" @click="tab = 'moderation'">
          Moderation
        </button>
        <button type="button" class="tab" :class="{ active: tab === 'invites' }" @click="tab = 'invites'">
          Invites
        </button>
      </div>

      <div class="tab-body">
        <CommunityMembersPanelHttp v-if="tab === 'community'" />
        <ModerationQueuePanel v-else-if="tab === 'moderation'" />
        <CreateInvitePanel v-else-if="tab === 'invites'" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-card {
  width: 560px;
  max-width: calc(100vw - var(--space-4) * 2);
  height: 70vh;
  max-height: 640px;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5) var(--space-2);
}
.modal-header h2 {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text);
}
.close-button {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-md);
}

.tabs {
  display: flex;
  gap: var(--space-1);
  padding: 0 var(--space-5) var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.tab {
  height: 32px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.tab:hover {
  background: var(--color-surface-hover);
}
.tab.active {
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-weight: 600;
}

.tab-body {
  flex: 1;
  overflow-y: auto;
}
</style>
