<script setup lang="ts">
import { computed } from "vue";
import AvatarCircle from "./AvatarCircle.vue";
import { useProfileMap } from "@/composables/useProfile";
import { usePresenceStore } from "@/stores/presence";
import {
  MAX_TYPING_NAMES,
  compactTypingLabel,
  typingAnnouncement,
  typingLabel,
} from "@/features/presence/typingLabel";

/**
 * "Prakhar, Rahul and Amit are typing • • •" — one reusable strip above the
 * composer (channels and DMs). Presentation only: who is typing, their order
 * (who started first) and expiry all come from `useTypingIndicator` unchanged.
 *
 * - ZERO height while nobody is typing (docs/TYPING_INDICATOR_LAYOUT_FIX.md):
 *   the last message sits directly on the composer. When someone starts, the
 *   strip opens (grid rows 0fr → 1fr) between the list and the composer, and
 *   collapses back to exactly 0 when the last typist stops. The list shrinks /
 *   regrows by that amount; MessageList keeps a reader at the bottom anchored.
 * - Names and avatars come from the canonical profile cache (`useProfileMap`),
 *   the same one messages, DMs and member lists use; a missing name falls back
 *   to the shortened key, a missing picture to initials.
 * - Up to 5 avatars and names; more become "+N others" (the chip's tooltip
 *   lists them). A narrow strip switches to the compact sentence via a
 *   container query — never horizontal overflow.
 * - Screen readers hear only meaningful changes (a polite live region with the
 *   names / count), never the animation.
 */
const props = defineProps<{ pubkeys: string[] }>();

const { profiles, displayNames } = useProfileMap(() => props.pubkeys);
const presence = usePresenceStore();

const nameOf = (pubkey: string) => displayNames.value.get(pubkey) ?? pubkey.slice(0, 8);
const names = computed(() => props.pubkeys.map(nameOf));
const visible = computed(() => props.pubkeys.slice(0, MAX_TYPING_NAMES));
const hidden = computed(() => props.pubkeys.slice(MAX_TYPING_NAMES));

const full = computed(() => typingLabel(names.value));
const compact = computed(() => compactTypingLabel(names.value));
const announcement = computed(() => typingAnnouncement(names.value));

const PRESENCE = { online: "Online", away: "Away", offline: "Offline" } as const;
function tooltip(pubkey: string): string {
  const status = presence.statusOf(pubkey);
  return status ? `${nameOf(pubkey)} · ${PRESENCE[status]}` : nameOf(pubkey);
}
/** The one visibility source: active typists from the (unchanged) typing store. */
const active = computed(() => props.pubkeys.length > 0);
const hiddenTooltip = computed(() => hidden.value.map(nameOf).join(", "));
</script>

<template>
  <div class="typing-strip" :class="{ open: active }" :data-visible="active" data-testid="typing-strip">
    <div class="typing-clip">
    <Transition name="typing">
      <div v-if="active" class="typing" data-testid="typing-indicator">
        <span class="avatars">
          <span
            v-for="pubkey in visible"
            :key="pubkey"
            class="avatar"
            tabindex="0"
            :title="tooltip(pubkey)"
            :aria-label="tooltip(pubkey)"
            data-testid="typing-avatar"
          >
            <AvatarCircle
              :name="nameOf(pubkey)"
              :avatar-url="profiles.get(pubkey)?.avatarUrl"
              :size="22"
              :show-presence="false"
            />
          </span>
          <span
            v-if="hidden.length"
            class="more"
            tabindex="0"
            :title="hiddenTooltip"
            :aria-label="`Also typing: ${hiddenTooltip}`"
            data-testid="typing-more"
          >
            +{{ hidden.length }}
          </span>
        </span>
        <span class="label" aria-hidden="true">
          <span class="full" data-testid="typing-label">{{ full }}</span>
          <span class="compact" data-testid="typing-label-compact">{{ compact }}</span>
        </span>
        <span class="dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    </Transition>
    </div>
    <span class="sr-only" role="status" aria-live="polite" data-testid="typing-announcement">{{ announcement }}</span>
  </div>
</template>

<style scoped>
/*
 * Collapsed = exactly 0px: a one-row grid at 0fr whose only child clips with
 * min-height 0. No min-height, padding or margin on the strip itself, and the
 * live region is absolutely positioned — nothing else can hold space open.
 */
.typing-strip {
  position: relative;
  flex: 0 0 auto;
  display: grid;
  grid-template-rows: 0fr;
  min-width: 0;
  container-type: inline-size;
  transition: grid-template-rows 180ms ease;
}
.typing-strip.open {
  grid-template-rows: 1fr;
}
.typing-clip {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 0 var(--space-3);
}
/* Vertical breathing room is the pill's margin INSIDE the clip, so it collapses
   with it. Open height ≈ 38px. */
.typing {
  margin: 4px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
  padding: 4px 10px 4px 6px;
  border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-surface) 78%, transparent);
  backdrop-filter: blur(8px);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.avatars {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.avatar,
.more {
  display: inline-flex;
  border-radius: var(--radius-full);
  box-shadow: 0 0 0 2px var(--color-surface);
  animation: arrive 180ms ease-out;
}
.avatar + .avatar,
.avatar + .more {
  margin-left: -6px;
}
.avatar:focus-visible,
.more:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
.more {
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 600;
}
.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.label .compact {
  display: none;
}
/* Narrow strip: the short sentence ("Prakhar, Rahul +3 others are typing"). */
@container (max-width: 460px) {
  .label .full {
    display: none;
  }
  .label .compact {
    display: inline;
  }
}
.dots {
  display: inline-flex;
  gap: 3px;
  flex-shrink: 0;
}
.dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-primary);
  opacity: 0.35;
  animation: dot 1.1s ease-in-out infinite;
}
.dots i:nth-child(2) {
  animation-delay: 0.18s;
}
.dots i:nth-child(3) {
  animation-delay: 0.36s;
}
@keyframes dot {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
@keyframes arrive {
  from {
    opacity: 0.6;
    transform: scale(0.94);
  }
}
.typing-enter-active,
.typing-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.typing-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.typing-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (prefers-reduced-motion: reduce) {
  .dots i,
  .avatar,
  .more {
    animation: none;
  }
  .dots i {
    opacity: 0.7;
  }
  .typing-enter-active,
  .typing-leave-active,
  .typing-strip {
    transition: none;
  }
}
</style>
