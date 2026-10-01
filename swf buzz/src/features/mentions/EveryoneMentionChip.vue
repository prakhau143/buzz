<script setup lang="ts">
import AppIcon from "@/components/AppIcon.vue";

/**
 * `@everyone` inside a message — the SAME chip as a person mention
 * (MentionChip.vue: the same `--color-mention-*` tokens, weight, radius,
 * border and hover), with the small group glyph where a person chip shows an
 * agent glyph. Rendered only for events that carry the semantic `@everyone`
 * tag (`MessageContent`), so plain text that happens to say "@everyone" stays
 * plain text.
 *
 * There is no profile behind it, so it is a focusable token with a description
 * rather than a button; the accessible name says what it means.
 */
const DESCRIPTION = "Mentions everyone who can see this channel";
</script>

<template>
  <span
    class="mention-chip everyone"
    tabindex="0"
    role="note"
    :aria-label="`@everyone. ${DESCRIPTION}`"
    :title="DESCRIPTION"
    data-mention=""
    data-mention-kind="everyone"
    data-testid="everyone-mention-chip"
    >@everyone<span class="group-glyph" aria-hidden="true"><AppIcon name="users" :size="16" /></span
  ></span>
</template>

<style scoped>
/* Kept identical to MentionChip.vue's `.mention-chip` — one visual language. */
.mention-chip {
  display: inline;
  padding: 1px 5px;
  border: 1px solid var(--color-mention-border);
  border-radius: 6px;
  background: var(--color-mention-bg);
  color: var(--color-mention-text);
  font-weight: 600;
  line-height: inherit;
  white-space: nowrap;
  cursor: default;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}
.mention-chip:hover,
.mention-chip:active {
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
.group-glyph {
  display: inline-flex;
  margin-left: 3px;
  vertical-align: -1px;
  opacity: 0.75;
}
.group-glyph :deep(svg) {
  width: 12px;
  height: 12px;
}
</style>
