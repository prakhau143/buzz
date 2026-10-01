<script setup lang="ts">
import CloseButton from "@/components/CloseButton.vue";
import { onMounted, ref } from "vue";
import BackupPanel from "@/features/onboarding/ui/BackupPanel.vue";
import BaseButton from "@/components/BaseButton.vue";
import { getLocalIdentity, type LocalIdentityInfo } from "@/features/signing/signingService.tauri";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { useFocusTrap } from "@/composables/useFocusTrap";

/**
 * "My identity": your public key (safe to share — an admin needs it to make you an
 * owner) and the NIP-49 backup. The private key is never displayed here or
 * anywhere else in the app.
 */
const emit = defineEmits<{ close: [] }>();
useEscapeKey(() => emit("close"));
const dialog = ref<HTMLElement | null>(null);
useFocusTrap(dialog);

const identity = ref<LocalIdentityInfo | null>(null);
const copied = ref<"npub" | "hex" | null>(null);
const showBackup = ref(false);

onMounted(async () => {
  identity.value = await getLocalIdentity().catch(() => null);
});

async function copy(kind: "npub" | "hex") {
  const value = kind === "npub" ? identity.value?.npub : identity.value?.pubkey;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    copied.value = kind;
  } catch {
    // Clipboard blocked: the value is on screen to copy by hand.
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div ref="dialog" class="card" role="dialog" aria-modal="true" aria-label="My identity">
      <div class="header">
        <h2>My identity</h2>
        <CloseButton @click="emit('close')" />
      </div>

      <p class="hint">
        Your public key identifies you. Send it to a community owner so they can add you. It is safe
        to share; your private key never leaves this device — and a public key on its own can never
        sign anyone in.
      </p>

      <template v-if="identity?.pubkey">
        <p class="label">Public key (npub)</p>
        <p class="value" data-testid="my-npub">{{ identity.npub }}</p>
        <BaseButton variant="secondary" @click="copy('npub')">{{ copied === "npub" ? "Copied" : "Copy Public Key" }}</BaseButton>
        <p class="label">Public key (hex)</p>
        <p class="value" data-testid="my-pubkey">{{ identity.pubkey }}</p>
        <BaseButton variant="secondary" @click="copy('hex')">{{ copied === "hex" ? "Copied" : "Copy hex" }}</BaseButton>
      </template>

      <BaseButton v-if="!showBackup" variant="primary" data-testid="open-backup" @click="showBackup = true">
        Back up my identity
      </BaseButton>
      <BackupPanel v-else @done="showBackup = false" />
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
}
.card {
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h2 {
  margin: 0;
  font-size: var(--font-size-lg, 1.1rem);
  color: var(--color-text);
}
.close {
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
.hint,
.label {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.value {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-xs);
  word-break: break-all;
  color: var(--color-text);
}
</style>
