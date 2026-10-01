<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import MobileConversationSkeleton from "../ui/MobileConversationSkeleton.vue";
import { rememberScroll, takeScroll } from "../scrollMemory";
import AppIcon from "@/components/AppIcon.vue";
import MessageList from "@/components/MessageList.vue";
import MessageComposer from "@/components/MessageComposer.vue";
import TypingIndicator from "@/components/TypingIndicator.vue";
import ReportMessageDialog from "@/features/moderation/ui/ReportMessageDialog.vue";
import MobileLayout from "../ui/MobileLayout.vue";
import MobileHeader from "../ui/MobileHeader.vue";
import MobileMessageActions from "../ui/MobileMessageActions.vue";
import MobileEditBar from "../ui/MobileEditBar.vue";
import { useMobileNav } from "../mobileNav";
import { useMobileMessageActions } from "../useMobileMessageActions";
import { useMobileReveal } from "../useMobileReveal";
import MobileRevealNotice from "../ui/MobileRevealNotice.vue";
import { MEMBER_ROLE_KEY } from "../memberRole";
import { useUiStore } from "@/stores/ui";
import { useSessionStore } from "@/stores/session";
import { useReadStateStore } from "@/stores/readState";
import { useThreadIndexStore } from "@/stores/threadIndex";
import { useChannels } from "@/features/channels/useChannels";
import { historyIsReadable, useChannelAccess } from "@/features/channels/channelAccess";
import ChannelAccessBar from "@/features/channels/ui/ChannelAccessBar.vue";
import { useJoinChannel } from "@/features/channels/useJoinChannel";
import { canEditMessage, messageDeleteMode } from "@/features/channels/channelPermissions";
import { useChannelMessages } from "@/features/messages/useChannelMessages";
import { useMessageMutations } from "@/features/messages/useMessageMutations";
import { useSendMessage } from "@/features/messages/useSendMessage";
import { useChannelReactions } from "@/features/reactions/useChannelReactions";
import { useAddReaction } from "@/features/reactions/useAddReaction";
import { useRemoveReaction } from "@/features/reactions/useRemoveReaction";
import { buildThreadSummaries, mergeThreadSummaries } from "@/features/threads/threadSummary";
import { useTypingIndicator } from "@/features/presence/useTypingIndicator";
import { useReportActiveConversation } from "@/features/notifications/useNotificationService";
import type { MentionScope } from "@/features/mentions/useMentionDirectory";
import type { Attachment } from "@/protocol/imeta";
import type { Message } from "@/types/domain";
import PinnedMessageBar from "@/features/pins/ui/PinnedMessageBar.vue";
import PinReplaceDialog from "@/features/pins/ui/PinReplaceDialog.vue";
import { useConversationPin } from "@/features/pins/useConversationPin";
import { usePinFlow } from "@/features/pins/usePinFlow";
import { normalizeMessageTarget } from "@/features/navigation/messageTarget";
import { useOpenMessageTarget } from "@/features/navigation/useOpenMessageTarget";
import { draftMentionsEveryone } from "@/features/mentions/everyone";

/**
 * Mobile channel conversation — full screen: back | channel | messages |
 * composer. The SAME core as the desktop ChannelsView: message query + live
 * updates, optimistic send, reactions, thread summaries, typing, NIP-RS read
 * state, the mention directory, and — for message actions — the same
 * authorization (`channelPermissions.ts`) and edit/delete overlays
 * (`useMessageMutations`). Actions open as a bottom sheet from each message's
 * "⋯" (no hover on touch); a thread is its own page.
 */
const props = defineProps<{ channelId: string }>();
const router = useRouter();
const ui = useUiStore();
const session = useSessionStore();
const readState = useReadStateStore();
const threadIndex = useThreadIndexStore();
const { goBack } = useMobileNav();

const channelId = computed(() => props.channelId);
// The shared selection (notifications, desktop counterpart) follows what is on screen.
watch(channelId, (id) => ui.selectChannel(id), { immediate: true });
useReportActiveConversation(() => channelId.value);

const { data: channels } = useChannels();
const channel = computed(() => channels.value?.find((c) => c.id === channelId.value) ?? null);
// The SAME access resolver as desktop (features/channels/channelAccess.ts) — no mobile-only membership logic.
const {
  access: channelAccess,
  roster: channelRoster,
  myRole,
  showJoin,
  rosterReady,
} = useChannelAccess({
  channelId: () => channelId.value,
  me: () => session.pubkey,
  visibility: () => channel.value?.visibility ?? null,
  historyReadable: () => historyIsReadable(messages.value, isError.value),
});
const { data: members } = channelRoster;
const { join, isJoining } = useJoinChannel();
provide(MEMBER_ROLE_KEY, (pubkey) => members.value?.find((m) => m.pubkey === pubkey)?.role ?? null);

const {
  data: messages,
  isLoading,
  isError,
  refetch,
  loadOlder,
  hasOlderMessages,
  isLoadingOlder,
  olderMessagesError,
  overlays,
  absorbTimelineEvents,
} = useChannelMessages(() => channelId.value);
const { send, isSending, error: sendError } = useSendMessage(() => channelId.value);
const { data: reactionsByMessage } = useChannelReactions(() => channelId.value);
const { react } = useAddReaction();
const { unreact } = useRemoveReaction(() => channelId.value);
const { typingPubkeys, notifyTyping } = useTypingIndicator(() => channelId.value);
const {
  editMessage,
  deleteMessage,
  error: mutationError,
} = useMessageMutations({
  overlays: () => overlays.value,
  touch: () => absorbTimelineEvents({ messages: [], edits: [], deletes: [] }),
});

/** Top-level messages only; replies live in their thread (same rule as desktop). */
const topLevel = computed(() => (messages.value ?? []).filter((m) => !m.thread.rootId));
const replySummaries = computed(() =>
  mergeThreadSummaries(buildThreadSummaries(messages.value ?? []), threadIndex.forChannel(channelId.value)),
);

// Seen while on screen — the same NIP-RS watermark the desktop view writes.
watch(
  () => messages.value,
  (msgs) => {
    if (!msgs?.length) return;
    readState.markChannelSeen(channelId.value, msgs.reduce((max, m) => Math.max(max, m.createdAt), 0));
  },
  { immediate: true },
);

// Permissions exactly as the desktop feed resolves them per row.
const visibility = computed(() => channel.value?.visibility ?? "private");
const canEdit = (m: Message) =>
  canEditMessage({ myPubkey: session.pubkey, authorPubkey: m.authorPubkey, myRole: myRole.value, visibility: visibility.value });
const deleteMode = (m: Message) =>
  m.isSystemMessage
    ? null
    : messageDeleteMode({ myPubkey: session.pubkey, authorPubkey: m.authorPubkey, myRole: myRole.value, visibility: visibility.value });

// Coming back from a thread: return to where the reader was (captured on the
// way in), unless this arrival is a deep reveal — that target wins.
const list = ref<InstanceType<typeof MessageList> | null>(null);
const restoreAnchor = takeScroll("channel", props.channelId, { revealing: !!useRoute().query?.m });

/** Pull-to-refresh: the conversation query's own refetch; a failed fetch reports as a failed refresh. */
async function refreshConversation() {
  const result = await refetch();
  if (result.isError) throw result.error ?? new Error("refresh failed");
}

function openThread(rootId: string) {
  rememberScroll("channel", channelId.value, list.value?.captureScrollAnchor?.() ?? null);
  void router.push({ name: "mobile-thread", params: { channelId: channelId.value, rootId } });
}

// Phase G — the channel's one pinned message: the same model and rules as desktop.
const pin = useConversationPin({
  conversationId: () => channelId.value,
  kind: () => "channel",
  myPubkey: () => session.pubkey,
  roleOf: (pubkey) => members.value?.find((m) => m.pubkey === pubkey)?.role ?? null,
  rolesReady: () => rosterReady.value,
  messages: () => messages.value,
  isDeleted: (id) => overlays.value.deletes.has(id),
});
const { view: pinnedView, canUnpinActive, busy: pinBusy } = pin;
const pinFlow = usePinFlow(pin);
const { confirmingReplace } = pinFlow;
const { openMessageTarget } = useOpenMessageTarget();
function openPinnedMessage() {
  const view = pinnedView.value;
  if (!view?.message) return;
  const target = normalizeMessageTarget({
    kind: "channel",
    conversationId: channelId.value,
    messageId: view.message.id,
    threadRootId: view.threadRootId,
    source: "other",
  });
  if (!target) return;
  // A thread target leaves this page: remember where the reader was, as openThread does.
  if (target.threadRootId) rememberScroll("channel", channelId.value, list.value?.captureScrollAnchor?.() ?? null);
  void openMessageTarget(target);
}

const actions = useMobileMessageActions({
  abilities: (m) => ({
    reply: m.status === "sent",
    react: m.status === "sent",
    edit: m.status === "sent" && canEdit(m),
    deleteMode: m.status === "sent" ? deleteMode(m) : null,
    report: m.status === "sent" && m.authorPubkey !== session.pubkey,
    pin: pin.canPin(m),
    unpin: pin.isPinned(m.id) && canUnpinActive.value,
  }),
  pin: (m) => pinFlow.requestPin(m),
  unpin: () => void pinFlow.requestUnpin(),
  reactionsFor: (id) => reactionsByMessage.value?.get(id),
  react: (targetEventId, emoji) => react({ targetEventId, emoji }),
  unreact: (targetEventId, emoji, reactionEventId) => unreact({ targetEventId, emoji, reactionEventId }),
  openThread,
  edit: (m, content) =>
    editMessage({
      channelId: channelId.value,
      targetEventId: m.id,
      content,
      authorPubkey: m.authorPubkey,
      mentionsEveryone: !!m.mentionsEveryone && draftMentionsEveryone(content),
    }),
  remove: async (m) => {
    const mode = deleteMode(m);
    if (!mode || !session.pubkey) return;
    await deleteMessage({ channelId: channelId.value, targetEventId: m.id, mode, myPubkey: session.pubkey });
  },
});

// Deep reveal (`?m=`): MessageList loads older pages until the message is found (bounded), then highlights it.
const reveal = useMobileReveal();

const mentionScope = computed<MentionScope>(() => ({ kind: "channel", channelId: channelId.value }));
const title = computed(() => channel.value?.name ?? "Channel");
const subtitle = computed(() => {
  const n = members.value?.length;
  return n ? `${n} ${n === 1 ? "member" : "members"}` : null;
});

async function sendMessage(
  content: string,
  mentionPubkeys: string[],
  attachments: Attachment[] = [],
  options: { mentionsEveryone: boolean } = { mentionsEveryone: false },
) {
  await send({ content, mentionPubkeys, attachments, mentionsEveryone: options.mentionsEveryone });
}
async function retryMessage(message: Message) {
  await send({
    content: message.content,
    mentionPubkeys: message.mentions,
    attachments: message.attachments,
    mentionsEveryone: !!message.mentionsEveryone,
  });
}
</script>

<template>
  <MobileLayout :back="goBack" :refresh="refreshConversation" refresh-scroller=".message-list">
    <template #header>
      <MobileHeader :title="title" :subtitle="subtitle" back back-label="Back to channels" @back="goBack">
        <template #title>
          <h1 class="conv-title" data-testid="mobile-title">
            <AppIcon :name="channel?.visibility === 'private' ? 'lock' : 'hash'" :size="16" class="conv-glyph" />
            <span>{{ title }}</span>
          </h1>
        </template>
      </MobileHeader>
    </template>

    <PinnedMessageBar
      v-if="pinnedView"
      :view="pinnedView"
      :can-unpin="canUnpinActive"
      :busy="pinBusy"
      mobile
      @open="openPinnedMessage"
      @unpin="pinFlow.requestUnpin"
      @retry="pin.reload"
    />
    <MobileRevealNotice :status="reveal.status.value" @dismiss="reveal.dismiss" />
    <!-- Initial load only: a message-shaped skeleton instead of a spinner. -->
    <MobileConversationSkeleton v-if="isLoading && !messages?.length" />
    <MessageList
      v-else
      ref="list"
      class="conv-list"
      :messages="topLevel"
      :conversation-id="channelId"
      :restore-anchor="restoreAnchor"
      :highlight-id="reveal.target.value"
      :reactions-by-message="reactionsByMessage"
      :reply-summaries="replySummaries"
      :is-loading="isLoading"
      :is-error="isError"
      :has-older-messages="hasOlderMessages"
      :is-loading-older="isLoadingOlder"
      :older-messages-error="olderMessagesError"
      mobile-actions
      empty-title="Start the conversation"
      :empty-description="`Say hello in #${title}.`"
      @highlight-done="reveal.done"
      @retry="refetch"
      @retry-message="retryMessage"
      @open-thread="openThread"
      @open-profile="ui.openProfile"
      @open-actions="actions.open"
      @load-older="loadOlder"
      @react="({ targetEventId, emoji }) => react({ targetEventId, emoji })"
      @unreact="({ targetEventId, emoji, reactionEventId }) => unreact({ targetEventId, emoji, reactionEventId })"
    />

    <template #footer>
      <p v-if="mutationError" class="mutation-error" role="alert">{{ mutationError }}</p>
      <p v-if="pin.error.value" class="mutation-error" role="alert" data-testid="pin-error">{{ pin.error.value }}</p>
      <TypingIndicator :pubkeys="typingPubkeys" />
      <ChannelAccessBar
        :access="channelAccess"
        :is-joining="isJoining"
        mobile
        @join="join(channelId)"
        @retry="channelRoster.refetch()"
      />
      <MobileEditBar
        v-if="actions.editing.value"
        :key="actions.editing.value.id"
        :original="actions.editing.value.content"
        :saving="actions.savingEdit.value"
        @save="actions.saveEdit"
        @cancel="actions.cancelEdit"
      />
      <MessageComposer
        v-else
        :disabled="isSending || showJoin"
        :error="sendError"
        :mention-scope="mentionScope"
        allow-attachments
        @send="sendMessage"
        @typing="notifyTyping"
      />
    </template>

    <MobileMessageActions
      v-if="actions.target.value"
      :message="actions.target.value"
      :abilities="actions.abilities.value"
      :is-own="actions.isOwn.value"
      :author-name="actions.authorName.value"
      :reactions="reactionsByMessage?.get(actions.target.value.id)"
      @close="actions.close"
      @react="actions.onReact"
      @reply="actions.onReply"
      @edit="actions.onEdit"
      @delete="actions.onDelete"
      @report="actions.onReport"
      @pin="actions.onPin"
      @unpin="actions.onUnpin"
    />
    <PinReplaceDialog v-if="confirmingReplace" mobile @confirm="pinFlow.confirmReplace" @cancel="pinFlow.cancelReplace" />
    <ReportMessageDialog v-if="actions.reporting.value" :message="actions.reporting.value" @close="actions.reporting.value = null" />
  </MobileLayout>
</template>

<style scoped>
.conv-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 700;
  min-width: 0;
}
.conv-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-glyph {
  flex: none;
  color: var(--color-text-subtle);
}
.conv-list {
  flex: 1;
  min-height: 0;
}
.mutation-error {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
</style>
