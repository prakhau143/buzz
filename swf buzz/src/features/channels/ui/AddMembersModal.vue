<script setup lang="ts">
/**
 * "Add members" for a channel.
 *
 * Candidates are COMMUNITY members minus CURRENT CHANNEL members
 * (`useChannelMemberPicker`) — the bug this replaces showed the channel's own
 * members, so the only name in the list was the person already looking at it.
 *
 * Adding publishes the existing kind:9000 channel-membership event through the
 * existing signing service (`useChannelMemberActions`). The relay remains the
 * authorization boundary: the Add button is hidden for people who cannot manage
 * membership, but that is a UX affordance, never the check itself — a rejection
 * from the relay is surfaced verbatim.
 */
import { computed, ref } from "vue";
import CloseButton from "@/components/CloseButton.vue";
import StateView from "@/components/StateView.vue";
import MemberPickerRow from "./MemberPickerRow.vue";
import { useChannelMemberPicker } from "../useChannelMemberPicker";
import { useChannelMemberActions } from "../useChannelMemberActions";
import { useProfileMap } from "@/composables/useProfile";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { useSessionStore } from "@/stores/session";
import { userMessageFor } from "@/services/errors";

const props = defineProps<{ channelId: string; channelName?: string }>();
const emit = defineEmits<{ close: [] }>();

const session = useSessionStore();
const picker = useChannelMemberPicker(() => props.channelId);
const { addMember, addErrorMessage } = useChannelMemberActions(() => props.channelId);

const search = ref("");
const dialog = ref<HTMLElement | null>(null);
useEscapeKey(() => emit("close"));
useFocusTrap(dialog);

// Names are resolved for the whole list here rather than inside each row, so
// the search box can match on what the user actually sees.
const allPubkeys = computed(() => picker.candidates.value.map((c) => c.pubkey));
const { profiles, displayNames } = useProfileMap(allPubkeys);

/** Which row is mid-add — so only that button shows "Adding…". */
const addingPubkey = ref<string | null>(null);
const localError = ref<string | null>(null);

function nameFor(pubkey: string): string {
  return displayNames.value.get(pubkey) ?? pubkey;
}

function matchesSearch(pubkey: string): boolean {
  const q = search.value.trim().toLowerCase();
  if (!q) return true;
  const profile = profiles.value.get(pubkey);
  // Name first, then the job title, then the bio — a hex key is matched only as
  // a last resort so that pasting a key still works without making keys the
  // primary way to find someone.
  return (
    nameFor(pubkey).toLowerCase().includes(q) ||
    (profile?.designation?.toLowerCase().includes(q) ?? false) ||
    (profile?.about?.toLowerCase().includes(q) ?? false) ||
    pubkey.toLowerCase().includes(q)
  );
}

/**
 * The signed-in person is never offered as a candidate to add — they are in the
 * channel already (that is how they opened this), and the relay would reject it.
 */
const visibleCandidates = computed(() =>
  picker.candidates.value
    .filter((c) => c.pubkey !== session.pubkey?.toLowerCase())
    .filter((c) => matchesSearch(c.pubkey))
    // Addable people first; already-added sink to the bottom.
    .sort((a, b) => Number(a.isInChannel) - Number(b.isInChannel)),
);

const availableCount = computed(
  () => picker.available.value.filter((c) => c.pubkey !== session.pubkey?.toLowerCase()).length,
);

const errorMessage = computed(() => localError.value ?? addErrorMessage.value);

async function add(pubkey: string) {
  localError.value = null;
  addingPubkey.value = pubkey;
  try {
    await addMember({ pubkey });
    // The mutation invalidates the channel-member query, so the row flips to
    // "Added ✓" from refreshed relay state rather than an optimistic guess.
    await picker.refetch();
  } catch (err) {
    localError.value = userMessageFor(err);
  } finally {
    addingPubkey.value = null;
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div ref="dialog" class="modal-card" role="dialog" aria-modal="true" aria-label="Add members">
      <div class="modal-header">
        <div>
          <h2>Add members</h2>
          <p v-if="channelName" class="subtitle">to {{ channelName }}</p>
        </div>
        <CloseButton @click="emit('close')" />
      </div>

      <input
        v-model="search"
        class="search-input"
        type="text"
        placeholder="Search community members…"
        aria-label="Search community members"
        data-testid="member-picker-search"
      />

      <p v-if="errorMessage" class="error" role="alert" data-testid="add-member-error">{{ errorMessage }}</p>

      <StateView v-if="picker.isLoading.value" kind="loading" />
      <StateView
        v-else-if="picker.isError.value"
        kind="error"
        title="Couldn't load community members"
        @retry="picker.refetch()"
      />
      <StateView
        v-else-if="!picker.hasCommunityRoster.value"
        kind="empty"
        title="This server has no member list"
      />
      <StateView
        v-else-if="!picker.candidates.value.length"
        kind="empty"
        title="No other community members available."
      />
      <StateView
        v-else-if="!availableCount && !search.trim()"
        kind="empty"
        title="All community members are already in this channel."
      />
      <StateView
        v-else-if="!visibleCandidates.length"
        kind="empty"
        title="No members match that search."
      />

      <ul v-else class="member-list">
        <MemberPickerRow
          v-for="candidate in visibleCandidates"
          :key="candidate.pubkey"
          :pubkey="candidate.pubkey"
          :display-name="nameFor(candidate.pubkey)"
          :profile="profiles.get(candidate.pubkey)"
          :community-role="candidate.communityRole"
          :is-in-channel="candidate.isInChannel"
          :can-manage="picker.canManage.value"
          :is-adding="addingPubkey === candidate.pubkey"
          @add="add(candidate.pubkey)"
        />
      </ul>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  padding: var(--space-4);
}

.modal-card {
  width: 460px;
  max-width: 100%;
  max-height: 70vh;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.modal-header h2 {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text);
}
.subtitle {
  margin: 2px 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

.search-input {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  padding: var(--space-2);
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.error {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger, #c0392b);
}

.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}

@media (max-width: 480px) {
  .modal-overlay {
    padding: 0;
    align-items: flex-end;
  }
  .modal-card {
    width: 100%;
    max-height: 85vh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
}
</style>
