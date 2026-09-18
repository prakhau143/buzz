<script setup lang="ts">
/**
 * New-backend roster panel (DECISIONS.md D10) — `userId`-keyed, HTTP-backed.
 * Deliberately does NOT carry over the old panel's inline ban/timeout
 * actions (`../../community-members/ui/CommunityMembersPanel.vue`):
 * moderation is keyed by `pubkey` there and is an explicitly out-of-scope
 * sibling migration (see `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §2, "Moderation"
 * row) — mixing the two identity keys in one row's actions would be
 * actively wrong, not just incomplete. The standalone "Moderation" tab in
 * `CommunityManagementModal.vue` is unaffected and still fully usable.
 */
import { computed, ref } from "vue";
import StateView from "@/components/StateView.vue";
import BaseButton from "@/components/BaseButton.vue";
import { useSessionStore } from "@/stores/session";
import { userMessageFor } from "@/services/errors";
import { useCommunity } from "../useCommunity";
import { assignableRoles, canRemoveMember } from "../permissions";
import type { CommunityRole } from "../CommunityService";
import CreateCommunityPrompt from "./CreateCommunityPrompt.vue";

const session = useSessionStore();
const {
  data: members,
  isLoading,
  isError,
  refetch,
  communityId,
  myRole,
  canManage,
  addMember,
  isAdding,
  addError,
  removeMember,
  isRemoving,
  changeRole,
  isChangingRole,
} = useCommunity();

const newUserId = ref("");
const newRole = ref<CommunityRole>("member");
const addRoleOptions = computed(() => assignableRoles(myRole.value));
const myUserId = computed(() => session.applicationUser?.id ?? null);

async function handleAdd() {
  const userId = newUserId.value.trim();
  if (!userId) return;
  await addMember({ userId, role: newRole.value });
  newUserId.value = "";
}

/** Role changes are owner-only and can never target the owner or the caller themselves. */
function canShowRolePicker(targetUserId: string, targetRole: CommunityRole): boolean {
  return myRole.value === "owner" && targetRole !== "owner" && targetUserId !== myUserId.value;
}

function handleRoleChange(userId: string, event: Event) {
  const role = (event.target as HTMLSelectElement).value as CommunityRole;
  void changeRole({ userId, role });
}
</script>

<template>
  <div class="community-members-panel-http">
    <CreateCommunityPrompt v-if="communityId === null" />
    <StateView v-else-if="isLoading" kind="loading" />
    <StateView
      v-else-if="isError"
      kind="error"
      title="Couldn't load the community roster"
      @retry="refetch"
    />
    <template v-else>
      <p v-if="!canManage" class="hint">
        Only the community owner or an admin can manage members. Your role:
        <strong>{{ myRole ?? "member" }}</strong>
      </p>

      <form v-if="canManage" class="add-form" @submit.prevent="handleAdd">
        <input
          v-model="newUserId"
          class="user-id-input"
          type="text"
          placeholder="Application user id"
          :disabled="isAdding"
        />
        <select v-model="newRole" class="role-select" :disabled="isAdding">
          <option v-for="role in addRoleOptions" :key="role" :value="role">{{ role }}</option>
        </select>
        <BaseButton type="submit" variant="primary" :disabled="isAdding || !newUserId.trim()">
          Add member
        </BaseButton>
      </form>
      <p v-if="addError" class="error-text">{{ userMessageFor(addError) }}</p>

      <ul class="member-list">
        <li v-for="member in members" :key="member.userId" class="member-row">
          <span class="member-id">{{ member.userId }}</span>
          <span class="member-role">{{ member.role }}</span>
          <select
            v-if="canShowRolePicker(member.userId, member.role)"
            class="role-select"
            :value="member.role"
            :disabled="isChangingRole"
            @change="handleRoleChange(member.userId, $event)"
          >
            <option v-for="role in assignableRoles(myRole)" :key="role" :value="role">{{ role }}</option>
            <option :value="member.role" disabled hidden>{{ member.role }}</option>
          </select>
          <BaseButton
            v-if="canRemoveMember(myRole, member.role, member.userId === myUserId)"
            variant="danger"
            :disabled="isRemoving"
            @click="removeMember(member.userId)"
          >
            Remove
          </BaseButton>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.community-members-panel-http {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.add-form {
  display: flex;
  gap: var(--space-2);
}
.user-id-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  font-family: monospace;
}
.role-select {
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-xs);
}
.error-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.member-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}
.member-id {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: var(--font-size-xs);
  color: var(--color-text);
}
.member-role {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: capitalize;
}
</style>
