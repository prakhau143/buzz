<script setup lang="ts">
/**
 * The new-backend (DECISIONS.md D10) channels/messages/threads UI — a
 * deliberately separate, self-contained view from `ChannelsView.vue`
 * rather than a retrofit of it. `ChannelsView.vue` is deeply wired into
 * Nostr-only features that are not part of this migration phase
 * (reactions, presence, agent activity, moderation) and rewriting it in
 * place would have risked breaking all of those for no benefit — this view
 * exercises the new HTTP+WebSocket backend end-to-end instead, reachable
 * at `/community`. See `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §2's "build
 * alongside" sequencing; a real single unified view is follow-up work once
 * reactions/presence/moderation are migrated too.
 *
 * Root-cause fix (see the P0 bug report this was written to close): every
 * mutation handler here used to `await` a mutation with no try/catch, so
 * any failure (most commonly: no community existed yet, so `POST
 * /api/communities/null/channels` was attempted and rejected) threw an
 * unhandled rejection out of a template event handler, which Vue routes
 * into the nearest error boundary — crashing the *entire app*, not just
 * this view. Every handler below now catches and surfaces its own error
 * inline instead. The `currentCommunityId === null` case additionally gets
 * a real guard (`CreateCommunityPrompt`) instead of silently attempting a
 * request that can never succeed.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AppShell from "@/layouts/AppShell.vue";
import BaseButton from "@/components/BaseButton.vue";
import StateView from "@/components/StateView.vue";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import { userMessageFor } from "@/services/errors";
import { currentCommunityId } from "@/features/communities/currentCommunity";
import CreateCommunityPrompt from "@/features/communities/ui/CreateCommunityPrompt.vue";
import { useChannelsHttp, useChannelMembersHttp } from "@/features/channels/useChannelsHttp";
import { useChannelMessagesHttp } from "@/features/messages/useChannelMessagesHttp";
import { useThreadHttp, useThreadSummariesHttp } from "@/features/threads/useThreadHttp";
import { realtimeService } from "@/services/RealtimeService";
import CreateChannelDialogHttp from "@/features/channels/ui/CreateChannelDialogHttp.vue";

const session = useSessionStore();
const ui = useUiStore();

onMounted(() => void realtimeService.connect());
onUnmounted(() => realtimeService.disconnect());

const selectedChannelId = ref<string | null>(null);
const { data: channels, isLoading: channelsLoading, createChannel, isCreating } = useChannelsHttp();

const showCreateChannel = ref(false);
async function handleCreateChannel(params: {
  name: string;
  visibility: "open" | "private";
  description?: string;
}) {
  // Errors are caught/displayed by CreateChannelDialogHttp itself (it calls
  // this directly and shows its own inline error) — this just wires the
  // resulting channel into the view once it succeeds.
  const channel = await createChannel(params);
  selectedChannelId.value = channel.id;
  await realtimeService.reconnect(); // new channel isn't in the connect-time membership snapshot yet
  return channel;
}

const actionError = ref<string | null>(null);

const { myRole, isMember, join, isJoining } = useChannelMembersHttp(() => selectedChannelId.value);
async function handleJoin() {
  actionError.value = null;
  try {
    await join();
    await realtimeService.reconnect(); // same reason as above
  } catch (err) {
    actionError.value = userMessageFor(err);
  }
}

const { data: messages, isLoading: messagesLoading, isError: messagesError, send, isSending } =
  useChannelMessagesHttp(() => selectedChannelId.value);

const threadSummaries = useThreadSummariesHttp(() => messages.value ?? []);

const composerText = ref("");
async function handleSend() {
  const content = composerText.value.trim();
  if (!content) return;
  actionError.value = null;
  const previous = composerText.value;
  composerText.value = "";
  try {
    await send({ content });
  } catch (err) {
    composerText.value = previous; // don't silently discard what the user typed
    actionError.value = userMessageFor(err);
  }
}

const openThreadRootId = ref<string | null>(null);
function openThread(messageId: string) {
  openThreadRootId.value = messageId;
  ui.detailsPaneOpen = true;
}
function closeThread() {
  openThreadRootId.value = null;
  ui.detailsPaneOpen = false;
}
const { data: thread, reply: sendReply, isReplying } = useThreadHttp(() => openThreadRootId.value);
const threadReplyText = ref("");
const threadError = ref<string | null>(null);
async function handleThreadReply() {
  const content = threadReplyText.value.trim();
  if (!content) return;
  threadError.value = null;
  const previous = threadReplyText.value;
  threadReplyText.value = "";
  try {
    await sendReply(content);
  } catch (err) {
    threadReplyText.value = previous;
    threadError.value = userMessageFor(err);
  }
}

// Selecting a different community (rare in this stopgap single-community
// model, see currentCommunity.ts) invalidates whatever channel was selected.
watch(currentCommunityId, () => {
  selectedChannelId.value = null;
  closeThread();
});

const myDisplayName = computed(
  () => session.applicationUser?.displayName ?? session.applicationUser?.email ?? "you",
);
</script>

<template>
  <div v-if="!currentCommunityId" class="no-community">
    <CreateCommunityPrompt />
  </div>

  <AppShell v-else>
    <template #sidebar>
      <div class="channel-sidebar">
        <div class="sidebar-header">
          <h2 class="sidebar-title">Channels</h2>
          <button
            type="button"
            class="create-channel-button"
            aria-label="Create channel"
            title="Create channel"
            @click="showCreateChannel = true"
          >
            +
          </button>
        </div>
        <StateView v-if="channelsLoading" kind="loading" title="Loading channels…" />
        <StateView
          v-else-if="!channels?.length"
          kind="empty"
          title="No channels yet"
          description="Create your first channel to get started."
        />
        <ul v-else class="channel-list">
          <li
            v-for="channel in channels"
            :key="channel.id"
            :class="{ active: channel.id === selectedChannelId }"
          >
            <button type="button" @click="selectedChannelId = channel.id">
              # {{ channel.name }}
            </button>
          </li>
        </ul>
      </div>
    </template>

    <template #main>
      <StateView
        v-if="!selectedChannelId"
        kind="empty"
        title="No channel selected"
        description="Pick a channel from the sidebar, or create one."
      />
      <div v-else class="channel-main">
        <div v-if="isMember" class="role-bar">Your role in this channel: {{ myRole }}</div>
        <div v-else class="join-bar">
          <span>You're not a member of this channel yet.</span>
          <BaseButton variant="primary" :disabled="isJoining" @click="handleJoin">
            Join channel
          </BaseButton>
        </div>

        <p v-if="actionError" class="inline-error">{{ actionError }}</p>

        <StateView v-if="messagesLoading" kind="loading" title="Loading messages…" />
        <StateView v-else-if="messagesError" kind="error" title="Couldn't load messages" />
        <StateView
          v-else-if="!messages?.length"
          kind="empty"
          title="No messages yet"
          description="Say something to get the conversation started."
        />
        <ul v-else class="message-list">
          <li v-for="message in messages" :key="message.id" class="message-item">
            <div class="message-sender">{{ message.senderUserId === session.applicationUser?.id ? myDisplayName : message.senderUserId }}</div>
            <div class="message-content">{{ message.content }}</div>
            <button type="button" class="thread-link" @click="openThread(message.id)">
              💬 {{ threadSummaries.get(message.id)?.replyCount ?? 0 }} repl{{
                (threadSummaries.get(message.id)?.replyCount ?? 0) === 1 ? "y" : "ies"
              }}
            </button>
          </li>
        </ul>

        <form class="composer" @submit.prevent="handleSend">
          <input
            v-model="composerText"
            type="text"
            placeholder="Message…"
            :disabled="isSending || !isMember"
          />
          <BaseButton type="submit" variant="primary" :disabled="isSending || !isMember || !composerText.trim()">
            Send
          </BaseButton>
        </form>
      </div>
    </template>

    <template #details>
      <div v-if="openThreadRootId" class="thread-panel">
        <div class="thread-panel-header">
          <h3>Thread</h3>
          <button type="button" @click="closeThread">✕</button>
        </div>
        <div v-if="thread" class="thread-root">{{ thread.root.content }}</div>
        <ul class="thread-replies">
          <li v-for="r in thread?.replies ?? []" :key="r.id">{{ r.content }}</li>
        </ul>
        <p v-if="threadError" class="inline-error">{{ threadError }}</p>
        <form class="composer" @submit.prevent="handleThreadReply">
          <input v-model="threadReplyText" type="text" placeholder="Reply…" :disabled="isReplying" />
          <BaseButton type="submit" variant="primary" :disabled="isReplying || !threadReplyText.trim()">
            Reply
          </BaseButton>
        </form>
      </div>
    </template>
  </AppShell>

  <CreateChannelDialogHttp
    v-if="showCreateChannel"
    :create="handleCreateChannel"
    :is-creating="isCreating"
    @close="showCreateChannel = false"
  />
</template>

<style scoped>
.no-community {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
}
.channel-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
}
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sidebar-title {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  text-transform: uppercase;
  margin: 0;
}
.create-channel-button {
  border: none;
  background: transparent;
  color: var(--color-text-subtle);
  font-size: var(--font-size-md);
  line-height: 1;
  cursor: pointer;
  padding: var(--space-1);
  border-radius: var(--radius-sm, 4px);
}
.create-channel-button:hover {
  color: var(--color-text);
  background: var(--color-surface-hover);
}
.channel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.channel-list li button {
  width: 100%;
  text-align: left;
  padding: var(--space-2);
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--radius-sm, 4px);
}
.channel-list li.active button {
  background: var(--color-surface-muted);
  font-weight: 600;
}
.channel-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.role-bar {
  padding: var(--space-1) var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.join-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-surface-muted);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.inline-error {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--color-danger);
  background: var(--color-danger-muted);
}
.message-list {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.message-sender {
  font-weight: 600;
  font-size: var(--font-size-sm);
}
.thread-link {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  padding: 0;
  margin-top: var(--space-1);
}
.composer {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3);
  border-top: 1px solid var(--color-border);
}
.composer input {
  flex: 1;
  min-width: 0;
}
.thread-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.thread-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
.thread-root {
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
.thread-replies {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
