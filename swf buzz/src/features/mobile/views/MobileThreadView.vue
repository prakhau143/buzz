<script setup lang="ts">
import { computed } from "vue";
import ThreadPanel from "@/components/ThreadPanel.vue";
import MobileLayout from "../ui/MobileLayout.vue";
import MobileHeader from "../ui/MobileHeader.vue";
import MobileMessageActions from "../ui/MobileMessageActions.vue";
import { useMobileNav } from "../mobileNav";
import { useMobileMessageActions } from "../useMobileMessageActions";
import { useMobileReveal } from "../useMobileReveal";
import MobileRevealNotice from "../ui/MobileRevealNotice.vue";
import { useChannels } from "@/features/channels/useChannels";
import { useDmList } from "@/features/dm/useDmList";
import { useThread } from "@/features/threads/useThread";
import { replyCountLabel } from "@/features/threads/threadSummary";
import { useReportActiveConversation } from "@/features/notifications/useNotificationService";
import type { MentionScope } from "@/features/mentions/useMentionDirectory";

/**
 * Mobile thread — a full-screen page of its own (never the desktop split
 * panel): back | root message | replies | reply composer. The body is the
 * existing ThreadPanel (same thread query, same optimistic replies), with its
 * desktop docked/expand header swapped for a mobile back header. Used for
 * channel threads and DM threads (`dm`), which differ only in mention scope.
 *
 * Message actions match the desktop thread panel, which offers none beyond
 * the message itself: copy (plus the profile via any avatar or mention).
 */
const props = defineProps<{ channelId: string; rootId: string; dm?: boolean }>();
const { goBack } = useMobileNav();

const { data: channels } = useChannels();
const { data: conversations } = useDmList();
const channelName = computed(() => (props.dm ? null : (channels.value?.find((c) => c.id === props.channelId)?.name ?? null)));
const participants = computed(() => conversations.value?.find((c) => c.id === props.channelId)?.dmParticipants ?? []);
// Same query key as ThreadPanel's — served from one cache entry, not fetched twice.
const { data: thread } = useThread(() => props.rootId);
const subtitle = computed(() => {
  const n = thread.value?.replies.length ?? 0;
  const where = props.dm ? "Direct message" : channelName.value ? `#${channelName.value}` : null;
  return [n ? replyCountLabel(n) : null, where].filter(Boolean).join(" · ") || null;
});
const mentionScope = computed<MentionScope>(() =>
  props.dm
    ? { kind: "dm", channelId: props.channelId, participants: participants.value }
    : { kind: "channel", channelId: props.channelId },
);
useReportActiveConversation(() => props.channelId);

// Deep reveal (`?m=`) of the root or a reply inside this thread.
const reveal = useMobileReveal();

const actions = useMobileMessageActions({
  abilities: () => ({}),
  reactionsFor: () => undefined,
  react: () => undefined,
  unreact: () => undefined,
  openThread: () => undefined,
});
</script>

<template>
  <MobileLayout :back="goBack">
    <template #header>
      <MobileHeader title="Thread" :subtitle="subtitle" back back-label="Back to conversation" @back="goBack" />
    </template>
    <MobileRevealNotice :status="reveal.status.value" @dismiss="reveal.dismiss" />
    <ThreadPanel
      class="m-thread"
      :highlight-id="reveal.target.value"
      :root-event-id="rootId"
      :channel-id="channelId"
      :channel-name="channelName"
      :mention-scope="mentionScope"
      hide-header
      mobile-actions
      @highlight-done="reveal.done"
      @close="goBack"
      @open-actions="actions.open"
    />
    <MobileMessageActions
      v-if="actions.target.value"
      :message="actions.target.value"
      :abilities="actions.abilities.value"
      :is-own="actions.isOwn.value"
      :author-name="actions.authorName.value"
      @close="actions.close"
    />
  </MobileLayout>
</template>

<style scoped>
.m-thread {
  flex: 1;
  min-height: 0;
}
/* The reply composer is the page's bottom edge: keep it clear of the home indicator. */
.m-thread :deep(.composer) {
  padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom));
}
:global(html[data-keyboard="open"]) .m-thread :deep(.composer) {
  padding-bottom: var(--space-2);
}
</style>
