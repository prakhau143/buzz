<script setup lang="ts">
import { computed } from "vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import BaseButton from "@/components/BaseButton.vue";
import { useProfile } from "@/composables/useProfile";
import { canManageChannelMember, isSoleChannelOwner } from "../channelPermissions";
import type { Member } from "@/types/domain";
import type { MemberRole } from "@/protocol/membership";

const props = defineProps<{
  member: Member;
  members: Member[];
  myRole: MemberRole | null;
  isSelf: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  changeRole: [newRole: MemberRole];
  remove: [];
}>();

const { data: profile } = useProfile(() => props.member.pubkey);
const displayName = computed(() => profile.value?.displayName ?? props.member.pubkey.slice(0, 8));

const canManage = computed(() => canManageChannelMember(props.myRole));
const isLastOwner = computed(() => isSoleChannelOwner(props.members, props.member.pubkey));
const canMakeAdmin = computed(
  () => canManage.value && props.member.role !== "admin" && !(props.member.role === "owner" && isLastOwner.value),
);
const canMakeMember = computed(
  () => canManage.value && props.member.role !== "member" && !(props.member.role === "owner" && isLastOwner.value),
);
const canRemove = computed(
  () => canManage.value && !props.isSelf && !(props.member.role === "owner" && isLastOwner.value),
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
