<script setup lang="ts">
import { useUiStore } from "@/stores/ui";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import StateView from "./StateView.vue";
import MessageItem from "./MessageItem.vue";
import MessageComposer from "./MessageComposer.vue";
import AppIcon from "./AppIcon.vue";
import { useThread } from "@/features/threads/useThread";
import { useSendMessage } from "@/features/messages/useSendMessage";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { replyCountLabel } from "@/features/threads/threadSummary";
import { useShortcut } from "@/features/shortcuts/useShortcuts";
import { shortcutHint } from "@/features/shortcuts/shortcutRegistry";
import type { Attachment } from "@/protocol/imeta";
import type { MentionScope } from "@/features/mentions/useMentionDirectory";
import type { Message } from "@/types/domain";
import { useMessageLongPress } from "@/features/mobile/gestures/useMessageLongPress";

const props = defineProps<{
  rootEventId: string;
  channelId: string;
  /** Shown in the header as "Thread · #engineering" when known. */
  channelName?: string | null;
  /**
   * Who the reply box can @mention — the parent view's own scope, so a thread
   * offers exactly what its conversation does. Defaults to the channel's.
   */
  mentionScope?: MentionScope;
  /** Mobile: the page provides its own back header, so the panel's docked/expand header is omitted. */
  hideHeader?: boolean;
  /** Mobile: rows show a "⋯" that emits `open-actions` (the page's action sheet) instead of the hover row. */
  mobileActions?: boolean;
  /**
   * Reveal this message (root or reply) once the thread has loaded: centre it
   * and highlight it briefly, then emit `highlight-done(found)` — the same
   * contract as MessageList. A thread loads whole, so there is nothing to page.
   */
  highlightId?: string | null;
}>();
const replyMentionScope = computed<MentionScope>(
  () => props.mentionScope ?? { kind: "channel", channelId: props.channelId },
);
const ui = useUiStore();
const emit = defineEmits<{ close: []; "open-actions": [message: Message]; "highlight-done": [found: boolean] }>();

const { data, isLoading, isError, refetch } = useThread(() => props.rootEventId);
const { send, isSending, error } = useSendMessage(() => props.channelId);

const root = computed(() => data.value?.root ?? null);
const replies = computed(() => data.value?.replies ?? []);

const panel = ref<HTMLElement | null>(null);
// Touch layouts only: long-press the root or a reply = its "⋯" (the page's action sheet).
useMessageLongPress(panel, {
  enabled: () => !!props.mobileActions,
  onLongPress: (id) => {
    const message = [root.value, ...replies.value].find((m) => m?.id === id);
    if (message && message.status !== "sending") emit("open-actions", message);
  },
});
const HIGHLIGHT_MS = 2000;
let revealed: string | null = null;
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  [() => props.highlightId, () => data.value, isLoading, isError],
  async ([id]) => {
    if (!id || isLoading.value || revealed === id) return;
    if (isError.value) {
      revealed = id;
      return emit("highlight-done", false);
    }
    if (!data.value) return;
    await nextTick();
    const el = panel.value?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    revealed = id; // one reveal per target: never fight the reader's own scrolling
    if (!el) return emit("highlight-done", false);
    el.scrollIntoView?.({ block: "center" });
    el.classList.add("is-highlighted");
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => el.classList.remove("is-highlighted"), HIGHLIGHT_MS);
    emit("highlight-done", true);
  },
  { immediate: true, flush: "post" },
);
onBeforeUnmount(() => clearTimeout(highlightTimer));
const headingText = computed(() =>
  props.channelName ? `Thread · #${props.channelName}` : "Thread",
);

/**
 * Docked ⇄ expanded (docs/THREAD_EXPANDED_VIEW.md). Layout only: the thread,
 * its scroll position and its composer are the same component instance in
 * both modes — nothing is re-fetched or re-mounted.
 */
const expanded = computed(() => ui.threadViewMode === "expanded");
const expandLabel = computed(() => (expanded.value ? "Restore thread" : "Expand thread"));
const expandHint = computed(() => `${expandLabel.value} (${shortcutHint("toggle-thread-expanded")})`);
function toggleExpanded() {
  ui.toggleThreadExpanded();
}
useShortcut("toggle-thread-expanded", toggleExpanded);

// Escape steps back one level: expanded → docked, docked → closed.
useEscapeKey(() => (expanded.value ? ui.setThreadViewMode("docked") : emit("close")));

async function sendReply(
  content: string,
  mentionPubkeys: string[],
  attachments: Attachment[] = [],
  options: { mentionsEveryone: boolean } = { mentionsEveryone: false },
) {
  if (!root.value) return;
  await send({
    content,
    mentionPubkeys,
    attachments,
    mentionsEveryone: options.mentionsEveryone,
    reply: {
      rootEventId: props.rootEventId,
      parentEventId: props.rootEventId,
      parentAuthorPubkey: root.value.authorPubkey,
    },
  });
}
</script>

<template>
  <div ref="panel" class="thread-panel" :class="{ expanded }">
    <div v-if="!hideHeader" class="thread-header">
      <button
        type="button"
        class="icon-btn expand-btn"
        :aria-label="expandLabel"
        :title="expandHint"
        data-testid="thread-expand"
        @click="toggleExpanded"
      >
        <AppIcon :name="expanded ? 'minimize' : 'maximize'" :size="16" />
      </button>
      <h2 data-testid="thread-heading">{{ headingText }}</h2>
      <button type="button" class="icon-btn" aria-label="Close thread" title="Close thread" data-testid="thread-close" @click="emit('close')">
        <AppIcon name="close" :size="16" />
      </button>
    </div>

    <StateView v-if="isLoading" kind="loading" />
    <StateView v-else-if="isError" kind="error" title="Couldn't load thread" @retry="refetch" />
    <template v-else>
      <div class="thread-body">
        <!-- The parent stays pinned at the top, visually distinct from its replies. -->
        <div v-if="root" class="thread-root" data-testid="thread-root">
          <MessageItem
            :message="root"
            :mobile-actions="mobileActions"
            @open-profile="ui.openProfile"
            @open-actions="emit('open-actions', root)"
          />
        </div>
        <div v-if="replies.length" class="replies-divider" data-testid="thread-replies-divider">
          <span>{{ replyCountLabel(replies.length) }}</span>
        </div>
        <div class="replies">
          <MessageItem
            v-for="reply in replies"
            :key="reply.id"
            :message="reply"
            :mobile-actions="mobileActions"
            @open-profile="ui.openProfile"
            @open-actions="emit('open-actions', reply)"
          />
        </div>
        <StateView v-if="!replies.length" kind="empty" title="No replies yet" />
      </div>
      <MessageComposer
        :disabled="isSending"
        :error="error"
        placeholder="Reply in thread…"
        :mention-scope="replyMentionScope"
        allow-attachments
        @send="sendReply"
      />
    </template>
  </div>
</template>

<style scoped>
.thread-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
/* A revealed message (deep link): the same accent tint MessageList uses; background only, so no layout shift. */
.thread-panel :deep(.is-highlighted) {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  box-shadow: inset 3px 0 0 var(--color-primary);
  transition:
    background 600ms ease,
    box-shadow 600ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .thread-panel :deep(.is-highlighted) {
    transition: none;
  }
}

.thread-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 48px;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
.thread-header h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
}

/* Compact icon buttons: 30px target, quiet until hovered, visible focus ring. */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease,
    border-color 120ms ease,
    transform 80ms ease;
}
.icon-btn:hover {
  background: var(--color-surface-muted);
  border-color: var(--color-border);
  color: var(--color-text);
}
.icon-btn:active {
  transform: scale(0.94);
}
.icon-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
.thread-panel.expanded .expand-btn {
  color: var(--color-primary);
}
/* Phones: the thread is already full-screen — nothing to expand. */
@media (max-width: 768px) {
  .expand-btn {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .icon-btn {
    transition: none;
  }
  .icon-btn:active {
    transform: none;
  }
}

.thread-body {
  flex: 1;
  overflow-y: auto;
  padding-top: var(--space-2);
}

/* The pinned parent: same message layout, set apart from the replies below. */
.thread-root {
  background: var(--color-surface-muted);
  border-left: 3px solid var(--color-accent);
}

/* "2 replies ——————" */
.replies-divider {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4) 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 600;
}
.replies-divider::after {
  content: "";
  flex: 1;
  border-bottom: 1px solid var(--color-border);
}

.replies {
  margin-top: var(--space-2);
}
</style>
