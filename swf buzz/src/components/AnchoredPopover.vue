<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

/**
 * A popover positioned from its anchor's real rectangle (`getBoundingClientRect`),
 * never fixed coordinates. It opens on the preferred side, flips if there is no
 * room there, and is clamped inside the viewport, so it works at any sidebar
 * width or window size. Clicking outside closes it (a transparent overlay, so
 * nothing underneath receives the click); Escape closes it; focus moves to the
 * first item on open and back to the anchor on close.
 *
 * Nesting: a submenu is another AnchoredPopover rendered inside this one's slot
 * with `nested` — it shares the parent's overlay, so one outside click closes both.
 */
const props = withDefaults(
  defineProps<{
    anchor: HTMLElement | null;
    /** Where to open relative to the anchor. */
    side?: "right" | "top";
    /** Vertical alignment for side="right": the popover's bottom meets the anchor's bottom. */
    align?: "start" | "end";
    width?: number;
    label: string;
    nested?: boolean;
  }>(),
  { side: "right", align: "end", width: 280, nested: false },
);
const emit = defineEmits<{ close: [] }>();

const GAP = 8;
const MARGIN = 8;
const panel = ref<HTMLElement | null>(null);
const style = ref<Record<string, string>>({ visibility: "hidden" });

function place(): void {
  const el = panel.value;
  const anchor = props.anchor;
  if (!el || !anchor) return;
  const a = anchor.getBoundingClientRect();
  const w = Math.min(props.width, window.innerWidth - MARGIN * 2);
  const h = el.offsetHeight;
  let left: number;
  let top: number;
  if (props.side === "right") {
    left = a.right + GAP;
    // No room on the right → open on the left of the anchor instead.
    if (left + w > window.innerWidth - MARGIN) left = a.left - GAP - w;
    top = props.align === "end" ? a.bottom - h : a.top;
  } else {
    left = a.left;
    top = a.top - GAP - h;
    if (top < MARGIN) top = a.bottom + GAP;
  }
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - w));
  top = Math.max(MARGIN, Math.min(top, window.innerHeight - MARGIN - h));
  style.value = { left: `${left}px`, top: `${top}px`, width: `${w}px` };
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
    return;
  }
  // Arrow keys move between the menu's items (buttons), wrapping around.
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = [...(panel.value?.querySelectorAll<HTMLElement>(":scope > .popover-body > :is([role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox']):not([disabled])") ?? [])];
  if (!items.length) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
  items[next]?.focus();
}

const previouslyFocused = document.activeElement as HTMLElement | null;
onMounted(async () => {
  await nextTick();
  place();
  panel.value
    ?.querySelector<HTMLElement>(":is([role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox']):not([disabled])")
    ?.focus();
  window.addEventListener("resize", place);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", place);
  if (!props.nested) (props.anchor ?? previouslyFocused)?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="!nested" class="popover-overlay" data-testid="popover-overlay" @click="emit('close')" />
    <div
      ref="panel"
      class="popover"
      role="menu"
      :aria-label="label"
      :style="style"
      @keydown="onKey"
      @click.stop
    >
      <div class="popover-body">
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.popover-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-dropdown);
}
.popover {
  position: fixed;
  z-index: calc(var(--z-dropdown) + 1);
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  padding: var(--space-2);
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  animation: popover-in 140ms ease-out;
}
.popover-body {
  display: flex;
  flex-direction: column;
}
@keyframes popover-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .popover {
    animation: none;
  }
}
</style>
