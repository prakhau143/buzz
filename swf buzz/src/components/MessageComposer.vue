<script setup lang="ts">
import { computed, ref } from "vue";
import BaseButton from "./BaseButton.vue";

export interface MentionCandidate {
  pubkey: string;
  displayName: string;
  isAgent?: boolean;
}

const props = defineProps<{
  disabled?: boolean;
  placeholder?: string;
  error?: string | null;
  mentionCandidates?: MentionCandidate[];
}>();
const emit = defineEmits<{ send: [content: string, mentionPubkeys: string[]]; typing: [] }>();

const content = ref("");
/** Pubkeys the user has explicitly picked from the @mention dropdown, in this draft. */
const mentionedPubkeys = ref<Set<string>>(new Set());

/** Trailing "@partial" at the end of the current draft, if any — drives the dropdown. */
const mentionQuery = computed(() => {
  const match = /(?:^|\s)@([a-zA-Z0-9_-]*)$/.exec(content.value);
  return match ? match[1] : null;
});

const mentionMatches = computed(() => {
  if (mentionQuery.value === null || !props.mentionCandidates?.length) return [];
  const query = mentionQuery.value.toLowerCase();
  return props.mentionCandidates
    .filter((c) => c.displayName.toLowerCase().includes(query))
    .slice(0, 6);
});

function pickMention(candidate: MentionCandidate) {
  content.value = content.value.replace(/(?:^|\s)@([a-zA-Z0-9_-]*)$/, (matched) => {
    const leadingSpace = matched.startsWith(" ") ? " " : "";
    return `${leadingSpace}@${candidate.displayName} `;
  });
  mentionedPubkeys.value.add(candidate.pubkey);
}

function submit() {
  const trimmed = content.value.trim();
  if (!trimmed || props.disabled) return;
  // Only keep mentions whose @Name still appears in the final text (in case it was edited away).
  const pubkeys = (props.mentionCandidates ?? [])
    .filter((c) => mentionedPubkeys.value.has(c.pubkey) && trimmed.includes(`@${c.displayName}`))
    .map((c) => c.pubkey);
  emit("send", trimmed, pubkeys);
  content.value = "";
  mentionedPubkeys.value = new Set();
}

function onInput() {
  emit("typing");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    if (mentionMatches.value.length > 0) return; // let the user finish picking a mention first
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <div class="composer-wrapper">
    <ul v-if="mentionMatches.length" class="mention-dropdown">
      <li v-for="candidate in mentionMatches" :key="candidate.pubkey">
        <button type="button" class="mention-option" @click="pickMention(candidate)">
          <span class="mention-name">{{ candidate.displayName }}</span>
          <span v-if="candidate.isAgent" class="mention-agent-badge">Agent</span>
        </button>
      </li>
    </ul>

    <div class="composer">
      <textarea
        v-model="content"
        class="composer-input"
        rows="1"
        :placeholder="placeholder ?? 'Message…'"
        :disabled="disabled"
        @keydown="onKeydown"
        @input="onInput"
      />
      <BaseButton variant="primary" :disabled="disabled || !content.trim()" @click="submit"
        >Send</BaseButton
      >
    </div>
    <p v-if="error" class="composer-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.composer-wrapper {
  position: relative;
}

.mention-dropdown {
  position: absolute;
  bottom: 100%;
  left: var(--space-4);
  right: var(--space-4);
  margin-bottom: var(--space-1);
  list-style: none;
  padding: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  max-height: 180px;
  overflow-y: auto;
}

.mention-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 32px;
  padding: 0 var(--space-2);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  text-align: left;
}
.mention-option:hover {
  background: var(--color-surface-muted);
}

.mention-agent-badge {
  font-size: var(--font-size-xs);
  color: var(--color-agent);
  background: var(--color-agent-muted);
  border-radius: var(--radius-full);
  padding: 0 var(--space-2);
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

.composer-input {
  flex: 1;
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
</style>
