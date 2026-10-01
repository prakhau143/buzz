<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import AppIcon from "@/components/AppIcon.vue";
import PresenceDot from "@/features/presence/PresenceDot.vue";
import { useProfile } from "@/composables/useProfile";
import { usePresenceOf } from "@/features/presence/presenceSync";
import { useDirectConversation } from "@/features/dm/useDirectConversation";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import { shortKey } from "@/features/identity/format";
import { userMessageFor } from "@/services/errors";

/**
 * The small identity card shown while hovering a mention. It is a PREVIEW of
 * the one profile system, not a second one: name, avatar and agent flag come
 * from the canonical registry (`useProfile`), presence from the one presence
 * store, "Profile" opens the same profile drawer as every author avatar, and
 * "Message" is the drawer's own find-or-create-DM action.
 *
 * Mounted only while visible, so a feed of mentions costs nothing until hovered.
 */
const props = defineProps<{ pubkey: string; anchor: HTMLElement }>();
const emit = defineEmits<{ close: []; enter: []; leave: [] }>();

const session = useSessionStore();
const ui = useUiStore();
const { data: profile } = useProfile(() => props.pubkey);
const presence = usePresenceOf(() => props.pubkey);
const { openDirectConversation } = useDirectConversation();

const name = computed(() => profile.value?.displayName?.trim() || shortKey(props.pubkey));
const isSelf = computed(() => session.pubkey === props.pubkey);
const STATUS = { online: "Online", away: "Away", offline: "Offline" } as const;
const isAgent = computed(() => !!profile.value?.isAgent);
const subtitle = computed(() => {
  const parts: string[] = [];
  if (isAgent.value) parts.push("Agent");
  else if (profile.value?.designation) parts.push(profile.value.designation);
  if (presence.value) parts.push(STATUS[presence.value]);
  return parts.join(" · ") || "Member";
});

const card = ref<HTMLElement | null>(null);
const style = ref<Record<string, string>>({ visibility: "hidden" });
const busy = ref(false);
const error = ref<string | null>(null);
const WIDTH = 248;
const GAP = 6;
const MARGIN = 8;

function place() {
  const el = card.value;
  if (!el) return;
  const a = props.anchor.getBoundingClientRect();
  const h = el.offsetHeight;
  let top = a.top - GAP - h;
  if (top < MARGIN) top = a.bottom + GAP;
  const left = Math.max(MARGIN, Math.min(a.left, window.innerWidth - MARGIN - WIDTH));
  style.value = { top: `${top}px`, left: `${left}px`, width: `${WIDTH}px` };
}

onMounted(async () => {
  await nextTick();
  place();
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", close, true);
  window.removeEventListener("resize", close);
});

function close() {
  emit("close");
}

function openProfile() {
  ui.openProfile(props.pubkey);
  close();
}

async function message() {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await openDirectConversation(props.pubkey);
    close();
  } catch (err) {
    error.value = userMessageFor(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="card"
      class="mention-card"
      role="dialog"
      :aria-label="`${name} profile preview`"
      :style="style"
      data-testid="mention-hover-card"
      @mouseenter="emit('enter')"
      @mouseleave="emit('leave')"
    >
      <div class="card-identity">
        <AvatarCircle
          :name="name"
          :avatar-url="profile?.avatarUrl"
          :is-agent="profile?.isAgent"
          :pubkey="pubkey"
          :size="36"
        />
        <div class="card-text">
          <span class="card-name">{{ name }}</span>
          <span class="card-sub">
            <span v-if="isAgent" class="card-agent" aria-hidden="true"><AppIcon name="bot" :size="16" /></span>
            <PresenceDot v-else-if="presence" :status="presence" class="card-dot" />
            {{ subtitle }}
          </span>
        </div>
      </div>
      <div class="card-actions">
        <button
          v-if="!isSelf"
          type="button"
          class="card-action"
          :disabled="busy"
          data-testid="mention-card-message"
          @click="message"
        >
          {{ busy ? "Opening…" : "Message" }}
        </button>
        <button type="button" class="card-action" data-testid="mention-card-profile" @click="openProfile">
          Profile
        </button>
      </div>
      <p v-if="error" class="card-error" role="alert">{{ error }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.mention-card {
  position: fixed;
  z-index: var(--z-dropdown);
  padding: var(--space-3);
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  animation: card-in 120ms ease-out;
}
@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mention-card {
    animation: none;
  }
}

.card-identity {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.card-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: var(--line-height-tight);
}
.card-name {
  font-weight: 600;
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-sub {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.card-dot {
  width: 8px;
  height: 8px;
}
.card-agent {
  display: inline-flex;
  color: var(--color-mention-text);
}
.card-agent :deep(svg) {
  width: 12px;
  height: 12px;
}

.card-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.card-action {
  flex: 1;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
}
.card-action:hover:not(:disabled) {
  background: var(--color-surface-hover);
}
.card-action:disabled {
  opacity: 0.6;
  cursor: default;
}

.card-error {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
</style>
