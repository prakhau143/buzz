<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import { MIN_BACKUP_PASSPHRASE_LEN, createBackup, saveBackup } from "@/features/identity/identityApi";
import { userMessageFor } from "@/services/errors";

/**
 * Back up the identity with NIP-49: Rust encrypts the private key with a
 * passphrase you choose and checks it decrypts back to the same identity. The
 * result is an `ncryptsec1…` blob — password-protected, but still key material,
 * so it is saved to a local file (never sent anywhere; Rust also refuses to sign
 * any event containing one, so it cannot be published to a relay).
 *
 * The passphrase is cleared as soon as the backup exists. There is no recovery
 * without it — the wording below says so.
 */
const emit = defineEmits<{ done: [] }>();

const passphrase = ref("");
const confirmation = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const savedPath = ref<string | null>(null);
const ncryptsec = ref<string | null>(null); // encrypted; kept only to offer "Copy"
const copied = ref(false);

const problem = computed(() => {
  if (passphrase.value.length < MIN_BACKUP_PASSPHRASE_LEN) {
    return `Use at least ${MIN_BACKUP_PASSPHRASE_LEN} characters.`;
  }
  if (passphrase.value !== confirmation.value) return "The two passphrases don't match.";
  return null;
});

async function create() {
  if (problem.value || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const blob = await createBackup(passphrase.value);
    ncryptsec.value = blob;
    savedPath.value = await saveBackup(blob);
    passphrase.value = "";
    confirmation.value = "";
  } catch (err) {
    error.value = userMessageFor(err);
  } finally {
    busy.value = false;
  }
}

async function copy() {
  if (!ncryptsec.value) return;
  try {
    await navigator.clipboard.writeText(ncryptsec.value);
    copied.value = true;
  } catch {
    error.value = "Couldn't copy to the clipboard. Use the saved file instead.";
  }
}

onBeforeUnmount(() => {
  passphrase.value = "";
  confirmation.value = "";
  ncryptsec.value = null;
});
</script>

<template>
  <div class="backup">
    <template v-if="!savedPath">
      <p class="hint">
        Choose a passphrase to encrypt a backup of your identity. <strong>If you lose both this
        device and the passphrase, your identity cannot be recovered.</strong>
      </p>
      <label class="label" for="backup-pass">Backup passphrase</label>
      <input
        id="backup-pass"
        v-model="passphrase"
        class="field"
        type="password"
        autocomplete="new-password"
        data-testid="backup-passphrase"
      />
      <label class="label" for="backup-confirm">Repeat passphrase</label>
      <input
        id="backup-confirm"
        v-model="confirmation"
        class="field"
        type="password"
        autocomplete="new-password"
        data-testid="backup-confirmation"
      />
      <p v-if="passphrase && problem" class="problem" data-testid="backup-problem">{{ problem }}</p>
      <BaseButton variant="primary" :disabled="!!problem || busy" data-testid="backup-create" @click="create">
        {{ busy ? "Encrypting…" : "Create encrypted backup" }}
      </BaseButton>
    </template>

    <template v-else>
      <p class="ok" data-testid="backup-saved">Backup saved to:</p>
      <p class="path" data-testid="backup-path">{{ savedPath }}</p>
      <p class="hint">
        Keep this file somewhere safe, separate from this device. It only opens with your passphrase.
      </p>
      <BaseButton variant="secondary" @click="copy">
        {{ copied ? "Copied" : "Copy encrypted backup text" }}
      </BaseButton>
    </template>

    <p v-if="error" class="error" data-testid="backup-error">{{ error }}</p>
    <BaseButton variant="ghost" data-testid="backup-done" @click="emit('done')">
      {{ savedPath ? "Done" : "Skip for now" }}
    </BaseButton>
  </div>
</template>

<style scoped>
.backup {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.hint,
.ok {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.field {
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}
.path {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-xs);
  word-break: break-all;
  color: var(--color-text);
}
.problem,
.error {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
</style>
