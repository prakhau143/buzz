<script setup lang="ts">
import { computed } from "vue";
import StateView from "./StateView.vue";
import MessageItem from "./MessageItem.vue";
import MessageComposer from "./MessageComposer.vue";
import BaseButton from "./BaseButton.vue";
import { useThread } from "@/features/threads/useThread";
import { useSendMessage } from "@/features/messages/useSendMessage";

const props = defineProps<{ rootEventId: string; channelId: string }>();
const emit = defineEmits<{ close: [] }>();

const { data, isLoading, isError, refetch } = useThread(() => props.rootEventId);
const { send, isSending, error } = useSendMessage(() => props.channelId);

const root = computed(() => data.value?.root ?? null);
const replies = computed(() => data.value?.replies ?? []);

async function sendReply(content: string, mentionPubkeys: string[]) {
  if (!root.value) return;
  await send({
    content,
    mentionPubkeys,
    reply: {
      rootEventId: props.rootEventId,
      parentEventId: props.rootEventId,
      parentAuthorPubkey: root.value.authorPubkey,
    },
  });
}
</script>

<template>
  <div class="thread-panel">
    <div class="thread-header">
      <h2>Thread</h2>
      <BaseButton variant="ghost" @click="emit('close')">Close</BaseButton>
    </div>

    <StateView v-if="isLoading" kind="loading" />
    <StateView v-else-if="isError" kind="error" title="Couldn't load thread" @retry="refetch" />
    <template v-else>
      <div class="thread-body">
        <MessageItem v-if="root" :message="root" />
        <div class="replies">
          <MessageItem v-for="reply in replies" :key="reply.id" :message="reply" />
        </div>
        <StateView v-if="!replies.length" kind="empty" title="No replies yet" />
      </div>
      <MessageComposer
        :disabled="isSending"
        :error="error"
        placeholder="Reply in thread…"
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

.thread-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.thread-header h2 {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.thread-body {
  flex: 1;
  overflow-y: auto;
  padding-top: var(--space-2);
}

.replies {
  border-top: 1px solid var(--color-border);
  margin-top: var(--space-2);
}
</style>
