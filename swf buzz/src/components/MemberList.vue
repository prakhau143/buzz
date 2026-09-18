<script setup lang="ts">
import StateView from "./StateView.vue";
import MemberRow from "./MemberRow.vue";
import { usePresence } from "@/features/presence/usePresence";
import type { Member } from "@/types/domain";

defineProps<{ members: Member[]; isLoading: boolean; isError: boolean }>();
defineEmits<{ retry: [] }>();

const { data: presence } = usePresence();
</script>

<template>
  <StateView v-if="isLoading" kind="loading" />
  <StateView
    v-else-if="isError"
    kind="error"
    title="Couldn't load members"
    @retry="$emit('retry')"
  />
  <StateView v-else-if="!members.length" kind="empty" title="No members yet" />

  <ul v-else class="member-list">
    <MemberRow
      v-for="member in members"
      :key="member.pubkey"
      :member="member"
      :presence="presence?.get(member.pubkey)?.status"
    />
  </ul>
</template>

<style scoped>
.member-list {
  list-style: none;
  margin: 0;
  padding: var(--space-2);
}
</style>
