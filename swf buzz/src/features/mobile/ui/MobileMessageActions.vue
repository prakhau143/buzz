<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import MessagePreview, { previewText } from "@/features/mentions/MessagePreview";
import { profileFor } from "@/features/profile/profileStore";
import { haptic } from "@/platform/haptics";
import { shortTime } from "../inboxPresentation";
import MobileSheet from "./MobileSheet.vue";
import type { Message, Reaction } from "@/types/domain";

/**
 * Message actions on touch — a bottom sheet instead of the desktop hover row
 * and "⋮" menu. It offers ONLY what the caller says this viewer may do; the
 * caller derives that from the same rules the desktop uses
 * (`channelPermissions.ts` for edit/delete, report on others' messages only,
 * reply/react where the surface supports them). Nothing here decides
 * authorization itself.
 *
 * Deleting asks for confirmation inside the sheet, naming the author when it
 * is somebody else's message (a moderation act), as the desktop does.
 */
export interface MessageActionAbilities {
  reply?: boolean;
  react?: boolean;
  edit?: boolean;
  /** "self" → kind:5, "admin" → kind:9005, null → no delete. */
  deleteMode?: "self" | "admin" | null;
  report?: boolean;
  /** Phase G — from `features/pins/pinModel.ts`, the same rules as the desktop menu. */
  pin?: boolean;
  /** This message is the active pin and this viewer may remove it. */
  unpin?: boolean;
}

const props = defineProps<{
  message: Message;
  abilities: MessageActionAbilities;
  isOwn: boolean;
  authorName: string;
  reactions?: Reaction[];
}>();
const emit = defineEmits<{
  close: [];
  reply: [];
  react: [emoji: string];
  edit: [];
  delete: [];
  report: [];
  pin: [];
  unpin: [];
}>();

const QUICK_REACTIONS = ["👍", "❤️", "😊", "🎉", "👀"];
const confirmingDelete = ref(false);
const copied = ref(false);
const reactedByMe = (emoji: string) => !!props.reactions?.some((r) => r.emoji === emoji && r.reactedByMe);
const deleteLabel = computed(() =>
  props.abilities.deleteMode === "admin" && !props.isOwn ? "Delete (moderator)" : "Delete message",
);
const preview = computed(() => previewText(props.message.content, 120));
// From the profile registry the list already filled — no per-message fetch.
const avatarUrl = computed(() => profileFor(props.message.authorPubkey)?.avatarUrl);
const attachments = computed(() => props.message.attachments?.length ?? 0);
const inThread = computed(() => !!props.message.thread?.rootId);

function react(emoji: string) {
  haptic("selection");
  emit("react", emoji);
  emit("close");
}

const confirmYes = ref<HTMLButtonElement | null>(null);
/** Destructive step: a distinct confirmation, a warning tick, and focus on the explicit choice. */
async function askDelete() {
  confirmingDelete.value = true;
  haptic("warning");
  await nextTick();
  confirmYes.value?.focus();
}

let closeTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(closeTimer));

async function copy() {
  try {
    await navigator.clipboard.writeText(props.message.content);
    copied.value = true;
    closeTimer = setTimeout(() => emit("close"), 500);
  } catch {
    emit("close");
  }
}
</script>

<template>
  <MobileSheet label="Message actions" testid="message-action-sheet" @close="emit('close')">
    <div class="context" data-testid="sheet-message-context">
      <AvatarCircle :name="authorName" :avatar-url="avatarUrl" :pubkey="message.authorPubkey" :size="36" />
      <div class="context-text">
        <p class="context-head">
          <span class="who">{{ authorName }}</span>
          <span class="when">{{ shortTime(message.createdAt) }}</span>
        </p>
        <p class="what">
          <MessagePreview
            v-if="preview"
            raw
            :content="preview"
            :mentions="message.mentions"
            :mentions-everyone="!!message.mentionsEveryone"
          /><template v-else>{{ attachments ? "Attachment" : "Message" }}</template>
        </p>
        <p v-if="attachments || inThread" class="cues">
          <span v-if="attachments" class="cue"><AppIcon name="paperclip" :size="16" />{{ attachments === 1 ? "1 attachment" : `${attachments} attachments` }}</span>
          <span v-if="inThread" class="cue"><AppIcon name="reply" :size="16" />In a thread</span>
        </p>
      </div>
    </div>

    <template v-if="!confirmingDelete">
      <div v-if="abilities.react" class="reactions" role="group" aria-label="React">
        <button
          v-for="emoji in QUICK_REACTIONS"
          :key="emoji"
          type="button"
          class="react"
          :class="{ mine: reactedByMe(emoji) }"
          :aria-pressed="reactedByMe(emoji)"
          :aria-label="reactedByMe(emoji) ? `Remove ${emoji} reaction` : `React with ${emoji}`"
          data-testid="action-react"
          @click="react(emoji)"
        >
          {{ emoji }}
        </button>
      </div>

      <button v-if="abilities.reply" type="button" class="sheet-row" data-testid="action-reply" @click="emit('reply'), emit('close')">
        <AppIcon name="reply" :size="20" class="row-icon" />Reply in thread
      </button>
      <button v-if="abilities.unpin" type="button" class="sheet-row" data-testid="action-unpin" @click="emit('unpin'), emit('close')">
        <AppIcon name="pin-off" :size="20" class="row-icon" />Unpin message
      </button>
      <button v-else-if="abilities.pin" type="button" class="sheet-row" data-testid="action-pin" @click="emit('pin'), emit('close')">
        <AppIcon name="pin" :size="20" class="row-icon" />Pin message
      </button>
      <button type="button" class="sheet-row" data-testid="action-copy" @click="copy">
        <AppIcon :name="copied ? 'check' : 'copy'" :size="20" class="row-icon" />{{ copied ? "Copied" : "Copy text" }}
      </button>
      <button v-if="abilities.edit" type="button" class="sheet-row" data-testid="action-edit" @click="emit('edit'), emit('close')">
        <AppIcon name="edit" :size="20" class="row-icon" />Edit message
      </button>
      <template v-if="abilities.deleteMode || abilities.report">
        <div class="sheet-divider" />
        <button
          v-if="abilities.deleteMode"
          type="button"
          class="sheet-row danger"
          data-testid="action-delete"
          @click="askDelete"
        >
          <AppIcon name="trash" :size="20" class="row-icon" />{{ deleteLabel }}
        </button>
        <button v-if="abilities.report" type="button" class="sheet-row danger" data-testid="action-report" @click="emit('report'), emit('close')">
          <AppIcon name="warning" :size="20" class="row-icon" />Report message
        </button>
      </template>
    </template>

    <div v-else class="confirm" role="alertdialog" aria-labelledby="m-del-title" data-testid="action-delete-confirm">
      <p id="m-del-title" class="confirm-title">{{ isOwn ? "Delete your message?" : `Delete ${authorName}'s message?` }}</p>
      <p class="confirm-body">
        {{
          isOwn
            ? "This removes it for everyone. It can't be undone."
            : `This removes ${authorName}'s message for everyone and is recorded in the moderation audit log. It can't be undone.`
        }}
      </p>
      <button ref="confirmYes" type="button" class="confirm-btn danger" data-testid="action-delete-confirm-yes" @click="emit('delete'), emit('close')">
        Delete
      </button>
      <button type="button" class="confirm-btn" @click="confirmingDelete = false">Cancel</button>
    </div>
  </MobileSheet>
</template>

<style scoped>
.context {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin: 0 var(--space-2) var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-3);
  border-radius: 14px;
  background: var(--color-surface-muted);
  min-width: 0;
}
.context-text {
  flex: 1;
  min-width: 0;
}
.context-text p {
  margin: 0;
}
.context-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--color-text);
}
.when {
  flex: none;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.what {
  margin-top: 2px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.cues {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-1) !important;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.cue {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.reactions {
  display: flex;
  justify-content: space-between;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2) var(--space-2);
}
.react {
  flex: 1;
  min-width: 44px;
  height: 48px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  font-size: 22px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.react.mine {
  border-color: var(--color-mention-border-hover);
  background: var(--color-mention-bg);
}
.react:active {
  transform: scale(0.96);
}
.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2) var(--space-1);
}
.confirm-title {
  margin: 0;
  font-weight: 700;
}
.confirm-body {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.confirm-btn {
  min-height: 48px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-weight: 600;
}
.confirm-btn.danger {
  border-color: var(--color-danger);
  background: var(--color-danger);
  color: var(--color-on-primary);
}
@media (prefers-reduced-motion: reduce) {
  .react:active {
    transform: none;
  }
}
</style>
