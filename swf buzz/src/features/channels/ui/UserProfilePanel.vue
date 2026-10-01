<script setup lang="ts">
import CloseButton from "@/components/CloseButton.vue";
import { computed, nextTick, onMounted, ref } from "vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import BaseButton from "@/components/BaseButton.vue";
import StateView from "@/components/StateView.vue";
import PresenceDot from "@/features/presence/PresenceDot.vue";
import { useProfile } from "@/composables/useProfile";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { usePresenceOf, useUserStatusOf } from "@/features/presence/presenceSync";
import { useDirectConversation } from "@/features/dm/useDirectConversation";
import { useSessionStore } from "@/stores/session";
import { userMessageFor } from "@/services/errors";

/**
 * A person's profile, opened from a message author (avatar or name), a member
 * list or a DM header — always by pubkey, never by display name. Lives in the
 * details pane beside the conversation, so closing it returns to exactly the
 * same channel, scroll position and composer text.
 *
 * Presence comes from the one presence store (same answer as the sidebar and
 * every avatar). Actions follow OLD BUZZ (`useProfileInteractionActions.ts`):
 * Message = find-or-create the 1:1 DM; Wave = the wave marker message in that
 * DM. No Huddle action: huddles are outside SWF Buzz's product boundary (no
 * creation, no audio, no join), so nothing here offers or teases one.
 */
const props = defineProps<{ pubkey: string }>();
const emit = defineEmits<{ close: [] }>();

const session = useSessionStore();
const { data: profile, isLoading, isError } = useProfile(() => props.pubkey);
const { data: myProfile } = useProfile(() => session.pubkey);
const { openDirectConversation, waveAt } = useDirectConversation();
const presenceStatus = usePresenceOf(() => props.pubkey);
/** Their custom status (NIP-38) — separate from presence; both can show. */
const customStatus = useUserStatusOf(() => props.pubkey);
const errorMessage = ref<string | null>(null);
const copied = ref(false);
/** One action at a time: a second click while one is running does nothing. */
const busy = ref<"message" | "wave" | null>(null);
const waved = ref(false);
const panel = ref<HTMLElement | null>(null);

useEscapeKey(() => emit("close"));
// Focus the panel so keyboard users land in it (Escape closes, Tab reaches the actions).
onMounted(() => nextTick(() => panel.value?.focus()));

const STATUS_LABELS = { online: "Online", away: "Away", offline: "Offline" } as const;
const statusLabel = computed(() => (presenceStatus.value ? STATUS_LABELS[presenceStatus.value] : null));

/** The key stays verifiable — a name can be chosen, a public key cannot. */
async function copyKey() {
  try {
    await navigator.clipboard.writeText(props.pubkey);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    // Clipboard blocked — the key is shown in full above and can be selected.
  }
}

const displayName = computed(() => profile.value?.displayName ?? props.pubkey.slice(0, 8));
const isSelf = computed(() => session.pubkey === props.pubkey);
const canWave = computed(() => !isSelf.value && !profile.value?.isAgent);

async function run(action: "message" | "wave", task: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = action;
  errorMessage.value = null;
  try {
    await task();
  } catch (err) {
    errorMessage.value = userMessageFor(err);
  } finally {
    busy.value = null;
  }
}

function startDm() {
  return run("message", () => openDirectConversation(props.pubkey));
}

function wave() {
  return run("wave", async () => {
    await waveAt(props.pubkey, myProfile.value?.displayName ?? "");
    waved.value = true;
  });
}
</script>

<template>
  <div ref="panel" class="profile-panel" tabindex="-1" aria-label="User profile" data-testid="profile-panel">
    <div class="panel-header">
      <h2>Profile</h2>
      <CloseButton @click="emit('close')" />
    </div>

    <StateView v-if="isLoading" kind="loading" />
    <StateView v-else-if="isError" kind="error" title="Couldn't load profile" />
    <div v-else class="panel-scroll">
      <div class="profile-body">
        <AvatarCircle
          :name="displayName"
          :avatar-url="profile?.avatarUrl"
          :is-agent="profile?.isAgent"
          :pubkey="pubkey"
          :size="80"
        />
        <h3 class="display-name" data-testid="profile-name">{{ displayName }}</h3>
        <p v-if="statusLabel && presenceStatus" class="status-line" data-testid="profile-status">
          <PresenceDot :status="presenceStatus" class="status-dot" />
          {{ statusLabel }}
        </p>
        <p v-if="customStatus" class="custom-status" data-testid="profile-custom-status">
          <span aria-hidden="true">{{ customStatus.emoji }}</span> {{ customStatus.text }}
        </p>
        <p v-if="profile?.designation" class="designation" data-testid="profile-designation">
          {{ profile.designation }}
        </p>
        <span v-if="profile?.isAgent" class="agent-badge">Agent</span>
        <p v-if="profile?.about" class="about-text">{{ profile.about }}</p>

        <div v-if="!isSelf" class="actions" data-testid="profile-actions">
          <BaseButton variant="primary" :disabled="busy !== null" data-testid="profile-message" @click="startDm">
            {{ busy === "message" ? "Opening…" : "Message" }}
          </BaseButton>
          <BaseButton v-if="canWave" variant="secondary" :disabled="busy !== null" data-testid="profile-wave" @click="wave">
            {{ busy === "wave" ? "Waving…" : waved ? "Waved 👋" : "👋 Wave" }}
          </BaseButton>
        </div>
        <p v-if="errorMessage" class="error-text" role="alert">{{ errorMessage }}</p>

        <div class="info-section">
          <h4>Info</h4>
          <div v-if="statusLabel" class="info-row">
            <span class="info-label">Status</span>
            <span class="info-value plain">{{ statusLabel }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Public key</span>
            <span class="info-value">{{ pubkey }}</span>
          </div>
          <BaseButton variant="ghost" data-testid="profile-copy-key" @click="copyKey">
            {{ copied ? "Copied" : "Copy public key" }}
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  outline: none;
  animation: profile-in var(--transition-fast, 150ms) ease-out;
}
@keyframes profile-in {
  from {
    opacity: 0;
    transform: translateX(12px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .profile-panel {
    animation: none;
  }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.panel-header h2 {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

/* Fixed header, scrolling body. */
.panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.profile-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-5) var(--space-4);
  gap: var(--space-2);
}

.display-name {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-lg);
  color: var(--color-text);
}

.status-line {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.custom-status {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}
.status-dot {
  width: 10px;
  height: 10px;
}

.designation {
  margin: 2px 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.about-text {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  text-align: center;
  max-width: 32ch;
}

.agent-badge {
  font-size: var(--font-size-xs);
  color: var(--color-agent);
  background: var(--color-agent-muted);
  border-radius: var(--radius-full);
  padding: 0 var(--space-2);
}

.actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
  width: 100%;
}
.actions :deep(button) {
  flex: 1;
}

.error-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}

.info-section {
  width: 100%;
  margin-top: var(--space-4);
}
.info-section h4 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-subtle);
}

.info-row {
  background: var(--color-surface-muted);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.info-row + .info-row {
  margin-top: var(--space-2);
}
.info-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.info-value {
  font-size: var(--font-size-xs);
  font-family: monospace;
  color: var(--color-text);
  word-break: break-all;
}
.info-value.plain {
  font-family: inherit;
}
</style>
