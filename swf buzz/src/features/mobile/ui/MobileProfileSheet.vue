<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import AppIcon from "@/components/AppIcon.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import PresenceDot from "@/features/presence/PresenceDot.vue";
import MobileSheet from "./MobileSheet.vue";
import { useProfile } from "@/composables/useProfile";
import { usePresenceOf, useUserStatusOf } from "@/features/presence/presenceSync";
import { useOpenDm } from "@/features/dm/useOpenDm";
import { useSessionStore } from "@/stores/session";
import { shortKey } from "@/features/identity/format";
import { userMessageFor } from "@/services/errors";
import { MEMBER_ROLE_KEY } from "../memberRole";

/**
 * A person, on mobile — opened from an avatar, a sender name, an @mention or a
 * member row (anything that calls `ui.openProfile(pubkey)`). The same data as
 * the desktop profile drawer: the canonical profile registry (`useProfile`),
 * the one presence store, the NIP-38 status, the conversation's member role
 * when the screen knows it. "Message" is the drawer's own find-or-create DM
 * (`useOpenDm`), then the mobile DM screen.
 */
const props = defineProps<{ pubkey: string }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const session = useSessionStore();
const { data: profile } = useProfile(() => props.pubkey);
const presence = usePresenceOf(() => props.pubkey);
const customStatus = useUserStatusOf(() => props.pubkey);
const roleOf = inject(MEMBER_ROLE_KEY, null);
const { open, isOpening } = useOpenDm();

const name = computed(() => profile.value?.displayName?.trim() || shortKey(props.pubkey));
const isSelf = computed(() => session.pubkey === props.pubkey);
const ROLE = { owner: "Owner", admin: "Admin", member: "Member" } as const;
const roleLabel = computed(() => {
  if (profile.value?.isAgent) return "Agent";
  const role = roleOf?.(props.pubkey);
  return role ? ROLE[role] : null;
});
const STATUS = { online: "Online", away: "Away", offline: "Offline" } as const;
const showDetails = ref(false);
const error = ref<string | null>(null);
const copied = ref(false);

async function message() {
  error.value = null;
  try {
    const conversationId = await open([props.pubkey]);
    emit("close");
    await router.push({ name: "mobile-dm", params: { conversationId } });
  } catch (err) {
    error.value = userMessageFor(err);
  }
}

let copiedTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(copiedTimer));

async function copyKey() {
  try {
    await navigator.clipboard.writeText(props.pubkey);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 1500);
  } catch {
    // The key is shown in full below and can be selected.
  }
}
</script>

<template>
  <MobileSheet :label="`${name}, profile`" testid="mobile-profile-sheet" @close="emit('close')">
    <div class="head">
      <AvatarCircle :name="name" :avatar-url="profile?.avatarUrl" :is-agent="profile?.isAgent" :pubkey="pubkey" :size="72" />
      <p class="name" data-testid="mobile-profile-name">{{ name }}</p>
      <p v-if="roleLabel || profile?.designation" class="role" data-testid="mobile-profile-role">
        {{ [roleLabel, profile?.designation].filter(Boolean).join(" · ") }}
      </p>
      <p v-if="presence" class="presence" data-testid="mobile-profile-presence">
        <PresenceDot :status="presence" class="dot" />{{ STATUS[presence] }}
      </p>
      <p v-if="customStatus" class="custom-status">
        <span aria-hidden="true">{{ customStatus.emoji }}</span> {{ customStatus.text }}
      </p>
    </div>

    <div v-if="showDetails" class="details" data-testid="mobile-profile-details">
      <p v-if="profile?.about" class="about">{{ profile.about }}</p>
      <p class="key-label">Public key</p>
      <p class="key">{{ pubkey }}</p>
      <button type="button" class="sheet-row" @click="copyKey">
        <AppIcon :name="copied ? 'check' : 'copy'" :size="20" class="row-icon" />{{ copied ? "Copied" : "Copy public key" }}
      </button>
    </div>

    <div class="actions">
      <button
        v-if="!isSelf"
        type="button"
        class="primary"
        :disabled="isOpening"
        data-testid="mobile-profile-message"
        @click="message"
      >
        <AppIcon name="message" :size="20" />{{ isOpening ? "Opening…" : "Message" }}
      </button>
      <button type="button" class="sheet-row" data-testid="mobile-profile-view" @click="showDetails = !showDetails">
        <AppIcon name="user" :size="20" class="row-icon" />{{ showDetails ? "Hide details" : "View profile" }}
      </button>
      <button type="button" class="sheet-row" data-testid="mobile-profile-close" @click="emit('close')">
        <AppIcon name="close" :size="20" class="row-icon" />Close
      </button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </MobileSheet>
</template>

<style scoped>
.head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-2) var(--space-3) var(--space-3);
  text-align: center;
}
.name {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-xl);
  font-weight: 700;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.presence {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.dot {
  width: 9px;
  height: 9px;
}
.custom-status {
  margin: 2px 0 0;
  font-size: var(--font-size-sm);
}
.details {
  margin: 0 var(--space-2) var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}
.about {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
}
.key-label {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.key {
  margin: 2px 0 var(--space-1);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  word-break: break-all;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.primary {
  min-height: 48px;
  margin: 0 var(--space-2) var(--space-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font: inherit;
  font-weight: 700;
}
.primary:disabled {
  opacity: 0.7;
}
.error {
  margin: var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
</style>
