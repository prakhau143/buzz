<script setup lang="ts">
/**
 * HTTP-backed create-channel dialog (DECISIONS.md D10) — deliberately
 * parallel to `./CreateChannelDialog.vue` (the old Nostr version), same
 * "build alongside" pattern as everything else in this migration. Channel
 * creation is ungated (any community member may create one), matching the
 * old dialog's own behavior — see `backend/src/routes/channels.rs`.
 */
import { ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import { userMessageFor } from "@/services/errors";
import type { ChannelVisibility } from "../ChannelServiceHttp";

const props = defineProps<{
  create: (params: {
    name: string;
    visibility: ChannelVisibility;
    description?: string;
  }) => Promise<{ id: string }>;
  isCreating: boolean;
}>();
const emit = defineEmits<{ close: []; created: [channelId: string] }>();

const name = ref("");
const visibility = ref<ChannelVisibility>("open");
const description = ref("");
const errorMessage = ref<string | null>(null);

const trimmedName = () => name.value.trim();

async function handleSubmit() {
  if (!trimmedName()) return;
  errorMessage.value = null;
  try {
    const channel = await props.create({
      name: trimmedName(),
      visibility: visibility.value,
      description: description.value.trim() || undefined,
    });
    emit("created", channel.id);
    emit("close");
  } catch (err) {
    errorMessage.value = userMessageFor(err);
  }
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card" role="dialog" aria-modal="true" aria-label="Create channel">
      <h2>Create a channel</h2>

      <label class="field-label" for="http-channel-name">Name</label>
      <input
        id="http-channel-name"
        v-model="name"
        class="channel-input"
        type="text"
        placeholder="e.g. general"
        :disabled="isCreating"
        maxlength="80"
        @keydown.enter="handleSubmit"
      />

      <label class="field-label" for="http-channel-visibility">Visibility</label>
      <select
        id="http-channel-visibility"
        v-model="visibility"
        class="channel-select"
        :disabled="isCreating"
      >
        <option value="open">Open — anyone in the community can join</option>
        <option value="private">Private — invite only</option>
      </select>

      <label class="field-label" for="http-channel-description">Description (optional)</label>
      <textarea
        id="http-channel-description"
        v-model="description"
        class="channel-description"
        rows="2"
        :disabled="isCreating"
        placeholder="What's this channel for?"
      />

      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

      <div class="dialog-actions">
        <BaseButton variant="ghost" :disabled="isCreating" @click="emit('close')">
          Cancel
        </BaseButton>
        <BaseButton variant="primary" :disabled="isCreating || !trimmedName()" @click="handleSubmit">
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
  background: var(--color-overlay);
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
  box-shadow: var(--shadow-lg);
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
.channel-description {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  padding: var(--space-2);
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.channel-description {
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
