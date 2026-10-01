<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import MobileBottomNav from "./MobileBottomNav.vue";
import MobilePullIndicator from "./MobilePullIndicator.vue";
import { useSwipeBack } from "../gestures/useSwipeBack";
import { usePullToRefresh } from "../gestures/usePullToRefresh";
import MobileProfileSheet from "./MobileProfileSheet.vue";
import { useUiStore } from "@/stores/ui";
import { navDirection, startViewportTracking } from "../mobileNav";

/**
 * The mobile screen frame: header | scrolling content | footer (composer) |
 * bottom navigation. A column exactly as tall as the VISIBLE viewport
 * (`--app-height`, tracked from `visualViewport`), so when the software
 * keyboard opens the content shrinks and the footer sits on the keyboard.
 * Only the content scrolls (`flex: 1; min-height: 0; overflow: auto`) —
 * no fixed positioning, no magic offsets.
 *
 * Safe areas: the header pads the top inset, the bottom nav (or, on stack
 * pages without it, the footer) pads the bottom inset, and the frame pads
 * left/right for landscape notches.
 */
const props = withDefaults(
  defineProps<{
    showNav?: boolean;
    /** Edge swipe → this (the screen's own header back). Screens without a back have no swipe. */
    back?: () => void;
    /** Pull-to-refresh → this (the screen's existing refetch). Omitted = no pull-to-refresh. */
    refresh?: () => Promise<unknown>;
    /** The element that scrolls, when it is not the content area itself (e.g. `.message-list`). */
    refreshScroller?: string;
  }>(),
  { showNav: false, back: undefined, refresh: undefined, refreshScroller: undefined },
);

/**
 * Every person surface already calls `ui.openProfile(pubkey)` (avatars, sender
 * names, @mentions, member rows). On mobile there is no side drawer, so each
 * screen shows that request as the profile sheet — no call site changes, one
 * profile model.
 */
const ui = useUiStore();
const profilePubkey = computed(() => (ui.contextPanel.kind === "profile" ? ui.contextPanel.pubkey : null));

const direction = navDirection.value;

// ---- Gestures (one shared policy: features/mobile/gestures) ----
const frame = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
useSwipeBack(frame, { enabled: () => !!props.back, onBack: () => props.back?.() });
const pull = usePullToRefresh(content, {
  enabled: () => !!props.refresh,
  scroller: () => (props.refreshScroller ? content.value?.querySelector<HTMLElement>(props.refreshScroller) : content.value) ?? null,
  onRefresh: () => props.refresh?.() ?? Promise.resolve(),
});
let stop: (() => void) | null = null;
onMounted(() => (stop = startViewportTracking()));
onBeforeUnmount(() => stop?.());
</script>

<template>
  <div ref="frame" class="mobile-layout" :class="[`enter-${direction}`, { 'has-nav': showNav }]" data-testid="mobile-layout">
    <header class="m-header">
      <slot name="header" />
    </header>
    <main ref="content" class="m-content">
      <MobilePullIndicator v-if="refresh" :phase="pull.phase.value" />
      <slot />
    </main>
    <div v-if="$slots.footer" class="m-footer">
      <slot name="footer" />
    </div>
    <MobileBottomNav v-if="showNav" class="m-nav" />
    <MobileProfileSheet v-if="profilePubkey" :key="profilePubkey" :pubkey="profilePubkey" @close="ui.closeContextPanel()" />
  </div>
</template>

<style scoped>
.mobile-layout {
  display: flex;
  flex-direction: column;
  height: var(--app-height, 100dvh);
  max-height: var(--app-height, 100dvh);
  overflow: hidden;
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  background: var(--color-bg);
  color: var(--color-text);
}

.m-header {
  flex: none;
  padding-top: env(safe-area-inset-top);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  z-index: 1;
}

.m-content {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
}

.m-footer {
  flex: none;
  background: var(--color-surface);
  padding-bottom: env(safe-area-inset-bottom);
}
.has-nav .m-footer {
  padding-bottom: 0;
}
/* The keyboard covers the home indicator: no inset, and no bottom nav. */
:global(html[data-keyboard="open"]) .m-footer {
  padding-bottom: 0;
}
:global(html[data-keyboard="open"]) .m-nav {
  display: none;
}

/*
  The shared message composer, touch-sized on every mobile screen (conversation
  and thread alike): 44px controls, and 16px text so iOS doesn't zoom on focus.
  No resize handle on a phone.
*/
.mobile-layout :deep(.composer) {
  padding: var(--space-2) var(--space-3);
  gap: var(--space-2);
}
.mobile-layout :deep(.composer-input),
.mobile-layout :deep(.composer-backdrop) {
  font-size: 16px;
}
.mobile-layout :deep(.composer-input) {
  min-height: 44px;
  resize: none;
}
.mobile-layout :deep(.composer .attach-button),
.mobile-layout :deep(.composer > button) {
  min-width: 44px;
  min-height: 44px;
}

/* A deep-revealed message: MessageList's accent tint plus a left rail (background/shadow only — no layout shift). */
.mobile-layout :deep(.message-list .is-highlighted) {
  box-shadow: inset 3px 0 0 var(--color-primary);
}

/*
  Attachments at phone width (MessageAttachments is shared with desktop; only
  these mobile-scoped rules change its presentation — upload, Blossom auth and
  rendering logic are untouched). Never wider than the column, aspect ratio
  kept (the component reserves it from `dim`), no stretching, readable names.
*/
.mobile-layout :deep(.attachments) {
  min-width: 0;
  max-width: 100%;
}
.mobile-layout :deep(.attachment) {
  min-width: 0;
  max-width: 100%;
}
.mobile-layout :deep(.message-body img),
.mobile-layout :deep(.message-body video) {
  max-width: 100%;
  height: auto;
}
.mobile-layout :deep(.attachments .video),
.mobile-layout :deep(.attachments .loading) {
  display: block;
  width: 100%;
  max-width: min(100%, 360px);
  border-radius: 12px;
}
/* The frame hugs the image: a portrait shot is capped by height and keeps its
   ratio (the reserved aspect-ratio drives both axes), with no letterbox bars. */
.mobile-layout :deep(.attachments .image-link) {
  display: block;
  width: fit-content;
  max-width: min(100%, 360px);
  border-radius: 12px;
}
.mobile-layout :deep(.attachments .image) {
  width: auto;
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
}
.mobile-layout :deep(.attachments .video) {
  max-height: 60vh;
}
/* A file is a 44px+ row whose long name ellipsises instead of widening the bubble. */
.mobile-layout :deep(.attachments .file) {
  display: flex;
  width: 100%;
  max-width: min(100%, 360px);
  min-width: 0;
  min-height: 48px;
  border-radius: 12px;
}
.mobile-layout :deep(.attachments .file-name) {
  flex: 1;
  min-width: 0;
}
/* Loading: a calm placeholder of real media height when the size isn't known yet. */
.mobile-layout :deep(.attachments .loading) {
  min-height: 140px;
  animation: m-media-pulse 1.4s ease-in-out infinite;
}
/* A failed attachment stays a labelled placeholder; its name wraps rather than overflowing. */
.mobile-layout :deep(.attachments .unavailable) {
  display: flex;
  max-width: min(100%, 360px);
  min-height: 48px;
  overflow-wrap: anywhere;
  border-radius: 12px;
}
@keyframes m-media-pulse {
  50% {
    opacity: 0.6;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mobile-layout :deep(.attachments .loading) {
    animation: none;
  }
}
/*
  Touch messages: a long press opens the action sheet (which offers Copy), so
  the platform's own callout / text-selection handles don't fight it.
*/
.mobile-layout :deep(.message-list [data-message-id]),
.mobile-layout :deep(.thread-panel [data-message-id]) {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

/*
  Micro-interactions (transform / opacity / colour only, 120–260 ms, none
  continuous): a sent message settles in, a reaction you add pops once, the
  feed fades in after its skeleton, a revealed message's tint eases out.
*/
.mobile-layout :deep(.message) {
  transition:
    opacity 200ms ease,
    background-color 320ms ease;
}
.mobile-layout :deep(.message.sending) {
  opacity: 0.62;
}
.mobile-layout :deep(.reaction-pill.mine) {
  animation: m-pop 220ms cubic-bezier(0.3, 1.4, 0.5, 1);
}
.mobile-layout :deep(.message-list) {
  animation: m-fade 180ms ease-out;
}
@keyframes m-pop {
  45% {
    transform: scale(1.14);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mobile-layout :deep(.message) {
    transition: none;
  }
  .mobile-layout :deep(.reaction-pill.mine),
  .mobile-layout :deep(.message-list) {
    animation: none;
  }
}

/*
  The sender avatar opens the profile: a 44px target on touch, drawn at its
  32px size — the negative margin keeps the row's layout exactly as before.
*/
.mobile-layout :deep(.author-avatar) {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin: -6px;
}

/* Retry / action controls in shared states meet the 44px touch minimum. */
.mobile-layout :deep(.state-view button),
.mobile-layout :deep(.pagination-retry) {
  min-height: 44px;
  min-width: 44px;
}

/*
  Sideways drags belong to the app, not the browser: only vertical panning
  (and pinch-zoom) is a native touch behaviour here, so a horizontal drag can
  never become the browser's "swipe to go back" and leave the app (Chrome
  ignores the root's overscroll-behavior once a nested scroller has the
  touch). The app's own edge swipe still sees every touchmove. Sideways
  scrollers, media and fields keep their native horizontal handling.
*/
.mobile-layout,
.mobile-layout :deep(*) {
  touch-action: pan-y pinch-zoom;
}
.mobile-layout :deep([data-hscroll]),
.mobile-layout :deep([data-hscroll] *),
.mobile-layout :deep(input),
.mobile-layout :deep(textarea),
.mobile-layout :deep(video),
.mobile-layout :deep(audio) {
  touch-action: manipulation;
}

/* Page transitions: deeper slides in from the right, back from the left. */
.enter-forward {
  animation: m-in-right 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.enter-back {
  animation: m-in-left 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.enter-none {
  animation: m-fade 140ms ease-out;
}
@keyframes m-in-right {
  from {
    transform: translateX(24px);
    opacity: 0.6;
  }
}
@keyframes m-in-left {
  from {
    transform: translateX(-24px);
    opacity: 0.6;
  }
}
@keyframes m-fade {
  from {
    opacity: 0.4;
  }
}
@media (prefers-reduced-motion: reduce) {
  .enter-forward,
  .enter-back,
  .enter-none {
    animation: none;
  }
}
</style>
