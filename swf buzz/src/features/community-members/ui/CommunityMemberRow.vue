<script setup lang="ts">
import { computed } from "vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import BaseButton from "@/components/BaseButton.vue";
import { useProfile } from "@/composables/useProfile";
import { canBanOrTimeout, canChangeRole, canRemoveMember } from "../permissions";
import type { RelayMember, RelayMemberRole } from "@/protocol/relayMembers";

const props = defineProps<{
  member: RelayMember;
  myRole: RelayMemberRole | null;
  isSelf: boolean;
  canManage: boolean;
  busy: boolean;
  isBanned?: boolean;
  isTimedOut?: boolean;
}>();

const emit = defineEmits<{
  changeRole: [newRole: RelayMemberRole];
  remove: [];
  ban: [];
  unban: [];
  timeout: [];
  untimeout: [];
}>();

const { data: profile } = useProfile(() => props.member.pubkey);
const displayName = computed(() => profile.value?.displayName ?? props.member.pubkey.slice(0, 8));

const canMakeAdmin = computed(() =>
  canChangeRole(props.myRole, props.member.role, props.isSelf, "admin"),
);
const canMakeMember = computed(() =>
  canChangeRole(props.myRole, props.member.role, props.isSelf, "member"),
);
const canRemove = computed(() => canRemoveMember(props.myRole, props.member.role, props.isSelf));
const canModerate = computed(
  () => !props.isSelf && canBanOrTimeout(props.myRole, props.member.role),
);
</script>

<template>
  <li class="member-row">
    <AvatarCircle :name="displayName" :avatar-url="profile?.avatarUrl" :size="24" />
    <span class="name">{{ displayName }}</span>
    <span class="role" :class="member.role">{{ member.role }}</span>

    <div v-if="canManage" class="actions">
      <BaseButton v-if="canMakeAdmin" variant="ghost" :disabled="busy" @click="emit('changeRole', 'admin')">
        Make admin
      </BaseButton>
      <BaseButton v-if="canMakeMember" variant="ghost" :disabled="busy" @click="emit('changeRole', 'member')">
        Make member
      </BaseButton>
      <BaseButton
        v-if="canModerate && !isTimedOut"
        variant="ghost"
        :disabled="busy"
        @click="emit('timeout')"
      >
        Timeout
      </BaseButton>
      <BaseButton v-if="canModerate && isTimedOut" variant="ghost" :disabled="busy" @click="emit('untimeout')">
        Lift timeout
      </BaseButton>
      <BaseButton v-if="canModerate && !isBanned" variant="danger" :disabled="busy" @click="emit('ban')">
        Ban
      </BaseButton>
      <BaseButton v-if="canModerate && isBanned" variant="secondary" :disabled="busy" @click="emit('unban')">
        Unban
      </BaseButton>
      <BaseButton v-if="canRemove" variant="danger" :disabled="busy" @click="emit('remove')">
        Remove
      </BaseButton>
    </div>
  </li>
</template>

<style scoped>
.member-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
}
.member-row:hover {
  background: var(--color-surface-muted);
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

.actions {
  display: flex;
  gap: var(--space-1);
}
</style>
