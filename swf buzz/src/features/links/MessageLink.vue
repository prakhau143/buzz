<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { linkDisplay } from "./urlModel";
import { openExternalUrl } from "@/platform/opener";

/**
 * A URL inside a message (docs/PHASE_H_MESSAGE_ACTIONS_RICH_LINKS.md §MessageLink).
 *
 * A real `<a href>` — so it is a link to assistive tech, can be focused and
 * copied, and shows its target on hover — whose activation is taken over:
 * every click (plain, Ctrl/⌘, Shift, middle) opens the URL in the system's
 * default browser via the platform opener and never navigates SWF itself.
 * A double-click is two clicks; the opener's de-duplication launches once,
 * without delaying the first click to wait for a second.
 *
 * `href` is already validated and normalised (`urlModel.findLinks`); the
 * opener checks it again. Text and attributes are bound, never HTML.
 */
const props = defineProps<{ href: string; text: string }>();

const display = computed(() => linkDisplay(props.href));
const label = computed(() => `${display.value.host}${display.value.rest ? `/${display.value.rest}` : ""}`);

function open(event: MouseEvent) {
  event.preventDefault();
  // Inside a message row: the click is the link's, not the row's (long-press,
  // thread open, selection handlers).
  event.stopPropagation();
  void openExternalUrl(props.href);
}

function onAuxClick(event: MouseEvent) {
  if (event.button === 1) open(event);
}
</script>

<template>
  <a
    class="message-link"
    :href="href"
    target="_blank"
    rel="noopener noreferrer nofollow"
    :title="href"
    :aria-label="`${label}, opens in your browser`"
    data-testid="message-link"
    draggable="false"
    @click="open"
    @auxclick="onAuxClick"
    @dblclick.prevent.stop
    ><AppIcon name="link" :size="16" class="link-glyph" /><span class="link-host">{{ display.host }}</span
    ><span v-if="display.rest" class="link-rest">/{{ display.rest }}</span></a
  >
</template>

<style scoped>
/*
  Inline, like a mention chip: it wraps with the sentence and never changes the
  line height. Accent text + a quiet underline distinguish it from prose (not
  colour alone: the glyph and underline carry it too), and it can never push
  the message wider than its column.
*/
.message-link {
  display: inline;
  color: var(--color-primary);
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
  word-break: break-word;
  border-radius: 4px;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    text-decoration-color 120ms ease;
}
.message-link:hover {
  background: var(--color-mention-bg);
  text-decoration-color: currentColor;
}
.message-link:active {
  background: var(--color-mention-bg-hover);
}
.message-link:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 1px;
}
.link-glyph {
  display: inline-block;
  width: 13px;
  height: 13px;
  margin-right: 3px;
  vertical-align: -2px;
  opacity: 0.8;
}
.link-rest {
  color: color-mix(in srgb, currentColor 78%, var(--color-text-muted));
  font-weight: 400;
}
@media (prefers-reduced-motion: reduce) {
  .message-link {
    transition: none;
  }
}
</style>
