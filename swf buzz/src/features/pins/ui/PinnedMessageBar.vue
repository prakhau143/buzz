<script setup lang="ts">
import { computed } from "vue";
import { nip19 } from "nostr-tools";
import AppIcon from "@/components/AppIcon.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import { useProfile } from "@/composables/useProfile";
import { relativeTime, shortKey } from "@/features/identity/format";
import { safePreview } from "@/features/notifications/notificationEngine";
import { profileFor } from "@/features/profile/profileStore";
import type { PinnedView } from "../useConversationPin";

/**
 * The conversation's pinned message, directly under its header
 * (docs/PHASE_G_PINNED_MESSAGES_EVERYONE.md §UI) — a compact context strip,
 * not an announcement: pin glyph, who pinned it and when, a 1–2 line preview,
 * attachment / thread cues, and an unpin control only for someone allowed to.
 *
 * Activating it (click, tap, Enter, Space) emits `open`; the screen routes that
 * through the existing MessageTarget → useOpenMessageTarget reveal, so the
 * exact message is scrolled to and highlighted (or its thread opened) by the
 * same code as every other deep link. A deleted or unavailable message never
 * leaves a dead banner: it says so, and offers unpin to whoever may.
 */
const props = defineProps<{
  view: PinnedView;
  canUnpin: boolean;
  busy?: boolean;
  /** Touch layout: 44px targets, two-line preview. */
  mobile?: boolean;
}>();
const emit = defineEmits<{ open: []; unpin: []; retry: [] }>();

// One profile lookup for the pinner, through the shared registry/query cache.
const { data: pinnerProfile } = useProfile(() => props.view.pin.pinnedBy);
const pinnerName = computed(() => pinnerProfile.value?.displayName?.trim() || shortKey(props.view.pin.pinnedBy));
const when = computed(() => relativeTime(props.view.pin.pinnedAt));
const whenAbsolute = computed(() => new Date(props.view.pin.pinnedAt * 1000).toLocaleString());

const message = computed(() => props.view.message);
const attachments = computed(() => message.value?.attachments?.length ?? 0);
const preview = computed(() => {
  const m = message.value;
  if (!m) return "";
  return safePreview(m.content, {
    attachments: attachments.value,
    max: 220,
    nameOf: nameOfRef,
  });
});

/** `npub…` / `nprofile…` in the text → the person's name from the registry (no fetch). */
function nameOfRef(ref: string): string | null {
  try {
    const decoded = nip19.decode(ref);
    const pubkey = decoded.type === "npub" ? decoded.data : decoded.type === "nprofile" ? decoded.data.pubkey : null;
    return pubkey ? (profileFor(pubkey)?.displayName ?? null) : null;
  } catch {
    return null;
  }
}
const inThread = computed(() => props.view.threadRootId !== null);
const openable = computed(() => props.view.status === "ready");

const accessibleName = computed(() => {
  const base = `Pinned by ${pinnerName.value}, ${when.value}`;
  if (props.view.status === "ready") return `${base}: ${preview.value}. Open pinned message`;
  if (props.view.status === "loading") return `${base}. Loading pinned message`;
  if (props.view.status === "error") return `${base}. Unable to load pinned message`;
  return `${base}. This message is no longer available`;
});

function activate() {
  if (openable.value) emit("open");
}
</script>

<template>
  <section
    class="pin-bar"
    :class="{ mobile, unavailable: view.status === 'unavailable' || view.status === 'error' }"
    aria-label="Pinned message"
    data-testid="pinned-message-bar"
    :data-status="view.status"
  >
    <component
      :is="openable ? 'button' : 'div'"
      :type="openable ? 'button' : undefined"
      class="pin-main"
      :class="{ openable }"
      :aria-label="accessibleName"
      data-testid="pinned-message-open"
      @click="activate"
    >
      <span class="pin-glyph" aria-hidden="true"><AppIcon name="pin" :size="16" /></span>
      <span class="pin-text">
        <span class="pin-meta">
          <AvatarCircle
            class="pin-avatar"
            :name="pinnerName"
            :avatar-url="pinnerProfile?.avatarUrl"
            :pubkey="view.pin.pinnedBy"
            :size="16"
            :show-presence="false"
          />
          <span class="pin-by">Pinned by <strong>{{ pinnerName }}</strong></span>
          <span class="pin-dot" aria-hidden="true">·</span>
          <time class="pin-when" :datetime="new Date(view.pin.pinnedAt * 1000).toISOString()" :title="whenAbsolute">{{ when }}</time>
          <span v-if="attachments" class="pin-cue" :title="attachments === 1 ? '1 attachment' : `${attachments} attachments`"
            ><AppIcon name="paperclip" :size="16" />{{ attachments }}</span
          >
          <span v-if="inThread" class="pin-cue" title="In a thread"><AppIcon name="reply" :size="16" />Thread</span>
        </span>
        <span v-if="view.status === 'ready'" class="pin-snippet" data-testid="pinned-message-preview">{{ preview }}</span>
        <span v-else-if="view.status === 'loading'" class="pin-snippet muted">Loading pinned message…</span>
        <span v-else-if="view.status === 'error'" class="pin-snippet muted" role="status">Unable to load pinned message</span>
        <span v-else class="pin-snippet muted" role="status" data-testid="pinned-message-unavailable">This message is no longer available.</span>
      </span>
      <AppIcon v-if="openable" name="chevron-right" :size="16" class="pin-chevron" />
    </component>
    <button
      v-if="view.status === 'error'"
      type="button"
      class="pin-action"
      aria-label="Retry loading the pinned message"
      title="Retry"
      data-testid="pinned-message-retry"
      @click="emit('retry')"
    >
      <AppIcon name="refresh" :size="16" />
    </button>
    <button
      v-if="canUnpin"
      type="button"
      class="pin-action"
      aria-label="Unpin message"
      title="Unpin"
      :disabled="busy"
      data-testid="pinned-message-unpin"
      @click="emit('unpin')"
    >
      <AppIcon name="close" :size="16" />
    </button>
  </section>
</template>

<style scoped>
.pin-bar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  min-height: 56px;
  margin: var(--space-2) var(--space-4) 0;
  padding: 0 4px 0 0;
  border: 1px solid var(--color-pin-border);
  border-radius: var(--radius-md);
  background: var(--color-pin-bg);
  color: var(--color-pin-text);
  flex: none;
  min-width: 0;
}
.pin-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px 8px 12px;
  border: none;
  border-radius: calc(var(--radius-md) - 1px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}
.pin-main.openable {
  cursor: pointer;
  transition: background-color 120ms ease;
}
.pin-main.openable:hover {
  background: var(--color-pin-bg-hover);
}
.pin-main.openable:active {
  background: var(--color-mention-bg);
}
.pin-main:focus-visible,
.pin-action:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}
.pin-glyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  background: var(--color-mention-bg);
  color: var(--color-pin-icon);
}
.pin-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pin-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}
.pin-avatar {
  flex: none;
}
.pin-by {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pin-by strong {
  font-weight: 600;
  color: var(--color-text);
}
.pin-dot,
.pin-when {
  flex: none;
}
.pin-cue {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.pin-cue :deep(svg) {
  width: 12px;
  height: 12px;
}
.pin-snippet {
  font-size: var(--font-size-sm);
  line-height: var(--line-height-tight, 1.3);
  color: var(--color-text);
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  -webkit-box-orient: vertical;
}
.pin-snippet.muted {
  color: var(--color-text-muted);
  font-style: italic;
}
.pin-chevron {
  flex: none;
  color: var(--color-text-subtle);
}
.pin-action {
  flex: none;
  align-self: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
.pin-action:hover:not(:disabled) {
  background: var(--color-pin-bg-hover);
  color: var(--color-text);
}
.pin-action:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Wider desktop panes have room for a second preview line. */
@media (min-width: 1200px) {
  .pin-bar:not(.mobile) .pin-snippet {
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
}

/* Touch: full-width strip under the mobile header, 44px targets, two lines. */
.pin-bar.mobile {
  margin: 0;
  border-width: 0 0 1px;
  border-radius: 0;
  padding-right: 0;
}
.pin-bar.mobile .pin-main {
  min-height: 56px;
  padding: 8px 4px 8px 12px;
  border-radius: 0;
  -webkit-tap-highlight-color: transparent;
}
.pin-bar.mobile .pin-snippet {
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.pin-bar.mobile .pin-action {
  width: 44px;
  height: 44px;
}
@media (prefers-reduced-motion: reduce) {
  .pin-main.openable {
    transition: none;
  }
}
</style>
