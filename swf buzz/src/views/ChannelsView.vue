<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import AppShell from "@/layouts/AppShell.vue";
import AppSidebar from "@/layouts/AppSidebar.vue";
import StateView from "@/components/StateView.vue";
import MessageList from "@/components/MessageList.vue";
import MessageComposer from "@/components/MessageComposer.vue";
import ChannelHeader from "@/features/channels/ui/ChannelHeader.vue";
import ChannelMenu from "@/features/channels/ui/ChannelMenu.vue";
import MembersModal from "@/features/channels/ui/MembersModal.vue";
import AddMembersModal from "@/features/channels/ui/AddMembersModal.vue";
import UserProfilePanel from "@/features/channels/ui/UserProfilePanel.vue";
import ChannelDetailsPanel from "@/features/channels/ui/ChannelDetailsPanel.vue";
import ReportMessageDialog from "@/features/moderation/ui/ReportMessageDialog.vue";
import ThreadPanel from "@/components/ThreadPanel.vue";
import TypingIndicator from "@/components/TypingIndicator.vue";
import { useUiStore } from "@/stores/ui";
import { useSessionStore } from "@/stores/session";
import { useChannels } from "@/features/channels/useChannels";
import { historyIsReadable, useChannelAccess } from "@/features/channels/channelAccess";
import { useJoinChannel } from "@/features/channels/useJoinChannel";
import { useChannelMessages } from "@/features/messages/useChannelMessages";
import { useMessageMutations } from "@/features/messages/useMessageMutations";
import { canEditMessage, messageDeleteMode } from "@/features/channels/channelPermissions";
import { useSendMessage } from "@/features/messages/useSendMessage";
import { useChannelReactions } from "@/features/reactions/useChannelReactions";
import { useAddReaction } from "@/features/reactions/useAddReaction";
import { useRemoveReaction } from "@/features/reactions/useRemoveReaction";
import { useReadStateStore } from "@/stores/readState";
import { useThreadIndexStore } from "@/stores/threadIndex";
import { buildThreadSummaries, mergeThreadSummaries } from "@/features/threads/threadSummary";
import { useTypingIndicator } from "@/features/presence/useTypingIndicator";
import type { MentionScope } from "@/features/mentions/useMentionDirectory";
import type { Message } from "@/types/domain";
import { channelAfterCommunitySwitch } from "@/features/communities/switchNavigation";
import type { Attachment } from "@/protocol/imeta";
import PinnedMessageBar from "@/features/pins/ui/PinnedMessageBar.vue";
import ChannelAccessBar from "@/features/channels/ui/ChannelAccessBar.vue";
import PinReplaceDialog from "@/features/pins/ui/PinReplaceDialog.vue";
import { useConversationPin } from "@/features/pins/useConversationPin";
import { usePinFlow } from "@/features/pins/usePinFlow";
import { normalizeMessageTarget } from "@/features/navigation/messageTarget";
import { useOpenMessageTarget } from "@/features/navigation/useOpenMessageTarget";
import { draftMentionsEveryone } from "@/features/mentions/everyone";

const props = defineProps<{ channelId?: string | string[] | null }>();

const ui = useUiStore();
const session = useSessionStore();

// Vue Router reuses this component instance across query-only navigations on
// the `channels` route (e.g. clicking a different channel in the sidebar just
// pushes a new `?channelId=`), so `onMounted` alone would only ever pick up
// the very first channel opened in the session. Watch the prop instead —
// `immediate: true` covers the initial mount, the watcher covers every
// subsequent sidebar click.
watch(
  () => props.channelId,
  (value) => {
    const next = Array.isArray(value) ? value[0] : value;
    if (next && next !== ui.selectedChannelId) ui.selectChannel(next);
  },
  { immediate: true },
);

const selectedChannelId = computed(() => ui.selectedChannelId);
const selectedChannel = computed(
  () => channels.value?.find((c) => c.id === selectedChannelId.value) ?? null,
);

const { data: channels } = useChannels();

const router = useRouter();
const queryClient = useQueryClient();

// After a community switch, open a channel of the NEW community once its list
// has loaded (the list's key follows the community, so `undefined` here means
// B's answer isn't in yet — never A's list). Nothing is chosen for the user if
// they (or a link) already picked a channel meanwhile.
watch(
  [() => ui.channelRestore, channels],
  ([restore, list]) => {
    if (!restore || list === undefined) return;
    ui.clearChannelRestore();
    if (ui.selectedChannelId) return;
    const next = channelAfterCommunitySwitch(list, restore.previousChannelId);
    if (!next) return;
    ui.selectChannel(next);
    void router.replace({ name: "channels", query: { channelId: next } });
  },
  { immediate: true },
);

/**
 * After the relay ACCEPTED a leave (never before): re-read the channel list and
 * roster from the relay — a private channel stops being visible to a
 * non-member, an open one stays listed with the "Join channel" bar — and move
 * to another channel so nothing keeps showing the one just left.
 */
async function onLeftChannel() {
  const leftId = selectedChannelId.value;
  ui.closeContextPanel();
  await queryClient.invalidateQueries({ queryKey: queryKeys.channels() });
  if (leftId) await queryClient.invalidateQueries({ queryKey: queryKeys.members(leftId) });
  const next = channels.value?.find((c) => c.id !== leftId && !c.archived) ?? null;
  ui.selectChannel(next?.id ?? null);
  await router.push(
    next ? { name: "channels", query: { channelId: next.id } } : { name: "channels" },
  );
}

/**
 * Channel access — the ONE source of "am I a member, as what?" for this screen
 * (features/channels/channelAccess.ts). "Not a member" / "Join channel" appear
 * only for an authoritative negative, never while the roster is loading,
 * re-checking or failed; private-channel history the relay served counts.
 */
const {
  access: channelAccess,
  roster: channelRoster,
  myRole: myChannelRole,
  showJoin,
  rosterReady,
} = useChannelAccess({
  channelId: () => selectedChannelId.value,
  me: () => session.pubkey,
  visibility: () => selectedChannel.value?.visibility ?? null,
  historyReadable: () => historyIsReadable(messages.value, messagesError.value),
});
const {
  data: members,
  isLoading: membersLoading,
  isError: membersError,
  refetch: refetchMembers,
} = channelRoster;
const { join, isJoining } = useJoinChannel();

const {
  data: messages,
  isLoading: messagesLoading,
  isError: messagesError,
  refetch: refetchMessages,
  loadOlder,
  hasOlderMessages,
  isLoadingOlder,
  olderMessagesError,
  overlays: messageOverlays,
  absorbTimelineEvents,
} = useChannelMessages(() => selectedChannelId.value);

/**
 * Phase 4B — edit / delete.
 *
 * Permissions are resolved per message rather than once per channel: the
 * delete path differs by who authored the row (self → kind:5, somebody else →
 * kind:9005), so it cannot be a single channel-wide flag.
 */
const {
  editMessage,
  deleteMessage,
  error: messageMutationError,
} = useMessageMutations({
  overlays: () => messageOverlays.value,
  touch: () => absorbTimelineEvents({ messages: [], edits: [], deletes: [] }),
});

function canEditMessageRow(message: Message): boolean {
  return canEditMessage({
    myPubkey: session.pubkey,
    authorPubkey: message.authorPubkey,
    myRole: myChannelRole.value,
    visibility: selectedChannel.value?.visibility ?? "private",
  });
}

function deleteModeForRow(message: Message): "self" | "admin" | null {
  // A system message (relay-authored kind:40099) is nobody's to delete.
  if (message.isSystemMessage) return null;
  return messageDeleteMode({
    myPubkey: session.pubkey,
    authorPubkey: message.authorPubkey,
    myRole: myChannelRole.value,
    visibility: selectedChannel.value?.visibility ?? "private",
  });
}

async function handleEditMessage(payload: { message: Message; content: string }) {
  const channelId = selectedChannelId.value;
  if (!channelId || !session.pubkey) return;
  await editMessage({
    channelId,
    targetEventId: payload.message.id,
    content: payload.content,
    authorPubkey: payload.message.authorPubkey,
    mentionsEveryone: !!payload.message.mentionsEveryone && draftMentionsEveryone(payload.content),
  });
}

/**
 * Phase G — the channel's ONE pinned message. Abilities come from the same
 * model every reader uses to accept pin events (features/pins/pinModel.ts),
 * evaluated against the channel roster's NIP-29 roles.
 */
const pin = useConversationPin({
  conversationId: () => selectedChannelId.value,
  kind: () => "channel",
  myPubkey: () => session.pubkey,
  roleOf: (pubkey) => members.value?.find((m) => m.pubkey === pubkey)?.role ?? null,
  rolesReady: () => rosterReady.value,
  messages: () => messages.value,
  isDeleted: (id) => messageOverlays.value.deletes.has(id),
});
const { view: pinnedView, canUnpinActive, busy: pinBusy } = pin;
const pinFlow = usePinFlow(pin);
const { confirmingReplace } = pinFlow;
function pinStateFor(message: Message) {
  const isPinned = pin.isPinned(message.id);
  return { isPinned, canPin: pin.canPin(message), canUnpin: isPinned && canUnpinActive.value };
}

/** Pinned bar → the exact message, through the one deep-link path (MessageTarget). */
const { openMessageTarget } = useOpenMessageTarget();
function openPinnedMessage() {
  const view = pinnedView.value;
  const channelId = selectedChannelId.value;
  if (!view?.message || !channelId) return;
  const target = normalizeMessageTarget({
    kind: "channel",
    conversationId: channelId,
    messageId: view.message.id,
    threadRootId: view.threadRootId,
    source: "other",
  });
  if (target) void openMessageTarget(target);
}

async function handleDeleteMessage(message: Message) {
  const channelId = selectedChannelId.value;
  const mode = deleteModeForRow(message);
  if (!channelId || !mode || !session.pubkey) return;
  await deleteMessage({
    channelId,
    targetEventId: message.id,
    mode,
    myPubkey: session.pubkey,
  });
}

const { send, isSending, error: sendError } = useSendMessage(() => selectedChannelId.value ?? "");

const { data: reactionsByMessage } = useChannelReactions(() => selectedChannelId.value);
/**
 * The channel feed shows TOP-LEVEL messages only. A reply belongs to its
 * thread; in the feed it is represented by the thread summary row under its
 * parent ("N replies · View thread"). Previously every reply was also rendered
 * here as if it were a new message.
 *
 * A reply whose parent is not in the loaded window is deliberately still
 * hidden rather than promoted to top level — it appears in its thread, and its
 * parent brings its summary row when it loads (see the out-of-order note in
 * docs/PHASE_3_FINAL_IMPLEMENTATION_REPORT.md follow-ups).
 */
const topLevelMessages = computed(() => (messages.value ?? []).filter((m) => !m.thread.rootId));

/**
 * Thread summary rows ("2 replies · Last reply 3m ago") under each parent.
 *
 * Two sources, merged (`threadSummary.ts`): the replies already loaded for this
 * channel — the same cache the thread panel reads, so a new reply updates the
 * row instantly, including one's own optimistic reply — plus the relay's own
 * batched summaries for roots whose replies fall outside the loaded window, so
 * counts are right on first render after a refresh, before any thread is opened.
 */
const localThreadSummaries = computed(() => buildThreadSummaries(messages.value ?? []));
const threadIndex = useThreadIndexStore();
// The relay's counts for this channel, loaded with each history page (stores/threadIndex).
const relayThreadSummaries = computed(() => threadIndex.forChannel(selectedChannelId.value));
const replySummaries = computed(() =>
  mergeThreadSummaries(localThreadSummaries.value, relayThreadSummaries.value),
);
const { react } = useAddReaction();
const { unreact } = useRemoveReaction(() => selectedChannelId.value);

// Phase 3.7 — mark this channel "seen" whenever its messages change while
// it's the open channel (covers initial load, live-appended, and the reader
// simply staying on the channel as messages keep arriving).
const channelReadState = useReadStateStore();
watch(
  () => messages.value,
  (msgs) => {
    const channelId = selectedChannelId.value;
    if (!channelId || !msgs?.length) return;
    const newest = msgs.reduce((max, m) => Math.max(max, m.createdAt), 0);
    channelReadState.markChannelSeen(channelId, newest);
  },
);
const { typingPubkeys, notifyTyping } = useTypingIndicator(() => selectedChannelId.value);

/** Channel members first, then the rest of the community — shared by the feed and thread composers. */
const mentionScope = computed<MentionScope>(() => ({
  kind: "channel",
  channelId: selectedChannelId.value,
}));

async function sendMessage(
  content: string,
  mentionPubkeys: string[],
  attachments: Attachment[] = [],
  options: { mentionsEveryone: boolean } = { mentionsEveryone: false },
) {
  await send({ content, mentionPubkeys, attachments, mentionsEveryone: options.mentionsEveryone });
}

async function retryMessage(message: Message) {
  // A retry re-sends exactly what failed — its mentions and (already
  // uploaded) attachments included, as the DM retry already did. For a failed
  // optimistic message `mentions` is precisely the picked mention pubkeys.
  await send({
    content: message.content,
    mentionPubkeys: message.mentions,
    attachments: message.attachments,
    mentionsEveryone: !!message.mentionsEveryone,
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
// "View members" and "Add members" are two different screens: the first lists
// who is in the channel, the second lists who in the COMMUNITY is not. They
// used to share one modal, which is why the picker could only ever show
// existing channel members (docs/PRIVATE_CHANNEL_MEMBER_PICKER_AUDIT.md §1).
const showAddMembersModal = ref(false);
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
function openAddMembersFromMenu() {
  showChannelMenu.value = false;
  showAddMembersModal.value = true;
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
        <ChannelAccessBar
          :access="channelAccess"
          :is-joining="isJoining"
          @join="join(selectedChannelId!)"
          @retry="refetchMembers"
        />

        <PinnedMessageBar
          v-if="pinnedView"
          :view="pinnedView"
          :can-unpin="canUnpinActive"
          :busy="pinBusy"
          @open="openPinnedMessage"
          @unpin="pinFlow.requestUnpin"
          @retry="pin.reload"
        />

        <MessageList
          :messages="topLevelMessages"
          :conversation-id="selectedChannelId"
          :highlight-id="revealId"
          :reactions-by-message="reactionsByMessage"
          :reply-summaries="replySummaries"
          :open-thread-root-id="ui.openThreadRootId"
          :is-loading="messagesLoading"
          :is-error="messagesError"
          :has-older-messages="hasOlderMessages"
          :is-loading-older="isLoadingOlder"
          :older-messages-error="olderMessagesError"
          :can-edit-message="canEditMessageRow"
          :delete-mode-for="deleteModeForRow"
          :pin-state-for="pinStateFor"
          @highlight-done="onRevealed"
          @retry="refetchMessages"
          @retry-message="retryMessage"
          @open-thread="ui.openThread"
          @open-profile="ui.openProfile"
          @load-older="loadOlder"
          @react="({ targetEventId, emoji }) => react({ targetEventId, emoji })"
          @unreact="
            ({ targetEventId, emoji, reactionEventId }) =>
              unreact({ targetEventId, emoji, reactionEventId })
          "
          @report="(message) => (reportTarget = message)"
          @edit="handleEditMessage"
          @delete="handleDeleteMessage"
          @pin="pinFlow.requestPin"
          @unpin="pinFlow.requestUnpin"
        />

        <!-- The relay's own refusal reason, verbatim: a generic failure message
             turned a precise server error into a guessing game twice before. -->
        <p v-if="messageMutationError" class="message-mutation-error" role="alert">
          {{ messageMutationError }}
        </p>
        <p v-if="pin.error.value" class="message-mutation-error" role="alert" data-testid="pin-error">
          {{ pin.error.value }}
        </p>

        <TypingIndicator :pubkeys="typingPubkeys" />
        <MessageComposer
          :disabled="isSending || showJoin"
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
        v-if="ui.contextPanel.kind === 'thread' && selectedChannelId"
        :root-event-id="ui.contextPanel.rootEventId"
        :channel-id="selectedChannelId"
        :channel-name="selectedChannel?.name ?? null"
        :mention-scope="mentionScope"
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
        @left="onLeftChannel"
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
  <AddMembersModal
    v-if="showAddMembersModal && selectedChannelId"
    :channel-id="selectedChannelId"
    :channel-name="selectedChannel?.name"
    @close="showAddMembersModal = false"
  />
  <ChannelMenu
    v-if="showChannelMenu && selectedChannel"
    :my-role="myChannelRole"
    :visibility="selectedChannel.visibility"
    @close="showChannelMenu = false"
    @view-members="openMembersFromMenu"
    @add-members="openAddMembersFromMenu"
    @channel-details="openChannelDetailsFromMenu"
    @copy-id="copyChannelId"
    @leave-channel="openChannelDetailsFromMenu"
  />
  <ReportMessageDialog v-if="reportTarget" :message="reportTarget" @close="reportTarget = null" />
  <PinReplaceDialog v-if="confirmingReplace" @confirm="pinFlow.confirmReplace" @cancel="pinFlow.cancelReplace" />
</template>

<style scoped>
.message-mutation-error {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}

.channel-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
</style>
