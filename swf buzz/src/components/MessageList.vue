<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import MessageItem from "./MessageItem.vue";
import StateView from "./StateView.vue";
import type { Message, Reaction, ThreadSummary } from "@/types/domain";

const props = defineProps<{
  messages: Message[];
  reactionsByMessage?: Map<string, Reaction[]>;
  replySummaries?: Map<string, ThreadSummary>;
  isLoading: boolean;
  isError: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  "retry-message": [message: Message];
  "open-thread": [rootId: string];
  react: [payload: { targetEventId: string; emoji: string }];
  report: [message: Message];
}>();

const scrollEl = ref<HTMLElement | null>(null);

watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
  },
);
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
    title="No messages yet"
    description="Be the first to say something."
  />

  <div v-else ref="scrollEl" class="message-list">
    <MessageItem
      v-for="message in messages"
      :key="message.id"
      :message="message"
      :reactions="reactionsByMessage?.get(message.id)"
      :reply-count="replySummaries?.get(message.id)?.replyCount"
      @retry="emit('retry-message', message)"
      @open-thread="(rootId) => emit('open-thread', rootId)"
      @react="(emoji) => emit('react', { targetEventId: message.id, emoji })"
      @report="emit('report', message)"
    />
  </div>
</template>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3) 0;
}
</style>
