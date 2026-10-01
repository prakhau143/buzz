<script setup lang="ts">
/**
 * One community member in the "Add members" picker.
 *
 * The person is identified by NAME, never by a raw hex key: the key is shown
 * only as small secondary text for disambiguation, and the row's accessible
 * label is the name too. Filtering happens in the parent (it owns the search
 * box and the empty states), so this component renders whatever it is given.
 */
import AvatarCircle from "@/components/AvatarCircle.vue";
import BaseButton from "@/components/BaseButton.vue";
import { shortKey } from "@/features/identity/format";
import type { RelayMemberRole } from "@/protocol/relayMembers";
import type { UserProfile } from "@/types/domain";

const props = defineProps<{
  pubkey: string;
  displayName: string;
  profile?: UserProfile;
  communityRole: RelayMemberRole;
  /** Already a channel member — shows "Added" instead of an Add button. */
  isInChannel: boolean;
  /** Whether the signed-in user may add anyone at all (owner/admin). */
  canManage: boolean;
  /** This specific row's add request is in flight. */
  isAdding: boolean;
}>();

defineEmits<{ add: [] }>();
</script>

<template>
  <li class="picker-row" :data-testid="`member-picker-row-${props.pubkey}`">
    <AvatarCircle :name="displayName" :avatar-url="profile?.avatarUrl" :is-agent="profile?.isAgent" :pubkey="pubkey" :size="32" />

    <span class="identity">
      <span class="name" :title="displayName">{{ displayName }}</span>
      <span class="secondary">
        <!-- Job title first — it is what identifies a colleague. The key is the
             fallback, kept visible so an identity can still be verified. -->
        <span v-if="profile?.designation" class="about" :title="profile.designation">
          {{ profile.designation }}
        </span>
        <span v-else-if="profile?.about" class="about" :title="profile.about">{{ profile.about }}</span>
        <span v-else class="key">{{ shortKey(pubkey) }}</span>
      </span>
    </span>

    <span class="role" :class="communityRole">{{ communityRole }}</span>

    <span v-if="isInChannel" class="added" data-testid="member-added">Added ✓</span>
    <BaseButton
      v-else-if="canManage"
      variant="secondary"
      :disabled="isAdding"
      :data-testid="`add-member-${pubkey}`"
      @click="$emit('add')"
    >
      {{ isAdding ? "Adding…" : "Add" }}
    </BaseButton>
  </li>
</template>

<style scoped>
.picker-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-md);
}
.picker-row:hover {
  background: var(--color-surface-hover);
}

/* min-width:0 lets the flex child actually shrink so a long name ellipsizes
   instead of pushing the Add button off the row. */
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
.secondary {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role {
  font-size: var(--font-size-xs);
  text-transform: capitalize;
  color: var(--color-text-subtle);
  flex-shrink: 0;
}
.role.owner,
.role.admin {
  color: var(--color-primary);
  font-weight: 600;
}

.added {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  flex-shrink: 0;
  white-space: nowrap;
}

@media (max-width: 480px) {
  .role {
    display: none; /* the name and the action matter more than the badge here */
  }
}
</style>
