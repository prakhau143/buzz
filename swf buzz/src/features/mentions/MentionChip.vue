<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import MentionHoverCard from "./MentionHoverCard.vue";
import { agentMentionDisplayLabel, formatMentionDisplayLabel } from "./mentionModel";
import { isKnownAgent, profileFor } from "@/features/profile/profileStore";
import { useUiStore } from "@/stores/ui";

/**
 * A mention inside a message — the ONE mention component for every identity
 * (OLD BUZZ `MarkdownMention.tsx`: one chip, human or agent). An agent gets a
 * small glyph from its identity metadata; the highlight itself is identical.
 *
 * Click / Enter / Space opens the same profile drawer as an author avatar.
 * Hovering (after a short delay, so sweeping the pointer across a message does
 * not flash cards) shows a preview of that profile.
 */
const props = defineProps<{ pubkey: string; label: string }>();

const ui = useUiStore();
const isAgent = computed(() => !!profileFor(props.pubkey)?.isAgent || isKnownAgent(props.pubkey));
/** Full name — what the title and screen readers get. */
const fullLabel = computed(() => formatMentionDisplayLabel(props.label));
/** What the chip shows: an agent's trailing "(… Agent)" is carried by the glyph instead. */
const chipLabel = computed(() => (isAgent.value ? agentMentionDisplayLabel(fullLabel.value) : fullLabel.value));
const ariaLabel = computed(() => `${fullLabel.value}, ${isAgent.value ? "agent" : "member"}, open profile`);

const chip = ref<HTMLElement | null>(null);
const showCard = ref(false);
const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 150;
let openTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function clearTimers() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
}
function scheduleOpen() {
  clearTimers();
  openTimer = setTimeout(() => (showCard.value = true), OPEN_DELAY_MS);
}
function scheduleClose() {
  clearTimers();
  closeTimer = setTimeout(() => (showCard.value = false), CLOSE_DELAY_MS);
}
function hideNow() {
  clearTimers();
  showCard.value = false;
}
onBeforeUnmount(clearTimers);

function openProfile() {
  hideNow();
  ui.openProfile(props.pubkey);
}
</script>

<template>
  <span
    ref="chip"
    class="mention-chip"
    :class="{ agent: isAgent }"
    role="button"
    tabindex="0"
    :aria-label="ariaLabel"
    :title="fullLabel"
    data-mention=""
    :data-mention-kind="isAgent ? 'agent' : 'human'"
    :data-mention-pubkey="pubkey"
    data-testid="mention-chip"
    @click.stop="openProfile"
    @keydown.enter.prevent="openProfile"
    @keydown.space.prevent="openProfile"
    @keydown.escape="hideNow"
    @mouseenter="scheduleOpen"
    @mouseleave="scheduleClose"
    @blur="hideNow"
    >@{{ chipLabel }}<span v-if="isAgent" class="agent-glyph" aria-hidden="true" data-testid="mention-agent-glyph"
      ><AppIcon name="bot" :size="16" /></span
  ></span>
  <MentionHoverCard
    v-if="showCard && chip"
    :pubkey="pubkey"
    :anchor="chip"
    @enter="clearTimers"
    @leave="scheduleClose"
    @close="hideNow"
  />
</template>

<style scoped>
/*
  An inline token, not a button: `display: inline` so a long name wraps with
  the sentence (box-decoration-break repeats the tint and border on each line),
  and inline vertical padding never changes the line box, so a message with a
  mention is exactly as tall as one without. Every colour is an Appearance
  token derived from the accent (tokens.css / appearance.css), so a new accent
  or scheme restyles every mention immediately.
*/
.mention-chip {
  display: inline;
  padding: 1px 5px;
  border: 1px solid var(--color-mention-border);
  border-radius: 6px;
  background: var(--color-mention-bg);
  color: var(--color-mention-text);
  font-weight: 600;
  line-height: inherit;
  white-space: normal;
  overflow-wrap: anywhere;
  cursor: pointer;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}
.mention-chip:hover {
  background: var(--color-mention-bg-hover);
  border-color: var(--color-mention-border-hover);
}
.mention-chip:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .mention-chip {
    transition: none;
  }
}

/* Agent metadata: a small glyph in the chip's own colour, nothing louder. */
.agent-glyph {
  display: inline-flex;
  margin-left: 3px;
  vertical-align: -1px;
  opacity: 0.75;
}
.agent-glyph :deep(svg) {
  width: 12px;
  height: 12px;
}
</style>
