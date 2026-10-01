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
import { activeRelayUrl, communities, relayHost } from "@/features/communities/relayCommunities";
import { parseOwnerPubkey } from "@/features/communities/OperatorService";
import { buildConnectLink } from "@/features/communities/RelayInviteService";
import { shortNpub } from "@/features/identity/format";
import { useProfileMap } from "@/composables/useProfile";
import CommunityMemberRow from "./CommunityMemberRow.vue";
import type { RelayMemberRole } from "@/protocol/relayMembers";

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

// A person's PUBLIC key (npub1… or hex) is all an owner needs to add them: the
// relay records them as a member (NIP-43 kind 9030) and, when they sign in with
// their own private key, lets them in. The public key authenticates nobody.
const pubkeyProblem = computed(() =>
  newPubkey.value.trim() && !parseOwnerPubkey(newPubkey.value)
    ? "Enter their npub1… address or 64-character hex public key."
    : null,
);
// After adding, the person still has to learn where the community lives: this link
// carries only the address (and a label). No secret, no code.
const added = ref<{ pubkey: string; link: string } | null>(null);
const copied = ref(false);

async function handleAdd() {
  const pubkey = parseOwnerPubkey(newPubkey.value);
  if (!pubkey) return;
  added.value = null;
  copied.value = false;
  try {
    await addMember({ pubkey, role: newRole.value });
  } catch {
    return; // shown through addError
  }
  const name = communities.value.find((c) => c.relayUrl === activeRelayUrl.value)?.name;
  added.value = {
    pubkey,
    link: buildConnectLink(activeRelayUrl.value, {
      communityName: name && name !== relayHost(activeRelayUrl.value) ? name : undefined,
    }),
  };
  newPubkey.value = "";
}

async function copyLink() {
  if (!added.value) return;
  try {
    await navigator.clipboard.writeText(added.value.link);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

/**
 * Search / filter / sort.
 *
 * Profiles are resolved in ONE batched request for the whole roster
 * (`useProfileMap`), not one per row — a 50-member community used to cost ~100
 * relay round trips. Searching by name therefore needs no extra fetching.
 */
const search = ref("");
const roleFilter = ref<"all" | RelayMemberRole>("all");
const { profiles } = useProfileMap(() => (members.value ?? []).map((m) => m.pubkey));

const ROLE_ORDER: Record<RelayMemberRole, number> = { owner: 0, admin: 1, member: 2 };

const visibleMembers = computed(() => {
  const term = search.value.trim().toLowerCase();
  return (members.value ?? [])
    .filter((m) => roleFilter.value === "all" || m.role === roleFilter.value)
    .filter((m) => {
      if (!term) return true;
      const profile = profiles.value.get(m.pubkey);
      // Key last: a name match is what someone almost always means, but a
      // pasted pubkey has to find its person too.
      return (
        (profile?.displayName ?? "").toLowerCase().includes(term) ||
        (profile?.designation ?? "").toLowerCase().includes(term) ||
        m.pubkey.toLowerCase().includes(term)
      );
    })
    .slice()
    .sort((a, b) => {
      const byRole = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (byRole !== 0) return byRole;
      const nameA = (profiles.value.get(a.pubkey)?.displayName ?? a.pubkey).toLowerCase();
      const nameB = (profiles.value.get(b.pubkey)?.displayName ?? b.pubkey).toLowerCase();
      return nameA.localeCompare(nameB);
    });
});

const totalCount = computed(() => members.value?.length ?? 0);
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
          placeholder="npub1… or 64-char hex public key"
          data-testid="add-member-pubkey"
          :disabled="isAdding"
        />
        <select v-model="newRole" class="role-select" :disabled="isAdding">
          <option v-for="role in addRoleOptions" :key="role" :value="role">{{ role }}</option>
        </select>
        <BaseButton
          type="submit"
          variant="primary"
          :disabled="isAdding || !newPubkey.trim() || !!pubkeyProblem"
          data-testid="add-member-submit"
        >
          Add member
        </BaseButton>
      </form>
      <p v-if="pubkeyProblem" class="error-text" data-testid="add-member-problem">{{ pubkeyProblem }}</p>
      <div v-if="added" class="added" data-testid="member-added">
        <p class="hint">
          Added <code>{{ shortNpub(added.pubkey) }}</code>. Send them this link so their app knows
          where to find the community (it contains no secret):
        </p>
        <p class="added-link" data-testid="member-added-link">{{ added.link }}</p>
        <BaseButton variant="secondary" @click="copyLink">{{ copied ? "Copied" : "Copy link" }}</BaseButton>
      </div>
      <p v-if="addError" class="error-text">{{ userMessageFor(addError) }}</p>

      <div class="roster-toolbar">
        <input
          v-model="search"
          class="search-input"
          type="search"
          placeholder="Search people…"
          aria-label="Search community members"
          data-testid="member-search"
        />
        <select v-model="roleFilter" class="role-filter" aria-label="Filter by role">
          <option value="all">All roles</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </select>
      </div>
      <p class="count" data-testid="member-count">
        {{ visibleMembers.length === totalCount
          ? `${totalCount} ${totalCount === 1 ? "member" : "members"}`
          : `${visibleMembers.length} of ${totalCount} members` }}
      </p>

      <StateView
        v-if="visibleMembers.length === 0"
        kind="empty"
        title="No one matches"
        description="Try a different name or role filter."
      />
      <ul v-else class="member-list">
        <CommunityMemberRow
          v-for="member in visibleMembers"
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
            (seconds) =>
              applyTimeout({
                pubkey: member.pubkey,
                targetRole: member.role,
                actingRole: myRole,
                expiresAt: Math.floor(Date.now() / 1000) + seconds,
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

.added {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.added-link {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-xs);
  word-break: break-all;
  color: var(--color-text);
}

.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.roster-toolbar {
  display: flex;
  gap: var(--space-2);
}
.search-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}
.role-filter {
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-xs);
}
.count {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

/* Tablet and narrower: the toolbar stacks so neither control is squeezed. */
@media (max-width: 768px) {
  .roster-toolbar {
    flex-direction: column;
  }
}
</style>
