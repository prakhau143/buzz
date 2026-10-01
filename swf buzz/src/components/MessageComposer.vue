<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BaseButton from "./BaseButton.vue";
import AppIcon from "./AppIcon.vue";
import MentionPicker from "@/features/mentions/MentionPicker.vue";
import {
  detectMentionQuery,
  extractMentionPubkeys,
  findMentionOccurrences,
  mentionLabelFor,
  normalizeMentionPubkeys,
  rankMentionCandidates,
  type MentionCandidate,
} from "@/features/mentions/mentionModel";
import { useMentionDirectory, type MentionScope } from "@/features/mentions/useMentionDirectory";
import { draftMentionsEveryone, EVERYONE_LABEL, everyoneAllowedIn } from "@/features/mentions/everyone";
import {
  prepareAttachment,
  rejectionReasonFor,
  uploadAttachment,
  type PreparedAttachment,
} from "@/features/messages/attachments";
import { formatSize, type Attachment } from "@/protocol/imeta";
import { userMessageFor } from "@/services/errors";

export type { MentionCandidate };

const props = defineProps<{
  disabled?: boolean;
  placeholder?: string;
  error?: string | null;
  /**
   * Where this composer writes — the mention picker offers that scope's
   * identities (features/mentions/useMentionDirectory.ts). Every surface
   * (channel, DM, thread, Inbox reply) passes one, so mentions work alike.
   */
  mentionScope?: MentionScope;
  /** Explicit candidates, overriding the scope's directory (tests, special surfaces). */
  mentionCandidates?: MentionCandidate[];
  /** Show the attach control. Off by default so surfaces opt in deliberately. */
  allowAttachments?: boolean;
}>();
const emit = defineEmits<{
  /**
   * `options.mentionsEveryone`: the draft says `@everyone` in a community
   * channel — the caller publishes the semantic tag (protocol/messages.ts).
   */
  send: [content: string, mentionPubkeys: string[], attachments: Attachment[], options: { mentionsEveryone: boolean }];
  typing: [];
}>();

const content = ref("");

/**
 * A picked file, with its own upload state.
 *
 * Upload happens on send, not on pick: uploading immediately would leave
 * orphaned blobs on the relay every time someone attaches a file and then
 * changes their mind, and there is no delete endpoint to clean them up.
 */
interface PendingAttachment {
  id: number;
  file: File;
  prepared?: PreparedAttachment;
  progress: number;
  error: string | null;
}

const pending = ref<PendingAttachment[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const isUploading = ref(false);
let nextId = 0;

function openFilePicker() {
  fileInput.value?.click();
}

function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  for (const file of Array.from(input.files ?? [])) {
    // Refuse locally what the relay would refuse anyway (audio, oversize) —
    // telling someone now beats a 415 after they've waited for an upload.
    const rejection = rejectionReasonFor(file);
    pending.value.push({
      id: nextId++,
      file,
      progress: 0,
      error: rejection,
    });
  }
  // Reset so picking the same file twice in a row still fires `change`.
  input.value = "";
}

function removeAttachment(id: number) {
  pending.value = pending.value.filter((item) => item.id !== id);
}

const hasBlockedAttachment = computed(() => pending.value.some((item) => item.error !== null));
const canSend = computed(
  () =>
    !props.disabled &&
    !isUploading.value &&
    !hasBlockedAttachment.value &&
    (content.value.trim().length > 0 || pending.value.length > 0),
);
// ---------------------------------------------------------------------------
// @mentions (docs/OLD_BUZZ_MENTION_AUDIT.md). Focus never leaves the textarea:
// the picker is driven from here, like OLD BUZZ's `useMentions`.
// ---------------------------------------------------------------------------

const textarea = ref<HTMLTextAreaElement | null>(null);
const caret = ref(0);
/** Set the first time an `@` is typed — the directory loads nothing before that. */
const mentionActive = ref(false);
const directory = props.mentionScope
  ? useMentionDirectory(() => props.mentionScope as MentionScope, mentionActive)
  : null;
const candidates = computed<MentionCandidate[]>(
  () => props.mentionCandidates ?? directory?.candidates.value ?? [],
);
const knownNames = computed(() => candidates.value.map((c) => c.displayName));

/**
 * Picked mentions in this draft: inserted label → pubkey. The pubkey, not the
 * name, is the identity; the label is only where it sits in the text. Capped
 * like OLD BUZZ (200) so a very long-lived draft cannot grow without bound.
 */
const bindings = ref(new Map<string, string>());
const MAX_BINDINGS = 200;
const mentionError = ref<string | null>(null);

/** An `@…` the user pressed Escape on stays closed until they leave it. */
const dismissedAt = ref<number | null>(null);

const mentionQuery = computed(() => {
  const found = detectMentionQuery(content.value, caret.value, knownNames.value);
  if (!found || found.start === dismissedAt.value) return null;
  return found;
});
watch(mentionQuery, (query) => {
  if (query) mentionActive.value = true;
  else if (dismissedAt.value !== null && !detectMentionQuery(content.value, caret.value, knownNames.value))
    dismissedAt.value = null;
});

const mentionMatches = computed(() =>
  mentionQuery.value ? rankMentionCandidates(candidates.value, mentionQuery.value.query) : [],
);
const pickerLoading = computed(() => !!directory?.isLoading.value);

/**
 * `@everyone` — community channels only (never DMs), offered while the query
 * is a prefix of "everyone": first in the list once typing (`@eve`), last for
 * a bare `@` so people stay on top.
 */
const everyoneAllowed = computed(() => everyoneAllowedIn(props.mentionScope));
const everyonePlacement = computed<"first" | "last" | null>(() => {
  const query = mentionQuery.value;
  if (!everyoneAllowed.value || !query) return null;
  const typed = query.query.trim().toLowerCase();
  if (!EVERYONE_LABEL.startsWith(typed)) return null;
  return typed ? "first" : "last";
});
const everyoneIndex = computed(() =>
  everyonePlacement.value === "first" ? 0 : everyonePlacement.value === "last" ? mentionMatches.value.length : -1,
);
const optionCount = computed(() => mentionMatches.value.length + (everyonePlacement.value ? 1 : 0));

const pickerOpen = computed(
  () => !!mentionQuery.value && (optionCount.value > 0 || pickerLoading.value),
);
const activeIndex = ref(0);
watch(
  () => mentionQuery.value?.query,
  () => (activeIndex.value = 0),
);

const pickerId = `mention-picker-${Math.random().toString(36).slice(2, 9)}`;
const activeOptionId = computed(() =>
  pickerOpen.value && optionCount.value ? `${pickerId}-option-${activeIndex.value}` : undefined,
);

function syncCaret() {
  caret.value = textarea.value?.selectionStart ?? content.value.length;
}

function pickMention(candidate: MentionCandidate) {
  const query = mentionQuery.value;
  if (!query) return;
  const label = mentionLabelFor(candidate, bindings.value);
  const before = content.value.slice(0, query.start);
  const after = content.value.slice(caret.value).replace(/^ /, "");
  const inserted = `@${label} `;
  content.value = before + inserted + after;
  const next = new Map(bindings.value);
  next.set(label, candidate.pubkey);
  while (next.size > MAX_BINDINGS) next.delete(next.keys().next().value as string);
  bindings.value = next;
  mentionError.value = null;
  const position = before.length + inserted.length;
  caret.value = position;
  void nextTick(() => {
    textarea.value?.focus();
    textarea.value?.setSelectionRange(position, position);
  });
}

/** Insert `@everyone ` in place of the query — the semantic tag is decided from the text at send. */
function pickEveryone() {
  const query = mentionQuery.value;
  if (!query || !everyoneAllowed.value) return;
  const before = content.value.slice(0, query.start);
  const after = content.value.slice(caret.value).replace(/^ /, "");
  const inserted = `@${EVERYONE_LABEL} `;
  content.value = before + inserted + after;
  mentionError.value = null;
  const position = before.length + inserted.length;
  caret.value = position;
  void nextTick(() => {
    textarea.value?.focus();
    textarea.value?.setSelectionRange(position, position);
  });
}

/** The option at a display index (people and the everyone row share one index space). */
function pickAt(index: number) {
  if (index === everyoneIndex.value) return pickEveryone();
  const personIndex = everyonePlacement.value === "first" ? index - 1 : index;
  const candidate = mentionMatches.value[personIndex];
  if (candidate) pickMention(candidate);
}

/** Keys the open picker owns. Returns true when the key was handled. */
function handlePickerKey(event: KeyboardEvent): boolean {
  if (!pickerOpen.value) return false;
  const count = optionCount.value;
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
  switch (event.key) {
    case "ArrowDown":
      if (!count) return false;
      activeIndex.value = (activeIndex.value + 1) % count;
      break;
    case "ArrowUp":
      if (!count) return false;
      activeIndex.value = (activeIndex.value - 1 + count) % count;
      break;
    case "Enter":
      if (!plain || event.shiftKey || !count) return false;
      pickAt(activeIndex.value);
      break;
    case "Tab":
      // Shift+Tab stays focus navigation, as in OLD BUZZ.
      if (!plain || event.shiftKey || !count) return false;
      pickAt(activeIndex.value);
      break;
    case "Escape":
      dismissedAt.value = mentionQuery.value?.start ?? null;
      // Close only the picker — not the thread panel or dialog around it.
      event.stopPropagation();
      break;
    default:
      return false;
  }
  event.preventDefault();
  return true;
}

/** Picked mentions drawn behind the textarea, so a mention reads as a token while writing. */
const draftSegments = computed(() => {
  const text = content.value;
  const segments: { text: string; mention: boolean }[] = [];
  let cursor = 0;
  const labels = everyoneAllowed.value ? [...bindings.value.keys(), EVERYONE_LABEL] : bindings.value.keys();
  for (const occurrence of findMentionOccurrences(text, labels)) {
    if (occurrence.start > cursor) segments.push({ text: text.slice(cursor, occurrence.start), mention: false });
    segments.push({ text: text.slice(occurrence.start, occurrence.end), mention: true });
    cursor = occurrence.end;
  }
  // A trailing newline needs a character after it, or the backdrop is one line short.
  segments.push({ text: `${text.slice(cursor)} `, mention: false });
  return segments;
});
const hasDraftMentions = computed(() => draftSegments.value.some((s) => s.mention));
const backdrop = ref<HTMLElement | null>(null);
function syncScroll() {
  if (backdrop.value && textarea.value) backdrop.value.scrollTop = textarea.value.scrollTop;
}

async function submit() {
  const trimmed = content.value.trim();
  if (!canSend.value) return;
  // Picked labels still in the text, plus a typed name that is exactly one
  // member's. A typed name several members share is refused, never guessed.
  const extracted = extractMentionPubkeys(trimmed, bindings.value, candidates.value);
  if (extracted.ambiguous.length) {
    mentionError.value = `The mention @${extracted.ambiguous[0]} is ambiguous. Choose a recipient from the mention picker.`;
    return;
  }
  mentionError.value = null;
  const pubkeys = normalizeMentionPubkeys(extracted.pubkeys);
  // Typed or picked, `@everyone` at a mention boundary in a channel is the
  // audience mention; anywhere else (a DM, inside code or a URL) it is text.
  const mentionsEveryone = everyoneAllowed.value && draftMentionsEveryone(trimmed);

  let uploaded: Attachment[] = [];
  if (pending.value.length > 0) {
    const expected = pending.value.length;
    uploaded = await uploadPending();
    // A failed upload keeps the draft and the files intact so the user can
    // retry — discarding their message because a network call failed would be
    // the worst possible response.
    if (uploaded.length !== expected) return;
  }

  emit("send", trimmed, pubkeys, uploaded, { mentionsEveryone });
  content.value = "";
  bindings.value = new Map();
  dismissedAt.value = null;
  caret.value = 0;
  pending.value = [];
}

/** Uploads every pending attachment. Returns fewer than requested if any failed. */
async function uploadPending(): Promise<Attachment[]> {
  isUploading.value = true;
  const done: Attachment[] = [];
  try {
    for (const item of pending.value) {
      item.error = null;
      try {
        item.prepared ??= await prepareAttachment(item.file);
        const attachment = await uploadAttachment(item.prepared, (fraction) => {
          item.progress = fraction;
        });
        done.push(attachment);
      } catch (err) {
        item.error = userMessageFor(err);
        item.progress = 0;
      }
    }
  } finally {
    isUploading.value = false;
  }
  return done;
}

function retryUploads() {
  for (const item of pending.value) item.error = null;
  void submit();
}

function onInput() {
  syncCaret();
  mentionError.value = null;
  emit("typing");
}

function onKeydown(event: KeyboardEvent) {
  if (handlePickerKey(event)) return;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <div class="composer-wrapper">
    <MentionPicker
      v-if="pickerOpen"
      :id="pickerId"
      :candidates="mentionMatches"
      :active-index="activeIndex"
      :loading="pickerLoading"
      :everyone="everyonePlacement"
      @select="pickMention"
      @select-everyone="pickEveryone"
      @hover="(i) => (activeIndex = i)"
    />

    <ul v-if="pending.length" class="attachment-drafts" data-testid="composer-attachments">
      <li v-for="item in pending" :key="item.id" class="attachment-draft">
        <span class="draft-name">{{ item.file.name }}</span>
        <span class="draft-size">{{ formatSize(item.file.size) }}</span>
        <span
          v-if="item.progress > 0 && item.progress < 1"
          class="draft-progress"
          :aria-label="`Uploading, ${Math.round(item.progress * 100)}%`"
          >{{ Math.round(item.progress * 100) }}%</span
        >
        <span v-if="item.error" class="draft-error">{{ item.error }}</span>
        <button
          type="button"
          class="draft-remove"
          :aria-label="`Remove ${item.file.name}`"
          @click="removeAttachment(item.id)"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </li>
    </ul>

    <p v-if="hasBlockedAttachment" class="composer-error">
      Remove the attachment above to send, or
      <button type="button" class="retry-link" @click="retryUploads">try again</button>.
    </p>

    <div class="composer">
      <button
        v-if="allowAttachments"
        type="button"
        class="attach-button"
        aria-label="Attach a file"
        :disabled="disabled || isUploading"
        @click="openFilePicker"
      >
        <AppIcon name="paperclip" />
      </button>
      <input
        ref="fileInput"
        type="file"
        multiple
        class="file-input"
        data-testid="composer-file-input"
        @change="onFilesPicked"
      />
      <div class="input-shell">
        <div v-if="hasDraftMentions" ref="backdrop" class="composer-backdrop" aria-hidden="true"><span v-for="(segment, i) in draftSegments" :key="i" :class="{ 'draft-mention': segment.mention }">{{ segment.text }}</span></div>
        <textarea
          ref="textarea"
          v-model="content"
          class="composer-input"
          :class="{ 'over-backdrop': hasDraftMentions }"
          rows="1"
          :placeholder="placeholder ?? 'Message…'"
          :disabled="disabled"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="pickerOpen"
          :aria-controls="pickerOpen ? pickerId : undefined"
          :aria-activedescendant="activeOptionId"
          data-testid="composer-input"
          @keydown="onKeydown"
          @input="onInput"
          @click="syncCaret"
          @keyup="syncCaret"
          @select="syncCaret"
          @scroll="syncScroll"
          @blur="dismissedAt = mentionQuery?.start ?? dismissedAt"
        />
      </div>
      <BaseButton variant="primary" :disabled="!canSend" @click="submit">{{
        isUploading ? "Uploading…" : "Send"
      }}</BaseButton>
    </div>
    <p v-if="mentionError" class="composer-error" role="alert" data-testid="composer-mention-error">
      {{ mentionError }}
    </p>
    <p v-if="error" class="composer-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.composer-wrapper {
  position: relative;
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

/*
  The textarea sits over a backdrop that repeats its text with picked mentions
  tinted, so a mention reads as a token while writing. Both share every metric
  that affects wrapping (font, padding, border width, gutter), and the backdrop
  follows the textarea's scroll.
*/
.input-shell {
  position: relative;
  flex: 1;
  display: flex;
  min-width: 0;
}
.composer-backdrop {
  position: absolute;
  inset: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: transparent;
  font-family: inherit;
  font-size: var(--font-size-md);
  line-height: var(--line-height-normal);
  white-space: pre-wrap;
  overflow-wrap: break-word;
  overflow: hidden;
  scrollbar-gutter: stable;
  pointer-events: none;
}
/* Same tokens as the sent MentionChip. No padding or border here: either
   would shift the backdrop text out of line with the textarea's. */
.draft-mention {
  border-radius: 4px;
  background: var(--color-mention-bg);
  box-shadow: inset 0 0 0 1px var(--color-mention-border);
}
.composer-input.over-backdrop {
  position: relative;
  background: transparent;
}

.composer-input {
  flex: 1;
  scrollbar-gutter: stable;
  min-height: 36px;
  max-height: 160px;
  resize: vertical;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--font-size-md);
  line-height: var(--line-height-normal);
}
.composer-input:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: -1px;
}
.composer-input:disabled {
  opacity: 0.6;
}

.composer-error {
  margin: 0;
  padding: 0 var(--space-4) var(--space-2);
  color: var(--color-danger);
  font-size: var(--font-size-xs);
  background: var(--color-surface);
}

.retry-link {
  border: none;
  background: none;
  padding: 0;
  color: var(--color-danger);
  font-size: inherit;
  font-family: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.attachment-drafts {
  list-style: none;
  margin: 0;
  padding: var(--space-2) var(--space-4) 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  background: var(--color-surface);
}

.attachment-draft {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 260px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bg);
  font-size: var(--font-size-xs);
}

.draft-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-size,
.draft-progress {
  flex: none;
  color: var(--color-text-muted);
}

.draft-error {
  flex: none;
  color: var(--color-danger);
}

.draft-remove {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  cursor: pointer;
}
.draft-remove:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.draft-remove:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.file-input {
  display: none;
}

.attach-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text-muted);
  cursor: pointer;
}
.attach-button:hover:not(:disabled) {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.attach-button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.attach-button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
