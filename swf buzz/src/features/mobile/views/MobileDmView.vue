<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import MobileConversationSkeleton from "../ui/MobileConversationSkeleton.vue";
import { rememberScroll, takeScroll } from "../scrollMemory";
import AppIcon from "@/components/AppIcon.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import MessageList from "@/components/MessageList.vue";
import MessageComposer from "@/components/MessageComposer.vue";
import TypingIndicator from "@/components/TypingIndicator.vue";
import MobileLayout from "../ui/MobileLayout.vue";
import MobileHeader from "../ui/MobileHeader.vue";
import MobileSheet from "../ui/MobileSheet.vue";
import MobileMessageActions from "../ui/MobileMessageActions.vue";
import { useMobileNav } from "../mobileNav";
import { useMobileMessageActions } from "../useMobileMessageActions";
import { useMobileReveal } from "../useMobileReveal";
import MobileRevealNotice from "../ui/MobileRevealNotice.vue";
import { useUiStore } from "@/stores/ui";
import { useSessionStore } from "@/stores/session";
import { useReadStateStore } from "@/stores/readState";
import { useThreadIndexStore } from "@/stores/threadIndex";
import { useDmList } from "@/features/dm/useDmList";
import { useDmMessages } from "@/features/dm/useDmMessages";
import { useSendDm } from "@/features/dm/useSendDm";
import { useHideDm } from "@/features/dm/useHideDm";
import { useChannelReactions } from "@/features/reactions/useChannelReactions";
import { useAddReaction } from "@/features/reactions/useAddReaction";
import { useRemoveReaction } from "@/features/reactions/useRemoveReaction";
import { buildThreadSummaries, mergeThreadSummaries } from "@/features/threads/threadSummary";
import { useTypingIndicator } from "@/features/presence/useTypingIndicator";
import { usePresenceOf } from "@/features/presence/presenceSync";
import { useProfile } from "@/composables/useProfile";
import { useReportActiveConversation } from "@/features/notifications/useNotificationService";
import { shortKey } from "@/features/identity/format";
import type { MentionScope } from "@/features/mentions/useMentionDirectory";
import type { Attachment } from "@/protocol/imeta";
import type { Message } from "@/types/domain";
import PinnedMessageBar from "@/features/pins/ui/PinnedMessageBar.vue";
import PinReplaceDialog from "@/features/pins/ui/PinReplaceDialog.vue";
import { useConversationPin } from "@/features/pins/useConversationPin";
import { usePinFlow } from "@/features/pins/usePinFlow";
import { normalizeMessageTarget } from "@/features/navigation/messageTarget";
import { useOpenMessageTarget } from "@/features/navigation/useOpenMessageTarget";

/**
 * Mobile DM conversation. The SAME DM implementation as the desktop DmView —
 * the kind:41010 conversation list, `useDmMessages` (kind:9 in the DM's
 * channel), `useSendDm`, reactions, threads, typing, NIP-RS read state — only
 * presented full screen. Message actions match what the desktop DM offers
 * (reply, react, copy): it has no edit/delete/report for DMs, so neither does
 * this — no invented authorization.
 */
const props = defineProps<{ conversationId: string }>();
const router = useRouter();
const ui = useUiStore();
const session = useSessionStore();
const readState = useReadStateStore();
const threadIndex = useThreadIndexStore();
const { goBack } = useMobileNav();

const conversationId = computed(() => props.conversationId);
watch(conversationId, (id) => ui.selectConversation(id), { immediate: true });
useReportActiveConversation(() => conversationId.value);

const { data: conversations } = useDmList();
const participants = computed(() => conversations.value?.find((c) => c.id === conversationId.value)?.dmParticipants ?? []);
const partner = computed(() => participants.value.find((p) => p !== session.pubkey) ?? null);
const { data: partnerProfile } = useProfile(() => partner.value);
const presence = usePresenceOf(() => partner.value);
const partnerName = computed(() => partnerProfile.value?.displayName?.trim() || (partner.value ? shortKey(partner.value) : "Direct message"));
const STATUS = { online: "Online", away: "Away", offline: "Offline" } as const;
const subtitle = computed(() => (partnerProfile.value?.isAgent ? "Agent" : presence.value ? STATUS[presence.value] : null));

const {
  data: messages,
  isLoading,
  isError,
  refetch,
  loadOlder,
  hasOlderMessages,
  isLoadingOlder,
  olderMessagesError,
  overlays: dmOverlays,
} = useDmMessages(() => conversationId.value);
const { send, isSending, error: sendError } = useSendDm(() => conversationId.value);
const { data: reactionsByMessage } = useChannelReactions(() => conversationId.value);
const { react } = useAddReaction();
const { unreact } = useRemoveReaction(() => conversationId.value);
const { typingPubkeys, notifyTyping } = useTypingIndicator(() => conversationId.value);
const replySummaries = computed(() =>
  mergeThreadSummaries(buildThreadSummaries(messages.value ?? []), threadIndex.forChannel(conversationId.value)),
);

// The same NIP-RS frontier as channels (kind:30078, keyed by the DM's id).
watch(
  () => messages.value,
  (msgs) => {
    if (!msgs?.length) return;
    readState.markChannelSeen(conversationId.value, msgs.reduce((max, m) => Math.max(max, m.createdAt), 0));
  },
  { immediate: true },
);

// Back from a DM thread returns to the captured position (a deep reveal wins).
const list = ref<InstanceType<typeof MessageList> | null>(null);
const restoreAnchor = takeScroll("dm", props.conversationId, { revealing: !!useRoute().query?.m });

/** Pull-to-refresh: the conversation query's own refetch; a failed fetch reports as a failed refresh. */
async function refreshConversation() {
  const result = await refetch();
  if (result.isError) throw result.error ?? new Error("refresh failed");
}

function openThread(rootId: string) {
  rememberScroll("dm", conversationId.value, list.value?.captureScrollAnchor?.() ?? null);
  void router.push({ name: "mobile-dm-thread", params: { conversationId: conversationId.value, rootId } });
}

// Phase G — the DM's one pinned message (no roles in a DM: either participant may pin/unpin).
const pin = useConversationPin({
  conversationId: () => conversationId.value,
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
const { openMessageTarget } = useOpenMessageTarget();
function openPinnedMessage() {
  const view = pinnedView.value;
  if (!view?.message) return;
  const target = normalizeMessageTarget({
    kind: "dm",
    conversationId: conversationId.value,
    messageId: view.message.id,
    threadRootId: view.threadRootId,
    source: "other",
  });
  if (!target) return;
  if (target.threadRootId) rememberScroll("dm", conversationId.value, list.value?.captureScrollAnchor?.() ?? null);
  void openMessageTarget(target);
}

const actions = useMobileMessageActions({
  abilities: (m) => ({
    reply: m.status === "sent",
    react: m.status === "sent",
    pin: pin.canPin(m),
    unpin: pin.isPinned(m.id) && canUnpinActive.value,
  }),
  pin: (m) => pinFlow.requestPin(m),
  unpin: () => void pinFlow.requestUnpin(),
  reactionsFor: (id) => reactionsByMessage.value?.get(id),
  react: (targetEventId, emoji) => react({ targetEventId, emoji }),
  unreact: (targetEventId, emoji, reactionEventId) => unreact({ targetEventId, emoji, reactionEventId }),
  openThread,
});

const mentionScope = computed<MentionScope>(() => ({ kind: "dm", channelId: conversationId.value, participants: participants.value }));
// Deep reveal (`?m=`): the existing DM history paging, bounded, via MessageList.
const reveal = useMobileReveal();

async function sendMessage(content: string, mentionPubkeys: string[], attachments: Attachment[] = []) {
  await send(content, mentionPubkeys, attachments);
}
async function retryMessage(message: Message) {
  await send(message.content, message.mentions, message.attachments);
}

// Overflow: the desktop DM's own actions (partner profile, Hide).
const showMenu = ref(false);
const { hide, isHiding } = useHideDm();
function openPartnerProfile() {
  showMenu.value = false;
  if (partner.value) ui.openProfile(partner.value);
}
async function hideConversation() {
  await hide(conversationId.value);
  showMenu.value = false;
  ui.selectConversation(null);
  void router.replace({ name: "mobile-home" });
}
</script>

<template>
  <MobileLayout :back="goBack" :refresh="refreshConversation" refresh-scroller=".message-list">
    <template #header>
      <MobileHeader :title="partnerName" back back-label="Back to Home" @back="goBack">
        <template #title>
          <button type="button" class="dm-id" :aria-label="`${partnerName}, profile`" data-testid="mobile-dm-partner" @click="openPartnerProfile">
            <AvatarCircle
              :name="partnerName"
              :avatar-url="partnerProfile?.avatarUrl"
              :is-agent="partnerProfile?.isAgent"
              :pubkey="partner"
              :size="32"
            />
            <span class="dm-text">
              <span class="dm-name" data-testid="mobile-title">{{ partnerName }}</span>
              <span v-if="subtitle" class="dm-sub" data-testid="mobile-dm-presence">{{ subtitle }}</span>
            </span>
          </button>
        </template>
        <template #actions>
          <button type="button" class="m-icon-btn" aria-label="Conversation options" aria-haspopup="dialog" @click="showMenu = true">
            <AppIcon name="more" :size="20" />
          </button>
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
      :messages="messages ?? []"
      :conversation-id="conversationId"
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
      :empty-description="`Say hello to ${partnerName}.`"
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
      <p v-if="pin.error.value" class="pin-error" role="alert" data-testid="pin-error">{{ pin.error.value }}</p>
      <TypingIndicator :pubkeys="typingPubkeys" />
      <MessageComposer
        :disabled="isSending"
        :error="sendError"
        :mention-scope="mentionScope"
        :placeholder="`Message ${partnerName}…`"
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
      @pin="actions.onPin"
      @unpin="actions.onUnpin"
    />
    <PinReplaceDialog v-if="confirmingReplace" mobile @confirm="pinFlow.confirmReplace" @cancel="pinFlow.cancelReplace" />

    <MobileSheet v-if="showMenu" label="Conversation options" testid="mobile-dm-menu" @close="showMenu = false">
      <button type="button" class="sheet-row" @click="openPartnerProfile">
        <AppIcon name="user" :size="20" class="row-icon" />View profile
      </button>
      <button type="button" class="sheet-row" :disabled="isHiding" data-testid="mobile-dm-hide" @click="hideConversation">
        <AppIcon name="leave" :size="20" class="row-icon" />{{ isHiding ? "Hiding…" : "Hide conversation" }}
      </button>
    </MobileSheet>
  </MobileLayout>
</template>

<style scoped>
.dm-id {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  min-height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dm-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.dm-name {
  font-size: var(--font-size-md);
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-sub {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.conv-list {
  flex: 1;
  min-height: 0;
}
.pin-error {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
</style>
