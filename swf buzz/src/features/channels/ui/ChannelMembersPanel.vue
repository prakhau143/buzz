<script setup lang="ts">
/**
 * CHANNEL-level member management — a separate permission plane from
 * `CommunityMembersPanel.vue` (community/relay-wide roles). See
 * `../channelPermissions.ts`'s doc comment and
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2 for kind:9000/9001.
 */
import { computed, ref } from "vue";
import StateView from "@/components/StateView.vue";
import BaseButton from "@/components/BaseButton.vue";
import { useSessionStore } from "@/stores/session";
import { useChannelMemberActions } from "../useChannelMemberActions";
import { assignableChannelRoles, canAddChannelMember } from "../channelPermissions";
import ChannelMemberRow from "./ChannelMemberRow.vue";
import type { Member, ChannelVisibility } from "@/types/domain";
import type { MemberRole } from "@/protocol/membership";

const props = defineProps<{
  channelId: string;
  members: Member[];
  visibility: ChannelVisibility;
  isLoading: boolean;
  isError: boolean;
}>();
const emit = defineEmits<{ retry: [] }>();

const session = useSessionStore();

const myRole = computed<MemberRole | null>(
  () => props.members.find((m) => m.pubkey === session.pubkey)?.role ?? null,
);
const canAdd = computed(() => canAddChannelMember(myRole.value, props.visibility));
const addRoleOptions = computed(() => assignableChannelRoles(myRole.value));

const {
  addMember,
  isAdding,
  addErrorMessage,
  removeMember,
  isRemoving,
  removeErrorMessage,
} = useChannelMemberActions(() => props.channelId);

const newPubkey = ref("");
const newRole = ref<MemberRole>("member");
const busy = computed(() => isAdding.value || isRemoving.value);

async function handleAdd() {
  const pubkey = newPubkey.value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return;
  await addMember({ pubkey, role: newRole.value });
  newPubkey.value = "";
}

/** An existing member's role is changed by re-sending kind:9000 with a `role` tag. */
async function changeRoleFor(pubkey: string, role: MemberRole) {
  await addMember({ pubkey, role });
}
</script>

<template>
  <div class="channel-members-panel">
    <StateView v-if="isLoading" kind="loading" />
    <StateView
      v-else-if="isError"
      kind="error"
      title="Couldn't load channel members"
      @retry="emit('retry')"
    />
    <template v-else>
      <form v-if="canAdd" class="add-form" @submit.prevent="handleAdd">
        <input
          v-model="newPubkey"
          class="pubkey-input"
          type="text"
          placeholder="64-char hex pubkey"
          :disabled="isAdding"
        />
        <select v-model="newRole" class="role-select" :disabled="isAdding">
          <option v-for="role in addRoleOptions" :key="role" :value="role">{{ role }}</option>
        </select>
        <BaseButton type="submit" variant="primary" :disabled="isAdding || !newPubkey.trim()">
          Add member
        </BaseButton>
      </form>
      <p v-if="addErrorMessage" class="error-text">{{ addErrorMessage }}</p>
      <p v-if="removeErrorMessage" class="error-text">{{ removeErrorMessage }}</p>

      <StateView v-if="!members.length" kind="empty" title="No members yet" />
      <ul v-else class="member-list">
        <ChannelMemberRow
          v-for="member in members"
          :key="member.pubkey"
          :member="member"
          :members="members"
          :my-role="myRole"
          :is-self="!!session.pubkey && session.pubkey === member.pubkey"
          :busy="busy"
          @change-role="(role) => changeRoleFor(member.pubkey, role)"
          @remove="() => removeMember({ pubkey: member.pubkey })"
        />
      </ul>
    </template>
  </div>
</template>

<style scoped>
.channel-members-panel {
  padding: var(--space-2);
}

.add-form {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.pubkey-input,
.role-select {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  padding: var(--space-2);
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.pubkey-input {
  flex: 1;
  min-width: 0;
}

.error-text {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}

.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
