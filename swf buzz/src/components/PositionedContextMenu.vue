<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { currentViewport, placeMenu } from "./menuPlacement";

/**
 * A floating menu anchored to its trigger that can never be clipped
 * (docs/PHASE_H_MESSAGE_ACTIONS_RICH_LINKS.md).
 *
 *  - Rendered in `<body>` (Teleport), so no ancestor's `overflow`, `transform`
 *    or stacking context can cut it off.
 *  - Positioned from the trigger's real rectangle and the VISIBLE viewport by
 *    `placeMenu` (pure, tested): below when it fits, above when it doesn't,
 *    scrolling inside itself when neither side is tall enough, always clamped.
 *  - Re-placed (once per frame) while open on window resize, any scroll —
 *    the conversation scrolling under it included — and visual-viewport
 *    changes (soft keyboard, pinch zoom). Every listener is removed on close.
 *  - Menu semantics: `role="menu"`; ArrowUp/ArrowDown (wrapping), Home/End;
 *    Enter/Space activate the focused item (they are buttons); Escape or Tab
 *    closes; focus moves to the first item on open and back to the trigger on
 *    close. Outside press closes it without swallowing the press, so the
 *    conversation underneath stays scrollable and clickable.
 *
 * Items are the slot's `[role="menuitem"]` buttons.
 */
const props = withDefaults(
  defineProps<{
    anchor: HTMLElement | null;
    label: string;
    width?: number;
  }>(),
  { width: 232 },
);
const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
const style = ref<Record<string, string>>({ visibility: "hidden", top: "0px", left: "0px" });
const side = ref<"bottom" | "top">("bottom");

function place(): void {
  const el = panel.value;
  const anchor = props.anchor;
  if (!el || !anchor) return;
  // Measure the natural height: clear any previous cap first.
  el.style.maxHeight = "";
  const placement = placeMenu(
    anchor.getBoundingClientRect(),
    { width: props.width, height: el.scrollHeight || el.offsetHeight },
    currentViewport(),
  );
  side.value = placement.side;
  style.value = {
    top: `${placement.top}px`,
    left: `${placement.left}px`,
    width: `${props.width}px`,
    ...(placement.maxHeight !== null ? { maxHeight: `${placement.maxHeight}px` } : {}),
  };
}

let frame = 0;
function schedulePlace(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    place();
  });
}

function items(): HTMLElement[] {
  return [...(panel.value?.querySelectorAll<HTMLElement>("[role='menuitem']:not([disabled])") ?? [])];
}

function onKeydown(event: KeyboardEvent): void {
  const list = items();
  const at = list.indexOf(document.activeElement as HTMLElement);
  let next: number | null;
  switch (event.key) {
    case "Escape":
      event.preventDefault();
      event.stopPropagation();
      emit("close");
      return;
    case "Tab":
      emit("close");
      return;
    case "ArrowDown":
      next = list.length ? (at + 1) % list.length : null;
      break;
    case "ArrowUp":
      next = list.length ? (at - 1 + list.length) % list.length : null;
      break;
    case "Home":
      next = list.length ? 0 : null;
      break;
    case "End":
      next = list.length ? list.length - 1 : null;
      break;
    default:
      return;
  }
  event.preventDefault();
  if (next !== null) list[next]?.focus();
}

function onOutsidePress(event: PointerEvent): void {
  const target = event.target as Node | null;
  if (!target) return;
  if (panel.value?.contains(target)) return;
  // The trigger toggles the menu itself; closing here too would reopen it.
  if (props.anchor?.contains(target)) return;
  emit("close");
}

const restoreFocusTo = props.anchor ?? (document.activeElement as HTMLElement | null);

onMounted(async () => {
  await nextTick();
  place();
  items()[0]?.focus({ preventScroll: true });
  window.addEventListener("resize", schedulePlace);
  window.addEventListener("scroll", schedulePlace, { capture: true, passive: true });
  window.visualViewport?.addEventListener("resize", schedulePlace);
  window.visualViewport?.addEventListener("scroll", schedulePlace);
  document.addEventListener("pointerdown", onOutsidePress, true);
});

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame);
  window.removeEventListener("resize", schedulePlace);
  window.removeEventListener("scroll", schedulePlace, { capture: true });
  window.visualViewport?.removeEventListener("resize", schedulePlace);
  window.visualViewport?.removeEventListener("scroll", schedulePlace);
  document.removeEventListener("pointerdown", onOutsidePress, true);
  // Back to the trigger, unless focus already moved somewhere deliberate
  // (an item that opened an editor or dialog takes it).
  const active = document.activeElement;
  if (restoreFocusTo?.isConnected && (!active || active === document.body || panel.value?.contains(active))) {
    restoreFocusTo.focus({ preventScroll: true });
  }
});

defineExpose({ place });
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel"
      class="context-menu"
      :class="`side-${side}`"
      role="menu"
      :aria-label="label"
      :style="style"
      data-testid="context-menu"
      @keydown="onKeydown"
    >
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: var(--z-dropdown);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
  overscroll-behavior: contain;
  animation: menu-in 120ms ease-out;
}
.context-menu.side-top {
  animation-name: menu-in-up;
}
@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}
@keyframes menu-in-up {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .context-menu {
    animation: none;
  }
}
</style>
