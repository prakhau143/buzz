<script setup lang="ts">
/**
 * Channel action menu. Item visibility follows the real channel-role
 * authorization rules (`../channelPermissions.ts`, sourced from
 * `channel_authz.rs`) — this is UX visibility only, not a security
 * boundary; the relay enforces every one of these actions independently.
 */
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { canAddChannelMember } from "../channelPermissions";
import { useEscapeKey } from "@/composables/useEscapeKey";
import type { MemberRole } from "@/protocol/membership";

const props = defineProps<{ myRole: MemberRole | null; visibility: "open" | "private" }>();
const emit = defineEmits<{
  "view-members": [];
  "channel-details": [];
  "copy-id": [];
  "add-members": [];
  "leave-channel": [];
  close: [];
}>();

const canAdd = computed(() => canAddChannelMember(props.myRole, props.visibility));
useEscapeKey(() => emit("close"));
</script>

<template>
  <div class="menu-overlay" @click.self="emit('close')">
    <div class="menu-card" role="menu">
      <button type="button" class="menu-item" @click="emit('view-members')">
        <AppIcon name="users" :size="16" />View members
      </button>
      <button v-if="canAdd" type="button" class="menu-item" @click="emit('add-members')">
        <AppIcon name="plus" :size="16" />Add members
      </button>
      <button type="button" class="menu-item" @click="emit('channel-details')">
        <AppIcon name="settings" :size="16" />Channel details
      </button>
      <button type="button" class="menu-item" @click="emit('copy-id')">
        <AppIcon name="copy" :size="16" />Copy channel ID
      </button>
      <div class="menu-divider" />
      <button type="button" class="menu-item danger" @click="emit('leave-channel')">
        <AppIcon name="leave" :size="16" />Leave channel
      </button>
    </div>
  </div>
</template>

<style scoped>
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-dropdown);
}

.menu-card {
  position: absolute;
  top: 48px;
  right: var(--space-4);
  width: 220px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--color-text);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.menu-item:hover {
  background: var(--color-surface-hover);
}
.menu-item.danger {
  color: var(--color-danger);
}

.menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: var(--space-1) 0;
}
</style>
