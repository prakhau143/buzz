<script setup lang="ts">
/**
 * Send feedback (profile menu → "Send feedback"). Private to this deployment:
 * a kind 42000 event read only by deployment operators/moderators
 * (features/feedback/feedbackModel.ts). Files are uploaded when you press
 * Send — not when you pick them — so a cancelled dialog leaves nothing behind.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import BaseButton from "@/components/BaseButton.vue";
import CloseButton from "@/components/CloseButton.vue";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { appVersion, loadAppVersion } from "@/app/appVersion";
import { logError, userMessageFor } from "@/services/errors";
import { activeRelayUrl, relayHost } from "@/features/communities/relayCommunities";
import {
  FEEDBACK_CATEGORIES,
  MAX_FEEDBACK_ATTACHMENTS,
  classifyFeedbackFile,
  validateFeedbackMessage,
  type FeedbackCategory,
} from "../feedbackModel";
import { sendFeedback, type FeedbackFile } from "../feedbackService";

const emit = defineEmits<{ close: [] }>();

const category = ref<FeedbackCategory | null>(null);
const message = ref("");
const includeDiagnostics = ref(false);

interface PickedFile extends FeedbackFile {
  previewUrl: string;
}
const files = ref<PickedFile[]>([]);
const fileError = ref<string | null>(null);
const progress = ref<Record<string, number>>({});
const stage = ref<"idle" | "uploading" | "sending" | "sent" | "error">("idle");
const error = ref<string | null>(null);
const touched = ref(false);

const busy = computed(() => stage.value === "uploading" || stage.value === "sending");
const messageError = computed(() => (touched.value ? validateFeedbackMessage(message.value) : null));
const canSend = computed(() => !busy.value && !validateFeedbackMessage(message.value));
const community = computed(() => relayHost(activeRelayUrl.value ?? ""));

let counter = 0;
function addFiles(list: FileList | File[] | null | undefined) {
  if (!list) return;
  fileError.value = null;
  for (const file of Array.from(list)) {
    if (files.value.length >= MAX_FEEDBACK_ATTACHMENTS) {
      fileError.value = `Up to ${MAX_FEEDBACK_ATTACHMENTS} attachments.`;
      break;
    }
    const verdict = classifyFeedbackFile(file);
    if ("error" in verdict) {
      fileError.value = verdict.error;
      continue;
    }
    files.value.push({ id: `f${++counter}`, file, kind: verdict.kind, previewUrl: URL.createObjectURL(file) });
  }
}
function removeFile(id: string) {
  const item = files.value.find((f) => f.id === id);
  if (item) URL.revokeObjectURL(item.previewUrl);
  files.value = files.value.filter((f) => f.id !== id);
  delete progress.value[id];
}

const fileInput = ref<HTMLInputElement | null>(null);
function onPick(event: Event) {
  addFiles((event.target as HTMLInputElement).files);
  (event.target as HTMLInputElement).value = "";
}
const dragging = ref(false);
function onDrop(event: DragEvent) {
  dragging.value = false;
  addFiles(event.dataTransfer?.files);
}
function onPaste(event: ClipboardEvent) {
  const pasted = Array.from(event.clipboardData?.files ?? []);
  if (pasted.length) {
    event.preventDefault();
    addFiles(pasted);
  }
}

async function submit() {
  touched.value = true;
  if (!canSend.value) return;
  error.value = null;
  stage.value = "uploading";
  try {
    await sendFeedback(
      {
        category: category.value,
        message: message.value,
        files: files.value,
        includeDiagnostics: includeDiagnostics.value,
        appVersion: appVersion.value,
      },
      (p) => {
        progress.value = p.files;
        stage.value = p.stage;
      },
    );
    stage.value = "sent";
  } catch (err) {
    stage.value = "error";
    error.value = userMessageFor(err);
    logError("SendFeedbackDialog.send", err);
  }
}

function close() {
  if (busy.value) return;
  emit("close");
}

useEscapeKey(close);
const dialog = ref<HTMLElement | null>(null);
useFocusTrap(dialog);
onMounted(() => void loadAppVersion());
onBeforeUnmount(() => files.value.forEach((f) => URL.revokeObjectURL(f.previewUrl)));

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
</script>

<template>
  <div class="overlay" @click.self="close">
    <div
      ref="dialog"
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
      data-testid="send-feedback-dialog"
      @paste="onPaste"
    >
      <header class="head">
        <div>
          <h2 id="feedback-title">Send feedback</h2>
          <p>Help us improve SWF Buzz. Your feedback is private to this deployment.</p>
        </div>
        <CloseButton :disabled="busy" @click="close" />
      </header>

      <div v-if="stage === 'sent'" class="sent" role="status" data-testid="feedback-sent">
        <span class="sent-icon"><AppIcon name="check" :size="24" /></span>
        <h3>Thanks — we got it.</h3>
        <p>Your feedback was delivered to the SWF Buzz team for {{ community }}.</p>
        <BaseButton variant="primary" @click="emit('close')">Done</BaseButton>
      </div>

      <form v-else class="body" @submit.prevent="submit">
        <fieldset class="categories" :disabled="busy">
          <legend>What kind of feedback? <span class="optional">Optional</span></legend>
          <button
            v-for="c in FEEDBACK_CATEGORIES"
            :key="c.id"
            type="button"
            class="category"
            :class="[c.id, { active: category === c.id }]"
            :aria-pressed="category === c.id"
            :data-testid="`feedback-category-${c.id}`"
            @click="category = category === c.id ? null : c.id"
          >
            <span class="dot" aria-hidden="true" />
            <span class="c-label">{{ c.label }}</span>
            <span class="c-hint">{{ c.hint }}</span>
          </button>
        </fieldset>

        <label class="field">
          <span class="field-label">What happened?</span>
          <textarea
            v-model="message"
            rows="5"
            placeholder="Tell us what happened, what you expected, and how to reproduce it…"
            :disabled="busy"
            :aria-invalid="!!messageError"
            data-testid="feedback-message"
            @blur="touched = true"
          />
          <span v-if="messageError" class="field-error">{{ messageError }}</span>
        </label>

        <div class="field">
          <span class="field-label">Attachments <span class="optional">Images or MP4 video, up to {{ MAX_FEEDBACK_ATTACHMENTS }}</span></span>
          <div class="attachments" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
            <button type="button" class="add-media" :disabled="busy || files.length >= MAX_FEEDBACK_ATTACHMENTS" data-testid="feedback-add-media" @click="fileInput?.click()">
              <AppIcon name="plus" :size="20" />
              <span>Add media</span>
              <span class="add-hint">or drop / paste</span>
            </button>
            <div v-for="f in files" :key="f.id" class="thumb" :class="{ failed: progress[f.id] === -1 }" :data-testid="`feedback-file-${f.kind}`">
              <img v-if="f.kind === 'image'" :src="f.previewUrl" :alt="f.file.name" />
              <video v-else :src="f.previewUrl" muted preload="metadata" />
              <span class="thumb-kind"><AppIcon :name="f.kind === 'image' ? 'image' : 'video'" :size="16" /></span>
              <span class="thumb-name">{{ f.file.name }} · {{ sizeLabel(f.file.size) }}</span>
              <span v-if="busy && progress[f.id] !== undefined && progress[f.id] >= 0" class="thumb-progress">
                <span :style="{ width: `${Math.round((progress[f.id] ?? 0) * 100)}%` }" />
              </span>
              <button v-if="!busy" type="button" class="remove" :aria-label="`Remove ${f.file.name}`" @click="removeFile(f.id)">
                <AppIcon name="close" :size="16" />
              </button>
            </div>
            <input ref="fileInput" type="file" accept="image/*,video/mp4" multiple class="hidden" @change="onPick" />
          </div>
          <span v-if="fileError" class="field-error" role="alert">{{ fileError }}</span>
        </div>

        <label class="diagnostics">
          <input v-model="includeDiagnostics" type="checkbox" :disabled="busy" data-testid="feedback-diagnostics" />
          <span>
            <span class="d-title">Include diagnostics</span>
            <span class="d-detail">App version {{ appVersion }} · operating system · browser engine · language. No messages, logs or keys.</span>
          </span>
        </label>

        <p v-if="error" class="send-error" role="alert" data-testid="feedback-error">
          <AppIcon name="warning" :size="16" />{{ error }} Your text and attachments are kept — press Send to try again.
        </p>

        <footer class="actions">
          <span class="sending-state" aria-live="polite">
            <template v-if="stage === 'uploading'">Uploading attachments…</template>
            <template v-else-if="stage === 'sending'">Sending…</template>
          </span>
          <BaseButton variant="ghost" :disabled="busy" @click="close">Cancel</BaseButton>
          <BaseButton variant="primary" type="submit" :disabled="!canSend" data-testid="feedback-send">
            {{ busy ? "Sending…" : stage === "error" ? "Try again" : "Send feedback" }}
          </BaseButton>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: var(--color-overlay);
  backdrop-filter: blur(3px);
  animation: fade 150ms ease both;
}
.dialog {
  display: flex;
  flex-direction: column;
  width: min(600px, 100%);
  max-height: min(760px, 92vh);
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 18px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
  animation: rise 180ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-5) var(--space-3);
}
.head h2 {
  margin: 0;
  font-size: var(--font-size-xl);
  letter-spacing: -0.01em;
}
.head p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-5) var(--space-5);
  overflow-y: auto;
}
.categories {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: none;
}
.categories legend {
  margin-bottom: var(--space-2);
  padding: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
}
.category {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: var(--space-2);
  align-items: center;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    transform 150ms ease;
}
.category:hover {
  transform: translateY(-1px);
}
.category .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.category.bug .dot {
  background: var(--color-danger);
}
.category.praise .dot {
  background: var(--color-success);
}
.category.needs-work .dot {
  background: var(--color-warning);
}
.c-label {
  font-weight: 600;
  font-size: var(--font-size-sm);
}
.c-hint {
  grid-column: 2;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.category.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, transparent);
  background: var(--color-surface);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: var(--font-size-sm);
  font-weight: 600;
}
.optional {
  margin-left: 6px;
  font-weight: 400;
  color: var(--color-text-subtle);
}
textarea {
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  resize: vertical;
}
textarea:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-primary) 60%, var(--color-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 14%, transparent);
}
textarea[aria-invalid="true"] {
  border-color: var(--color-danger);
}
.field-error {
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
.attachments {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px dashed var(--color-border-strong);
  border-radius: 14px;
  transition: background 150ms ease, border-color 150ms ease;
}
.attachments.dragging {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
}
.add-media {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 104px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface-muted);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
}
.add-media:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.add-hint {
  font-weight: 400;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.thumb {
  position: relative;
  min-height: 104px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: #000;
}
.thumb.failed {
  border-color: var(--color-danger);
}
.thumb img,
.thumb video {
  width: 100%;
  height: 104px;
  object-fit: cover;
  display: block;
}
.thumb-kind {
  position: absolute;
  top: 6px;
  left: 6px;
  display: inline-flex;
  padding: 3px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}
.thumb-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 4px 6px;
  overflow: hidden;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
  color: #fff;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thumb-progress {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 24px;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.3);
}
.thumb-progress span {
  display: block;
  height: 100%;
  background: #fff;
  transition: width 120ms linear;
}
.remove {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  padding: 3px;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
}
.hidden {
  display: none;
}
.diagnostics {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg);
  cursor: pointer;
}
.diagnostics input {
  margin-top: 3px;
  accent-color: var(--color-primary);
}
.d-title {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 600;
}
.d-detail {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.send-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: var(--space-3);
  border-radius: 10px;
  background: var(--color-danger-muted);
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.sending-state {
  margin-right: auto;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.sent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-5) var(--space-6);
  text-align: center;
}
.sent h3 {
  margin: var(--space-2) 0 0;
}
.sent p {
  margin: 0 0 var(--space-3);
  color: var(--color-text-muted);
}
.sent-icon {
  display: inline-flex;
  padding: 12px;
  border-radius: 50%;
  background: var(--color-success-muted);
  color: var(--color-success);
}
@media (max-width: 520px) {
  .categories {
    grid-template-columns: minmax(0, 1fr);
  }
}
/* Primary actions meet the 44 px touch minimum. */
.actions :deep(.base-button) {
  height: auto;
  min-height: 44px;
}
/* Phones: a bottom sheet over the visible viewport (keyboard-safe via dvh), clear of the home indicator. */
@media (max-width: 767px) {
  .overlay {
    align-items: flex-end;
    padding: env(safe-area-inset-top) 0 0;
  }
  .dialog {
    width: 100%;
    max-height: 94dvh;
    border-radius: 18px 18px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
  }
}
@media (prefers-reduced-motion: reduce) {
  .overlay,
  .dialog {
    animation: none;
  }
}
</style>
