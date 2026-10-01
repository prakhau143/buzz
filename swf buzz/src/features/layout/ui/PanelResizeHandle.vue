<script setup lang="ts">
/**
 * A VERTICAL divider that resizes a panel HORIZONTALLY
 * (docs/PANEL_RESIZE_IMPLEMENTATION.md).
 *
 * - Pointer Events + pointer capture: mouse, pen and touch; the drag keeps
 *   tracking when the pointer leaves the 8px hit area or the window.
 * - Reads `clientX` only. Width in, width out — never height.
 * - `resize` fires on every move (live), `commit` once when the drag, a key
 *   press or a reset ends — that is the only time anything is persisted.
 * - Double-click resets to the default; the separator is keyboard-operable
 *   (arrows ±10px, Shift ±50px, Home/End) and announces its width.
 *
 * The parent positions it over the panel's border and owns the width.
 */
import { onBeforeUnmount, ref } from "vue";
import { clamp, dragWidth, keyWidth } from "../panelSizing";

const props = defineProps<{
  /** Current rendered width of the panel this divider sizes. */
  width: number;
  min: number;
  /** Effective max — already reduced to what the window can give. */
  max: number;
  /** "end" = divider on the panel's right edge; "start" = on its left edge. */
  edge: "start" | "end";
  label: string;
}>();

const emit = defineEmits<{
  resize: [width: number];
  commit: [];
  reset: [];
}>();

const dragging = ref(false);
let cleanup: (() => void) | null = null;

function onPointerDown(event: PointerEvent) {
  // Primary button / first touch only; a right-click must not start a drag.
  if (event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startWidth = props.width;
  const { min, max, edge } = props;
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    // Pointer already gone (or jsdom) — listeners below still end the drag.
  }
  dragging.value = true;
  document.body.classList.add("is-resizing");

  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    emit("resize", clamp(dragWidth(startWidth, startX, e.clientX, edge), min, max));
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    finish(true);
  };
  const finish = (commit: boolean) => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    handle.removeEventListener("lostpointercapture", end);
    document.body.classList.remove("is-resizing");
    dragging.value = false;
    cleanup = null;
    if (commit) emit("commit");
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);
  cleanup = () => finish(false);
}

function onKeyDown(event: KeyboardEvent) {
  const next = keyWidth(event.key, event.shiftKey, props.width, props.min, props.max, props.edge);
  if (next === null) return;
  event.preventDefault();
  if (next !== props.width) emit("resize", next);
  emit("commit");
}

// A view that unmounts mid-drag (route change) must not leave the cursor stuck.
onBeforeUnmount(() => cleanup?.());
</script>

<template>
  <div
    class="panel-resize-handle"
    :class="{ dragging }"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuenow="width"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    title="Drag to resize · double-click to reset"
    @pointerdown="onPointerDown"
    @dblclick="emit('reset')"
    @keydown="onKeyDown"
  />
</template>

<style scoped>
/* 8px hit area, 1px line centred in it. */
.panel-resize-handle {
  position: relative;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  outline: none;
  z-index: 5;
}
.panel-resize-handle::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: transparent;
  transition: background-color 120ms ease, width 120ms ease;
}
.panel-resize-handle:hover::after,
.panel-resize-handle.dragging::after,
.panel-resize-handle:focus-visible::after {
  width: 2px;
  background: var(--color-primary);
}
</style>

<style>
/* While any panel is being resized: one cursor everywhere, no text selection,
   and embedded frames can't swallow the pointer. */
body.is-resizing,
body.is-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
body.is-resizing iframe {
  pointer-events: none;
}
</style>
