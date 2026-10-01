<script setup lang="ts">
/**
 * Settings → Notifications. Per identity, on this device
 * (features/notifications/notificationSettings.ts). OS permission is asked
 * for only when desktop alerts are switched on here, and its real state is
 * shown — never assumed.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import AppIcon from "@/components/AppIcon.vue";
import BaseButton from "@/components/BaseButton.vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import SettingsRow from "../primitives/SettingsRow.vue";
import ToggleSwitch from "../primitives/ToggleSwitch.vue";
import SaveIndicator from "../primitives/SaveIndicator.vue";
import { useSessionStore } from "@/stores/session";
import { NOTIFICATION_SLOTS, useNotificationSettings, type NotificationSlot } from "@/features/notifications/notificationSettings";
import {
  alertIfAllowed,
  notificationPermission,
  playChime,
  requestNotificationPermission,
  type PermissionState,
} from "@/features/notifications/desktopNotifier";

const session = useSessionStore();
const { settings, update } = useNotificationSettings(() => session.pubkey);
const permission = ref<PermissionState | "checking">("checking");
const requesting = ref(false);
const saveState = ref<"idle" | "saved" | "error">("idle");
let timer: ReturnType<typeof setTimeout> | undefined;

const nativeApp = isTauri();

async function refreshPermission() {
  permission.value = await notificationPermission();
}
// The OS setting can change while Settings is open (Windows → Notifications).
const onWindowFocus = () => void refreshPermission();
onMounted(() => {
  void refreshPermission();
  window.addEventListener("focus", onWindowFocus);
});
onUnmounted(() => window.removeEventListener("focus", onWindowFocus));

function saved(ok: boolean) {
  saveState.value = ok ? "saved" : "error";
  clearTimeout(timer);
  if (ok) timer = setTimeout(() => (saveState.value = "idle"), 1800);
}

async function setDesktop(on: boolean) {
  if (on && permission.value !== "granted") {
    requesting.value = true;
    permission.value = await requestNotificationPermission();
    requesting.value = false;
    if (permission.value !== "granted") {
      saved(update({ desktopEnabled: false }));
      return;
    }
  }
  saved(update({ desktopEnabled: on }));
}
function setSlot(slot: NotificationSlot, on: boolean) {
  saved(update({ slots: { [slot]: on } }));
}

const permissionNote = computed(() => {
  switch (permission.value) {
    case "denied":
      return nativeApp
        ? "Windows is blocking notifications for SWF Buzz. Turn them on in Windows Settings → System → Notifications, then come back here."
        : "Notifications are blocked for SWF Buzz in your browser. Allow them there, then turn alerts on again.";
    case "unsupported":
      return "Desktop notifications aren't available on this device.";
    default:
      return null;
  }
});

const testing = ref<"idle" | "sent" | "blocked">("idle");
/** A real OS toast through the same delivery path — it touches no unread state. */
async function sendTest() {
  await refreshPermission();
  const shown = await alertIfAllowed({ slot: "mention", title: "SWF Buzz", body: "This is how alerts will look.", viewing: false });
  testing.value = shown ? "sent" : "blocked";
  setTimeout(() => (testing.value = "idle"), 2500);
}
</script>

<template>
  <SettingsPage title="Notifications" description="Alerts, sounds and badges for your account on this device.">
    <template #actions><SaveIndicator :state="saveState === 'idle' ? 'idle' : saveState" error="Couldn't save on this device" /></template>

    <p v-if="permissionNote" class="banner" role="status" data-testid="notification-permission-note">
      <AppIcon name="warning" :size="16" />{{ permissionNote }}
    </p>

    <SettingsCard title="Desktop">
      <SettingsRow
        label="Desktop notifications"
        :description="
          requesting
            ? 'Asking your system for permission…'
            : nativeApp
              ? 'Show Windows notifications when SWF Buzz needs your attention. While SWF Buzz is in front, they appear inside the app instead.'
              : 'Show system notifications when SWF Buzz needs your attention.'
        "
        for-id="n-desktop"
      >
        <ToggleSwitch
          id="n-desktop"
          :model-value="settings.desktopEnabled && permission === 'granted'"
          label="Desktop notifications"
          :disabled="requesting || permission === 'unsupported' || permission === 'checking'"
          @update:model-value="setDesktop"
        />
      </SettingsRow>
      <SettingsRow
        label="Notify while viewing"
        description="Also alert for the conversation that is open on screen while SWF Buzz is in front. Off: that conversation stays quiet (everything else still alerts)."
        for-id="n-viewing"
      >
        <ToggleSwitch
          id="n-viewing"
          :model-value="settings.notifyWhileViewing"
          label="Notify while viewing"
          :disabled="!settings.desktopEnabled"
          @update:model-value="(v) => saved(update({ notifyWhileViewing: v }))"
        />
      </SettingsRow>
      <SettingsRow
        label="Send a test notification"
        :description="nativeApp ? 'Sends a real Windows notification through the same path as messages.' : undefined"
      >
        <span v-if="testing !== 'idle'" class="test-state">{{ testing === "sent" ? "Sent" : "Not shown — check the settings above" }}</span>
        <BaseButton variant="secondary" :disabled="!settings.desktopEnabled" @click="sendTest">Test</BaseButton>
      </SettingsRow>
    </SettingsCard>

    <SettingsCard title="Alert me about">
      <SettingsRow v-for="slot in NOTIFICATION_SLOTS" :key="slot.id" :label="slot.label" :description="slot.description" :for-id="`n-${slot.id}`">
        <ToggleSwitch
          :id="`n-${slot.id}`"
          :model-value="settings.slots[slot.id]"
          :label="slot.label"
          :disabled="!settings.desktopEnabled"
          @update:model-value="(v) => setSlot(slot.id, v)"
        />
      </SettingsRow>
    </SettingsCard>

    <SettingsCard title="Sound and badges">
      <SettingsRow
        label="Sound"
        :description="nativeApp ? 'Play the Windows notification sound with each alert.' : 'Play a soft chime with each alert.'"
        for-id="n-sound"
      >
        <BaseButton v-if="!nativeApp" variant="ghost" :disabled="!settings.soundEnabled" @click="playChime">Preview</BaseButton>
        <ToggleSwitch id="n-sound" :model-value="settings.soundEnabled" label="Sound" @update:model-value="(v) => saved(update({ soundEnabled: v }))" />
      </SettingsRow>
      <SettingsRow label="Inbox badge" description="Count of unread mentions and requests next to Inbox." for-id="n-badge">
        <ToggleSwitch id="n-badge" :model-value="settings.homeBadge" label="Inbox badge" @update:model-value="(v) => saved(update({ homeBadge: v }))" />
      </SettingsRow>
      <SettingsRow
        v-if="nativeApp"
        label="Taskbar indicator"
        description="Show a small dot on the SWF Buzz taskbar icon when unread attention is waiting — direct messages, mentions and requests. Ordinary channel messages never light it."
        for-id="n-taskbar"
      >
        <ToggleSwitch
          id="n-taskbar"
          :model-value="settings.taskbarIndicator"
          label="Taskbar indicator"
          @update:model-value="(v) => saved(update({ taskbarIndicator: v }))"
        />
      </SettingsRow>
    </SettingsCard>

    <p class="footnote">These settings apply to every community on this device. Alerts come from the community you have open.</p>
  </SettingsPage>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent);
  border-radius: 12px;
  background: var(--color-warning-muted);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}
.test-state {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.footnote {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-subtle);
}
</style>
