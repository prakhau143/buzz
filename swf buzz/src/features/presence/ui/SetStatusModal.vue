<script setup lang="ts">
import { computed, ref } from "vue";
import OverlayDialog from "@/components/OverlayDialog.vue";
import BaseButton from "@/components/BaseButton.vue";
import { userMessageFor } from "@/services/errors";
import { useUserStatusStore } from "@/stores/userStatus";
import { useSessionStore } from "@/stores/session";
import { userStatusService, type StatusUpdate } from "../UserStatusService";
import {
  DEFAULT_STATUS_EMOJI,
  QUICK_STATUSES,
  STATUS_DURATIONS,
  statusExpiry,
  type StatusDuration,
} from "@/protocol/userStatus";

/**
 * "Set a status" — OLD BUZZ `SetStatusDialog.tsx`: emoji + text, a duration
 * (1 hour / 8 hours / Today / This week / Custom; Today by default, and every
 * status clears itself), quick statuses while none is set. Saving publishes a
 * NIP-38 kind:30315 so every member (SWF or OLD BUZZ) sees it; "Clear status"
 * publishes the empty 30315 OLD BUZZ uses.
 */
const emit = defineEmits<{ close: [] }>();

const session = useSessionStore();
const statuses = useUserStatusStore();
const current = computed(() => statuses.statusOf(session.pubkey));

const emoji = ref(current.value?.emoji ?? "");
const text = ref(current.value?.text ?? "");
const duration = ref<StatusDuration>("today");
/** `datetime-local` value for Custom; defaults to now + 24 h, rounded up to the half hour. */
function defaultCustom(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setMinutes(d.getMinutes() <= 30 ? 30 : 60, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const customAt = ref(defaultCustom());
/** Editing an existing status without touching the duration keeps its expiry (OLD BUZZ). */
const durationTouched = ref(false);

const saving = ref(false);
const error = ref<string | null>(null);

const canSave = computed(() => !saving.value && (text.value.trim().length > 0 || emoji.value.trim().length > 0));
const customInvalid = computed(
  () => duration.value === "custom" && !(new Date(customAt.value).getTime() > Date.now()),
);

function pickQuick(q: { emoji: string; text: string }) {
  // Fills the form; nothing is saved until "Save status" (OLD BUZZ behaviour).
  emoji.value = q.emoji;
  text.value = q.text;
}

function expiresAt(): number {
  if (current.value?.expiresAt && !durationTouched.value) return current.value.expiresAt;
  return statusExpiry(duration.value, new Date(), duration.value === "custom" ? new Date(customAt.value) : undefined);
}

async function run(task: () => Promise<StatusUpdate>) {
  if (saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    const u = await task();
    // Show it immediately; the relay's live echo carries the same event.
    statuses.apply(u.pubkey, u.status, u.updatedAt);
    emit("close");
  } catch (err) {
    error.value = userMessageFor(err);
  } finally {
    saving.value = false;
  }
}

function save() {
  if (!canSave.value || customInvalid.value) return;
  void run(() => userStatusService.set({ emoji: emoji.value, text: text.value, expiresAt: expiresAt() }));
}

function clear() {
  void run(() => userStatusService.clear());
}
</script>

<template>
  <OverlayDialog title="Set a status" @close="emit('close')">
    <form class="status-form" data-testid="set-status" @submit.prevent="save">
      <div class="status-input">
        <input
          v-model="emoji"
          class="emoji-input"
          maxlength="8"
          :placeholder="DEFAULT_STATUS_EMOJI"
          aria-label="Status emoji"
          data-testid="status-emoji"
        />
        <input
          v-model="text"
          class="text-input"
          maxlength="100"
          placeholder="What's your status?"
          aria-label="Status text"
          data-testid="status-text"
        />
      </div>

      <label class="field">
        <span class="field-label">Clear after</span>
        <select
          v-model="duration"
          class="select"
          data-testid="status-duration"
          @change="durationTouched = true"
        >
          <option v-for="d in STATUS_DURATIONS" :key="d.value" :value="d.value">{{ d.label }}</option>
        </select>
      </label>
      <label v-if="duration === 'custom'" class="field">
        <span class="field-label">Clear at</span>
        <input v-model="customAt" type="datetime-local" step="1800" class="select" data-testid="status-custom" @change="durationTouched = true" />
      </label>
      <p v-if="customInvalid" class="error" role="alert">Pick a time in the future.</p>

      <div v-if="!current" class="quick" data-testid="quick-statuses">
        <p class="field-label">Quick statuses</p>
        <button
          v-for="q in QUICK_STATUSES"
          :key="q.text"
          type="button"
          class="quick-item"
          :class="{ selected: text === q.text && emoji === q.emoji }"
          @click="pickQuick(q)"
        >
          <span class="quick-emoji" aria-hidden="true">{{ q.emoji }}</span>{{ q.text }}
        </button>
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="actions">
        <BaseButton v-if="current" type="button" variant="ghost" :disabled="saving" data-testid="status-clear" @click="clear">
          Clear status
        </BaseButton>
        <span class="spacer" />
        <BaseButton type="button" variant="secondary" :disabled="saving" @click="emit('close')">Cancel</BaseButton>
        <BaseButton type="submit" variant="primary" :disabled="!canSave || customInvalid" data-testid="status-save">
          {{ saving ? "Saving…" : "Save status" }}
        </BaseButton>
      </div>
    </form>
  </OverlayDialog>
</template>

<style scoped>
.status-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.status-input {
  display: flex;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  overflow: hidden;
}
.status-input:focus-within {
  border-color: var(--color-primary);
}
.emoji-input,
.text-input {
  border: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  padding: var(--space-2) var(--space-3);
  outline: none;
}
.emoji-input {
  width: 3.25rem;
  text-align: center;
  border-right: 1px solid var(--color-border);
  font-size: 1.1rem;
}
.text-input {
  flex: 1;
  min-width: 0;
}
.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.field-label {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.select {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}
.quick {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.quick-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 40px;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.quick-item:hover,
.quick-item:focus-visible,
.quick-item.selected {
  background: var(--color-surface-muted);
}
.quick-emoji {
  width: 1.5rem;
  text-align: center;
  font-size: 1.1rem;
}
.error {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.spacer {
  flex: 1;
}
</style>
