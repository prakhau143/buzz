<script setup lang="ts">
/**
 * Settings → Community (the open community). What each item really is
 * (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md §9):
 *  - Name: a label on THIS device (the relay stores none) — anyone.
 *  - Icon: server-side, kind 9033 — owners/admins (the relay decides).
 *  - Relay URL: the community's identity — read-only.
 *  - Members & roles, moderation: existing panels, gated by the relay's role.
 *  - Leave: kind 28936 — members/admins (an owner cannot leave).
 * OLD BUZZ's API token (never used) and repos directory (agents) are not here.
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import AppIcon from "@/components/AppIcon.vue";
import BaseButton from "@/components/BaseButton.vue";
import OverlayDialog from "@/components/OverlayDialog.vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import SettingsRow from "../primitives/SettingsRow.vue";
import SaveIndicator from "../primitives/SaveIndicator.vue";
import CommunityMembersPanel from "@/features/community-members/ui/CommunityMembersPanel.vue";
import ModerationQueuePanel from "@/features/moderation/ui/ModerationQueuePanel.vue";
import { useSessionStore } from "@/stores/session";
import { useCapabilities } from "@/features/access/capabilities";
import { activeRelayUrl, communities, forgetCommunity, relayHost, renameCommunity } from "@/features/communities/relayCommunities";
import { fetchCommunityIcon, makeIconDataUrl, setCommunityIcon } from "@/features/communities/communityIcon";
import { leaveCommunity } from "@/features/communities/leaveCommunity";
import { endIdentitySession } from "@/features/auth/identitySession";
import { logError, userMessageFor } from "@/services/errors";

const session = useSessionStore();
const can = useCapabilities();
const router = useRouter();

const relay = computed(() => activeRelayUrl.value ?? "");
const savedName = computed(() => communities.value.find((c) => c.relayUrl === relay.value)?.name ?? relayHost(relay.value));
const name = ref(savedName.value);
const nameState = ref<"idle" | "saved" | "error">("idle");
function saveName() {
  const next = name.value.trim();
  if (!next || next === savedName.value) return;
  try {
    renameCommunity(relay.value, next);
    nameState.value = "saved";
  } catch {
    nameState.value = "error";
  }
}

const role = computed(() => session.communityRole);
const roleLabel = computed(() => (role.value ? role.value[0].toUpperCase() + role.value.slice(1) : "Not a member"));
const isOwner = computed(() => role.value === "owner");

// ---- Icon ----
const icon = ref<string | null>(null);
const iconLoading = ref(true);
const iconState = ref<"idle" | "saving" | "saved" | "error">("idle");
const iconError = ref<string | null>(null);
const iconInput = ref<HTMLInputElement | null>(null);
onMounted(async () => {
  icon.value = relay.value ? await fetchCommunityIcon(relay.value) : null;
  iconLoading.value = false;
});
async function applyIcon(value: string) {
  iconState.value = "saving";
  iconError.value = null;
  try {
    await setCommunityIcon(value);
    icon.value = value || null;
    iconState.value = "saved";
  } catch (err) {
    iconState.value = "error";
    iconError.value = userMessageFor(err);
    logError("CommunitySection.icon", err);
  }
}
async function onIconFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  try {
    await applyIcon(await makeIconDataUrl(file));
  } catch (err) {
    iconState.value = "error";
    iconError.value = userMessageFor(err);
  }
}

// ---- Relay URL ----
const copied = ref(false);
async function copyRelay() {
  try {
    await navigator.clipboard.writeText(relay.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    // clipboard blocked; the address is visible anyway
  }
}

// ---- Leave ----
const confirmLeave = ref(false);
const leaving = ref(false);
const leaveError = ref<string | null>(null);
async function leave() {
  if (leaving.value || !relay.value) return;
  leaving.value = true;
  leaveError.value = null;
  try {
    await leaveCommunity();
    forgetCommunity(relay.value);
    confirmLeave.value = false;
    endIdentitySession();
    await router.push({ name: "communities" });
  } catch (err) {
    leaveError.value = userMessageFor(err);
  } finally {
    leaving.value = false;
  }
}
</script>

<template>
  <SettingsPage title="Community" :description="`Settings for ${savedName}.`">
    <SettingsCard title="Details">
      <div class="identity">
        <div class="icon-tile" :class="{ loading: iconLoading }">
          <img v-if="icon" :src="icon" alt="" />
          <span v-else>{{ savedName.trim()[0]?.toUpperCase() ?? "?" }}</span>
        </div>
        <div class="identity-text">
          <strong>{{ savedName }}</strong>
          <span class="muted">{{ relayHost(relay) }}</span>
          <span class="role-badge" :data-role="role ?? 'none'">{{ roleLabel }}</span>
        </div>
      </div>
      <SettingsRow
        label="Icon"
        :description="can.canManageCommunityMembers ? 'Shown to everyone in this community.' : 'Only owners and admins can change the icon.'"
      >
        <SaveIndicator v-if="iconState !== 'idle'" :state="iconState" :error="iconError" />
        <template v-if="can.canManageCommunityMembers">
          <BaseButton variant="secondary" :disabled="iconState === 'saving'" data-testid="community-icon-upload" @click="iconInput?.click()">
            <AppIcon name="upload" :size="16" />Upload
          </BaseButton>
          <BaseButton v-if="icon" variant="ghost" :disabled="iconState === 'saving'" @click="applyIcon('')">Remove</BaseButton>
          <input ref="iconInput" type="file" accept="image/*" class="hidden" @change="onIconFile" />
        </template>
      </SettingsRow>
      <SettingsRow label="Name" description="A label on this device only — the community itself has no name to change." for-id="community-name" stack>
        <input id="community-name" v-model="name" class="text-input" maxlength="60" data-testid="community-name" @input="nameState = 'idle'" @keydown.enter="saveName" />
        <BaseButton variant="secondary" :disabled="!name.trim() || name.trim() === savedName" @click="saveName">Save</BaseButton>
        <SaveIndicator v-if="nameState !== 'idle'" :state="nameState" />
      </SettingsRow>
      <SettingsRow label="Community address" :description="relay">
        <BaseButton variant="secondary" @click="copyRelay"><AppIcon :name="copied ? 'check' : 'copy'" :size="16" />{{ copied ? "Copied" : "Copy" }}</BaseButton>
      </SettingsRow>
    </SettingsCard>

    <SettingsCard title="Members and roles" description="Roles come from the community's server. Only owners and admins can change them.">
      <div class="panel-wrap"><CommunityMembersPanel /></div>
    </SettingsCard>

    <SettingsCard v-if="can.canModerateCommunity" title="Moderation" description="Reports and actions in this community.">
      <div class="panel-wrap"><ModerationQueuePanel /></div>
    </SettingsCard>

    <SettingsCard title="Leave">
      <SettingsRow
        label="Leave this community"
        :description="isOwner ? 'Owners can’t leave. Transfer ownership first.' : 'You’ll need a new invite to come back.'"
      >
        <BaseButton variant="danger" :disabled="isOwner" data-testid="community-leave" @click="confirmLeave = true">Leave community</BaseButton>
      </SettingsRow>
    </SettingsCard>

    <OverlayDialog v-if="confirmLeave" title="Leave community?" @close="confirmLeave = false">
      <p class="leave-copy">
        You'll be removed from <strong>{{ savedName }}</strong> on the server. Its channels and direct messages will no
        longer be available.
      </p>
      <p v-if="leaveError" class="leave-error" role="alert">{{ leaveError }}</p>
      <div class="leave-actions">
        <BaseButton variant="secondary" :disabled="leaving" @click="confirmLeave = false">Cancel</BaseButton>
        <BaseButton variant="danger" :disabled="leaving" @click="leave">{{ leaving ? "Leaving…" : "Leave community" }}</BaseButton>
      </div>
    </OverlayDialog>
  </SettingsPage>
</template>

<style scoped>
.identity {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5);
}
.icon-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 55%, #000));
  color: var(--color-on-primary);
  font-size: 26px;
  font-weight: 700;
  box-shadow: var(--shadow-md);
}
.icon-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.icon-tile.loading {
  opacity: 0.6;
}
.identity-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}
.identity-text strong {
  font-size: var(--font-size-lg);
}
.muted {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.role-badge {
  margin-top: 4px;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  font-size: var(--font-size-xs);
  font-weight: 600;
}
.role-badge[data-role="owner"],
.role-badge[data-role="admin"] {
  background: var(--color-primary-muted);
  color: var(--color-primary);
}
.text-input {
  flex: 1 1 200px;
  min-width: 0;
  max-width: 420px;
  height: 44px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}
.hidden {
  display: none;
}
.panel-wrap {
  padding: var(--space-4);
}
:deep(.settings-row .base-button) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.leave-copy {
  margin: 0 0 var(--space-3);
  color: var(--color-text-muted);
}
.leave-error {
  color: var(--color-danger);
}
.leave-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
