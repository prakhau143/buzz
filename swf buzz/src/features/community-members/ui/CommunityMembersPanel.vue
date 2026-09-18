<script setup lang="ts">
/**
 * Community (relay-wide) member management — the owner/admin roster for the
 * whole community, distinct from the per-channel "Members" tab. See
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2a.
 */
import { computed, ref } from "vue";
import StateView from "@/components/StateView.vue";
import BaseButton from "@/components/BaseButton.vue";
import { useSessionStore } from "@/stores/session";
import { useCommunityMembers } from "../useCommunityMembers";
import { assignableRoles } from "../permissions";
import { userMessageFor } from "@/services/errors";
import { useModerationActions } from "@/features/moderation/useModerationActions";
import { useModerationRestrictions } from "@/features/moderation/useModerationQueue";
import CommunityMemberRow from "./CommunityMemberRow.vue";
import type { RelayMemberRole } from "@/protocol/relayMembers";

const ONE_DAY_SECS = 24 * 60 * 60;

const session = useSessionStore();
const {
  data: members,
  isLoading,
  isError,
  refetch,
  myRole,
  canManage,
  addMember,
  isAdding,
  addError,
  removeMember,
  isRemoving,
  changeRole,
  isChangingRole,
} = useCommunityMembers();

const { data: restrictions } = useModerationRestrictions(canManage);
const { ban, unban, timeout: applyTimeout, untimeout } = useModerationActions();

const newPubkey = ref("");
const newRole = ref<RelayMemberRole>("member");
const addRoleOptions = computed(() => assignableRoles(myRole.value));
const busy = computed(() => isRemoving.value || isChangingRole.value);

function restrictionFor(pubkey: string) {
  return restrictions.value?.find((r) => r.pubkey === pubkey);
}
function isBanned(pubkey: string): boolean {
  return restrictionFor(pubkey)?.banned ?? false;
}
function isTimedOut(pubkey: string): boolean {
  const until = restrictionFor(pubkey)?.mutedUntil;
  return !!until && new Date(until).getTime() > Date.now();
}

async function handleAdd() {
  const pubkey = newPubkey.value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return;
  await addMember({ pubkey, role: newRole.value });
  newPubkey.value = "";
}
</script>

<template>
  <div class="community-members-panel">
    <StateView v-if="isLoading" kind="loading" />
    <StateView
      v-else-if="isError"
      kind="error"
      title="Couldn't load the community roster"
      @retry="refetch"
    />
    <StateView
      v-else-if="members === null"
      kind="empty"
      title="No community roster on this relay"
      description="This relay doesn't require or enforce community membership — everyone who can reach it can participate. There's no owner/admin roster to manage."
    />
    <template v-else>
      <p v-if="!canManage" class="hint">
        Only the community owner or an admin can manage members. Your role:
        <strong>{{ myRole ?? "member" }}</strong>
      </p>

      <form v-if="canManage" class="add-form" @submit.prevent="handleAdd">
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
      <p v-if="addError" class="error-text">{{ userMessageFor(addError) }}</p>

      <ul class="member-list">
        <CommunityMemberRow
          v-for="member in members"
          :key="member.pubkey"
          :member="member"
          :my-role="myRole"
          :is-self="!!session.pubkey && session.pubkey === member.pubkey"
          :can-manage="canManage"
          :busy="busy"
          :is-banned="isBanned(member.pubkey)"
          :is-timed-out="isTimedOut(member.pubkey)"
          @change-role="(newRoleValue) => changeRole({ pubkey: member.pubkey, targetRole: member.role, newRole: newRoleValue })"
          @remove="() => removeMember({ pubkey: member.pubkey, targetRole: member.role })"
          @ban="() => ban({ pubkey: member.pubkey, targetRole: member.role, actingRole: myRole })"
          @unban="() => unban({ pubkey: member.pubkey, actingRole: myRole })"
          @timeout="
            () =>
              applyTimeout({
                pubkey: member.pubkey,
                targetRole: member.role,
                actingRole: myRole,
                expiresAt: Math.floor(Date.now() / 1000) + ONE_DAY_SECS,
              })
          "
          @untimeout="() => untimeout({ pubkey: member.pubkey, actingRole: myRole })"
        />
      </ul>
    </template>
  </div>
</template>

<style scoped>
.community-members-panel {
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

.pubkey-input {
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
</style>
