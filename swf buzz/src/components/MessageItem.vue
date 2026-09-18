<script setup lang="ts">
import { computed } from "vue";
import AvatarCircle from "./AvatarCircle.vue";
import ReactionBar from "./ReactionBar.vue";
import { useProfile } from "@/composables/useProfile";
import { useSessionStore } from "@/stores/session";
import type { Message, Reaction } from "@/types/domain";

const props = defineProps<{
  message: Message;
  reactions?: Reaction[];
  replyCount?: number;
}>();

const emit = defineEmits<{
  retry: [];
  "open-thread": [rootId: string];
  react: [emoji: string];
  report: [];
}>();

const session = useSessionStore();
const isOwnMessage = computed(() => session.pubkey === props.message.authorPubkey);

const { data: profile } = useProfile(() => props.message.authorPubkey);

const displayName = computed(
  () => profile.value?.displayName ?? props.message.authorPubkey.slice(0, 8),
);
const timeLabel = computed(() =>
  new Date(props.message.createdAt * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }),
);

const QUICK_REACTIONS = ["👍", "❤️", "😄"];
</script>

<template>
  <div v-if="message.isSystemMessage" class="system-message">
    <span>{{ message.content }}</span>
  </div>

  <div
    v-else
    class="message"
    :class="{ failed: message.status === 'failed', agent: profile?.isAgent }"
  >
    <AvatarCircle
      :name="displayName"
      :avatar-url="profile?.avatarUrl"
      :is-agent="profile?.isAgent"
      :size="32"
    />
    <div class="message-body">
      <div class="message-header">
        <span class="author">{{ displayName }}</span>
        <span v-if="profile?.isAgent" class="agent-badge">Agent</span>
        <span class="time">{{ timeLabel }}</span>
        <span v-if="message.status === 'sending'" class="status">Sending…</span>
      </div>
      <p class="content">{{ message.content }}</p>

      <ReactionBar
        v-if="reactions?.length"
        :reactions="reactions"
        @toggle="(emoji) => emit('react', emoji)"
      />

      <button
        v-if="replyCount"
        type="button"
        class="reply-count-button"
        @click="emit('open-thread', message.thread.rootId ?? message.id)"
      >
        💬 {{ replyCount }} {{ replyCount === 1 ? "reply" : "replies" }}
      </button>

      <div class="message-actions">
        <button
          v-for="emoji in QUICK_REACTIONS"
          :key="emoji"
          type="button"
          class="action-button"
          @click="emit('react', emoji)"
        >
          {{ emoji }}
        </button>
        <button
          type="button"
          class="action-button text"
          @click="emit('open-thread', message.thread.rootId ?? message.id)"
        >
          ↩ Reply
        </button>
        <button
          v-if="!isOwnMessage"
          type="button"
          class="action-button text danger"
          @click="emit('report')"
        >
          Report
        </button>
      </div>

      <p v-if="message.status === 'failed'" class="failed-row">
        Message failed to send.
        <button type="button" class="retry-link" @click="emit('retry')">Retry</button>
      </p>
    </div>
  </div>
</template>

<style scoped>
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

.reply-count-button {
  display: block;
  margin-top: var(--space-1);
  border: none;
  background: transparent;
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.reply-count-button:hover {
  text-decoration: underline;
}

.message-actions {
  display: flex;
  gap: var(--space-1);
  margin-top: var(--space-1);
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.message:hover .message-actions {
  opacity: 1;
}

.action-button {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  height: 22px;
  padding: 0 var(--space-2);
  font-size: var(--font-size-xs);
  cursor: pointer;
  color: var(--color-text-muted);
}
.action-button:hover {
  background: var(--color-surface-hover);
}
.action-button.text {
  color: var(--color-primary);
}
.action-button.text.danger {
  color: var(--color-text-subtle);
}
.action-button.text.danger:hover {
  color: var(--color-danger);
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
</style>
