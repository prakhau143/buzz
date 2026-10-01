<script setup lang="ts">
/**
 * The per-view content layout (secondary sidebar / main pane / details
 * pane). The persistent header/primary-nav used to live here too — moved
 * to `AppHeader.vue` (rendered by `App.vue`, outside `ErrorBoundary`) so a
 * crash in this view's content doesn't take navigation down with it.
 *
 * The details pane has no toggle: it is visible exactly when a context panel
 * is open, derived in `stores/ui.ts`.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useRoute } from "vue-router";
import { useUiStore } from "@/stores/ui";
import { panelShownOn } from "@/features/navigation/contextPanelPolicy";
import PanelResizeHandle from "@/features/layout/ui/PanelResizeHandle.vue";
import {
  EXPANDED_MAIN_MIN_WIDTH,
  MAIN_MIN_WIDTH,
  availableMax,
  fitExpandedThread,
  fitShellPanels,
  usePanelWidth,
} from "@/features/layout/panelSizing";

const uiStore = useUiStore();
const { sidebarCollapsed, contextPanel, detailsPaneOpen: panelOpenInStore, threadViewMode } = storeToRefs(uiStore);

/**
 * The details column exists only for a panel THIS view owns
 * (features/navigation/contextPanelPolicy.ts). The navigation invariant
 * already closes a previous view's panel; this keeps the layout honest for a
 * panel opened later from a shared surface on a view that cannot render it —
 * no empty reserved column, ever. Outside a router (isolated component tests)
 * the store's answer stands.
 */
const route = useRoute() as ReturnType<typeof useRoute> | undefined;
const detailsPaneOpen = computed(() =>
  route ? panelShownOn(route.name, contextPanel.value) : panelOpenInStore.value,
);

/**
 * Design spec's six breakpoints (Audit B §9 / the design doc): 1440/1280 are
 * the same 260px/fluid/300px grid the CSS below already renders by default —
 * no JS needed, "tighter main" at 1280 is just fluid's own behavior. 1024
 * only needs the sidebar/details toggle to be reachable (`ChannelHeader`'s ☰
 * button, already wired to the same `sidebarCollapsed` state) — no forced
 * collapse. Only the ≤768px "drawer" tier needs real behavior: the sidebar
 * must start CLOSED there (so a fresh narrow window shows channel content,
 * not the nav overlay covering it) and OPEN again on returning to a wide
 * viewport — the one piece pure CSS can't do, since it can't flip a Vue
 * boolean's default. `detailsPaneOpen` is deliberately left alone here: it's
 * already content-triggered (opening a thread/profile/settings), and forcing
 * it closed on a resize would just slam shut whatever the reader had open —
 * only its CSS treatment (drawer/full-screen) changes at this width, below.
 */
const MOBILE_QUERY = "(max-width: 768px)";
/** Above this the details pane is a grid column; at or below it, an overlay (CSS below). */
const DETAILS_INLINE_QUERY = "(min-width: 1025px)";
let mql: MediaQueryList | null = null;
let detailsMql: MediaQueryList | null = null;
/** Whether each side panel is an in-flow column (resizable) rather than a drawer/overlay. */
const sidebarInline = ref(true);
const detailsInline = ref(true);
function handleBreakpointChange(e: MediaQueryList | MediaQueryListEvent) {
  uiStore.setSidebarCollapsed(e.matches);
  sidebarInline.value = !e.matches;
}
function handleDetailsBreakpoint(e: MediaQueryList | MediaQueryListEvent) {
  detailsInline.value = e.matches;
}

// ---- resizable columns (docs/PANEL_RESIZE_IMPLEMENTATION.md) ----
const bodyEl = ref<HTMLElement | null>(null);
const bodyWidth = ref(0);
let bodyObserver: ResizeObserver | null = null;
const sidebarWidth = usePanelWidth("sidebar");
const detailsWidth = usePanelWidth("details");
const showSidebarHandle = computed(() => !sidebarCollapsed.value && sidebarInline.value);
const showDetailsHandle = computed(() => detailsPaneOpen.value && detailsInline.value);
/**
 * Expanded thread (docs/THREAD_EXPANDED_VIEW.md): same grid, same divider —
 * the details column just takes most of the width while the conversation
 * keeps EXPANDED_MAIN_MIN_WIDTH. Its width is session-only; the persisted
 * docked width is never written while expanded, so Restore returns to it.
 */
const expanded = computed(() => threadViewMode.value === "expanded");
const expandedInline = computed(() => expanded.value && showDetailsHandle.value);
const expandedChoice = ref<number | null>(null);
const expandedFit = computed(() =>
  fitExpandedThread(bodyWidth.value, showSidebarHandle.value ? sidebarWidth.width.value : null, expandedChoice.value),
);
/** Rendered widths: the saved ones, squeezed only as far as keeps the conversation >= MAIN_MIN_WIDTH. */
const fitted = computed(() =>
  expandedInline.value
    ? { sidebar: expandedFit.value.sidebar, details: expandedFit.value.thread }
    : fitShellPanels(
        bodyWidth.value,
        showSidebarHandle.value ? sidebarWidth.width.value : null,
        showDetailsHandle.value ? detailsWidth.width.value : null,
      ),
);
const renderedSidebar = computed(() => fitted.value.sidebar ?? sidebarWidth.width.value);
const renderedDetails = computed(() => fitted.value.details ?? detailsWidth.width.value);
const mainFloor = computed(() => (expandedInline.value ? EXPANDED_MAIN_MIN_WIDTH : MAIN_MIN_WIDTH));
const sidebarMax = computed(() =>
  availableMax("sidebar", bodyWidth.value, (showDetailsHandle.value ? renderedDetails.value : 0) + mainFloor.value),
);
const detailsMin = computed(() => (expandedInline.value ? expandedFit.value.min : detailsWidth.spec.min));
const detailsMax = computed(() =>
  expandedInline.value
    ? expandedFit.value.max
    : availableMax("details", bodyWidth.value, (showSidebarHandle.value ? renderedSidebar.value : 0) + MAIN_MIN_WIDTH),
);
// The one divider drives whichever width is showing: expanded → session-only,
// docked → the persisted preference.
function onDetailsResize(width: number) {
  if (expandedInline.value) expandedChoice.value = width;
  else detailsWidth.set(width);
}
function onDetailsCommit() {
  if (!expandedInline.value) detailsWidth.commit();
}
function onDetailsReset() {
  if (expandedInline.value) expandedChoice.value = null; // back to the balanced default split
  else detailsWidth.reset();
}

/**
 * Animate only the docked ⇄ expanded switch (never a drag, which must track
 * the pointer 1:1). `prefers-reduced-motion` turns the transition off in CSS.
 */
const switching = ref(false);
let switchTimer: ReturnType<typeof setTimeout> | undefined;
watch(expanded, () => {
  switching.value = true;
  clearTimeout(switchTimer);
  switchTimer = setTimeout(() => (switching.value = false), 320);
});

/**
 * While expanded, a click on the conversation's EMPTY area restores the
 * docked layout. Anything meaningful — a message, link, button, reaction,
 * composer, menu, text selection — keeps its normal behavior and does not
 * collapse the thread.
 */
const INTERACTIVE =
  "a, button, input, textarea, select, label, summary, [role=button], [role=link], [role=menuitem], [role=textbox], [contenteditable], [tabindex], [data-message-id]";
function onMainClick(event: MouseEvent) {
  if (!expanded.value || event.button !== 0 || event.defaultPrevented) return;
  const target = event.target as Element | null;
  if (!target || target.closest(INTERACTIVE)) return;
  if (window.getSelection?.()?.toString()) return;
  uiStore.setThreadViewMode("docked");
}
const columnVars = computed(() => ({
  "--shell-sidebar-width": `${renderedSidebar.value}px`,
  "--shell-details-width": `${renderedDetails.value}px`,
}));

onMounted(() => {
  if (bodyEl.value && typeof ResizeObserver !== "undefined") {
    bodyObserver = new ResizeObserver(([entry]) => (bodyWidth.value = entry.contentRect.width));
    bodyObserver.observe(bodyEl.value);
  }
  // jsdom (component tests) doesn't implement matchMedia — real browsers and
  // Tauri's webview always do, so this is a test-environment guard, not
  // production behavior: without it, the default (visible) sidebar is fine.
  if (typeof window.matchMedia !== "function") return;
  mql = window.matchMedia(MOBILE_QUERY);
  handleBreakpointChange(mql);
  mql.addEventListener("change", handleBreakpointChange);
  detailsMql = window.matchMedia(DETAILS_INLINE_QUERY);
  handleDetailsBreakpoint(detailsMql);
  detailsMql.addEventListener("change", handleDetailsBreakpoint);
});
onBeforeUnmount(() => {
  clearTimeout(switchTimer);
  mql?.removeEventListener("change", handleBreakpointChange);
  detailsMql?.removeEventListener("change", handleDetailsBreakpoint);
  bodyObserver?.disconnect();
});

function isNarrow(): boolean {
  return mql?.matches ?? false;
}
function closeSidebarDrawer() {
  if (isNarrow()) uiStore.setSidebarCollapsed(true);
}
function closeDetailsDrawer() {
  if (isNarrow()) uiStore.closeContextPanel();
}
</script>

<template>
  <div class="app-shell">
    <div
      ref="bodyEl"
      class="body"
      :class="{ 'sidebar-collapsed': sidebarCollapsed, 'thread-expanded': expanded && detailsPaneOpen, switching }"
      :style="columnVars"
    >
      <!-- Backdrop: only rendered (and only intercepts clicks) at ≤768px,
           where the sidebar/details panes become drawers over the content
           instead of grid columns beside it — see the media query below. -->
      <div
        v-if="!sidebarCollapsed || detailsPaneOpen"
        class="scrim"
        @click="closeSidebarDrawer(), closeDetailsDrawer()"
      />

      <aside
        v-if="!sidebarCollapsed"
        class="sidebar"
        @keydown.escape="closeSidebarDrawer"
      >
        <slot name="sidebar" />
      </aside>
      <PanelResizeHandle
        v-if="showSidebarHandle"
        class="shell-handle sidebar-handle"
        edge="end"
        label="Resize sidebar"
        :width="renderedSidebar"
        :min="sidebarWidth.spec.min"
        :max="sidebarMax"
        data-testid="sidebar-resize"
        @resize="sidebarWidth.set"
        @commit="sidebarWidth.commit"
        @reset="sidebarWidth.reset"
      />

      <!-- The "Show/Hide details" toggle was removed. The pane is now shown
           exactly when a context panel THIS VIEW OWNS is open (`detailsPaneOpen`
           above: `contextPanel.kind` + contextPanelPolicy), so there is nothing
           to toggle and no way to leave an empty pane behind. Every panel still has its
           own trigger: reply-in-thread, clicking a person, and the channel
           menu's "Channel details". -->
      <main class="main-pane" data-testid="main-pane" @click="onMainClick">
        <slot name="main" />
      </main>

      <aside
        v-if="detailsPaneOpen"
        class="details-pane"
        :class="{ expanded }"
        data-testid="details-pane"
        @keydown.escape="closeDetailsDrawer"
      >
        <slot name="details" />
      </aside>
      <PanelResizeHandle
        v-if="showDetailsHandle"
        class="shell-handle details-handle"
        edge="start"
        label="Resize side panel"
        :width="renderedDetails"
        :min="detailsMin"
        :max="detailsMax"
        data-testid="details-resize"
        @resize="onDetailsResize"
        @commit="onDetailsCommit"
        @reset="onDetailsReset"
      />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg);
}

/* Column widths come from the resizers (--shell-*-width, set inline); the
   fallbacks are the pre-resizer 260px / 300px. */
.body {
  position: relative;
  flex: 1;
  display: grid;
  grid-template-columns: var(--shell-sidebar-width, 260px) 1fr;
  min-height: 0;
}

.body:has(.details-pane) {
  grid-template-columns: var(--shell-sidebar-width, 260px) 1fr var(--shell-details-width, 300px);
}

.body.sidebar-collapsed {
  grid-template-columns: 1fr;
}
.body.sidebar-collapsed:has(.details-pane) {
  grid-template-columns: 1fr var(--shell-details-width, 300px);
}

/* Vertical dividers laid over the column borders (absolutely positioned, so
   they take no grid cell). Their 8px hit area straddles the 1px border. */
.shell-handle {
  position: absolute;
  top: 0;
  bottom: 0;
}
.sidebar-handle {
  left: calc(var(--shell-sidebar-width, 260px) - 4px);
}
.details-handle {
  right: calc(var(--shell-details-width, 300px) - 4px);
}

.sidebar {
  border-right: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  overflow-y: auto;
  min-width: 0;
}

.main-pane {
  min-width: 0;
  /* A grid item's default `min-height: auto` is its content height: without this
     a long history grew the pane (composer included) past the window, the whole
     page scrolled instead of the message feed, and the feed's own scrollTop —
     "open at the latest message" — did nothing. */
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}

.details-pane {
  border-left: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow-y: auto;
}

.scrim {
  display: none;
}

/* ---- Expanded thread (docs/THREAD_EXPANDED_VIEW.md) ---- */
/* Docked ⇄ expanded only: columns and the divider move together, right → left. */
.body.switching {
  transition: grid-template-columns 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.body.switching .details-handle {
  transition: right 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* The thread is the primary surface; the conversation stays fully usable, just
   slightly quieter — and back to full contrast the moment it is pointed at. */
.body.thread-expanded .main-pane {
  opacity: 0.92;
  transition: opacity 180ms ease;
}
.body.thread-expanded .main-pane:hover,
.body.thread-expanded .main-pane:focus-within {
  opacity: 1;
}
.details-pane.expanded {
  box-shadow: -10px 0 28px -18px rgba(0, 0, 0, 0.35);
}
@media (prefers-reduced-motion: reduce) {
  .body.switching,
  .body.switching .details-handle,
  .body.thread-expanded .main-pane {
    transition: none;
  }
}

/*
 * Design spec's responsive breakpoints (1440/1280/1024/768/390/375):
 * 1440+ and 1280 need no override — the default grid above already gives
 * 260px sidebar / fluid main / 300px details, all simultaneously visible,
 * and "tighter main" at 1280 falls out of `1fr` for free. 1024 only needs
 * the sidebar/details toggle to be reachable (ChannelHeader's ☰, and the
 * existing "Show/Hide details" bar) — no layout change, both already work
 * at any width. The real breakpoint is ≤768px, where sidebar and details
 * stop being grid columns and become drawers/overlays over full-width main
 * content (JS default-state handling for the sidebar drawer is in the
 * script above); ≤480px (covers the 390/375 targets) makes the details
 * drawer a true full-screen view rather than a partial overlay, per the
 * "Thread becomes full-screen" mobile requirement.
 */
/*
 * 769–1024px: the sidebar is still an in-flow column here (it only becomes a
 * drawer at ≤768), so the grid must keep a column for it. This rule used to set
 * `1fr` for every case, which made the sidebar a full-width ROW with the main
 * pane pushed underneath it — observed in the real Tauri window at 1024.
 * Three columns would crush the main pane at this width, so the details /
 * thread pane becomes a right-side overlay instead.
 */
@media (max-width: 1024px) {
  .body,
  .body:has(.details-pane) {
    grid-template-columns: var(--shell-sidebar-width, 260px) 1fr;
  }
  /* The details pane is an overlay here - not resizable. */
  .details-handle {
    display: none;
  }
  .body.sidebar-collapsed,
  .body.sidebar-collapsed:has(.details-pane) {
    grid-template-columns: 1fr;
  }
  .details-pane {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(380px, 100%);
    z-index: calc(var(--z-drawer) + 1);
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.16);
  }
  /* Overlay tier: expanded widens the overlay but leaves the sidebar plus 300px
     of the conversation visible (just the 300px when the sidebar is hidden). */
  .details-pane.expanded {
    width: max(380px, calc(100% - var(--shell-sidebar-width, 260px) - 300px));
    transition: width 280ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .body.sidebar-collapsed .details-pane.expanded {
    width: max(380px, calc(100% - 300px));
  }
}
@media (max-width: 1024px) and (prefers-reduced-motion: reduce) {
  .details-pane.expanded {
    transition: none;
  }
}

@media (max-width: 768px) {
  /* Drawers on mobile - nothing is resizable. */
  .shell-handle {
    display: none;
  }

  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.32);
    z-index: var(--z-drawer);
  }

  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: min(320px, 85vw);
    max-width: 320px;
    height: 100%;
    z-index: calc(var(--z-drawer) + 1);
    box-shadow: 0 0 24px rgba(0, 0, 0, 0.24);
  }

  .details-pane,
  .details-pane.expanded,
  .body.sidebar-collapsed .details-pane.expanded {
    position: fixed;
    inset: 0;
    width: 100%;
    z-index: calc(var(--z-drawer) + 1);
  }
}

@media (max-width: 480px) {
  .sidebar {
    width: 100%;
    max-width: 100%;
  }
}
</style>
