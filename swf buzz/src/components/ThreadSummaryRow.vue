<script setup lang="ts">
import { computed } from "vue";
import AvatarCircle from "./AvatarCircle.vue";
import ThreadParticipantAvatar from "./ThreadParticipantAvatar.vue";
import { replyCountLabel, type ThreadSummaryView } from "@/features/threads/threadSummary";
import { relativeTime } from "@/features/identity/format";

/**
 * Slack-style thread summary under a parent message: the faces of the last few
 * repliers, the reply count, and when the thread was last active. The whole row
 * is one button — clicking it (or Enter/Space) opens the thread panel, exactly
 * as the ↩ hover action does.
 *
 * Everything shown is derived from the message store (`threadSummary.ts`), so a
 * new reply updates the count, the avatar order and the time in place, without
 * the feed re-rendering or the scroll position moving.
 */
const props = defineProps<{
  summary: ThreadSummaryView;
  /** Ticks with the feed's clock so "Last reply 3m ago" stays true. */
  now: number;
  /** This message's thread is the one currently open in the panel. */
  isOpen?: boolean;
}>();

const emit = defineEmits<{ open: [] }>();

const countLabel = computed(() => replyCountLabel(props.summary.count));
/** People who replied beyond the avatars shown ("+2"). */
const extraParticipants = computed(() =>
  Math.max(0, (props.summary.participantTotal ?? 0) - props.summary.participantPubkeys.length),
);
const lastReplyLabel = computed(() =>
  props.summary.lastReplyAt === null
    ? null
    : `Last reply ${relativeTime(props.summary.lastReplyAt, props.now)}`,
);
/** Spoken as one sentence; the visual row splits the same information in two. */
const ariaLabel = computed(() =>
  [countLabel.value, lastReplyLabel.value ? `${lastReplyLabel.value}.` : null, "View thread"]
    .filter(Boolean)
    .join(", "),
);
</script>

<template>
  <button
    type="button"
    class="thread-summary"
    :class="{ open: isOpen }"
    :aria-label="ariaLabel"
    :aria-expanded="isOpen ? 'true' : undefined"
    data-testid="thread-summary-row"
    @click.stop="emit('open')"
  >
    <span class="avatars" aria-hidden="true">
      <ThreadParticipantAvatar
        v-for="pubkey in summary.participantPubkeys"
        :key="pubkey"
        :pubkey="pubkey"
      />
      <!-- No participants known yet (count came from the relay): one neutral face. -->
      <AvatarCircle v-if="!summary.participantPubkeys.length" name="?" :size="24" class="stacked" />
      <span v-if="extraParticipants" class="more" data-testid="thread-summary-more">+{{ extraParticipants }}</span>
    </span>

    <span class="count" data-testid="thread-summary-count">{{ countLabel }}</span>

    <span class="meta">
      <span class="last-reply" data-testid="thread-summary-last-reply">{{ lastReplyLabel ?? "" }}</span>
      <span class="view-thread" data-testid="thread-summary-view">View thread</span>
    </span>

    <span class="chevron" aria-hidden="true">›</span>
  </button>
</template>

<style scoped>
.thread-summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  cursor: pointer;
  text-align: left;
  max-width: 100%;
}
.thread-summary:hover,
.thread-summary:focus-visible,
.thread-summary.open {
  border-color: var(--color-border);
  background: var(--color-surface-muted);
}
.thread-summary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.avatars {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
/* ~30% overlap, each face ringed in the feed background so they stay distinct. */
.avatars :deep(.avatar-wrapper) {
  margin-left: -7px;
  border-radius: var(--radius-full);
  box-shadow: 0 0 0 2px var(--color-bg);
}
.avatars :deep(.avatar-wrapper:first-child) {
  margin-left: 0;
}

.count {
  color: var(--color-accent);
  font-weight: 600;
  flex-shrink: 0;
}

.meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* "Last reply 3m ago" becomes "View thread" on hover/focus — same slot, no reflow. */
.view-thread {
  display: none;
}
.thread-summary:hover .last-reply,
.thread-summary:focus-visible .last-reply {
  display: none;
}
.thread-summary:hover .view-thread,
.thread-summary:focus-visible .view-thread {
  display: inline;
}

.chevron {
  margin-left: auto;
  padding-left: var(--space-2);
  opacity: 0;
  flex-shrink: 0;
}
.thread-summary:hover .chevron,
.thread-summary:focus-visible .chevron {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .thread-summary {
    transition: none;
  }
}
.more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  margin-left: -6px;
  padding: 0 4px;
  border: 2px solid var(--color-surface);
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 600;
}
</style>
