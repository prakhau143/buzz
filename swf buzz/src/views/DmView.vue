<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { computed, watch } from "vue";
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
import { useReadStateStore } from "@/stores/readState";
import { useDmList } from "@/features/dm/useDmList";
import { useDmMessages } from "@/features/dm/useDmMessages";
import { useSendDm } from "@/features/dm/useSendDm";
import { useHideDm } from "@/features/dm/useHideDm";
import { useChannelReactions } from "@/features/reactions/useChannelReactions";
import { useAddReaction } from "@/features/reactions/useAddReaction";
import { useThreadIndexStore } from "@/stores/threadIndex";
import { buildThreadSummaries, mergeThreadSummaries } from "@/features/threads/threadSummary";
import { useTypingIndicator } from "@/features/presence/useTypingIndicator";
import { useProfile } from "@/composables/useProfile";
import type { Message } from "@/types/domain";
import type { MentionScope } from "@/features/mentions/useMentionDirectory";
import type { Attachment } from "@/protocol/imeta";
import PinnedMessageBar from "@/features/pins/ui/PinnedMessageBar.vue";
import PinReplaceDialog from "@/features/pins/ui/PinReplaceDialog.vue";
import { useConversationPin } from "@/features/pins/useConversationPin";
import { usePinFlow } from "@/features/pins/usePinFlow";
import { normalizeMessageTarget } from "@/features/navigation/messageTarget";
import { useOpenMessageTarget } from "@/features/navigation/useOpenMessageTarget";

const props = defineProps<{ conversationId?: string | string[] | null }>();

const ui = useUiStore();
const session = useSessionStore();
const readState = useReadStateStore();

// Same fix as ChannelsView.vue: Vue Router reuses this component instance
// across query-only navigations on the `dm` route, so `onMounted` alone only
// ever picked up the first conversation opened in the session. Watch the
// prop instead of reading it once at mount.
watch(
  () => props.conversationId,
  (value) => {
    const next = Array.isArray(value) ? value[0] : value;
    if (next && next !== ui.selectedConversationId) ui.selectConversation(next);
  },
  { immediate: true },
);

const selectedConversationId = computed(() => ui.selectedConversationId);


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
  loadOlder,
  hasOlderMessages,
  isLoadingOlder,
  olderMessagesError,
  overlays: dmOverlays,
} = useDmMessages(() => selectedConversationId.value);

/**
 * Phase G — the DM's ONE pinned message. A DM has no roles: both participants
 * may pin any message and unpin any pin (features/pins/pinModel.ts); the relay
 * restricts the conversation itself to its participants.
 */
const pin = useConversationPin({
  conversationId: () => selectedConversationId.value,
  kind: () => "dm",
  myPubkey: () => session.pubkey,
  roleOf: () => null,
  rolesReady: () => true,
  messages: () => messages.value,
  isDeleted: (id) => dmOverlays.value.deletes.has(id),
});
const { view: pinnedView, canUnpinActive, busy: pinBusy } = pin;
const pinFlow = usePinFlow(pin);
const { confirmingReplace } = pinFlow;
function pinStateFor(message: Message) {
  const isPinned = pin.isPinned(message.id);
  return { isPinned, canPin: pin.canPin(message), canUnpin: isPinned && canUnpinActive.value };
}
const { openMessageTarget } = useOpenMessageTarget();
function openPinnedMessage() {
  const view = pinnedView.value;
  const conversationId = selectedConversationId.value;
  if (!view?.message || !conversationId) return;
  const target = normalizeMessageTarget({
    kind: "dm",
    conversationId,
    messageId: view.message.id,
    threadRootId: view.threadRootId,
    source: "other",
  });
  if (target) void openMessageTarget(target);
}

const { send, isSending, error: sendError } = useSendDm(() => selectedConversationId.value ?? "");
const { data: reactionsByMessage } = useChannelReactions(() => selectedConversationId.value);
// Same thread rows as channels: the relay's counts (loaded with each history
// page) plus any replies seen since, merged.
const threadIndex = useThreadIndexStore();
const replySummaries = computed(() =>
  mergeThreadSummaries(buildThreadSummaries(messages.value ?? []), threadIndex.forChannel(selectedConversationId.value)),
);

// DM read state is the SAME NIP-RS frontier as channels (kind:30078, keyed by
// the DM's channel UUID — OLD BUZZ `markChannelRead`), so a read DM stays read
// across restarts and devices. Marked at the newest message actually loaded,
// on open and as messages arrive while it is open — exactly like ChannelsView.
watch(
  () => [selectedConversationId.value, messages.value] as const,
  ([id, msgs]) => {
    if (!id || !msgs?.length) return;
    const newest = msgs.reduce((max, m) => Math.max(max, m.createdAt), 0);
    readState.markChannelSeen(id, newest);
  },
  { immediate: true },
);
const { react } = useAddReaction();
const { typingPubkeys, notifyTyping } = useTypingIndicator(() => selectedConversationId.value);

/**
 * A DM offers its participants only — never the wider community, who cannot
 * read it. Used by the conversation composer and its thread panel alike.
 */
const mentionScope = computed<MentionScope>(() => {
  const id = selectedConversationId.value;
  const convo = id ? conversations.value?.find((c) => c.id === id) : undefined;
  return { kind: "dm", channelId: id, participants: convo?.dmParticipants ?? [] };
});

async function sendMessage(
  content: string,
  mentionPubkeys: string[],
  attachments: Attachment[] = [],
) {
  await send(content, mentionPubkeys, attachments);
}

async function retryMessage(message: Message) {
  // Retry re-sends the attachments too: they are already uploaded, so the
  // blobs still exist at the relay and re-uploading would orphan a duplicate.
  await send(message.content, message.mentions, message.attachments);
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

/**
 * Arriving from the Inbox's "Open in channel" (`?messageId=&threadRootId=`):
 * a reply opens its thread; the feed reveals the message — or its thread root,
 * which is what the main timeline shows — and the ids are dropped from the URL
 * once handled, so a reload doesn't jump again (OLD BUZZ does the same).
 */
const revealRoute = useRoute();
const revealRouter = useRouter();
const revealId = computed(() => {
  const q = revealRoute.query;
  const root = typeof q.threadRootId === "string" ? q.threadRootId : null;
  const message = typeof q.messageId === "string" ? q.messageId : null;
  return root ?? message;
});
watch(
  () => [revealRoute.query.threadRootId, revealRoute.query.messageId] as const,
  ([root, message]) => {
    if (typeof root === "string" && root !== message) ui.openThread(root);
  },
  { immediate: true },
);
function onRevealed() {
  const query = { ...revealRoute.query };
  delete query.messageId;
  delete query.threadRootId;
  void revealRouter.replace({ query });
}
</script>

<template>
  <AppShell>
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
            :pubkey="otherParticipant(selectedConversationId)"
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

        <PinnedMessageBar
          v-if="pinnedView"
          :view="pinnedView"
          :can-unpin="canUnpinActive"
          :busy="pinBusy"
          @open="openPinnedMessage"
          @unpin="pinFlow.requestUnpin"
          @retry="pin.reload"
        />
        <p v-if="pin.error.value" class="pin-error" role="alert" data-testid="pin-error">{{ pin.error.value }}</p>

        <MessageList
          :messages="messages ?? []"
          :conversation-id="selectedConversationId"
          :highlight-id="revealId"
          :reactions-by-message="reactionsByMessage"
          :reply-summaries="replySummaries"
          :is-loading="messagesLoading"
          :is-error="messagesError"
          :has-older-messages="hasOlderMessages"
          :is-loading-older="isLoadingOlder"
          :older-messages-error="olderMessagesError"
          :pin-state-for="pinStateFor"
          @highlight-done="onRevealed"
          @load-older="loadOlder"
          @retry="refetchMessages"
          @retry-message="retryMessage"
          @open-thread="ui.openThread"
          @open-profile="ui.openProfile"
          @react="({ targetEventId, emoji }) => react({ targetEventId, emoji })"
          @pin="pinFlow.requestPin"
          @unpin="pinFlow.requestUnpin"
        />

        <TypingIndicator :pubkeys="typingPubkeys" />
        <MessageComposer
          :disabled="isSending"
          :error="sendError"
          :mention-scope="mentionScope"
          allow-attachments
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
        :mention-scope="mentionScope"
        @close="ui.closeContextPanel()"
      />
      <UserProfilePanel
        v-else-if="ui.contextPanel.kind === 'profile'"
        :pubkey="ui.contextPanel.pubkey"
        @close="ui.closeContextPanel()"
      />
    </template>
  </AppShell>
  <PinReplaceDialog v-if="confirmingReplace" @confirm="pinFlow.confirmReplace" @cancel="pinFlow.cancelReplace" />
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

.pin-error {
  margin: 0;
  padding: var(--space-2) var(--space-4) 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}

.hide-button {
  position: absolute;
  top: var(--space-2);
  right: var(--space-3);
}
</style>
