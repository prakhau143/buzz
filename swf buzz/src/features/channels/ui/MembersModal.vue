<script setup lang="ts">
import { ref } from "vue";
import StateView from "@/components/StateView.vue";
import ChannelMemberSearchRow from "./ChannelMemberSearchRow.vue";
import type { Member } from "@/types/domain";

defineProps<{ members: Member[]; isLoading: boolean; isError: boolean }>();
defineEmits<{ close: []; "select-member": [pubkey: string]; retry: [] }>();

const search = ref("");
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Members">
      <div class="modal-header">
        <div>
          <h2>Members</h2>
          <p class="count">{{ members.length }} member{{ members.length === 1 ? "" : "s" }}</p>
        </div>
        <button type="button" class="close-button" aria-label="Close" @click="$emit('close')">✕</button>
      </div>

      <input v-model="search" class="search-input" type="text" placeholder="Search members" />

      <StateView v-if="isLoading" kind="loading" />
      <StateView v-else-if="isError" kind="error" title="Couldn't load members" @retry="$emit('retry')" />
      <StateView v-else-if="!members.length" kind="empty" title="No members yet" />

      <ul v-else class="member-list">
        <ChannelMemberSearchRow
          v-for="member in members"
          :key="member.pubkey"
          :member="member"
          :query="search"
          @select="$emit('select-member', member.pubkey)"
        />
      </ul>
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
  width: 420px;
  max-width: calc(100vw - var(--space-4) * 2);
  max-height: 70vh;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.modal-header h2 {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text);
}
.count {
  margin: 2px 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

.close-button {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-md);
}

.search-input {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  padding: var(--space-2);
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}
</style>
