<script setup lang="ts">
import { ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import IdentityImportForm from "./IdentityImportForm.vue";
import type { LocalIdentityInfo } from "@/features/signing/signingService.tauri";
import { importIdentity } from "@/features/identity/identityApi";
import { userMessageFor } from "@/services/errors";

/**
 * A device with no identity: two choices, "Create new identity" or "Import
 * existing identity". Also explains the recovery states:
 *
 *  - `keyring-locked` — the OS secure storage can't be read right now. Nothing is
 *    created or imported (that could orphan the real key); unlock it and relaunch.
 *  - `lost`           — secure storage is reachable but empty although a key used
 *    to be there. Import the old key from a backup, or knowingly start over.
 *  - `corrupt`        — a stored identity exists but can't be read. It is left
 *    untouched; importing a key replaces it (after an explicit confirmation).
 *
 * Emits `ready` once an IMPORTED identity exists on this device; emits `create`
 * when the user chooses to create one — the parent then runs the explicit
 * backup checkpoint (`CreateIdentityFlow`) which generates the key. Neither
 * signs in — the parent does that (NIP-42). Nothing here takes a public key: a
 * public key identifies, it never authenticates.
 */
defineProps<{ recovery: LocalIdentityInfo["recovery"] }>();
const emit = defineEmits<{
  ready: [info: LocalIdentityInfo, source: "created" | "imported"];
  create: [];
}>();

const mode = ref<"choose" | "import">("choose");
const busy = ref(false);
const error = ref<string | null>(null);

function create() {
  error.value = null;
  emit("create");
}

async function doImport(input: string, password: string | undefined, allowRawHex: boolean) {
  busy.value = true;
  error.value = null;
  try {
    emit("ready", await importIdentity(input, password, allowRawHex), "imported");
  } catch (err) {
    error.value = userMessageFor(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="setup">
    <p v-if="recovery === 'keyring-locked'" class="warning" data-testid="recovery-locked">
      Your secure storage is locked, so your existing identity can't be read right now. Unlock it
      (for example, sign in to your operating system's keychain) and restart the app. A new
      identity will not be created.
    </p>

    <template v-else>
      <p v-if="recovery === 'lost'" class="warning" data-testid="recovery-lost">
        Your previous identity could not be found in secure storage. If you have a backup, import
        it. Creating a new identity gives you a different one, and you would need to be re-invited
        to your communities.
      </p>
      <p v-if="recovery === 'corrupt'" class="warning" data-testid="recovery-corrupt">
        A stored identity was found but couldn't be read. It has been left untouched. If you have a
        backup, import it to recover; a new identity can't be created over it.
      </p>

      <template v-if="mode === 'choose' && recovery !== 'corrupt'">
        <p class="hint">
          Your identity is a key pair generated on this device. The private key stays in your
          operating system's secure storage and never leaves it.
        </p>
        <BaseButton variant="primary" :disabled="busy" data-testid="show-import" @click="mode = 'import'">
          Import existing identity
        </BaseButton>
        <BaseButton variant="secondary" :disabled="busy" data-testid="create-identity" @click="create">
          Create new identity
        </BaseButton>
      </template>

      <template v-else>
        <IdentityImportForm :busy="busy" :needs-confirm="recovery === 'corrupt'" @submit="doImport" />
        <BaseButton
          v-if="recovery !== 'corrupt'"
          variant="ghost"
          :disabled="busy"
          data-testid="import-back"
          @click="mode = 'choose'"
        >
          Back
        </BaseButton>
      </template>

      <p v-if="error" class="error" data-testid="setup-error">{{ error }}</p>
    </template>
  </div>
</template>

<style scoped>
.setup {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.hint,
.warning {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}
</style>
