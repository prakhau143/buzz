<script setup lang="ts">
import StateView from "./StateView.vue";
import BaseButton from "./BaseButton.vue";
import { useChannelInvites } from "@/features/invites/useChannelInvites";

const props = defineProps<{ channelId: string }>();
const {
  data: invites,
  isLoading,
  isError,
  refetch,
  create,
  isCreating,
} = useChannelInvites(() => props.channelId);
</script>

<template>
  <div class="invites-panel">
    <p class="disclaimer">
      Invites are stored but not yet enforced by the server — anyone can still join an open channel
      without one, and there's no way to expire or revoke one yet. Ask an admin before relying on
      this for a private channel.
    </p>

    <BaseButton variant="primary" :disabled="isCreating" @click="create">Create invite</BaseButton>

    <StateView v-if="isLoading" kind="loading" />
    <StateView v-else-if="isError" kind="error" title="Couldn't load invites" @retry="refetch" />
    <StateView v-else-if="!invites?.length" kind="empty" title="No invites created yet" />

    <ul v-else class="invite-list">
      <li v-for="invite in invites" :key="invite.id" class="invite-row">
        <code>{{ invite.id.slice(0, 16) }}…</code>
        <span class="time">{{ new Date(invite.createdAt * 1000).toLocaleDateString() }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.invites-panel {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.disclaimer {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  background: var(--color-warning-muted);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
}

.invite-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.invite-row {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--color-border);
}
</style>
