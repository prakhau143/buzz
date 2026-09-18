<script setup lang="ts">
/**
 * The new-backend (DECISIONS.md D10) direct-messages UI — a deliberately
 * separate, self-contained view from `DmView.vue` (the old `kind:41010`
 * version) rather than a retrofit of it, for the same reason
 * `CommunityChannelsView.vue` is separate from `ChannelsView.vue`: the old
 * view is wired into Nostr-only discovery/hide mechanisms outside this
 * migration phase's scope. Reachable at `/community-dm`. See
 * `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §2's "build alongside" sequencing.
 *
 * "Start a new DM" is a raw user-id input rather than a picker, because no
 * HTTP-backed endpoint in this codebase yet returns a directory of other
 * users with display names to pick from (`GET /api/channels/:id/members`
 * only returns `{user_id, role, joined_at}` — see `ChannelServiceHttp.ts`).
 * Conversations list their participant ids for the same reason. A real
 * "Message" button on a user's profile can call `useOpenDmHttp()` directly
 * once a userId-keyed profile panel exists to put it on.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppShell from "@/layouts/AppShell.vue";
import BaseButton from "@/components/BaseButton.vue";
import StateView from "@/components/StateView.vue";
import { useSessionStore } from "@/stores/session";
import { userMessageFor } from "@/services/errors";
import { useConversationsHttp, useDmMessagesHttp } from "@/features/dm/useDmHttp";
import { realtimeService } from "@/services/RealtimeService";

const session = useSessionStore();

onMounted(() => void realtimeService.connect());
onUnmounted(() => realtimeService.disconnect());

const selectedConversationId = ref<string | null>(null);
const { data: conversations, isLoading: conversationsLoading, open, isOpening, openError } =
  useConversationsHttp();

const newParticipantId = ref("");
// `openError` (the mutation's own `onError` state) already displays a
// message below — this try/catch exists only so a failed open doesn't
// *also* throw an unhandled rejection out of this template event handler
// and crash the whole app (see the P0 fix this view is part of).
async function handleOpen() {
  const otherUserId = newParticipantId.value.trim();
  if (!otherUserId) return;
  try {
    const conversation = await open([otherUserId]);
    newParticipantId.value = "";
    selectedConversationId.value = conversation.id;
    await realtimeService.reconnect(); // a brand-new conversation isn't in the connect-time membership snapshot yet
  } catch {
    // handled above via `openError`
  }
}

const { data: messages, isLoading: messagesLoading, isError: messagesError, send, isSending } =
  useDmMessagesHttp(() => selectedConversationId.value);

const composerText = ref("");
const sendErrorMessage = ref<string | null>(null);
async function handleSend() {
  const content = composerText.value.trim();
  if (!content) return;
  sendErrorMessage.value = null;
  const previous = composerText.value;
  composerText.value = "";
  try {
    await send(content);
  } catch (err) {
    composerText.value = previous;
    sendErrorMessage.value = userMessageFor(err);
  }
}

function otherParticipants(conversation: { participantIds: string[] }): string {
  const myId = session.applicationUser?.id;
  const others = conversation.participantIds.filter((id) => id !== myId);
  return others.length > 0 ? others.join(", ") : conversation.participantIds.join(", ");
}

const myDisplayName = computed(
  () => session.applicationUser?.displayName ?? session.applicationUser?.email ?? "you",
);
</script>

<template>
  <AppShell>
    <template #sidebar>
      <div class="dm-sidebar">
        <h2 class="sidebar-title">Direct Messages</h2>
        <StateView v-if="conversationsLoading" kind="loading" title="Loading conversations…" />
        <StateView
          v-else-if="!conversations?.length"
          kind="empty"
          title="No conversations yet"
          description="Start one below."
        />
        <ul v-else class="conversation-list">
          <li
            v-for="conversation in conversations"
            :key="conversation.id"
            :class="{ active: conversation.id === selectedConversationId }"
          >
            <button type="button" @click="selectedConversationId = conversation.id">
              {{ otherParticipants(conversation) }}
            </button>
          </li>
        </ul>
        <form class="open-dm" @submit.prevent="handleOpen">
          <input
            v-model="newParticipantId"
            type="text"
            placeholder="Other user's id"
            :disabled="isOpening"
          />
          <BaseButton type="submit" variant="secondary" :disabled="isOpening || !newParticipantId.trim()">
            Start DM
          </BaseButton>
        </form>
        <p v-if="openError" class="open-dm-error">Couldn't start that conversation.</p>
      </div>
    </template>

    <template #main>
      <StateView
        v-if="!selectedConversationId"
        kind="empty"
        title="No conversation selected"
        description="Pick a conversation from the sidebar, or start a new one."
      />
      <div v-else class="dm-main">
        <p v-if="sendErrorMessage" class="open-dm-error">{{ sendErrorMessage }}</p>

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
            <div class="message-sender">
              {{ message.senderUserId === session.applicationUser?.id ? myDisplayName : message.senderUserId }}
            </div>
            <div class="message-content">{{ message.content }}</div>
          </li>
        </ul>

        <form class="composer" @submit.prevent="handleSend">
          <input v-model="composerText" type="text" placeholder="Message…" :disabled="isSending" />
          <BaseButton type="submit" variant="primary" :disabled="isSending || !composerText.trim()">
            Send
          </BaseButton>
        </form>
      </div>
    </template>
  </AppShell>
</template>

<style scoped>
.dm-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
}
.sidebar-title {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  text-transform: uppercase;
}
.conversation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.conversation-list li button {
  width: 100%;
  text-align: left;
  padding: var(--space-2);
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--radius-sm, 4px);
  overflow-wrap: anywhere;
}
.conversation-list li.active button {
  background: var(--color-surface-muted);
  font-weight: 600;
}
.open-dm {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.open-dm input {
  flex: 1;
  min-width: 0;
}
.open-dm-error {
  color: var(--color-danger, #b00020);
  font-size: var(--font-size-sm);
}
.dm-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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
  overflow-wrap: anywhere;
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
</style>
