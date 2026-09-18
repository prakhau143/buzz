<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppShell from "@/layouts/AppShell.vue";
import AppSidebar from "@/layouts/AppSidebar.vue";
import StateView from "@/components/StateView.vue";
import BaseButton from "@/components/BaseButton.vue";
import MessageList from "@/components/MessageList.vue";
import MessageComposer from "@/components/MessageComposer.vue";
import ChannelHeader from "@/features/channels/ui/ChannelHeader.vue";
import ChannelMenu from "@/features/channels/ui/ChannelMenu.vue";
import MembersModal from "@/features/channels/ui/MembersModal.vue";
import UserProfilePanel from "@/features/channels/ui/UserProfilePanel.vue";
import ChannelDetailsPanel from "@/features/channels/ui/ChannelDetailsPanel.vue";
import ReportMessageDialog from "@/features/moderation/ui/ReportMessageDialog.vue";
import ThreadPanel from "@/components/ThreadPanel.vue";
import TypingIndicator from "@/components/TypingIndicator.vue";
import { useUiStore } from "@/stores/ui";
import { useSessionStore } from "@/stores/session";
import { useChannels } from "@/features/channels/useChannels";
import { useChannelMembers } from "@/features/channels/useChannelMembers";
import { useJoinChannel } from "@/features/channels/useJoinChannel";
import { useChannelMessages } from "@/features/messages/useChannelMessages";
import { useSendMessage } from "@/features/messages/useSendMessage";
import { useChannelReactions } from "@/features/reactions/useChannelReactions";
import { useAddReaction } from "@/features/reactions/useAddReaction";
import { useThreadSummaries } from "@/features/threads/useThreadSummaries";
import { useTypingIndicator } from "@/features/presence/useTypingIndicator";
import { useMentionCandidates } from "@/features/agents/useMentionCandidates";
import { useAgentActivity } from "@/features/agents/useAgentActivity";
import AgentActivityBar from "@/components/AgentActivityBar.vue";
import type { Message } from "@/types/domain";

const props = defineProps<{ channelId?: string | string[] | null }>();

const ui = useUiStore();
const session = useSessionStore();

onMounted(() => {
  const initial = Array.isArray(props.channelId) ? props.channelId[0] : props.channelId;
  if (initial) ui.selectChannel(initial);
});

const selectedChannelId = computed(() => ui.selectedChannelId);
const selectedChannel = computed(
  () => channels.value?.find((c) => c.id === selectedChannelId.value) ?? null,
);

const { data: channels } = useChannels();

const {
  data: members,
  isLoading: membersLoading,
  isError: membersError,
  refetch: refetchMembers,
} = useChannelMembers(() => selectedChannelId.value);
const myChannelRole = computed(
  () => members.value?.find((m) => m.pubkey === session.pubkey)?.role ?? null,
);
const isMember = computed(() => myChannelRole.value !== null);
const { join, isJoining } = useJoinChannel();

const {
  data: messages,
  isLoading: messagesLoading,
  isError: messagesError,
  refetch: refetchMessages,
} = useChannelMessages(() => selectedChannelId.value);

const { send, isSending, error: sendError } = useSendMessage(() => selectedChannelId.value ?? "");

const { data: reactionsByMessage } = useChannelReactions(() => selectedChannelId.value);
const replySummaries = useThreadSummaries(() => messages.value ?? []);
const { react } = useAddReaction();
const { typingPubkeys, notifyTyping } = useTypingIndicator(() => selectedChannelId.value);

const mentionCandidates = useMentionCandidates(() => members.value ?? []);
const agentPubkeysInScope = computed(() =>
  mentionCandidates.value.filter((c) => c.isAgent).map((c) => c.pubkey),
);
const agentActivity = useAgentActivity(agentPubkeysInScope, typingPubkeys);

async function sendMessage(content: string, mentionPubkeys: string[]) {
  await send({ content, mentionPubkeys });
}

async function retryMessage(message: Message) {
  await send({
    content: message.content,
    reply: message.thread.parentId
      ? {
          rootEventId: message.thread.rootId!,
          parentEventId: message.thread.parentId,
          parentAuthorPubkey: message.authorPubkey,
        }
      : undefined,
  });
}

const reportTarget = ref<Message | null>(null);
const showMembersModal = ref(false);
const showChannelMenu = ref(false);

function openMembers() {
  showMembersModal.value = true;
}
function selectMemberProfile(pubkey: string) {
  showMembersModal.value = false;
  ui.openProfile(pubkey);
}
function copyChannelId() {
  if (selectedChannelId.value) void navigator.clipboard.writeText(selectedChannelId.value);
  showChannelMenu.value = false;
}
function openChannelDetailsFromMenu() {
  ui.openChannelDetails();
  showChannelMenu.value = false;
}
function openMembersFromMenu() {
  showChannelMenu.value = false;
  openMembers();
}
</script>

<template>
  <AppShell show-details-toggle>
    <template #sidebar>
      <AppSidebar :active-channel-id="selectedChannelId" />
    </template>

    <template #main>
      <StateView
        v-if="!selectedChannelId"
        kind="empty"
        title="No channel selected"
        description="Pick a channel from the sidebar to start reading."
      />
      <div v-else class="channel-main">
        <ChannelHeader
          :channel="selectedChannel"
          :member-count="members?.length ?? 0"
          @open-members="openMembers"
          @open-menu="showChannelMenu = true"
        />
        <div v-if="!isMember" class="join-bar">
          <span>You're not a member of this channel yet.</span>
          <BaseButton variant="primary" :disabled="isJoining" @click="join(selectedChannelId!)">
            Join channel
          </BaseButton>
        </div>

        <MessageList
          :messages="messages ?? []"
          :reactions-by-message="reactionsByMessage"
          :reply-summaries="replySummaries"
          :is-loading="messagesLoading"
          :is-error="messagesError"
          @retry="refetchMessages"
          @retry-message="retryMessage"
          @open-thread="ui.openThread"
          @react="({ targetEventId, emoji }) => react({ targetEventId, emoji })"
          @report="(message) => (reportTarget = message)"
        />

        <AgentActivityBar :activity="agentActivity" />
        <TypingIndicator :pubkeys="typingPubkeys" />
        <MessageComposer
          :disabled="isSending || !isMember"
          :error="sendError"
          :mention-candidates="mentionCandidates"
          @send="sendMessage"
          @typing="notifyTyping"
        />
      </div>
    </template>

    <template #details>
      <ThreadPanel
        v-if="ui.contextPanel.kind === 'thread' && selectedChannelId"
        :root-event-id="ui.contextPanel.rootEventId"
        :channel-id="selectedChannelId"
        @close="ui.closeContextPanel()"
      />
      <UserProfilePanel
        v-else-if="ui.contextPanel.kind === 'profile'"
        :pubkey="ui.contextPanel.pubkey"
        @close="ui.closeContextPanel()"
      />
      <ChannelDetailsPanel
        v-else-if="ui.contextPanel.kind === 'channelDetails' && selectedChannel"
        :channel="selectedChannel"
        :member-count="members?.length ?? 0"
        @close="ui.closeContextPanel()"
      />
    </template>
  </AppShell>

  <MembersModal
    v-if="showMembersModal"
    :members="members ?? []"
    :is-loading="membersLoading"
    :is-error="membersError"
    @close="showMembersModal = false"
    @retry="refetchMembers"
    @select-member="selectMemberProfile"
  />
  <ChannelMenu
    v-if="showChannelMenu && selectedChannel"
    :my-role="myChannelRole"
    :visibility="selectedChannel.visibility"
    @close="showChannelMenu = false"
    @view-members="openMembersFromMenu"
    @add-members="openMembersFromMenu"
    @channel-details="openChannelDetailsFromMenu"
    @copy-id="copyChannelId"
    @leave-channel="openChannelDetailsFromMenu"
  />
  <ReportMessageDialog
    v-if="reportTarget"
    :message="reportTarget"
    @close="reportTarget = null"
  />
</template>

<style scoped>
.channel-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.join-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-surface-muted);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
</style>
