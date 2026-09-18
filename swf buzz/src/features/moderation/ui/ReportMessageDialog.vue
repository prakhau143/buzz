<script setup lang="ts">
/** Report a message to the community's moderation queue (kind:1984, NIP-56). */
import { ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import { useSubmitReport } from "../useSubmitReport";
import { userMessageFor } from "@/services/errors";
import { REPORT_TYPES, type ReportType } from "@/protocol/moderation";
import type { Message } from "@/types/domain";

const props = defineProps<{ message: Message }>();
const emit = defineEmits<{ close: [] }>();

const reportType = ref<ReportType>("other");
const note = ref("");
const { submit, isSubmitting, error, isSuccess } = useSubmitReport();

const REPORT_LABELS: Record<ReportType, string> = {
  illegal: "Illegal content",
  nudity: "Nudity",
  malware: "Malware / phishing",
  spam: "Spam",
  impersonation: "Impersonation",
  profanity: "Profanity / harassment",
  other: "Other",
};

async function handleSubmit() {
  await submit({
    authorPubkey: props.message.authorPubkey,
    eventId: props.message.id,
    reportType: reportType.value,
    note: note.value,
  });
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card" role="dialog" aria-modal="true" aria-label="Report message">
      <h2>Report this message</h2>

      <template v-if="isSuccess">
        <p class="success-text">
          Report submitted. Community moderators can review it — the author won't be told who
          reported them.
        </p>
        <BaseButton variant="primary" @click="emit('close')">Done</BaseButton>
      </template>

      <template v-else>
        <p class="hint">The author won't be told who reported this.</p>

        <label class="field-label" for="report-type">Reason</label>
        <select id="report-type" v-model="reportType" class="report-select" :disabled="isSubmitting">
          <option v-for="type in REPORT_TYPES" :key="type" :value="type">
            {{ REPORT_LABELS[type] }}
          </option>
        </select>

        <label class="field-label" for="report-note">Additional details (optional)</label>
        <textarea
          id="report-note"
          v-model="note"
          class="report-note"
          rows="3"
          :disabled="isSubmitting"
          placeholder="What happened?"
        />

        <p v-if="error" class="error-text">{{ userMessageFor(error) }}</p>

        <div class="dialog-actions">
          <BaseButton variant="ghost" :disabled="isSubmitting" @click="emit('close')">
            Cancel
          </BaseButton>
          <BaseButton variant="danger" :disabled="isSubmitting" @click="handleSubmit">
            {{ isSubmitting ? "Submitting…" : "Submit report" }}
          </BaseButton>
        </div>
      </template>
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

.hint {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

.field-label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-muted);
  margin-top: var(--space-2);
}

.report-select,
.report-note {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  padding: var(--space-2);
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.report-note {
  resize: vertical;
}

.error-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}

.success-text {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
