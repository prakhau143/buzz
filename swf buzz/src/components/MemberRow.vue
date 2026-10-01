<script setup lang="ts">
import { computed } from "vue";
import AvatarCircle from "./AvatarCircle.vue";
import { useProfile } from "@/composables/useProfile";
import type { Member } from "@/types/domain";

const props = defineProps<{ member: Member }>();
const { data: profile } = useProfile(() => props.member.pubkey);
const displayName = computed(() => profile.value?.displayName ?? props.member.pubkey.slice(0, 8));
</script>

<template>
  <li class="member-row">
    <AvatarCircle
      :name="displayName"
      :avatar-url="profile?.avatarUrl"
      :is-agent="profile?.isAgent"
      :pubkey="member.pubkey"
      :size="24"
    />
    <span class="identity">
      <span class="name">{{ displayName }}</span>
      <!-- Job title, when the person has published one. Distinct from the
           community role badge on the right, which the relay controls. -->
      <span v-if="profile?.designation" class="designation">{{ profile.designation }}</span>
    </span>
    <span v-if="profile?.isAgent" class="agent-badge">Agent</span>
    <span v-else-if="member.role !== 'member'" class="role">{{ member.role }}</span>
  </li>
</template>

<style scoped>
.member-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 32px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
}
.member-row:hover {
  background: var(--color-surface-muted);
}

/* min-width:0 so a long name ellipsizes instead of pushing the badge out. */
.identity {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.name {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.designation {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
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
