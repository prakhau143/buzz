<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import BaseButton from "@/components/BaseButton.vue";
import { channelService } from "../ChannelService";
import { logError, userMessageFor } from "@/services/errors";
import type { Channel } from "@/types/domain";

const props = defineProps<{ channel: Channel; memberCount: number }>();
const emit = defineEmits<{ close: []; left: [] }>();

const router = useRouter();
const showLeaveConfirm = ref(false);
const isLeaving = ref(false);
const leaveError = ref<string | null>(null);

async function confirmLeave() {
  isLeaving.value = true;
  leaveError.value = null;
  try {
    await channelService.leaveChannel(props.channel.id);
    showLeaveConfirm.value = false;
    emit("left");
    await router.push({ name: "channels" });
  } catch (err) {
    logError("ChannelDetailsPanel.leave", err);
    leaveError.value = userMessageFor(err);
  } finally {
    isLeaving.value = false;
  }
}
</script>

<template>
  <div class="details-panel">
    <div class="panel-header">
      <h2>Channel Settings</h2>
      <button type="button" class="close-button" aria-label="Close" @click="emit('close')">✕</button>
    </div>

    <div class="panel-body">
      <div class="channel-summary">
        <span class="icon">{{ channel.visibility === "private" ? "🔒" : "#" }}</span>
        <h3>{{ channel.name }}</h3>
        <p v-if="channel.topic" class="description">{{ channel.topic }}</p>
      </div>

      <div class="details-list">
        <div class="details-row">
          <span class="label">Channel type</span>
          <span class="value">{{ channel.channelType }}</span>
        </div>
        <div class="details-row">
          <span class="label">Visibility</span>
          <span class="value">{{ channel.visibility === "private" ? "Private" : "Open" }}</span>
        </div>
        <div class="details-row">
          <span class="label">Members</span>
          <span class="value">{{ memberCount }} members</span>
        </div>
        <div class="details-row">
          <span class="label">Channel ID</span>
          <span class="value mono">{{ channel.id }}</span>
        </div>
      </div>

      <BaseButton variant="danger" class="leave-button" @click="showLeaveConfirm = true">
        🚪 Leave channel
      </BaseButton>
    </div>

    <div v-if="showLeaveConfirm" class="confirm-overlay" @click.self="showLeaveConfirm = false">
      <div class="confirm-card">
        <h3>Leave #{{ channel.name }}?</h3>
        <p>You will no longer receive messages from this channel.</p>
        <p v-if="leaveError" class="error-text">{{ leaveError }}</p>
        <div class="confirm-actions">
          <BaseButton variant="ghost" :disabled="isLeaving" @click="showLeaveConfirm = false">
            Cancel
          </BaseButton>
          <BaseButton variant="danger" :disabled="isLeaving" @click="confirmLeave">
            {{ isLeaving ? "Leaving…" : "Leave channel" }}
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.details-panel {
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

.panel-body {
  padding: var(--space-4);
  overflow-y: auto;
}

.channel-summary {
  text-align: center;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--space-4);
}
.channel-summary .icon {
  font-size: var(--font-size-xl);
}
.channel-summary h3 {
  margin: var(--space-2) 0 0;
  color: var(--color-text);
}
.description {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.details-list {
  background: var(--color-surface-muted);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: var(--space-4);
}

.details-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
.details-row:last-child {
  border-bottom: none;
}
.label {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.value {
  font-size: var(--font-size-sm);
  color: var(--color-text);
}
.value.mono {
  font-family: monospace;
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.leave-button {
  width: 100%;
}

.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 110;
}
.confirm-card {
  width: 340px;
  max-width: calc(100vw - var(--space-4) * 2);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
}
.confirm-card h3 {
  margin: 0 0 var(--space-2);
  color: var(--color-text);
}
.confirm-card p {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.error-text {
  color: var(--color-danger) !important;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
