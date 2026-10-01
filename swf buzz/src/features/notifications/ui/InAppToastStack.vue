<script setup lang="ts">
/**
 * The foreground notification surface: up to 3 compact cards at the top-right,
 * newest on top. Each auto-dismisses after ~6 s (paused while hovered or
 * focused), dismisses on × or Esc, and opens its exact message / thread / DM on
 * click. Pointer events are limited to the cards themselves, so the
 * conversation and composer underneath stay fully usable.
 */
import { computed, onBeforeUnmount, watch } from "vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import AppIcon from "@/components/AppIcon.vue";
import MessagePreview from "@/features/mentions/MessagePreview";
import { profileFor } from "@/features/profile/profileStore";
import { relativeTime } from "@/features/identity/format";
import {
  STATUS_TOAST_DISMISS_MS,
  TOAST_DISMISS_MS,
  dismissInAppToast,
  inAppToasts,
  isStatusToast,
  openInAppToast,
  type InAppToast,
  type ToastEntry,
} from "../inAppToasts";

const props = withDefaults(defineProps<{ offsetTop?: number }>(), { offsetTop: 60 });

// ---- auto-dismiss with pause ----
const timers = new Map<string, { handle: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number }>();

function start(id: string, ms: number) {
  const t = { handle: setTimeout(() => dismissInAppToast(id), ms), remaining: ms, startedAt: Date.now() };
  timers.set(id, t);
}
function pause(id: string) {
  const t = timers.get(id);
  if (!t?.handle) return;
  clearTimeout(t.handle);
  t.handle = null;
  t.remaining = Math.max(1000, t.remaining - (Date.now() - t.startedAt));
}
function resume(id: string) {
  const t = timers.get(id);
  if (!t || t.handle) return;
  t.startedAt = Date.now();
  t.handle = setTimeout(() => dismissInAppToast(id), t.remaining);
}

watch(
  () => inAppToasts.value.map((t) => t.id),
  (ids) => {
    for (const toast of inAppToasts.value) {
      if (!timers.has(toast.id)) start(toast.id, isStatusToast(toast) ? STATUS_TOAST_DISMISS_MS : TOAST_DISMISS_MS);
    }
    for (const [id, t] of timers) {
      if (ids.includes(id)) continue;
      if (t.handle) clearTimeout(t.handle);
      timers.delete(id);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  for (const t of timers.values()) if (t.handle) clearTimeout(t.handle);
  timers.clear();
});

const style = computed(() => ({ top: `${props.offsetTop}px` }));
const avatarOf = (t: InAppToast) => (t.authorPubkey ? profileFor(t.authorPubkey)?.avatarUrl : undefined);

function onKeydown(event: KeyboardEvent, toast: ToastEntry) {
  if (event.key !== "Escape") return;
  // Handled here: Esc on a toast must not also close a thread or dialog.
  event.stopPropagation();
  event.preventDefault();
  dismissInAppToast(toast.id);
}
</script>

<template>
  <section class="toast-stack" :style="style" aria-label="Notifications" aria-live="polite" data-testid="in-app-toasts">
    <TransitionGroup name="toast">
      <template v-for="toast in inAppToasts" :key="toast.id">
      <div
        v-if="toast.variant === 'status'"
        class="toast status-toast"
        :class="{ error: toast.tone === 'error' }"
        role="status"
        data-testid="status-toast"
        @mouseenter="pause(toast.id)"
        @mouseleave="resume(toast.id)"
      >
        <AppIcon :name="toast.icon" :size="16" class="status-icon" />
        <span class="status-title">{{ toast.title }}</span>
      </div>
      <article
        v-else
        class="toast"
        data-testid="in-app-toast"
        @mouseenter="pause(toast.id)"
        @mouseleave="resume(toast.id)"
        @focusin="pause(toast.id)"
        @focusout="resume(toast.id)"
        @keydown="onKeydown($event, toast)"
      >
        <button
          type="button"
          class="toast-main"
          :aria-label="`${toast.title}: ${toast.body}. ${toast.context}. Open`"
          data-testid="in-app-toast-open"
          @click="openInAppToast(toast)"
        >
          <AvatarCircle :name="toast.authorName" :avatar-url="avatarOf(toast)" :size="36" :show-presence="false" />
          <span class="toast-text">
            <span class="toast-title">{{ toast.title }}</span>
            <span class="toast-body"
              ><MessagePreview
                raw
                :content="toast.body"
                :mentions="toast.mentions ?? []"
                :mentions-everyone="!!toast.mentionsEveryone"
            /></span>
            <span class="toast-meta">{{ toast.context }} · {{ relativeTime(toast.createdAt) }}</span>
          </span>
        </button>
        <button
          type="button"
          class="toast-close"
          aria-label="Dismiss notification"
          title="Dismiss"
          data-testid="in-app-toast-close"
          @click="dismissInAppToast(toast.id)"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </article>
      </template>
    </TransitionGroup>
  </section>
</template>

<style scoped>
/* The stack itself never takes clicks — only the cards do. */
.toast-stack {
  position: fixed;
  right: 20px;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(380px, calc(100vw - 32px));
  pointer-events: none;
}
.toast {
  position: relative;
  display: flex;
  align-items: flex-start;
  pointer-events: auto;
  border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-surface) 90%, transparent);
  backdrop-filter: blur(14px) saturate(1.2);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.toast-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 8px 12px 14px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.toast-main:hover {
  background: color-mix(in srgb, var(--color-surface-muted) 60%, transparent);
}
.toast-main:focus-visible,
.toast-close:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
.toast-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.toast-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toast-body {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.toast-meta {
  margin-top: 2px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toast-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 8px 8px 0 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
.toast-close:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}

/* Status confirmation ("Message pinned"): one compact line, right-aligned in the stack. */
.status-toast {
  align-self: flex-end;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
}
.status-icon {
  color: var(--color-primary);
}
.status-toast.error .status-icon {
  color: var(--color-danger);
}
.status-title {
  white-space: nowrap;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(16px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
.toast-move {
  transition: transform 200ms ease;
}
/* Phone width (the mobile tier): centred under the status bar / notch, with a
   thumb-sized dismiss target. Desktop windows never reach this width. */
@media (max-width: 767px) {
  .toast-stack {
    left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right));
    width: auto;
    margin-top: env(safe-area-inset-top);
  }
  .toast-close {
    width: 44px;
    height: 44px;
    margin: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active,
  .toast-move {
    transition: none;
  }
}
</style>
