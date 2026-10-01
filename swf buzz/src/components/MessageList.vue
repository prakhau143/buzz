<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MessageItem from "./MessageItem.vue";
import StateView from "./StateView.vue";
import type { Message, Reaction } from "@/types/domain";
import type { ThreadSummaryView } from "@/features/threads/threadSummary";
import type { ScrollAnchor } from "@/features/messages/scrollAnchor";
import { useMessageLongPress } from "@/features/mobile/gestures/useMessageLongPress";

const props = defineProps<{
  messages: Message[];
  /**
   * The channel/DM being shown. The view reuses this component when switching,
   * so a change here means "a different conversation just opened" — it starts
   * at its latest message instead of inheriting the previous one's scroll.
   */
  conversationId?: string | null;
  /**
   * Reveal this message (from the Inbox's "Open in channel"): scroll it to the
   * centre and highlight it, loading older pages if it isn't loaded yet.
   * `highlight-done` fires once handled (found or given up), so the caller
   * can drop it from the URL.
   */
  highlightId?: string | null;
  reactionsByMessage?: Map<string, Reaction[]>;
  /** rootId → summary, derived from the loaded messages (threadSummary.ts). */
  replySummaries?: Map<string, ThreadSummaryView>;
  /** The thread currently open in the side panel, so its parent can be tinted. */
  openThreadRootId?: string | null;
  isLoading: boolean;
  isError: boolean;
  /** Phase 3.4 pagination — see useChannelMessages.ts. */
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
  olderMessagesError?: boolean;
  /**
   * Phase 4B permission resolvers, passed as functions rather than precomputed
   * maps so a role or channel-visibility change re-evaluates every row without
   * the parent rebuilding a map on each render.
   */
  canEditMessage?: (message: Message) => boolean;
  deleteModeFor?: (message: Message) => "self" | "admin" | null;
  /** Phase G: per-row pin state and abilities (features/pins/useConversationPin.ts). */
  pinStateFor?: (message: Message) => { isPinned: boolean; canPin: boolean; canUnpin: boolean };
  /** Touch layouts: each row shows a "⋯" that emits `open-actions` instead of the hover row. */
  mobileActions?: boolean;
  /** Empty-state wording, when the surface wants its own. */
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Where to put the reader when the feed first appears, instead of the
   * latest message: this message at this distance from the top (as captured by
   * `captureScrollAnchor()` before leaving). Mobile uses it to come back from a
   * thread page; unset (desktop) keeps opening at the bottom.
   */
  restoreAnchor?: ScrollAnchor | null;
}>();

const emit = defineEmits<{
  retry: [];
  "retry-message": [message: Message];
  "open-thread": [rootId: string];
  react: [payload: { targetEventId: string; emoji: string }];
  unreact: [payload: { targetEventId: string; emoji: string; reactionEventId: string }];
  report: [message: Message];
  "load-older": [];
  "open-profile": [pubkey: string];
  "highlight-done": [found: boolean];
  edit: [payload: { message: Message; content: string }];
  delete: [message: Message];
  pin: [message: Message];
  unpin: [message: Message];
  "open-actions": [message: Message];
}>();

/**
 * One clock for the whole feed: relative times ("3m ago", "Last reply 3m ago")
 * keep ticking without every row owning a timer, and a tick only re-renders the
 * rows whose text actually changes.
 */
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => {
  if (clock) clearInterval(clock);
});

const scrollEl = ref<HTMLElement | null>(null);
// Touch layouts only: long-press a row = its "⋯" (the page's action sheet). Desktop never attaches this.
useMessageLongPress(scrollEl, {
  enabled: () => !!props.mobileActions,
  onLongPress: (id) => {
    const message = props.messages?.find((m) => m.id === id);
    if (message && message.status !== "sending") emit("open-actions", message);
  },
});
const contentEl = ref<HTMLElement | null>(null);
const topSentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let previousFirstId: string | null = null;
let previousLastId: string | null = null;
let previousScrollHeight = 0;
let previousScrollTop = 0;

// "↓ New messages" pill (design spec): a reader who has scrolled up to read
// history must never be yanked back to the bottom by an incoming message.
// `isNearBottom` is a plain variable, not a ref — it is written on every scroll
// frame and read only by the handlers below, so it must not re-render the feed.
// It always reflects where the reader was *before* a change landed.
const NEAR_BOTTOM_PX = 100;
let isNearBottom = true;
const showNewMessagesPill = ref(false);

let scrollFrame = 0;
function handleScroll(): void {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const el = scrollEl.value;
    if (!el) return;
    isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    if (isNearBottom) showNewMessagesPill.value = false;
  });
}

/** Instant (never smooth): opening a conversation must land on the latest message, not animate to it. */
function scrollToBottom(): void {
  const el = scrollEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  isNearBottom = true;
  showNewMessagesPill.value = false;
}

function rememberEnds(): void {
  previousFirstId = props.messages[0]?.id ?? null;
  previousLastId = props.messages[props.messages.length - 1]?.id ?? null;
}

/**
 * Opening a conversation: the feed element appears only once messages are
 * rendered (loading/empty states come first), so this runs after the initial
 * list is in the DOM — reading scrollHeight here measures the real history.
 */
watch(
  scrollEl,
  (el) => {
    if (!el) return;
    rememberEnds();
    if (!restoreTo(props.restoreAnchor)) scrollToBottom();
  },
  { flush: "post" },
);

/**
 * Put `anchor` back at its captured distance from the top. Returns false (and
 * the caller opens at the bottom as usual) when that message isn't in the feed
 * any more — deleted, or outside the loaded window.
 */
function restoreTo(anchor: ScrollAnchor | null | undefined): boolean {
  const el = scrollEl.value;
  if (!anchor || !el) return false;
  const target = el.querySelector<HTMLElement>(`[data-message-id="${anchor.id}"]`);
  if (!target) return false;
  const offset = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
  el.scrollTop += offset - anchor.offset;
  isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  return true;
}

/** The first message whose bottom is inside the viewport, and how far it sits from the top. */
function captureScrollAnchor(): ScrollAnchor | null {
  const el = scrollEl.value;
  if (!el) return null;
  const top = el.getBoundingClientRect().top;
  for (const row of el.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const box = row.getBoundingClientRect();
    if (box.bottom > top) return { id: row.dataset.messageId as string, offset: box.top - top, scrollTop: el.scrollTop };
  }
  return null;
}
defineExpose({ captureScrollAnchor });

/**
 * Keep a reader who is at the bottom there while content below them changes
 * height after render (images/attachments loading, markdown, reactions, an
 * edit). Someone reading history is never moved.
 */
watch(contentEl, (el) => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el || typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(() => {
    if (isNearBottom && scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
  });
  resizeObserver.observe(el);
  // The viewport too: the typing strip opening, the composer growing a line or
  // a window resize shrinks it — a reader at the bottom must stay there.
  if (scrollEl.value) resizeObserver.observe(scrollEl.value);
});

/**
 * One handler for every change to the feed, classified by its two ends:
 *  - another conversation → open it at its latest message (the view reuses this
 *    component across channels/DMs, so the old scrollTop must not carry over);
 *  - prepend (older page landed; first id changed, old first still present) →
 *    keep the same content under the viewport;
 *  - append (last id changed) → follow it if the reader was near the bottom or
 *    it is their own message being sent; otherwise show the pill;
 *  - anything else (edit, delete, status change) → leave the position alone.
 */
watch(
  () => [props.conversationId, props.messages] as const,
  async ([conversationId], [previousConversationId]) => {
    const messages = props.messages;
    const firstId = messages[0]?.id ?? null;
    const last = messages[messages.length - 1];
    const switched = conversationId !== previousConversationId;
    const isPrepend =
      !switched &&
      previousFirstId !== null &&
      firstId !== previousFirstId &&
      messages.some((m) => m.id === previousFirstId);
    const isAppend = !switched && !!last && last.id !== previousLastId;
    const wasNearBottom = isNearBottom;
    rememberEnds();

    await nextTick();
    const el = scrollEl.value;
    if (!el) return;
    if (switched) {
      scrollToBottom();
    } else if (isPrepend) {
      // The classic "prepend to a scrolled container" scroll-restoration formula.
      el.scrollTop = el.scrollHeight - previousScrollHeight + previousScrollTop;
    } else if (isAppend) {
      if (wasNearBottom || last.status === "sending") scrollToBottom();
      else showNewMessagesPill.value = true;
    }
  },
);

watch(
  () => props.isLoadingOlder,
  (loading) => {
    if (loading && scrollEl.value) {
      previousScrollHeight = scrollEl.value.scrollHeight;
      previousScrollTop = scrollEl.value.scrollTop;
    }
  },
);

function observeSentinel(): void {
  observer?.disconnect();
  if (!topSentinel.value || !scrollEl.value) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && props.hasOlderMessages && !props.isLoadingOlder) {
        emit("load-older");
      }
    },
    { root: scrollEl.value, threshold: 0 },
  );
  observer.observe(topSentinel.value);
}

const HIGHLIGHT_MS = 2000;
/** Older pages to fetch while looking for a target before giving up. */
const MAX_HIGHLIGHT_PAGES = 10;
let highlightPages = 0;
watch(
  () => props.highlightId,
  () => (highlightPages = 0),
);
watch(
  [() => props.highlightId, () => props.messages, scrollEl, () => props.isLoadingOlder],
  async () => {
    const id = props.highlightId;
    if (!id || props.isLoadingOlder) return;
    // After the open/prepend scroll handlers above (registered earlier) have run.
    await nextTick();
    const el = scrollEl.value?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    if (el) {
      isNearBottom = false; // the reader is now reading history — don't yank them down
      el.scrollIntoView?.({ block: "center" });
      el.classList.add("is-highlighted");
      setTimeout(() => el.classList.remove("is-highlighted"), HIGHLIGHT_MS);
      emit("highlight-done", true);
    } else if (props.messages.length && props.hasOlderMessages && highlightPages < MAX_HIGHLIGHT_PAGES) {
      highlightPages += 1;
      emit("load-older");
    } else if (!props.isLoading && (props.messages.length || !props.hasOlderMessages)) {
      emit("highlight-done", false);
    }
  },
  { flush: "post" },
);

watch([topSentinel, scrollEl], () => observeSentinel());
onBeforeUnmount(() => {
  observer?.disconnect();
  resizeObserver?.disconnect();
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
});
</script>

<template>
  <StateView v-if="isLoading" kind="loading" />
  <StateView
    v-else-if="isError"
    kind="error"
    title="Couldn't load messages"
    description="Something went wrong reaching the server."
    @retry="emit('retry')"
  />
  <StateView
    v-else-if="!messages.length"
    kind="empty"
    :title="emptyTitle ?? 'No messages yet'"
    :description="emptyDescription ?? 'Be the first to say something.'"
  />

  <div v-else class="message-list-wrapper">
    <div
      ref="scrollEl"
      class="message-list"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Channel messages"
      @scroll.passive="handleScroll"
    >
      <div ref="contentEl">
        <div ref="topSentinel" class="top-sentinel" aria-hidden="true" />
        <p v-if="isLoadingOlder" class="pagination-status" role="status">Loading older messages…</p>
        <div v-else-if="olderMessagesError" class="pagination-status pagination-status--error">
          Couldn't load older messages.
          <button type="button" class="pagination-retry" @click="emit('load-older')">Retry</button>
        </div>
        <MessageItem
          v-for="message in messages"
          :key="message.id"
          :message="message"
          :reactions="reactionsByMessage?.get(message.id)"
          :thread-summary="replySummaries?.get(message.id)"
          :now="now"
          :is-thread-open="openThreadRootId === message.id"
          reply-affordance
          :all-messages="messages"
          :can-edit="canEditMessage?.(message)"
          :delete-mode="deleteModeFor?.(message) ?? null"
          :can-pin="pinStateFor?.(message).canPin ?? false"
          :can-unpin="pinStateFor?.(message).canUnpin ?? false"
          :is-pinned="pinStateFor?.(message).isPinned ?? false"
          :mobile-actions="mobileActions"
          @open-actions="emit('open-actions', message)"
          @retry="emit('retry-message', message)"
          @open-thread="(rootId) => emit('open-thread', rootId)"
        @open-profile="(pubkey) => emit('open-profile', pubkey)"
          @react="(emoji) => emit('react', { targetEventId: message.id, emoji })"
          @unreact="
            ({ emoji, reactionEventId }) =>
              emit('unreact', { targetEventId: message.id, emoji, reactionEventId })
          "
          @report="emit('report', message)"
          @edit="(content) => emit('edit', { message, content })"
          @delete="emit('delete', message)"
          @pin="emit('pin', message)"
          @unpin="emit('unpin', message)"
        />
      </div>
    </div>
    <button
      v-if="showNewMessagesPill"
      type="button"
      class="new-messages-pill"
      @click="scrollToBottom"
    >
      ↓ New messages
    </button>
  </div>
</template>

<style scoped>
.message-list-wrapper {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3) 0;
}

.new-messages-pill {
  position: absolute;
  bottom: var(--space-3);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  border: 1px solid var(--color-border);
  background: var(--color-primary);
  color: var(--color-text-on-accent);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  z-index: var(--z-sticky);
  animation: pill-in var(--transition-fast) ease-out;
}
.new-messages-pill:hover {
  filter: brightness(1.05);
}

@keyframes pill-in {
  from {
    opacity: 0;
    transform: translate(-50%, 8px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .new-messages-pill {
    animation: none;
  }
}

.message-list :deep(.is-highlighted) {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  transition: background 600ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .message-list :deep(.is-highlighted) {
    transition: none;
  }
}

.top-sentinel {
  height: 1px;
}

.pagination-status {
  text-align: center;
  padding: var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.pagination-status--error {
  color: var(--color-danger);
}

.pagination-retry {
  margin-left: var(--space-1);
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  text-decoration: underline;
  font: inherit;
}
</style>
