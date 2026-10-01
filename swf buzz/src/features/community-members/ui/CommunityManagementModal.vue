<script setup lang="ts">
import CloseButton from "@/components/CloseButton.vue";
/**
 * Community-wide administration — members/roles, moderation, invites.
 * Deliberately separate from channel conversation UI (`ChannelDetailsPanel.vue`
 * etc.): community role and channel role are two independent authorization
 * planes (see `../../channels/channelPermissions.ts`'s doc comment), and
 * conflating them in one always-visible tab strip inside every channel was
 * the biggest UX issue with the previous layout.
 */
import { ref } from "vue";
import CommunityMembersPanel from "@/features/community-members/ui/CommunityMembersPanel.vue";
import CommunityMembersPanelHttp from "@/features/communities/ui/CommunityMembersPanelHttp.vue";
import CreateRelayInvitePanel from "@/features/communities/ui/CreateRelayInvitePanel.vue";
import { useSessionStore } from "@/stores/session";
import ModerationQueuePanel from "@/features/moderation/ui/ModerationQueuePanel.vue";
import CreateInvitePanel from "@/features/communities/ui/CreateInvitePanel.vue";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { useFocusTrap } from "@/composables/useFocusTrap";

defineProps<{ selectedChannelId: string | null }>();
const emit = defineEmits<{ close: [] }>();
useEscapeKey(() => emit("close"));
const dialog = ref<HTMLElement | null>(null);
useFocusTrap(dialog);
// The local identity (no Okta, no backend session) is served by the relay itself:
// members and roles come from relay_members, invites from the relay's invite API.
// The HTTP panels remain for legacy Okta/dev sessions until they are removed.
const session = useSessionStore();
const isLocal = session.authMode === "local";

const tab = ref<"community" | "moderation" | "invites">("community");
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div ref="dialog" class="modal-card" role="dialog" aria-modal="true" aria-label="Community management">
      <div class="modal-header">
        <h2>Community</h2>
        <CloseButton @click="$emit('close')" />
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
        <template v-if="tab === 'community'">
          <CommunityMembersPanel v-if="isLocal" />
          <CommunityMembersPanelHttp v-else />
        </template>
        <ModerationQueuePanel v-else-if="tab === 'moderation'" />
        <template v-else-if="tab === 'invites'">
          <CreateRelayInvitePanel v-if="isLocal" />
          <CreateInvitePanel v-else />
        </template>
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
  z-index: var(--z-modal);
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
  /* The roster can be long and its rows have their own overflow handling —
     without this the flex child refuses to shrink and the card overflows the
     viewport instead of scrolling internally. */
  min-height: 0;
}

/*
  Mobile: full-screen, per the design spec. A 560px card inside a 390px
  viewport is what produced the horizontal overflow on phones — `max-width`
  alone still left the side gutters and rounded corners fighting for room.
*/
@media (max-width: 768px) {
  .modal-overlay {
    align-items: stretch;
    justify-content: stretch;
  }
  .modal-card {
    width: 100%;
    max-width: 100%;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }
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
  min-height: 0;
  overflow-y: auto;
  /* Long pubkeys and invite links must wrap rather than widen the modal — the
     usual source of horizontal overflow at narrow widths. */
  overflow-x: hidden;
}

/* The tab strip scrolls rather than wrapping when the three labels no longer
   fit, so the header height stays predictable. */
@media (max-width: 430px) {
  .tabs {
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    flex: 0 0 auto;
  }
}
</style>
