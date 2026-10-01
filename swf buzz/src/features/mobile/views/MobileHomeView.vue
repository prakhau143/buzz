<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import AppIcon from "@/components/AppIcon.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import StateView from "@/components/StateView.vue";
import ChannelListItem from "@/components/ChannelListItem.vue";
import CommunityAvatar from "@/features/communities/ui/CommunityAvatar.vue";
import MobileLayout from "../ui/MobileLayout.vue";
import MobileHeader from "../ui/MobileHeader.vue";
import MobileCommunitySheet from "../ui/MobileCommunitySheet.vue";
import { queryKeys } from "@/app/providers/queryKeys";
import { useChannels } from "@/features/channels/useChannels";
import { sidebarChannels } from "@/features/channels/channelVisibility";
import { useDmList } from "@/features/dm/useDmList";
import { useReadStateStore } from "@/stores/readState";
import { useSessionStore } from "@/stores/session";
import { useProfile, useProfileMap } from "@/composables/useProfile";
import { useCommunitySwitch } from "@/features/communities/useCommunitySwitch";
import { useUnreadCatchUp } from "@/features/readState/useUnreadCatchUp";
import { useReportActiveConversation } from "@/features/notifications/useNotificationService";
import { relativeTime } from "@/features/identity/format";
import type { Message } from "@/types/domain";

/**
 * Mobile Home: the current community (tap → community selector), its channels
 * (tap → conversation) and your direct messages (tap → DM). All data is the
 * desktop sidebar's: the same channel query and visibility rule, the same
 * kind:41010 DM list, the same NIP-RS unread counts, the same community switch.
 */
const router = useRouter();
const queryClient = useQueryClient();
const session = useSessionStore();
const readState = useReadStateStore();
const { data: me } = useProfile(() => session.pubkey);
const { current, connected, switchingTo } = useCommunitySwitch();
const { data: channels, isLoading, isError, refetch } = useChannels();
const { data: conversations, isLoading: dmLoading, isError: dmError, refetch: refetchDms } = useDmList();
/** Pull-to-refresh: the channel and DM lists' own refetches. */
async function refreshHome() {
  const [ch, dm] = await Promise.all([refetch(), refetchDms()]);
  if (ch.isError || dm.isError) throw ch.error ?? dm.error ?? new Error("refresh failed");
}
const visibleChannels = computed(() => sidebarChannels(channels.value));
const showSheet = ref(false);

useUnreadCatchUp(null);
useReportActiveConversation(() => null);

const statusLabel = computed(() => (switchingTo.value ? "Switching…" : connected.value ? "Connected" : "Connecting…"));
const myName = computed(() => me.value?.displayName ?? "Profile");

// ---- Direct messages ----
const partnerOf = (participants: readonly string[] | undefined) => participants?.find((p) => p !== session.pubkey) ?? null;
const partners = computed(() => (conversations.value ?? []).map((c) => partnerOf(c.dmParticipants)).filter((p): p is string => !!p));
const { profiles, displayNames } = useProfileMap(partners);

/**
 * The latest message of a DM, when this session already holds its timeline
 * (opened here, or live-updated) — read from the same cache the DM screen
 * uses, never fetched per row. Re-read whenever that cache changes.
 */
const cacheTick = ref(0);
const unsubscribe = queryClient.getQueryCache().subscribe(() => cacheTick.value++);
onBeforeUnmount(unsubscribe);
function latest(conversationId: string): Message | null {
  void cacheTick.value;
  const list = queryClient.getQueryData<Message[]>(queryKeys.dm(conversationId));
  return list?.length ? list.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)) : null;
}

const dmRows = computed(() =>
  (conversations.value ?? []).map((c) => {
    const partner = partnerOf(c.dmParticipants);
    const last = latest(c.id);
    const preview = last ? last.content.replace(/!\[[^\]]*]\([^)]*\)/g, "📎").replace(/\s+/g, " ").trim() : "";
    return {
      id: c.id,
      partner,
      name: (partner && displayNames.value.get(partner)) || "Direct message",
      avatarUrl: partner ? profiles.value.get(partner)?.avatarUrl : undefined,
      isAgent: partner ? profiles.value.get(partner)?.isAgent : false,
      preview: last ? `${last.authorPubkey === session.pubkey ? "You: " : ""}${preview || "Attachment"}` : "",
      time: last ? relativeTime(last.createdAt) : "",
      unread: readState.visibleUnread(c.id),
    };
  }),
);

function openChannel(channelId: string) {
  void router.push({ name: "mobile-channel", params: { channelId } });
}
function openDm(conversationId: string) {
  void router.push({ name: "mobile-dm", params: { conversationId } });
}
</script>

<template>
  <MobileLayout show-nav :refresh="refreshHome">
    <template #header>
      <MobileHeader title="SWF Buzz">
        <template #title>
          <h1 class="brand" data-testid="mobile-title">SWF <span>Buzz</span></h1>
        </template>
        <template #actions>
          <RouterLink
            :to="{ name: 'mobile-profile' }"
            replace
            class="m-icon-btn profile-btn"
            :aria-label="`${myName}, profile`"
            data-testid="mobile-home-profile"
          >
            <AvatarCircle :name="myName" :avatar-url="me?.avatarUrl" :pubkey="session.pubkey" :size="32" />
          </RouterLink>
        </template>
      </MobileHeader>
    </template>

    <div class="home">
      <p class="section-label">Current community</p>
      <button
        type="button"
        class="community-card"
        aria-haspopup="dialog"
        :aria-label="`${current.name || 'No community'}, ${statusLabel}. Switch community`"
        data-testid="mobile-community-card"
        @click="showSheet = true"
      >
        <CommunityAvatar :relay-url="current.url" :name="current.name || '?'" :size="44" />
        <span class="card-text">
          <span class="card-name">{{ current.name || "No community" }}</span>
          <span class="card-status">
            <span class="dot" :class="{ on: connected && !switchingTo }" aria-hidden="true" />{{ statusLabel }}
          </span>
        </span>
        <AppIcon name="chevron-right" :size="20" class="chev" />
      </button>

      <!-- Channels -->
      <div class="section-head">
        <h2 class="section-label">Channels</h2>
        <span v-if="visibleChannels.length" class="count">{{ visibleChannels.length }}</span>
      </div>
      <div class="list" data-testid="mobile-channel-list">
        <div v-if="isLoading" class="skeletons" role="status" aria-label="Loading channels" data-testid="mobile-skeleton">
          <span v-for="i in 3" :key="i" class="skeleton-row"><span class="sk-icon" /><span class="sk-line" /></span>
        </div>
        <StateView v-else-if="isError" kind="error" title="Couldn't load channels" @retry="refetch" />
        <StateView
          v-else-if="!visibleChannels.length"
          kind="empty"
          title="No channels yet"
          description="Channels you can see in this community will appear here."
        />
        <template v-else>
          <ChannelListItem
            v-for="channel in visibleChannels"
            :key="channel.id"
            :channel="channel"
            :active="false"
            :unread-count="readState.visibleUnread(channel.id)"
            :has-mention="readState.isReady && (readState.hasMention[channel.id] ?? false)"
            data-testid="mobile-channel-row"
            @click="openChannel(channel.id)"
          />
        </template>
      </div>

      <!-- Direct messages -->
      <div class="section-head">
        <h2 class="section-label">Direct messages</h2>
        <span v-if="dmRows.length" class="count">{{ dmRows.length }}</span>
      </div>
      <div class="list" data-testid="mobile-dm-list">
        <div v-if="dmLoading" class="skeletons" role="status" aria-label="Loading direct messages">
          <span v-for="i in 2" :key="i" class="skeleton-row tall"><span class="sk-avatar" /><span class="sk-line" /></span>
        </div>
        <StateView v-else-if="dmError" kind="error" title="Couldn't load direct messages" @retry="refetchDms" />
        <p v-else-if="!dmRows.length" class="empty" data-testid="mobile-dm-empty">Your direct conversations will appear here.</p>
        <template v-else>
          <button
            v-for="row in dmRows"
            :key="row.id"
            type="button"
            class="dm-row"
            :class="{ unread: row.unread > 0 }"
            :aria-label="row.unread ? `${row.name}, ${row.unread} unread` : row.name"
            data-testid="mobile-dm-row"
            @click="openDm(row.id)"
          >
            <AvatarCircle :name="row.name" :avatar-url="row.avatarUrl" :is-agent="row.isAgent" :pubkey="row.partner" :size="40" />
            <span class="dm-text">
              <span class="dm-line1">
                <span class="dm-name">{{ row.name }}</span>
                <span v-if="row.time" class="dm-time">{{ row.time }}</span>
              </span>
              <span v-if="row.preview" class="dm-preview">{{ row.preview }}</span>
            </span>
            <span v-if="row.unread" class="dm-badge" aria-hidden="true" data-testid="mobile-dm-badge">{{
              row.unread > 99 ? "99+" : row.unread
            }}</span>
          </button>
        </template>
      </div>
    </div>

    <MobileCommunitySheet v-if="showSheet" @close="showSheet = false" />
  </MobileLayout>
</template>

<style scoped>
.brand {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--color-text);
}
.brand span {
  color: var(--color-brand);
}
.profile-btn {
  text-decoration: none;
}

.home {
  padding: var(--space-4) var(--space-4) var(--space-5);
}
.section-label {
  margin: 0 0 var(--space-2);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-subtle);
}
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: var(--space-5);
}
.count {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

.community-card {
  width: 100%;
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  box-shadow: var(--shadow-sm);
  -webkit-tap-highlight-color: transparent;
  transition: background-color 120ms ease;
}
.community-card:active {
  background: var(--color-surface-muted);
}
.community-card:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}
.card-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card-name {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-text-subtle);
}
.dot.on {
  background: var(--color-success);
}
.chev {
  color: var(--color-text-subtle);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}
/* The desktop channel row, made touch-sized. */
.list :deep(.channel-item) {
  height: auto;
  min-height: 48px;
  padding: 0 var(--space-3);
  font-size: var(--font-size-md);
  border-radius: 12px;
  -webkit-tap-highlight-color: transparent;
}
.list :deep(.channel-item:active) {
  background: var(--color-surface-muted);
}
.list :deep(.badge) {
  min-width: 22px;
  height: 22px;
  line-height: 22px;
  font-size: 11px;
}

.dm-row {
  width: 100%;
  min-height: 60px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.dm-row:active {
  background: var(--color-surface-muted);
}
.dm-row:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}
.dm-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dm-line1 {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.dm-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-row.unread .dm-name {
  font-weight: 700;
}
.dm-time {
  flex: none;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.dm-preview {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-row.unread .dm-preview {
  color: var(--color-text);
}
.dm-badge {
  flex: none;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-text-on-accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 22px;
  text-align: center;
}
.empty {
  margin: 0;
  padding: var(--space-4) var(--space-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  text-align: center;
}

/* Skeletons: calm placeholders instead of spinners in lists. */
.skeletons {
  display: flex;
  flex-direction: column;
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 48px;
  padding: 0 var(--space-3);
}
.skeleton-row.tall {
  min-height: 60px;
}
.sk-icon,
.sk-avatar,
.sk-line {
  background: var(--color-surface-muted);
  animation: sk-pulse 1.2s ease-in-out infinite;
}
.sk-icon {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}
.sk-avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
}
.sk-line {
  flex: 1;
  max-width: 60%;
  height: 12px;
  border-radius: var(--radius-sm);
}
@keyframes sk-pulse {
  50% {
    opacity: 0.55;
  }
}

@media (max-width: 429.98px) {
  .home {
    padding: var(--space-3) var(--space-3) var(--space-4);
  }
}
@media (prefers-reduced-motion: reduce) {
  .community-card {
    transition: none;
  }
  .sk-icon,
  .sk-avatar,
  .sk-line {
    animation: none;
  }
}
</style>
