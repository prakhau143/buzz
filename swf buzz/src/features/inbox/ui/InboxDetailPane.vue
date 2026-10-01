<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import MessageItem from "@/components/MessageItem.vue";
import MessageComposer from "@/components/MessageComposer.vue";
import StateView from "@/components/StateView.vue";
import AppIcon from "@/components/AppIcon.vue";
import { useThread } from "@/features/threads/useThread";
import { useSendMessage } from "@/features/messages/useSendMessage";
import { KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2 } from "@/protocol/kinds";
import { relativeTime } from "@/features/identity/format";
import type { Attachment } from "@/protocol/imeta";
import type { InboxItem } from "../inboxModel";
import type { MentionScope } from "@/features/mentions/useMentionDirectory";

/**
 * The selected inbox item, OLD BUZZ-style (`InboxDetailPane` / `useInboxThreadContext`):
 * the conversation around it — the thread root and its replies — with the
 * selected message centred and briefly highlighted, and a reply box anchored
 * at the bottom. Only this body scrolls; the header and composer stay put.
 *
 * Approval / reminder / agent-job / project events are not chat messages, so
 * they are shown as a single event card with no composer (nothing to reply to).
 */
const props = defineProps<{
  item: InboxItem;
  title: string;
  /** Single-pane layout: show "Back to Inbox". */
  narrow: boolean;
}>();
const emit = defineEmits<{
  back: [];
  "open-source": [];
  "open-profile": [pubkey: string];
}>();

const MESSAGE_KINDS = new Set([KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2]);
const isMessage = computed(() => MESSAGE_KINDS.has(props.item.event.kind));
const rootId = computed(() => (isMessage.value ? (props.item.rootId ?? props.item.event.id) : null));

const { data, isLoading, isError, refetch } = useThread(rootId);
const { send, isSending, error } = useSendMessage(() => props.item.channelId ?? "");

/** Reply mentions offer what the source conversation would: its members (a DM: only them). */
const mentionScope = computed<MentionScope>(() => ({
  kind: props.item.type === "dm" ? "dm" : "channel",
  channelId: props.item.channelId ?? null,
}));

const root = computed(() => data.value?.root ?? null);
const replies = computed(() => data.value?.replies ?? []);

const body = ref<HTMLElement | null>(null);
const HIGHLIGHT_MS = 1200;

/** Centre and flash the selected message once the thread is on screen. */
async function focusSelected() {
  await nextTick();
  const el = body.value?.querySelector<HTMLElement>(`[data-message-id="${props.item.event.id}"]`);
  if (!el) return;
  el.scrollIntoView?.({ block: "center" });
  el.classList.add("inbox-highlight");
  setTimeout(() => el.classList.remove("inbox-highlight"), HIGHLIGHT_MS);
}
watch([() => props.item.event.id, () => data.value], () => void focusSelected(), { immediate: true });

async function reply(
  content: string,
  mentionPubkeys: string[],
  attachments: Attachment[] = [],
  options: { mentionsEveryone: boolean } = { mentionsEveryone: false },
) {
  if (!root.value || !rootId.value) return;
  // Reply to the message the person selected (NIP-10 root + parent), not always the root.
  const parent = props.item.event.id === rootId.value ? root.value : null;
  await send({
    content,
    mentionPubkeys,
    attachments,
    mentionsEveryone: options.mentionsEveryone,
    reply: {
      rootEventId: rootId.value,
      parentEventId: props.item.event.id,
      parentAuthorPubkey: parent?.authorPubkey ?? props.item.event.pubkey,
    },
  });
}
</script>

<template>
  <section class="detail" aria-label="Inbox item">
    <header class="detail-header">
      <button v-if="narrow" type="button" class="icon-btn" aria-label="Back to Inbox" data-testid="inbox-back" @click="emit('back')">
        ←
      </button>
      <h2 class="detail-title" data-testid="inbox-detail-title">{{ title }}</h2>
      <button
        v-if="item.channelId"
        type="button"
        class="icon-btn"
        title="Open in channel"
        aria-label="Open in channel"
        data-testid="inbox-open-source"
        @click="emit('open-source')"
      >
        <AppIcon name="link" :size="16" />
      </button>
    </header>

    <div ref="body" class="detail-body">
      <template v-if="isMessage">
        <StateView v-if="isLoading" kind="loading" />
        <StateView v-else-if="isError" kind="error" title="Couldn't load this conversation" @retry="refetch" />
        <template v-else>
          <div v-if="root" class="root">
            <MessageItem :message="root" @open-profile="(p) => emit('open-profile', p)" />
          </div>
          <div v-if="replies.length" class="replies-label">
            {{ replies.length }} {{ replies.length === 1 ? "reply" : "replies" }}
          </div>
          <MessageItem
            v-for="r in replies"
            :key="r.id"
            :message="r"
            @open-profile="(p) => emit('open-profile', p)"
          />
        </template>
      </template>
      <article v-else class="event-card" data-testid="inbox-event-card">
        <p class="event-meta">{{ relativeTime(item.createdAt) }}</p>
        <p class="event-content">{{ item.event.content || "(no text)" }}</p>
      </article>
    </div>

    <MessageComposer
      v-if="isMessage && root"
      class="detail-composer"
      :disabled="isSending"
      :error="error"
      placeholder="Reply…"
      :mention-scope="mentionScope"
      allow-attachments
      @send="reply"
    />
  </section>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.detail-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 52px;
  flex-shrink: 0;
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-bg) 82%, transparent);
  backdrop-filter: blur(10px);
}
.detail-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.icon-btn:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.icon-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3) 0;
}
.root {
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-2);
  margin-bottom: var(--space-2);
}
.replies-label {
  padding: 0 var(--space-4) var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.detail-body :deep(.inbox-highlight) {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  transition: background 600ms ease;
}
.event-card {
  margin: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
}
.event-meta {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.event-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text);
}
.detail-composer {
  flex-shrink: 0;
}
@media (prefers-reduced-motion: reduce) {
  .detail-body :deep(.inbox-highlight),
  .icon-btn {
    transition: none;
  }
}
</style>
