<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AvatarCircle from "@/components/AvatarCircle.vue";
import AnchoredPopover from "@/components/AnchoredPopover.vue";
import AppIcon from "@/components/AppIcon.vue";
import OverlayDialog from "@/components/OverlayDialog.vue";
import { shortcutHint } from "@/features/shortcuts/shortcutRegistry";
import BaseButton from "@/components/BaseButton.vue";
import SetStatusModal from "@/features/presence/ui/SetStatusModal.vue";
import CommunitySettingsDialog from "@/features/communities/ui/CommunitySettingsDialog.vue";
import { usePresenceOf, useUserStatusOf } from "@/features/presence/presenceSync";
import { useDisplayName } from "@/composables/useProfile";
import { useCapabilities } from "@/features/access/capabilities";
import { useSessionStore } from "@/stores/session";
import { useAccessStore } from "@/stores/access";
import { activeRelayUrl, communities, forgetCommunity, relayHost } from "@/features/communities/relayCommunities";
import { leaveCommunity } from "@/features/communities/leaveCommunity";
import { endIdentitySession } from "@/features/auth/identitySession";
import { userMessageFor } from "@/services/errors";

/**
 * The bottom-left control centre: one compact card (avatar + live presence,
 * name, status, current community) that opens the personal menu; the community
 * row in it opens the community submenu. Replaces the old stack of links.
 *
 * Structure follows OLD BUZZ's profile menu (identity block → status →
 * community › → Send feedback → Settings) with SWF's changes: Sign out in this
 * menu, My identity / Operator dashboard in the community menu, and no
 * developer-only entries (identity diagnostics) in this user-facing menu.
 * Menus are AnchoredPopovers positioned from the card's real rectangle; only
 * one menu chain is open at a time; Escape / outside click close it.
 */
const emit = defineEmits<{
  identity: [];
  members: [];
  "create-community": [];
  "sign-out": [];
  feedback: [];
}>();

const session = useSessionStore();
const access = useAccessStore();
const router = useRouter();
const route = useRoute();
const can = useCapabilities();
const { profile: myProfile, displayName } = useDisplayName(() => session.pubkey);
const presence = usePresenceOf(() => session.pubkey);
const status = useUserStatusOf(() => session.pubkey);

type Menu = "profile" | "community" | null;
type Dialog = "status" | "community-settings" | "leave" | null;
const menu = ref<Menu>(null);
const dialog = ref<Dialog>(null);

const card = ref<HTMLElement | null>(null);
const communityRow = ref<HTMLElement | null>(null);

const PRESENCE_LABEL = { online: "Online", away: "Away", offline: "Offline" } as const;
const presenceLabel = computed(() => (presence.value ? PRESENCE_LABEL[presence.value] : null));

const communityName = computed(
  () => communities.value.find((c) => c.relayUrl === activeRelayUrl.value)?.name ?? relayHost(activeRelayUrl.value ?? ""),
);
const communityInitial = computed(() => communityName.value.trim()[0]?.toUpperCase() ?? "?");
const hasOtherCommunities = computed(() => access.memberships.length > 1);
const settingsHint = shortcutHint("open-settings");

function openDialog(next: Dialog) {
  menu.value = null;
  dialog.value = next;
}
function closeAll() {
  menu.value = null;
}
type CardEvent = "identity" | "members" | "create-community" | "sign-out" | "feedback";
function act(event: CardEvent) {
  menu.value = null;
  (emit as (e: CardEvent) => void)(event);
}

const copied = ref(false);
/** OLD BUZZ copies the relay address itself (`wss://…`). */
async function copyCommunityUrl() {
  if (!activeRelayUrl.value) return;
  try {
    await navigator.clipboard.writeText(activeRelayUrl.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    // Clipboard blocked — the address is shown in Community settings.
  }
}

function go(name: "operator" | "communities") {
  menu.value = null;
  void router.push({ name });
}

// Leave community (server-side NIP-43 leave; local cleanup only after the relay's OK).
const leaving = ref(false);
const leaveError = ref<string | null>(null);
async function confirmLeave() {
  const relay = activeRelayUrl.value;
  if (!relay || leaving.value) return;
  leaving.value = true;
  leaveError.value = null;
  try {
    await leaveCommunity();
    forgetCommunity(relay);
    dialog.value = null;
    endIdentitySession(); // closes the socket and clears this community's state; the identity stays
    await router.push({ name: "communities" }); // re-discovers memberships; none left → Welcome
  } catch (err) {
    leaveError.value = userMessageFor(err);
  } finally {
    leaving.value = false;
  }
}

/** Settings is a full-screen page (Ctrl+, works everywhere — app/SessionServices.vue). */
function openSettings() {
  menu.value = null;
  void router.push({ name: "settings", query: { section: "profile", from: route.fullPath } });
}
</script>

<template>
  <button
    ref="card"
    type="button"
    class="user-card"
    :class="{ open: menu !== null }"
    aria-haspopup="menu"
    :aria-expanded="menu !== null"
    :aria-label="`${displayName}${presenceLabel ? `, ${presenceLabel}` : ''}. Open profile menu`"
    data-testid="user-card"
    @click="menu = menu ? null : 'profile'"
  >
    <AvatarCircle :name="displayName" :avatar-url="myProfile?.avatarUrl" :pubkey="session.pubkey" :size="36" />
    <span class="card-text">
      <span class="card-name" data-testid="user-card-name">{{ displayName }}</span>
      <span class="card-sub">
        <template v-if="status">
          <span aria-hidden="true">{{ status.emoji }}</span> {{ status.text || presenceLabel }}
        </template>
        <template v-else>{{ presenceLabel ?? "Connecting…" }}</template>
      </span>
      <span class="card-community" data-testid="user-card-community">
        <span class="community-tile" aria-hidden="true">{{ communityInitial }}</span>{{ communityName }}
      </span>
    </span>
  </button>

  <AnchoredPopover v-if="menu" :anchor="card" label="Profile menu" :width="288" @close="closeAll">
    <div class="menu-identity">
      <AvatarCircle :name="displayName" :avatar-url="myProfile?.avatarUrl" :pubkey="session.pubkey" :size="40" />
      <div class="menu-identity-text">
        <span class="menu-name">{{ displayName }}</span>
        <span v-if="presenceLabel" class="menu-presence" data-testid="menu-presence">{{ presenceLabel }}</span>
      </div>
    </div>

    <button type="button" role="menuitem" class="menu-item status-item" data-testid="menu-status" @click="openDialog('status')">
      <span class="item-icon" aria-hidden="true">{{ status?.emoji || "☺" }}</span>
      <span class="item-label">{{ status ? status.text || "Edit status" : "Update your status" }}</span>
    </button>
    <div class="menu-divider" />

    <button
      ref="communityRow"
      type="button"
      role="menuitem"
      class="menu-item"
      :class="{ active: menu === 'community' }"
      aria-haspopup="menu"
      :aria-expanded="menu === 'community'"
      data-testid="menu-community"
      @click="menu = menu === 'community' ? 'profile' : 'community'"
      @keydown.right.prevent="menu = 'community'"
    >
      <span class="community-tile" aria-hidden="true">{{ communityInitial }}</span>
      <span class="item-label">{{ communityName }}</span>
      <span class="chevron" aria-hidden="true">›</span>
    </button>
    <div class="menu-divider" />

    <button type="button" role="menuitem" class="menu-item" data-testid="menu-send-feedback" @click="act('feedback')">
      <AppIcon name="message" :size="16" class="item-icon" />
      <span class="item-label">Send feedback</span>
    </button>
    <button type="button" role="menuitem" class="menu-item" data-testid="menu-settings" @click="openSettings">
      <AppIcon name="settings" :size="16" class="item-icon" />
      <span class="item-label">Settings</span>
      <kbd class="hint">{{ settingsHint }}</kbd>
    </button>
    <div class="menu-divider" />
    <button type="button" role="menuitem" class="menu-item" data-testid="sign-out" @click="act('sign-out')">
      <AppIcon name="leave" :size="16" class="item-icon" />
      <span class="item-label">Sign out</span>
    </button>

    <AnchoredPopover
      v-if="menu === 'community'"
      nested
      :anchor="communityRow"
      align="start"
      label="Community menu"
      :width="264"
      @close="menu = 'profile'"
    >
      <button type="button" role="menuitem" class="menu-item" data-testid="menu-copy-url" @click="copyCommunityUrl">
        <AppIcon name="link" :size="16" class="item-icon" />
        <span class="item-label">{{ copied ? "Copied!" : "Copy community URL" }}</span>
      </button>
      <div class="menu-divider" />
      <button type="button" role="menuitem" class="menu-item" data-testid="menu-identity" @click="act('identity')">
        <span class="item-icon" aria-hidden="true">🪪</span>
        <span class="item-label">My identity</span>
      </button>
      <button type="button" role="menuitem" class="menu-item" data-testid="menu-members" @click="act('members')">
        <AppIcon name="users" :size="16" class="item-icon" />
        <span class="item-label">Members &amp; moderation</span>
      </button>
      <button
        v-if="can.canAccessOperatorDashboard"
        type="button"
        role="menuitem"
        class="menu-item"
        data-testid="menu-operator"
        @click="go('operator')"
      >
        <span class="item-icon" aria-hidden="true">🛠</span>
        <span class="item-label">Operator Dashboard</span>
      </button>
      <button
        v-if="hasOtherCommunities"
        type="button"
        role="menuitem"
        class="menu-item"
        data-testid="menu-switch"
        @click="go('communities')"
      >
        <span class="item-icon" aria-hidden="true">⇄</span>
        <span class="item-label">Switch community</span>
      </button>
      <div class="menu-divider" />
      <button type="button" role="menuitem" class="menu-item" data-testid="menu-community-settings" @click="openDialog('community-settings')">
        <AppIcon name="settings" :size="16" class="item-icon" />
        <span class="item-label">Community settings</span>
      </button>
      <button type="button" role="menuitem" class="menu-item danger" data-testid="menu-leave" @click="openDialog('leave')">
        <AppIcon name="leave" :size="16" class="item-icon" />
        <span class="item-label">Leave community</span>
      </button>
      <div class="menu-divider" />
      <button
        v-if="can.canCreateCommunity"
        type="button"
        role="menuitem"
        class="menu-item"
        data-testid="menu-create-community"
        @click="act('create-community')"
      >
        <AppIcon name="plus" :size="16" class="item-icon" />
        <span class="item-label">Create community</span>
      </button>
      <button type="button" role="menuitem" class="menu-item" data-testid="menu-add-community" @click="go('communities')">
        <AppIcon name="plus" :size="16" class="item-icon" />
        <span class="item-label">Add a community</span>
      </button>
    </AnchoredPopover>
  </AnchoredPopover>

  <SetStatusModal v-if="dialog === 'status'" @close="dialog = null" />

  <CommunitySettingsDialog v-if="dialog === 'community-settings'" @close="dialog = null" />

  <OverlayDialog v-if="dialog === 'leave'" title="Leave community?" @close="dialog = null">
    <div class="leave" data-testid="leave-community-dialog">
      <p>
        You'll be removed from <strong>{{ communityName }}</strong> on the server. Its channels and direct
        messages will no longer be available, and you'll need a new invite to come back.
      </p>
      <p v-if="leaveError" class="leave-error" role="alert">{{ leaveError }}</p>
      <div class="leave-actions">
        <BaseButton variant="secondary" :disabled="leaving" @click="dialog = null">Cancel</BaseButton>
        <BaseButton variant="danger" :disabled="leaving" data-testid="confirm-leave-community" @click="confirmLeave">
          {{ leaving ? "Leaving…" : "Leave community" }}
        </BaseButton>
      </div>
    </div>
  </OverlayDialog>
</template>

<style scoped>
.user-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 72px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease;
}
.user-card:hover,
.user-card.open {
  background: var(--color-surface-muted);
}
.user-card:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.card-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}
.card-name {
  font-weight: 600;
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-sub,
.card-community {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-community {
  display: flex;
  align-items: center;
  gap: 6px;
}
.community-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--color-primary);
  color: var(--color-text-on-accent);
  font-size: 11px;
  font-weight: 700;
}

.menu-identity {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3) var(--space-3);
}
.menu-identity-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.menu-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-presence {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 40px;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}
.menu-item:hover,
.menu-item:focus-visible,
.menu-item.active {
  background: var(--color-surface-muted);
  outline: none;
}
.menu-item.danger {
  color: var(--color-danger);
}
.menu-item.subtle {
  color: var(--color-text-muted);
}
.item-icon {
  width: 18px;
  flex-shrink: 0;
  text-align: center;
}
.item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-item {
  border: 1px solid var(--color-border);
  margin-bottom: var(--space-1);
}
.chevron {
  color: var(--color-text-subtle);
  font-size: 1.1rem;
}
.hint {
  font-family: inherit;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.menu-divider {
  height: 1px;
  margin: var(--space-1) var(--space-2);
  background: var(--color-border);
}

.leave p {
  margin: 0 0 var(--space-3);
  color: var(--color-text-muted);
}
.leave-error {
  color: var(--color-danger) !important;
}
.leave-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
