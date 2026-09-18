<script setup lang="ts">
import { computed } from "vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import { useProfile } from "@/composables/useProfile";
import type { Member } from "@/types/domain";

const props = defineProps<{ member: Member; query: string }>();
const emit = defineEmits<{ select: [] }>();

const { data: profile } = useProfile(() => props.member.pubkey);
const displayName = computed(() => profile.value?.displayName ?? props.member.pubkey.slice(0, 8));
const matches = computed(
  () => !props.query.trim() || displayName.value.toLowerCase().includes(props.query.trim().toLowerCase()),
);
</script>

<template>
  <li v-if="matches" class="member-row" @click="emit('select')">
    <AvatarCircle :name="displayName" :avatar-url="profile?.avatarUrl" :size="28" />
    <span class="name">{{ displayName }}</span>
    <span class="role" :class="member.role">{{ member.role }}</span>
  </li>
</template>

<style scoped>
.member-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.member-row:hover {
  background: var(--color-surface-hover);
}
.name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role {
  font-size: var(--font-size-xs);
  text-transform: capitalize;
  color: var(--color-text-subtle);
}
.role.owner,
.role.admin {
  color: var(--color-primary);
  font-weight: 600;
}
</style>
