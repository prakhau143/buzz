<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import AvatarCircle from "@/components/AvatarCircle.vue";
import BaseButton from "@/components/BaseButton.vue";
import StateView from "@/components/StateView.vue";
import { useProfile } from "@/composables/useProfile";
import { usePresence } from "@/features/presence/usePresence";
import { useOpenDm } from "@/features/dm/useOpenDm";
import { useSessionStore } from "@/stores/session";
import { userMessageFor } from "@/services/errors";

const props = defineProps<{ pubkey: string }>();
defineEmits<{ close: [] }>();

const router = useRouter();
const session = useSessionStore();
const { data: profile, isLoading, isError } = useProfile(() => props.pubkey);
const { data: presence } = usePresence();
const { open, isOpening } = useOpenDm();
const errorMessage = ref<string | null>(null);

const displayName = computed(() => profile.value?.displayName ?? props.pubkey.slice(0, 8));
const presenceStatus = computed(() => presence.value?.get(props.pubkey)?.status);
const isSelf = computed(() => session.pubkey === props.pubkey);

async function startDm() {
  errorMessage.value = null;
  try {
    const conversationId = await open([props.pubkey]);
    await router.push({ name: "dm", query: { conversationId } });
  } catch (err) {
    errorMessage.value = userMessageFor(err);
  }
}
</script>

<template>
  <div class="profile-panel">
    <div class="panel-header">
      <h2>Profile</h2>
      <button type="button" class="close-button" aria-label="Close" @click="$emit('close')">✕</button>
    </div>

    <StateView v-if="isLoading" kind="loading" />
    <StateView v-else-if="isError" kind="error" title="Couldn't load profile" />
    <template v-else>
      <div class="profile-body">
        <AvatarCircle
          :name="displayName"
          :avatar-url="profile?.avatarUrl"
          :is-agent="profile?.isAgent"
          :presence="presenceStatus"
          :size="72"
        />
        <h3 class="display-name">{{ displayName }}</h3>
        <span v-if="profile?.isAgent" class="agent-badge">Agent</span>

        <div v-if="!isSelf" class="actions">
          <BaseButton variant="primary" :disabled="isOpening" @click="startDm">
            {{ isOpening ? "Opening…" : "Message" }}
          </BaseButton>
        </div>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <div class="info-section">
          <h4>Info</h4>
          <div class="info-row">
            <span class="info-label">🔑 Public key</span>
            <span class="info-value">{{ pubkey }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.profile-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
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

.close-button {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-md);
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
</style>
