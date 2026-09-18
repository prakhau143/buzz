<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import AppShell from "@/layouts/AppShell.vue";
import AppSidebar from "@/layouts/AppSidebar.vue";
import StateView from "@/components/StateView.vue";
import BaseButton from "@/components/BaseButton.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import MessageList from "@/components/MessageList.vue";
import MessageComposer from "@/components/MessageComposer.vue";
import ThreadPanel from "@/components/ThreadPanel.vue";
import UserProfilePanel from "@/features/channels/ui/UserProfilePanel.vue";
import TypingIndicator from "@/components/TypingIndicator.vue";
import { useUiStore } from "@/stores/ui";
import { useSessionStore } from "@/stores/session";
import { useDmReadStateStore } from "@/stores/dmReadState";
import { useDmList } from "@/features/dm/useDmList";
import { useDmMessages } from "@/features/dm/useDmMessages";
import { useSendDm } from "@/features/dm/useSendDm";
import { useHideDm } from "@/features/dm/useHideDm";
import { useChannelReactions } from "@/features/reactions/useChannelReactions";
import { useAddReaction } from "@/features/reactions/useAddReaction";
import { useThreadSummaries } from "@/features/threads/useThreadSummaries";
import { useTypingIndicator } from "@/features/presence/useTypingIndicator";
import { useAgentActivity } from "@/features/agents/useAgentActivity";
import AgentActivityBar from "@/components/AgentActivityBar.vue";
import { useProfile } from "@/composables/useProfile";
import type { Message } from "@/types/domain";
import type { MentionCandidate } from "@/components/MessageComposer.vue";

const props = defineProps<{ conversationId?: string | string[] | null }>();

const ui = useUiStore();
const session = useSessionStore();
const readState = useDmReadStateStore();

onMounted(() => {
  const initial = Array.isArray(props.conversationId)
    ? props.conversationId[0]
    : props.conversationId;
  if (initial) ui.selectConversation(initial);
});

const selectedConversationId = computed(() => ui.selectedConversationId);

// Mark read on every selection, including a direct-URL navigation (a
// sidebar click also marks read, via `AppSidebar.selectConversation` —
// this covers the mount/query-param path that click handler doesn't see).
watch(selectedConversationId, (id) => {
  if (id) readState.markRead(id);
}, { immediate: true });

const { data: conversations } = useDmList();

const otherParticipant = (conversationId: string) => {
  const convo = conversations.value?.find((c) => c.id === conversationId);
  return convo?.dmParticipants?.find((p) => p !== session.pubkey) ?? null;
};
const { data: selectedProfile } = useProfile(() =>
  selectedConversationId.value ? otherParticipant(selectedConversationId.value) : null,
);

const {
  data: messages,
  isLoading: messagesLoading,
  isError: messagesError,
  refetch: refetchMessages,
} = useDmMessages(() => selectedConversationId.value);

const { send, isSending, error: sendError } = useSendDm(() => selectedConversationId.value ?? "");
const { data: reactionsByMessage } = useChannelReactions(() => selectedConversationId.value);
const replySummaries = useThreadSummaries(() => messages.value ?? []);
const { react } = useAddReaction();
const { typingPubkeys, notifyTyping } = useTypingIndicator(() => selectedConversationId.value);

const mentionCandidates = computed<MentionCandidate[]>(() => {
  const otherPubkey = selectedConversationId.value
    ? otherParticipant(selectedConversationId.value)
    : null;
  if (!otherPubkey) return [];
  return [
    {
      pubkey: otherPubkey,
      displayName: selectedProfile.value?.displayName ?? otherPubkey.slice(0, 8),
      isAgent: selectedProfile.value?.isAgent,
    },
  ];
});
const agentPubkeysInScope = computed(() =>
  mentionCandidates.value.filter((c) => c.isAgent).map((c) => c.pubkey),
);
const agentActivity = useAgentActivity(agentPubkeysInScope, typingPubkeys);

async function sendMessage(content: string, mentionPubkeys: string[]) {
  await send(content, mentionPubkeys);
}

async function retryMessage(message: Message) {
  await send(message.content);
}

const { hide, isHiding } = useHideDm();

async function hideCurrentConversation() {
  if (!selectedConversationId.value) return;
  await hide(selectedConversationId.value);
  ui.selectConversation(null);
}

function openPartnerProfile() {
  const pubkey = selectedConversationId.value ? otherParticipant(selectedConversationId.value) : null;
  if (pubkey) ui.openProfile(pubkey);
}
</script>

<template>
  <AppShell show-details-toggle>
    <template #sidebar>
      <AppSidebar :active-conversation-id="selectedConversationId" />
    </template>

    <template #main>
      <StateView
        v-if="!selectedConversationId"
        kind="empty"
        title="No conversation selected"
        description="Pick a conversation, or start a new one from the sidebar."
      />
      <div v-else class="dm-main">
        <button type="button" class="dm-header" @click="openPartnerProfile">
          <AvatarCircle
            :name="selectedProfile?.displayName ?? '?'"
            :avatar-url="selectedProfile?.avatarUrl"
            :is-agent="selectedProfile?.isAgent"
            :size="28"
          />
          <h1>
            {{
              selectedProfile?.displayName ?? otherParticipant(selectedConversationId)?.slice(0, 12)
            }}
          </h1>
        </button>
        <BaseButton
          variant="ghost"
          class="hide-button"
          :disabled="isHiding"
          @click="hideCurrentConversation"
        >
          Hide
        </BaseButton>

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
        />

        <AgentActivityBar :activity="agentActivity" />
        <TypingIndicator :pubkeys="typingPubkeys" />
        <MessageComposer
          :disabled="isSending"
          :error="sendError"
          :mention-candidates="mentionCandidates"
          @send="sendMessage"
          @typing="notifyTyping"
        />
      </div>
    </template>

    <template #details>
      <ThreadPanel
        v-if="ui.contextPanel.kind === 'thread' && selectedConversationId"
        :root-event-id="ui.contextPanel.rootEventId"
        :channel-id="selectedConversationId"
        @close="ui.closeContextPanel()"
      />
      <UserProfilePanel
        v-else-if="ui.contextPanel.kind === 'profile'"
        :pubkey="ui.contextPanel.pubkey"
        @close="ui.closeContextPanel()"
      />
    </template>
  </AppShell>
</template>

<style scoped>
.dm-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
}

.dm-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  padding-right: 80px;
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  cursor: pointer;
  width: 100%;
  text-align: left;
}
.dm-header:hover {
  background: var(--color-surface-hover);
}
.dm-header h1 {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text);
}

.hide-button {
  position: absolute;
  top: var(--space-2);
  right: var(--space-3);
}
</style>
