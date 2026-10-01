<script setup lang="ts">
import { computed, ref } from "vue";
import { parseWaveMessageContent } from "@/features/dm/wave";
import AvatarCircle from "./AvatarCircle.vue";
import AppIcon from "./AppIcon.vue";
import ReactionBar from "./ReactionBar.vue";
import MessageMenu from "./MessageMenu.vue";
import ThreadSummaryRow from "./ThreadSummaryRow.vue";
import MessageAttachments from "./MessageAttachments.vue";
import MessageContent from "@/features/mentions/MessageContent";
import { reactionToggle } from "@/features/reactions/reactionToggle";
import { contentWithoutAttachmentRefs } from "@/protocol/imeta";
import type { ThreadSummaryView } from "@/features/threads/threadSummary";
import { useProfile } from "@/composables/useProfile";
import { useSessionStore } from "@/stores/session";
import { useReadStateStore } from "@/stores/readState";
import { nip19 } from "nostr-tools";
import { config } from "@/app/config";
import type { Message, Reaction } from "@/types/domain";

const props = defineProps<{
  message: Message;
  reactions?: Reaction[];
  /** Replies to this message, if any — rendered as the thread summary row. */
  threadSummary?: ThreadSummaryView;
  /** Shared ticking clock (ms) so "Last reply 3m ago" stays current. */
  now?: number;
  /** This message's thread is the one open in the panel — tint it so the pairing is obvious. */
  isThreadOpen?: boolean;
  /** Main feed only: offer "Reply in thread" on a message with no replies yet (on hover/focus). */
  replyAffordance?: boolean;
  /** Every currently-loaded message in this channel — needed to compute the
   * unread count when "Mark unread" rewinds the watermark to this message. */
  allMessages?: Message[];
  /** Phase 4B: whether THIS viewer may edit / delete THIS message, resolved by
   *  `channelPermissions.ts` against the relay's own rules. */
  canEdit?: boolean;
  deleteMode?: "self" | "admin" | null;
  /** Phase G: this viewer may pin / unpin THIS message (features/pins/pinModel.ts). */
  canPin?: boolean;
  canUnpin?: boolean;
  /** This message is its conversation's active pin. */
  isPinned?: boolean;
  /**
   * Touch layouts: no hover row — an always-visible "⋯" opens the caller's
   * action sheet instead (emits `open-actions`). Off on desktop.
   */
  mobileActions?: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  "open-thread": [rootId: string];
  react: [emoji: string];
  unreact: [payload: { emoji: string; reactionEventId: string }];
  report: [];
  edit: [content: string];
  delete: [];
  pin: [];
  unpin: [];
  /** Avatar or name clicked — always the author's pubkey, never their display name. */
  "open-profile": [pubkey: string];
  /** `mobileActions` only: the "⋯" was tapped. */
  "open-actions": [];
}>();

/** OLD BUZZ wave (kind:9 with the wave marker) — rendered as a card, not raw text. */
const wave = computed(() => parseWaveMessageContent(props.message.content));

/**
 * The text to show, minus the markdown references that duplicate attachments we
 * render as real UI. An attachment-only message has no text left, which is why
 * the paragraph is `v-else-if` rather than always rendered.
 */
const displayContent = computed(() =>
  contentWithoutAttachmentRefs(props.message.content, props.message.attachments ?? []),
);

/** Inline edit state — the composer-style editor replaces the content in place. */
const isEditingInline = ref(false);
const editDraft = ref("");
const showDeleteConfirm = ref(false);

function beginEdit() {
  editDraft.value = props.message.content;
  isEditingInline.value = true;
}

function commitEdit() {
  const next = editDraft.value.trim();
  // An unchanged or emptied edit is a no-op, not a publish: the relay would
  // reject an empty edit anyway, and republishing identical text just adds a
  // pointless "(edited)" marker for everyone.
  if (next && next !== props.message.content) emit("edit", next);
  isEditingInline.value = false;
}

function cancelEdit() {
  isEditingInline.value = false;
  editDraft.value = "";
}

function confirmDelete() {
  showDeleteConfirm.value = false;
  emit("delete");
}

const session = useSessionStore();
const isOwnMessage = computed(() => session.pubkey === props.message.authorPubkey);

/** Toggle: reacting again on a reaction I already made retracts it instead (kind:5). */
function toggleReaction(emoji: string) {
  const action = reactionToggle(props.reactions, emoji, session.pubkey);
  if (action.kind === "unreact") emit("unreact", { emoji, reactionEventId: action.reactionEventId });
  else emit("react", emoji);
}

const { data: profile } = useProfile(() => props.message.authorPubkey);

const displayName = computed(
  () => profile.value?.displayName ?? props.message.authorPubkey.slice(0, 8),
);

/**
 * Relative for recent messages, matching the design spec; a native `title`
 * (shown on hover, standard browser tooltip) carries the absolute time —
 * simplest accessible way to do "absolute on hover" without a bespoke
 * tooltip component. Not a ticking clock: doesn't re-render as time passes
 * without the row re-rendering for another reason (new sibling message,
 * reaction, etc.) — an accepted simplification, not a hidden bug.
 */
const timeLabel = computed(() => {
  const diffMs = Date.now() - props.message.createdAt * 1000;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(props.message.createdAt * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
});
const absoluteTimeLabel = computed(() =>
  new Date(props.message.createdAt * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }),
);

const QUICK_REACTIONS = ["👍", "❤️", "😊"];

async function copyLinkQuick() {
  const nevent = nip19.neventEncode({
    id: props.message.id,
    author: props.message.authorPubkey,
    relays: [config.relayUrl],
  });
  await navigator.clipboard.writeText(`nostr:${nevent}`);
}

/**
 * The "⋮" menu. Its placement is PositionedContextMenu's job (teleported,
 * flips above the trigger near the composer, clamped to the viewport); here we
 * only hold the trigger element it anchors to and returns focus to.
 */
const showMenu = ref(false);
const menuTrigger = ref<HTMLElement | null>(null);
function toggleMenu() {
  showMenu.value = !showMenu.value;
}

const readState = useReadStateStore();
function markUnread() {
  const channelId = props.message.channelId;
  if (!channelId) return;
  const count =
    props.allMessages?.filter((m) => m.createdAt >= props.message.createdAt).length ?? 1;
  readState.markUnreadFrom(channelId, props.message.createdAt, count);
}
</script>

<template>
  <div v-if="message.isSystemMessage" class="system-message" :data-message-id="message.id">
    <span>{{ message.content }}</span>
  </div>

  <div
    v-else
    class="message"
    :data-message-id="message.id"
    :class="{
      failed: message.status === 'failed',
      sending: message.status === 'sending',
      agent: profile?.isAgent,
      'thread-open': isThreadOpen,
    }"
  >
    <button
      type="button"
      class="author-avatar"
      :aria-label="`Open ${displayName}'s profile`"
      data-testid="message-author-avatar"
      @click="emit('open-profile', message.authorPubkey)"
    >
      <AvatarCircle
        :name="displayName"
        :avatar-url="profile?.avatarUrl"
        :is-agent="profile?.isAgent"
        :pubkey="message.isSystemMessage ? null : message.authorPubkey"
        :size="32"
      />
    </button>
    <div class="message-body">
      <div class="message-header">
        <button
          type="button"
          class="author"
          data-testid="message-author-name"
          @click="emit('open-profile', message.authorPubkey)"
        >
          {{ displayName }}
        </button>
        <span v-if="profile?.isAgent" class="agent-badge">Agent</span>
        <span class="time" :title="absoluteTimeLabel">{{ timeLabel }}</span>
        <span v-if="isPinned" class="pinned-marker" data-testid="message-pinned-marker"
          ><AppIcon name="pin" :size="16" />Pinned</span
        >
        <span v-if="message.status === 'sending'" class="status">Sending…</span>
        <button
          v-if="mobileActions && message.status !== 'sending'"
          type="button"
          class="mobile-more"
          :aria-label="`Message actions, ${displayName}`"
          aria-haspopup="dialog"
          data-testid="message-mobile-actions"
          @click.stop="emit('open-actions')"
        >
          <AppIcon name="more" :size="16" />
        </button>
      </div>
      <form v-if="isEditingInline" class="edit-form" @submit.prevent="commitEdit">
        <label class="sr-only" :for="`edit-${message.id}`">Edit message</label>
        <textarea
          :id="`edit-${message.id}`"
          v-model="editDraft"
          class="edit-input"
          rows="2"
          data-testid="message-edit-input"
          @keydown.enter.exact.prevent="commitEdit"
          @keydown.escape.prevent="cancelEdit"
        />
        <div class="edit-actions">
          <button type="submit" class="edit-save" data-testid="message-edit-save">Save</button>
          <button type="button" class="edit-cancel" @click="cancelEdit">Cancel</button>
          <span class="edit-hint">Enter to save · Esc to cancel</span>
        </div>
      </form>
      <div v-else-if="wave" class="wave-card" data-testid="message-wave">
        <span class="wave-icon" aria-hidden="true">👋</span>
        <span class="wave-text">{{ wave.text }}</span>
      </div>
      <p v-else-if="displayContent" class="content">
        <MessageContent :content="displayContent" :mentions="message.mentions" :mentions-everyone="!!message.mentionsEveryone" />
        <span
          v-if="message.editedAt"
          class="edited-marker"
          :title="`Edited ${new Date(message.editedAt * 1000).toLocaleString()}`"
          data-testid="message-edited"
          >(edited)</span
        >
      </p>

      <MessageAttachments
        v-if="message.attachments?.length"
        :attachments="message.attachments"
      />

      <ReactionBar
        v-if="reactions?.length"
        :reactions="reactions"
        @toggle="toggleReaction"
      />

      <ThreadSummaryRow
        v-if="threadSummary && threadSummary.count > 0"
        :summary="threadSummary"
        :now="now ?? Date.now()"
        :is-open="isThreadOpen"
        @open="emit('open-thread', message.thread.rootId ?? message.id)"
      />
      <button
        v-else-if="replyAffordance && !mobileActions && !message.thread.rootId && message.status !== 'sending'"
        type="button"
        class="reply-in-thread"
        data-testid="reply-in-thread"
        @click.stop="emit('open-thread', message.id)"
      >
        <AppIcon name="reply" :size="16" />Reply in thread
      </button>

      <div v-if="!mobileActions" class="message-actions">
        <button
          v-for="emoji in QUICK_REACTIONS"
          :key="emoji"
          type="button"
          class="action-button"
          :aria-label="`React with ${emoji}`"
          @click="toggleReaction(emoji)"
        >
          {{ emoji }}
        </button>
        <button
          type="button"
          class="action-button"
          aria-label="Reply in thread"
          title="Reply in thread"
          @click="emit('open-thread', message.thread.rootId ?? message.id)"
        >
          <AppIcon name="reply" :size="16" />
        </button>
        <button
          type="button"
          class="action-button"
          aria-label="Copy link to message"
          title="Copy link"
          @click="copyLinkQuick"
        >
          <AppIcon name="link" :size="16" />
        </button>
        <button
          ref="menuTrigger"
          type="button"
          class="action-button"
          :class="{ active: showMenu }"
          aria-label="More actions"
          title="More actions"
          aria-haspopup="menu"
          :aria-expanded="showMenu"
          data-testid="message-more-actions"
          @click="toggleMenu"
        >
          <AppIcon name="more" :size="16" />
        </button>
      </div>

      <p v-if="message.status === 'failed'" class="failed-row">
        Message failed to send.
        <button type="button" class="retry-link" @click="emit('retry')">Retry</button>
      </p>
    </div>

    <MessageMenu
      v-if="showMenu"
      :anchor="menuTrigger"
      :message-content="message.content"
      :message-event-id="message.id"
      :author-pubkey="message.authorPubkey"
      :is-own-message="isOwnMessage"
      :can-edit="canEdit"
      :delete-mode="deleteMode"
      :can-reply="!!replyAffordance && message.status === 'sent'"
      :can-pin="canPin"
      :can-unpin="isPinned && canUnpin"
      @reply="emit('open-thread', message.thread.rootId ?? message.id)"
      @pin="emit('pin')"
      @unpin="emit('unpin')"
      @mark-unread="markUnread"
      @report="emit('report')"
      @edit="beginEdit"
      @delete="showDeleteConfirm = true"
      @close="showMenu = false"
    />

    <!-- Destructive confirmation names the person, per the design spec: deleting
         somebody else's message is a moderation act and must not be a one-click
         slip. -->
    <div v-if="showDeleteConfirm" class="confirm-overlay" @click.self="showDeleteConfirm = false">
      <div class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="del-title">
        <h3 id="del-title" class="confirm-title">
          {{ isOwnMessage ? "Delete your message?" : `Delete ${displayName}'s message?` }}
        </h3>
        <p class="confirm-body">
          {{
            isOwnMessage
              ? "This removes it for everyone in the channel. It can't be undone."
              : `This removes ${displayName}'s message for everyone in the channel, and is recorded in the moderation audit log. It can't be undone.`
          }}
        </p>
        <div class="confirm-actions">
          <button type="button" class="edit-cancel" @click="showDeleteConfirm = false">Cancel</button>
          <button
            type="button"
            class="confirm-delete"
            data-testid="message-delete-confirm"
            @click="confirmDelete"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.edited-marker {
  margin-left: var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.edit-input {
  width: 100%;
  resize: vertical;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}
.edit-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.edit-save,
.edit-cancel,
.confirm-delete {
  height: 28px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.edit-save {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-on-primary);
}
.confirm-delete {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: var(--color-on-primary);
}
.edit-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
}
.confirm-card {
  width: 380px;
  max-width: calc(100vw - var(--space-4) * 2);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
}
.confirm-title {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--color-text);
}
.confirm-body {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.system-message {
  text-align: center;
  color: var(--color-text-subtle);
  font-size: var(--font-size-xs);
  padding: var(--space-1) 0;
}

.message {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
}
.message:hover {
  background: var(--color-surface-muted);
}
.message.failed .content {
  opacity: 0.6;
}

.message-body {
  min-width: 0;
  flex: 1;
}

.message-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.author {
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  /* A button (opens the profile) that looks like the name. */
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
  cursor: pointer;
}
.author:hover {
  text-decoration: underline;
}
.author-avatar {
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  border-radius: var(--radius-full);
  transition: opacity var(--transition-fast, 150ms);
}
.author-avatar:hover {
  opacity: 0.85;
}
.author:focus-visible,
.author-avatar:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.wave-card {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
  font-size: var(--font-size-sm);
  color: var(--color-text);
}
.wave-icon {
  font-size: 1.25rem;
}

.agent-badge {
  font-size: var(--font-size-xs);
  color: var(--color-agent);
  background: var(--color-agent-muted);
  border-radius: var(--radius-full);
  padding: 0 var(--space-2);
}

.time {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

/* Touch: a quiet glyph with a full 44px hit area (the negative margin keeps
   the header row its normal height). */
.mobile-more {
  margin: -12px -12px -12px auto;
  width: 44px;
  height: 44px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-subtle);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.mobile-more:active {
  background: var(--color-surface-muted);
}
.mobile-more:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -4px;
}

.status {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  font-style: italic;
}

.content {
  margin: 2px 0 0;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
}

/* The parent whose thread is open in the panel, so the pairing is obvious. */
.message.thread-open {
  background: var(--color-surface-muted);
  box-shadow: inset 3px 0 0 var(--color-accent);
}

.message-actions {
  display: flex;
  gap: var(--space-1);
  margin-top: var(--space-1);
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.message:hover .message-actions,
.message:focus-within .message-actions,
.message-actions:has(.action-button.active) {
  opacity: 1;
}
.action-button.active {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.pinned-marker {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--font-size-xs);
  color: var(--color-pin-icon);
  font-weight: 500;
}
.pinned-marker :deep(svg) {
  width: 12px;
  height: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .message-actions {
    transition: none;
  }
}

.action-button {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  height: 22px;
  min-width: 22px;
  padding: 0 var(--space-2);
  font-size: var(--font-size-xs);
  cursor: pointer;
  color: var(--color-text-muted);
}
.action-button:hover {
  background: var(--color-surface-hover);
}
.action-button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.failed-row {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}

.retry-link {
  border: none;
  background: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0;
  font-size: inherit;
  text-decoration: underline;
}
/* Subtle: only on hover / keyboard focus of the message, so a long feed isn't
   one extra line per message. Messages WITH replies show their summary row. */
.reply-in-thread {
  display: none;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  padding: 2px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-subtle);
  font: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.message:hover .reply-in-thread,
.message:focus-within .reply-in-thread {
  display: inline-flex;
}
.reply-in-thread:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.reply-in-thread:focus-visible {
  display: inline-flex;
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
</style>
