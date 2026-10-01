<script setup lang="ts">
import { ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import IdentityImportForm from "./IdentityImportForm.vue";
import { shortKey } from "@/features/identity/format";

/**
 * "Switch / Import another identity" on a device that already has one.
 *
 * Importing here is a SWITCH of the active identity, and the screen says so:
 * it names the identity this device currently uses, requires an explicit tick,
 * and the button reads "Switch identity". The current private key is not
 * destroyed by the switch — Rust archives it in the operating system's secure
 * storage first and refuses to continue if it can't — but it stops being the
 * active identity, and the NEXT SIGN-OUT removes that archive along with the
 * active key (SWF shared-device policy, docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §3).
 * Anything it owned is reachable again only by importing it back from its backup.
 *
 * The parent does the switching (`replace`), so it can end the current session
 * first, show progress and errors; a typed key/password is cleared by the
 * import form the moment it is submitted.
 */
defineProps<{ currentPubkey: string; busy?: boolean; error?: string | null }>();
const emit = defineEmits<{
  replace: [input: string, password: string | undefined, allowRawHex: boolean];
  cancel: [];
}>();

const open = ref(false);
</script>

<template>
  <div class="another">
    <BaseButton v-if="!open" variant="secondary" :disabled="busy" data-testid="import-another" @click="open = true">
      Switch / Import another identity
    </BaseButton>
    <template v-else>
      <h2 class="title">Switch identity</h2>
      <p class="current" data-testid="replace-warning">
        Current identity: <code>{{ shortKey(currentPubkey) }}</code>. This device already has an identity;
        importing another one switches this device to <strong>that</strong> identity. Your current
        private key is archived in your operating system's secure storage until the next sign-out, which
        removes it from this device — so back it up first if you may want it again. Communities you own
        or belong to as this identity won't open until you import it back.
      </p>
      <p class="label">Import another identity</p>
      <IdentityImportForm
        :busy="busy"
        needs-confirm
        confirm-text="I understand this will switch the active identity."
        submit-label="Switch identity"
        @submit="(input, password, allowRawHex) => emit('replace', input, password, allowRawHex)"
      />
      <BaseButton
        variant="ghost"
        :disabled="busy"
        data-testid="import-another-cancel"
        @click="
          open = false;
          emit('cancel');
        "
      >
        Cancel
      </BaseButton>
      <p v-if="error" class="error" data-testid="replace-error">{{ error }}</p>
    </template>
  </div>
</template>

<style scoped>
.another {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.title {
  margin: 0;
  font-size: var(--font-size-md, 1rem);
  color: var(--color-text);
}
.current,
.label {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.current code {
  font-family: monospace;
  color: var(--color-text);
}
.error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}
</style>
