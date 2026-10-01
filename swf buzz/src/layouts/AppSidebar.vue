<script setup lang="ts">
/**
 * Shared left sidebar (Channels + Direct Messages) for both `ChannelsView`
 * and `DmView` — previously each view duplicated this markup and diverged:
 * `ChannelsView` showed a hardcoded "No conversations yet." placeholder
 * instead of the real DM list, and `DmView` didn't show channels at all.
 * One component, one real data source for each list, used identically by
 * both routes.
 */
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import StateView from "@/components/StateView.vue";
import ChannelListItem from "@/components/ChannelListItem.vue";
import DmParticipantLabel from "./DmParticipantLabel.vue";
import CreateChannelDialog from "@/features/channels/ui/CreateChannelDialog.vue";
import CommunityManagementModal from "@/features/community-members/ui/CommunityManagementModal.vue";
import { isPlatformAdminConfigured } from "@/features/platform-admin/usePlatformAdmin";
import { useSignOut } from "@/features/auth/useSignOut";
import SignOutDialog from "@/features/auth/ui/SignOutDialog.vue";
import { useSessionStore } from "@/stores/session";
import { useChannels } from "@/features/channels/useChannels";
import { useDmList } from "@/features/dm/useDmList";
import { useReadStateStore } from "@/stores/readState";
import { useUnreadCatchUp } from "@/features/readState/useUnreadCatchUp";
import { sidebarChannels } from "@/features/channels/channelVisibility";
import CreateCommunityDialog from "@/features/communities/ui/CreateCommunityDialog.vue";
import IdentityModal from "@/features/identity/ui/IdentityModal.vue";
import { operatorService } from "@/features/communities/OperatorService";
import { useCapabilities } from "@/features/access/capabilities";
import { useInboxBadge } from "@/features/inbox/useInboxBadge";
import SidebarUserCard from "./SidebarUserCard.vue";
import CommunitySwitcher from "./CommunitySwitcher.vue";
import { useUiStore } from "@/stores/ui";
import AppIcon from "@/components/AppIcon.vue";
import { config } from "@/app/config";
import { useShortcut } from "@/features/shortcuts/useShortcuts";
import { useReportActiveConversation } from "@/features/notifications/useNotificationService";
import SendFeedbackDialog from "@/features/feedback/ui/SendFeedbackDialog.vue";

const props = defineProps<{
  activeChannelId?: string | null;
  activeConversationId?: string | null;
  /** The Inbox route is open (it highlights the item and hides the badge). */
  inboxActive?: boolean;
}>();

/**
 * Search is one command palette ("Search anything", Ctrl/Cmd+K) over channels,
 * DMs, people and messages. The Inbox is a full workspace route (`/inbox`,
 * InboxView) — OLD BUZZ's model: list | detail | profile, not a dialog.
 */
const overlay = ref<"search" | null>(null);
const CommandPalette = defineAsyncComponent(() => import("@/features/search/ui/CommandPalette.vue"));
const ui = useUiStore();
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// Shortcuts come from the one registry (features/shortcuts/shortcutRegistry.ts).
useShortcut("quick-search", () => {
  overlay.value = overlay.value === "search" ? null : "search";
});
useShortcut("new-channel", () => {
  if (can.value.canCreateChannel) showCreateChannel.value = true;
});
useShortcut("go-inbox", () => void router.push({ name: "inbox" }));

function paletteOpenChannel(channelId: string, messageId?: string) {
  overlay.value = null;
  void router.push({ name: "channels", query: messageId ? { channelId, messageId } : { channelId } });
}
function paletteOpenDm(conversationId: string) {
  overlay.value = null;
  void router.push({ name: "dm", query: { conversationId } });
}
function paletteOpenPerson(pubkey: string) {
  // The profile panel offers "Message" (find-or-create the DM) — the same path
  // as clicking a member anywhere else.
  overlay.value = null;
  ui.openProfile(pubkey);
}
function paletteCreateChannel() {
  overlay.value = null;
  showCreateChannel.value = true;
}

// Sidebar Inbox badge (OLD BUZZ) — the same rule as the mobile bottom nav.
const inboxBadge = useInboxBadge(() => !!props.inboxActive);

// Every role-gated control below reads the capability model (one place that
// turns platformRole/communityRole into UI capabilities) — never a role label,
// a hostname, a cached flag or a previous session.
const can = useCapabilities();

const { showConfirm: showSignOut, requestSignOut, confirmSignOut, cancelSignOut, isSigningOut } = useSignOut();
const session = useSessionStore();
const router = useRouter();

const { data: channels, isLoading: channelsLoading, isError: channelsError, refetch: refetchChannels } = useChannels();
const { data: conversations, isLoading: dmLoading, isError: dmError } = useDmList();
const channelReadState = useReadStateStore();
// Live unread tracking, desktop alerts and the taskbar dot run session-wide
// (features/notifications/useNotificationService.ts, mounted by
// app/SessionServices.vue) so they keep working in Settings; the sidebar only
// reports which conversation is on screen.
useReportActiveConversation(() => props.activeChannelId ?? props.activeConversationId ?? null);

// Archived channels (including every ended OLD BUZZ huddle) never list —
// see features/channels/channelVisibility.ts. Live 39000 updates re-run this.
const visibleChannels = computed(() => sidebarChannels(channels.value));

// Startup unread catch-up (shared with the mobile Home — runs once per identity + community).
useUnreadCatchUp(() => props.activeChannelId ?? props.activeConversationId ?? null);


const showCreateChannel = ref(false);
const showCommunityModal = ref(false);
const showIdentity = ref(false);
const showCreateCommunity = ref(false);
const showFeedback = ref(false);
// Operator only — decided by the RELAY (it answers the operator probe with 403
// for anyone else), never assumed. `session.platformRole` is that answer for
// the CURRENTLY authenticated pubkey, resolved when the session was
// established (identitySession.ts) and cleared on sign-out — so a previous
// identity's answer can never linger here. Re-probed once on mount as a
// belt-and-braces check; hidden on any failure.
onMounted(async () => {
  if (session.authMode === "local" && session.pubkey) {
    const forPubkey = session.pubkey;
    const answer = await operatorService.isOperator(config.relayUrl).catch(() => false);
    // Only apply if the same identity is still signed in (a switch may have
    // happened while the probe was in flight).
    const stillSameIdentity = session.pubkey === forPubkey;
    if (stillSameIdentity) {
      session.setPlatformRole(answer ? "operator" : null);
    }
  }
});

const platformAdminAvailable = isPlatformAdminConfigured();

function otherParticipant(conversationId: string): string | null {
  const convo = conversations.value?.find((c) => c.id === conversationId);
  return convo?.dmParticipants?.find((p) => p !== session.pubkey) ?? null;
}

/** DM unread from the shared NIP-RS frontier — zero until hydrated, and never for the open one. */
function dmUnread(conversationId: string): number {
  return conversationId === activeConversationId.value ? 0 : channelReadState.visibleUnread(conversationId);
}

function selectChannel(channelId: string) {
  void router.push({ name: "channels", query: { channelId } });
}

function selectConversation(conversationId: string) {
  // Marked read by DmView with the newest message's timestamp, not here: a
  // click proves nothing about which messages were actually on screen.
  void router.push({ name: "dm", query: { conversationId } });
}

const activeChannelId = computed(() => props.activeChannelId ?? null);
const activeConversationId = computed(() => props.activeConversationId ?? null);
</script>

<template>
  <div class="sidebar-content">
    <div class="sidebar-top">
      <CommunitySwitcher />
    </div>
    <nav class="sidebar-nav" aria-label="Search and inbox">
      <button
        type="button"
        class="search-trigger"
        aria-haspopup="dialog"
        :aria-keyshortcuts="isMac ? 'Meta+K' : 'Control+K'"
        data-testid="sidebar-search"
        @click="overlay = 'search'"
      >
        <AppIcon name="search" :size="16" class="search-trigger-icon" />
        <span class="search-trigger-label">Search anything…</span>
        <kbd class="search-trigger-kbd" aria-hidden="true">{{ isMac ? "⌘K" : "Ctrl K" }}</kbd>
      </button>
      <RouterLink
        :to="{ name: 'inbox' }"
        class="nav-item"
        :class="{ active: inboxActive }"
        :aria-current="inboxActive ? 'page' : undefined"
        data-testid="sidebar-inbox"
      >
        <span class="nav-label">Inbox</span>
        <span v-if="inboxBadge" class="nav-badge" data-testid="sidebar-inbox-badge" :aria-label="`${inboxBadge} unread`">
          {{ inboxBadge > 99 ? "99+" : inboxBadge }}
        </span>
      </RouterLink>
    </nav>

    <div class="sidebar-section">
      <div class="sidebar-section-header">
        <h2>Channels</h2>
        <button
          v-if="can.canCreateChannel"
          type="button"
          class="create-channel-button"
          aria-label="Create channel"
          title="Create channel"
          data-testid="create-channel-button"
          @click="showCreateChannel = true"
        >
          +
        </button>
      </div>
      <StateView v-if="channelsLoading" kind="loading" />
      <StateView v-else-if="channelsError" kind="error" title="Couldn't load channels" @retry="refetchChannels" />
      <p v-else-if="!visibleChannels.length" class="muted">No channels yet.</p>
      <ChannelListItem
        v-for="channel in visibleChannels"
        :key="channel.id"
        :channel="channel"
        :active="channel.id === activeChannelId"
        :unread-count="channelReadState.visibleUnread(channel.id)"
        :has-mention="channelReadState.isReady && (channelReadState.hasMention[channel.id] ?? false)"
        @click="selectChannel(channel.id)"
      />
    </div>

    <div class="sidebar-section">
      <h2>Direct messages</h2>
      <StateView v-if="dmLoading" kind="loading" />
      <StateView v-else-if="dmError" kind="error" title="Couldn't load conversations" />
      <p v-else-if="!conversations?.length" class="muted">No conversations yet.</p>
      <button
        v-for="conversation in conversations"
        :key="conversation.id"
        type="button"
        class="dm-item"
        :class="{ active: conversation.id === activeConversationId, unread: dmUnread(conversation.id) > 0 }"
        :aria-current="conversation.id === activeConversationId ? 'page' : undefined"
        data-testid="sidebar-dm"
        @click="selectConversation(conversation.id)"
      >
        <!-- The dot on the avatar is PRESENCE (one store, by pubkey). Unread is
             shown as a bold name instead of a second dot: a coloured dot beside
             the name used to be read as the person's status. -->
        <DmParticipantLabel :pubkey="otherParticipant(conversation.id)" />
        <span
          v-if="dmUnread(conversation.id)"
          class="dm-badge"
          data-testid="sidebar-dm-badge"
          :aria-label="`${dmUnread(conversation.id)} unread`"
        >{{ dmUnread(conversation.id) > 99 ? "99+" : dmUnread(conversation.id) }}</span>
      </button>
      <!-- A conversation is started from a person, not from a key: open a
           member's profile and choose Message (UserProfilePanel →
           openDirectConversation). The hex-pubkey box that used to live here
           asked people to handle raw key material to do something the member
           list already does. -->
    </div>

    <div class="sidebar-footer">
      <!-- One compact card: avatar + live presence, status, current community.
           Everything that used to be a stacked link lives in its menus. -->
      <SidebarUserCard
        v-if="session.pubkey"
        @identity="showIdentity = true"
        @members="showCommunityModal = true"
        @create-community="showCreateCommunity = true"
        @sign-out="requestSignOut"
        @feedback="showFeedback = true"
      />
      <!-- Only for non-local sign-in modes (HTTP-backend screens / deployment console). -->
      <nav v-if="session.authMode !== 'local' || platformAdminAvailable" class="footer-links">
        <template v-if="session.authMode !== 'local'">
          <RouterLink to="/community" class="admin-link">Channels</RouterLink>
          <RouterLink to="/community-dm" class="admin-link">Direct Messages</RouterLink>
        </template>
        <RouterLink v-if="platformAdminAvailable" to="/platform-admin" class="admin-link">Platform Admin</RouterLink>
      </nav>
    </div>
  </div>

  <SignOutDialog v-if="showSignOut" :busy="isSigningOut" @close="cancelSignOut" @confirm="confirmSignOut" />
  <CreateChannelDialog v-if="showCreateChannel" @close="showCreateChannel = false" />
  <IdentityModal v-if="showIdentity" @close="showIdentity = false" />
  <CreateCommunityDialog v-if="showCreateCommunity" @close="showCreateCommunity = false" />
  <component
    :is="CommandPalette"
    v-if="overlay === 'search'"
    :can-create-channel="can.canCreateChannel"
    @close="overlay = null"
    @open-channel="paletteOpenChannel"
    @open-dm="paletteOpenDm"
    @open-person="paletteOpenPerson"
    @create-channel="paletteCreateChannel"
  />
  <SendFeedbackDialog v-if="showFeedback" @close="showFeedback = false" />
  <CommunityManagementModal
    v-if="showCommunityModal"
    :selected-channel-id="activeChannelId"
    @close="showCommunityModal = false"
  />
</template>

<style scoped>
.sidebar-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--space-4);
}

.sidebar-section {
  margin-bottom: var(--space-5);
}

.sidebar-section h2 {
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-subtle);
  margin: 0 0 var(--space-2);
}

.sidebar-top {
  margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-2)) var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: var(--space-3);
}

.search-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 34px;
  margin-bottom: var(--space-2);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-subtle);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.search-trigger:hover {
  border-color: var(--color-border-strong);
}
.search-trigger:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
.search-trigger-icon {
  flex-shrink: 0;
}
.search-trigger-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-trigger-kbd {
  flex-shrink: 0;
  padding: 0 5px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  font-family: var(--font-sans);
  font-size: 11px;
  color: var(--color-text-muted);
}

.nav-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  text-align: left;
  cursor: pointer;
}
.nav-item:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}
a.nav-item {
  text-decoration: none;
}
.nav-item.active {
  background: var(--color-surface-hover);
  color: var(--color-text);
  font-weight: 600;
}
.nav-label {
  flex: 1;
}
.nav-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--color-primary);
  color: var(--color-text-on-accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.nav-item:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.sidebar-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sidebar-section-header h2 {
  margin: 0;
}

.create-channel-button {
  border: none;
  background: transparent;
  color: var(--color-text-subtle);
  font-size: var(--font-size-md);
  line-height: 1;
  cursor: pointer;
  padding: 0 var(--space-1) var(--space-2);
  margin-bottom: var(--space-2);
}
.create-channel-button:hover {
  color: var(--color-text);
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.dm-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 32px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  cursor: pointer;
  text-align: left;
}
.dm-badge {
  margin-left: auto;
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--color-primary);
  color: var(--color-text-on-accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.dm-item:hover {
  background: var(--color-surface-hover);
}
.dm-item.active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}
.dm-item.unread :deep(.dm-name) {
  font-weight: 700;
  color: var(--color-text);
}
.dm-item :deep(.dm-name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.admin-link {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  margin-bottom: var(--space-2);
  text-decoration: none;
}
.admin-link:hover {
  color: var(--color-text);
  text-decoration: underline;
}

.sidebar-footer {
  margin-top: auto;
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.identity-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.identity-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.identity-main:hover,
.identity-main:focus-visible {
  border-color: var(--color-border);
  background: var(--color-surface-muted);
}
.identity-main:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.identity-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.identity-name {
  font-weight: 600;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.identity-roles {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
}
.identity-key-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-left: calc(28px + var(--space-2) + var(--space-1));
}
.identity-key {
  font-family: monospace;
  color: var(--color-text-subtle);
}
/* Revealed on hover/focus of the block, per the design spec. */
.copy-key {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: var(--font-size-xs);
  color: var(--color-accent);
  cursor: pointer;
  opacity: 0;
}
.identity-block:hover .copy-key,
.copy-key:focus-visible {
  opacity: 1;
}
.role-badge {
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  background: var(--color-surface);
}
.role-badge--platform {
  color: var(--color-accent, var(--color-text));
  border-color: var(--color-accent, var(--color-border));
}
</style>
