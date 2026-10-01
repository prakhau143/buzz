<script setup lang="ts">
/**
 * The SWF sign-out confirmation. Sign-out REMOVES the identity's private key
 * from this device (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §3, a
 * deliberate shared-device decision — not OLD BUZZ parity), so the user is told
 * before it happens and reminded that the only way back is their own backup.
 * It never blocks: "Sign out & remove identity" proceeds regardless.
 */
import { ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { useFocusTrap } from "@/composables/useFocusTrap";

defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ close: []; confirm: [] }>();
useEscapeKey(() => emit("close"));
const dialog = ref<HTMLElement | null>(null);
useFocusTrap(dialog);
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div
      ref="dialog"
      class="dialog-card"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sign-out-title"
      aria-describedby="sign-out-warning"
      data-testid="sign-out-dialog"
    >
      <h2 id="sign-out-title">Sign out of SWF Buzz?</h2>
      <p id="sign-out-warning" class="warning" data-testid="sign-out-warning">
        Signing out will remove this identity's private key from this device. Make sure you have
        your nsec, hex private key, or ncryptsec backup if you want to use this identity again.
      </p>
      <p class="hint">
        Without a backup you will not be able to use this identity again. Any identities previously
        switched away on this device are removed as well.
      </p>
      <div class="dialog-actions">
        <BaseButton variant="ghost" :disabled="busy" data-testid="sign-out-cancel" @click="emit('close')">
          Cancel
        </BaseButton>
        <BaseButton variant="danger" :disabled="busy" data-testid="sign-out-confirm" @click="emit('confirm')">
          {{ busy ? "Signing out…" : "Sign out & remove identity" }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
}

.dialog-card {
  width: 420px;
  max-width: calc(100vw - var(--space-4) * 2);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.2));
}

.dialog-card h2 {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-lg);
  color: var(--color-text);
}

.warning {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
