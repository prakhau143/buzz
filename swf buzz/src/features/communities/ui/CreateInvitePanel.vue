<script setup lang="ts">
/**
 * Community-scoped invite creation (DECISIONS.md D10) — replaces the old
 * channel-scoped, kind:9009-based `InvitesPanel.vue` in
 * `CommunityManagementModal.vue`'s "Invites" tab (that component and its
 * `../../invites/InviteService.ts` are left in place, just no longer used
 * from this one integration point — see `InviteService.ts`'s doc comment).
 * `code`/`url` are shown exactly once, matching the backend's own
 * "only ever present in this one response" guarantee
 * (`backend/src/routes/invites.rs::create_invite`).
 */
import { computed, ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import StateView from "@/components/StateView.vue";
import { userMessageFor } from "@/services/errors";
import { useCommunity } from "../useCommunity";
import { useCreateInvite } from "../useInvites";
import CreateCommunityPrompt from "./CreateCommunityPrompt.vue";

const { communityId, canManage } = useCommunity();
const { createInvite, isCreating, createError, createdInvite, reset } = useCreateInvite(
  () => communityId.value,
);

const TTL_OPTIONS = [
  { label: "1 hour", secs: 3600 },
  { label: "24 hours", secs: 24 * 3600 },
  { label: "72 hours", secs: 72 * 3600 },
  { label: "7 days", secs: 7 * 24 * 3600 },
  { label: "30 days", secs: 30 * 24 * 3600 },
];
const ttlSecs = ref(TTL_OPTIONS[2]!.secs);
const limitUses = ref(false);
const maxUses = ref(10);

const copied = ref(false);

async function handleCreate() {
  copied.value = false;
  await createInvite({
    ttlSecs: ttlSecs.value,
    maxUses: limitUses.value ? maxUses.value : undefined,
  });
}

async function copyLink() {
  if (!createdInvite.value) return;
  try {
    await navigator.clipboard.writeText(createdInvite.value.url);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

const usesLabel = computed(() => {
  const uses = createdInvite.value?.maxUses;
  return uses === null || uses === undefined ? "Unlimited" : `${uses}`;
});
</script>

<template>
  <div class="create-invite-panel">
    <CreateCommunityPrompt v-if="communityId === null" />
    <StateView
      v-else-if="!canManage"
      kind="empty"
      title="You don't have permission to create invitations"
      description="Only the community owner or an admin can invite people."
    />
    <template v-else>
      <template v-if="createdInvite">
        <p class="title">Invite created</p>
        <div class="invite-link-row">
          <code class="invite-url">{{ createdInvite.url }}</code>
          <BaseButton variant="secondary" @click="copyLink">{{ copied ? "Copied!" : "Copy" }}</BaseButton>
        </div>
        <p class="meta">Expires {{ new Date(createdInvite.expiresAt).toLocaleString() }} · Uses: {{ usesLabel }}</p>
        <BaseButton variant="ghost" @click="reset">Create another invite</BaseButton>
      </template>

      <form v-else class="form" @submit.prevent="handleCreate">
        <label class="field">
          <span>Invite expires</span>
          <select v-model.number="ttlSecs" :disabled="isCreating">
            <option v-for="opt in TTL_OPTIONS" :key="opt.secs" :value="opt.secs">{{ opt.label }}</option>
          </select>
        </label>
        <label class="field checkbox">
          <input v-model="limitUses" type="checkbox" :disabled="isCreating" />
          <span>Limit number of uses</span>
        </label>
        <label v-if="limitUses" class="field">
          <span>Maximum uses</span>
          <input v-model.number="maxUses" type="number" min="1" :disabled="isCreating" />
        </label>
        <BaseButton type="submit" variant="primary" :disabled="isCreating">
          {{ isCreating ? "Creating…" : "Create invite" }}
        </BaseButton>
        <p v-if="createError" class="error-text">{{ userMessageFor(createError) }}</p>
      </form>
    </template>
  </div>
</template>

<style scoped>
.create-invite-panel {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.title {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text);
}
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.field select,
.field input[type="number"] {
  height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
}
.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
}
.invite-link-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.invite-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
  font-size: var(--font-size-xs);
}
.meta {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.error-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
</style>
