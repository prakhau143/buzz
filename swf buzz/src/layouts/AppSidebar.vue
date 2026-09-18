<script setup lang="ts">
/**
 * Shared left sidebar (Channels + Direct Messages) for both `ChannelsView`
 * and `DmView` — previously each view duplicated this markup and diverged:
 * `ChannelsView` showed a hardcoded "No conversations yet." placeholder
 * instead of the real DM list, and `DmView` didn't show channels at all.
 * One component, one real data source for each list, used identically by
 * both routes.
 */
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import StateView from "@/components/StateView.vue";
import BaseButton from "@/components/BaseButton.vue";
import ChannelListItem from "@/components/ChannelListItem.vue";
import DmParticipantLabel from "./DmParticipantLabel.vue";
import CreateChannelDialog from "@/features/channels/ui/CreateChannelDialog.vue";
import CommunityManagementModal from "@/features/community-members/ui/CommunityManagementModal.vue";
import { isPlatformAdminConfigured } from "@/features/platform-admin/usePlatformAdmin";
import { useAuth } from "@/features/auth/useAuth";
import { useSessionStore } from "@/stores/session";
import { useChannels } from "@/features/channels/useChannels";
import { useDmList } from "@/features/dm/useDmList";
import { useOpenDm } from "@/features/dm/useOpenDm";
import { useDmReadStateStore } from "@/stores/dmReadState";

const props = defineProps<{ activeChannelId?: string | null; activeConversationId?: string | null }>();

const { logout } = useAuth();
const session = useSessionStore();
const router = useRouter();

const { data: channels, isLoading: channelsLoading, isError: channelsError, refetch: refetchChannels } = useChannels();
const { data: conversations, isLoading: dmLoading, isError: dmError } = useDmList();
const readState = useDmReadStateStore();
const { open, isOpening } = useOpenDm();

const showCreateChannel = ref(false);
const showCommunityModal = ref(false);
const platformAdminAvailable = isPlatformAdminConfigured();
const newDmPubkey = ref("");
const newDmError = ref<string | null>(null);

function otherParticipant(conversationId: string): string | null {
  const convo = conversations.value?.find((c) => c.id === conversationId);
  return convo?.dmParticipants?.find((p) => p !== session.pubkey) ?? null;
}

function isUnread(conversationId: string): boolean {
  // Best-effort, client-only signal — see stores/dmReadState.ts.
  const last = readState.lastReadAt[conversationId] ?? 0;
  return conversationId !== activeConversationId.value && last === 0;
}

function selectChannel(channelId: string) {
  void router.push({ name: "channels", query: { channelId } });
}

function selectConversation(conversationId: string) {
  readState.markRead(conversationId);
  void router.push({ name: "dm", query: { conversationId } });
}

async function startNewDm() {
  const pubkey = newDmPubkey.value.trim();
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
    newDmError.value = "Enter a valid 64-character hex pubkey.";
    return;
  }
  newDmError.value = null;
  try {
    const conversationId = await open([pubkey]);
    newDmPubkey.value = "";
    selectConversation(conversationId);
  } catch {
    newDmError.value = "Couldn't start that conversation. Please try again.";
  }
}

const activeChannelId = computed(() => props.activeChannelId ?? null);
const activeConversationId = computed(() => props.activeConversationId ?? null);
</script>

<template>
  <div class="sidebar-content">
    <div class="sidebar-section">
      <div class="sidebar-section-header">
        <h2>Channels</h2>
        <button
          type="button"
          class="create-channel-button"
          aria-label="Create channel"
          title="Create channel"
          @click="showCreateChannel = true"
        >
          +
        </button>
      </div>
      <StateView v-if="channelsLoading" kind="loading" />
      <StateView v-else-if="channelsError" kind="error" title="Couldn't load channels" @retry="refetchChannels" />
      <p v-else-if="!channels?.length" class="muted">No channels yet.</p>
      <ChannelListItem
        v-for="channel in channels"
        :key="channel.id"
        :channel="channel"
        :active="channel.id === activeChannelId"
        @click="selectChannel(channel.id)"
      />
    </div>

    <div class="sidebar-section">
      <h2>Direct messages</h2>
      <StateView v-if="dmLoading" kind="loading" />
      <StateView v-else-if="dmError" kind="error" title="Couldn't load conversations" />
      <p v-else-if="!conversations?.length" class="muted">No conversations yet.</p>
      <button
        v-for="conversation in conversations"
        :key="conversation.id"
        type="button"
        class="dm-item"
        :class="{ active: conversation.id === activeConversationId }"
        @click="selectConversation(conversation.id)"
      >
        <DmParticipantLabel :pubkey="otherParticipant(conversation.id)" />
        <span v-if="isUnread(conversation.id)" class="unread-dot" />
      </button>

      <div class="new-dm">
        <input
          v-model="newDmPubkey"
          class="new-dm-input"
          type="text"
          placeholder="Pubkey (hex) to message…"
        />
        <BaseButton variant="secondary" :disabled="isOpening" @click="startNewDm">Start</BaseButton>
      </div>
      <p v-if="newDmError" class="new-dm-error">{{ newDmError }}</p>
    </div>

    <div class="sidebar-footer">
      <BaseButton variant="ghost" @click="showCommunityModal = true">Community</BaseButton>
      <!-- The primary Channels/DMs experience now lives at these routes
           (DECISIONS.md D10) — this sidebar itself is the older Nostr-based
           one, kept for reactions/presence/moderation/agent-activity which
           haven't migrated yet. See CommunityChannelsView.vue/CommunityDmView.vue. -->
      <RouterLink to="/community" class="admin-link">Channels</RouterLink>
      <RouterLink to="/community-dm" class="admin-link">Direct Messages</RouterLink>
      <RouterLink v-if="platformAdminAvailable" to="/platform-admin" class="admin-link">
        Platform Admin
      </RouterLink>
      <BaseButton variant="ghost" @click="logout">Sign out</BaseButton>
    </div>
  </div>

  <CreateChannelDialog v-if="showCreateChannel" @close="showCreateChannel = false" />
  <CommunityManagementModal
    v-if="showCommunityModal"
    :selected-channel-id="activeChannelId"
    @close="showCommunityModal = false"
  />
</template>

<style scoped>
.sidebar-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--space-4);
}

.sidebar-section {
  margin-bottom: var(--space-5);
}

.sidebar-section h2 {
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-subtle);
  margin: 0 0 var(--space-2);
}

.sidebar-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sidebar-section-header h2 {
  margin: 0;
}

.create-channel-button {
  border: none;
  background: transparent;
  color: var(--color-text-subtle);
  font-size: var(--font-size-md);
  line-height: 1;
  cursor: pointer;
  padding: 0 var(--space-1) var(--space-2);
  margin-bottom: var(--space-2);
}
.create-channel-button:hover {
  color: var(--color-text);
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.dm-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 32px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  cursor: pointer;
  text-align: left;
}
.dm-item:hover {
  background: var(--color-surface-hover);
}
.dm-item.active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}
.dm-item :deep(.dm-name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  flex-shrink: 0;
}

.new-dm {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.new-dm-input {
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

.new-dm-error {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}

.admin-link {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  margin-bottom: var(--space-2);
  text-decoration: none;
}
.admin-link:hover {
  color: var(--color-text);
  text-decoration: underline;
}

.sidebar-footer {
  margin-top: auto;
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>
