<script setup lang="ts">
/**
 * Creates a channel (kind:39000-family group). Per
 * docs/NEW_SWF_BUZZ_GAP_ANALYSIS.md, old Buzz does not gate channel creation
 * by community role — any member can create one — so this dialog is shown
 * unconditionally to members, matching that behavior rather than inventing
 * an owner/admin-only restriction.
 */
import { ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import { useCreateChannel } from "../useCreateChannel";
import type { ChannelVisibility } from "@/types/domain";

const emit = defineEmits<{ close: [] }>();

const name = ref("");
const visibility = ref<ChannelVisibility>("open");
const about = ref("");
const { createChannel, isCreating, errorMessage } = useCreateChannel();

const trimmedName = () => name.value.trim();

async function handleSubmit() {
  if (!trimmedName()) return;
  await createChannel({
    name: trimmedName(),
    visibility: visibility.value,
    about: about.value.trim() || undefined,
  });
  if (!errorMessage.value) emit("close");
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card" role="dialog" aria-modal="true" aria-label="Create channel">
      <h2>Create a channel</h2>

      <label class="field-label" for="channel-name">Name</label>
      <input
        id="channel-name"
        v-model="name"
        class="channel-input"
        type="text"
        placeholder="e.g. general"
        :disabled="isCreating"
        maxlength="80"
        @keydown.enter="handleSubmit"
      />

      <label class="field-label" for="channel-visibility">Visibility</label>
      <select id="channel-visibility" v-model="visibility" class="channel-select" :disabled="isCreating">
        <option value="open">Open — anyone in the community can join</option>
        <option value="private">Private — invite only</option>
      </select>

      <label class="field-label" for="channel-about">Description (optional)</label>
      <textarea
        id="channel-about"
        v-model="about"
        class="channel-about"
        rows="2"
        :disabled="isCreating"
        placeholder="What's this channel for?"
      />

      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

      <div class="dialog-actions">
        <BaseButton variant="ghost" :disabled="isCreating" @click="emit('close')">
          Cancel
        </BaseButton>
        <BaseButton
          variant="primary"
          :disabled="isCreating || !trimmedName()"
          @click="handleSubmit"
        >
          {{ isCreating ? "Creating…" : "Create channel" }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog-card {
  width: 400px;
  max-width: calc(100vw - var(--space-4) * 2);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
}

.dialog-card h2 {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-lg);
  color: var(--color-text);
}

.field-label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-muted);
  margin-top: var(--space-2);
}

.channel-input,
.channel-select,
.channel-about {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  padding: var(--space-2);
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.channel-about {
  resize: vertical;
}

.error-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
