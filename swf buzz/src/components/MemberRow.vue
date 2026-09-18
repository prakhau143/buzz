<script setup lang="ts">
import { computed } from "vue";
import AvatarCircle from "./AvatarCircle.vue";
import { useProfile } from "@/composables/useProfile";
import type { Member } from "@/types/domain";

const props = defineProps<{ member: Member; presence?: "online" | "away" | "offline" }>();
const { data: profile } = useProfile(() => props.member.pubkey);
const displayName = computed(() => profile.value?.displayName ?? props.member.pubkey.slice(0, 8));
</script>

<template>
  <li class="member-row">
    <AvatarCircle
      :name="displayName"
      :avatar-url="profile?.avatarUrl"
      :is-agent="profile?.isAgent"
      :presence="presence"
      :size="24"
    />
    <span class="name">{{ displayName }}</span>
    <span v-if="profile?.isAgent" class="agent-badge">Agent</span>
    <span v-else-if="member.role !== 'member'" class="role">{{ member.role }}</span>
  </li>
</template>

<style scoped>
.member-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
}
.member-row:hover {
  background: var(--color-surface-muted);
}

.name {
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  text-transform: capitalize;
}

.agent-badge {
  font-size: var(--font-size-xs);
  color: var(--color-agent);
  background: var(--color-agent-muted);
  border-radius: var(--radius-full);
  padding: 0 var(--space-2);
}
</style>
