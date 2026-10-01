<script setup lang="ts">
import { computed, ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import {
  NPUB_REJECTED_MESSAGE,
  RAW_HEX_REJECTED_MESSAGE,
  previewIdentityInput,
  type IdentityPreview,
} from "@/features/identity/identityApi";
import { shortKey } from "@/features/identity/format";
import { userMessageFor } from "@/services/errors";

/**
 * Import an existing identity from an `nsec1…`, a 64-character hex key, or an
 * `ncryptsec1…` backup file's text (plus its password).
 *
 * What the user types here is the one place a secret exists in the webview. It
 * lives in these two local refs only — never Pinia, localStorage or a log — and
 * is cleared the instant it is handed to Rust, whether or not the import works.
 *
 * TWO-STEP, deliberately (docs/PHASE_3_FINAL_IMPLEMENTATION_REPORT.md §1a):
 * "Check key" asks Rust which identity the input actually resolves to and shows
 * it; only then can it be imported. A 64-character hex value is a *private* key
 * by definition, but a Nostr public key is also 64 hex characters — so pasting a
 * public key silently produces a different, unrelated identity. That is exactly
 * what happened with the operator key on this project: `0f61e5e4…` (a PUBLIC
 * key) was accepted and produced identity `7e13d4f6…`. Nothing can tell the two
 * apart by format, so the person confirms the resulting identity instead.
 */
const props = defineProps<{
  busy?: boolean;
  needsConfirm?: boolean;
  confirmText?: string;
  /** Button text — "Import identity" by default; the switch flow says "Switch identity". */
  submitLabel?: string;
}>();
const emit = defineEmits<{
  submit: [input: string, password: string | undefined, allowRawHex: boolean];
}>();

const secret = ref("");
const password = ref("");
const confirmed = ref(false);
/** The identity the current input resolves to. `null` until "Check key" succeeds. */
const preview = ref<IdentityPreview | null>(null);
const checking = ref(false);
const checkError = ref<string | null>(null);

/**
 * The input as Rust will read it (`backup::normalize_key_input`): pasted keys often
 * carry a `nostr:` prefix, quotes, line breaks or invisible characters. Used only to
 * decide which checks apply; the text sent to Rust is normalized there again.
 */
const cleaned = computed(() =>
  secret.value
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^nostr:/i, ""),
);
const isBackup = computed(() => /^ncryptsec1/i.test(cleaned.value));
/**
 * An npub is a PUBLIC key: it identifies, it can never authenticate, and no
 * private key can be derived from it. Refused here (same wording as Rust's
 * `backup::NPUB_REJECTED`, which refuses it again) so the user learns what is
 * actually needed instead of getting a generic "not a valid private key".
 */
const isNpub = computed(() => /^npub1/i.test(cleaned.value));
/**
 * A bare 64-character hex value. A private key is 64 hex characters and so is a
 * PUBLIC key, so this is refused on the normal path rather than guessed at — the
 * mistake it prevents (an operator's public key silently becoming a different
 * identity) happened twice here. `allowRawHex` is the developer-only opt-in.
 */
const isBareHex = computed(() => /^[0-9a-f]{64}$/i.test(cleaned.value));
const allowRawHex = ref(false);
const rejectedReason = computed(() => {
  if (isNpub.value) return NPUB_REJECTED_MESSAGE;
  if (isBareHex.value && !allowRawHex.value) return RAW_HEX_REJECTED_MESSAGE;
  return null;
});
/** Enough input to ask Rust which identity it is. */
const canCheck = computed(
  () =>
    !props.busy &&
    !checking.value &&
    secret.value.trim().length > 0 &&
    rejectedReason.value === null &&
    (!isBackup.value || password.value.length > 0),
);
const canSubmit = computed(
  () => canCheck.value && preview.value !== null && (!props.needsConfirm || confirmed.value),
);

/** Any edit invalidates a previous answer — never import against a stale preview. */
function onInputChanged() {
  preview.value = null;
  checkError.value = null;
}

async function check() {
  if (!canCheck.value) return;
  checking.value = true;
  checkError.value = null;
  try {
    preview.value = await previewIdentityInput(
      secret.value.trim(),
      isBackup.value ? password.value : undefined,
      allowRawHex.value,
    );
  } catch (err) {
    preview.value = null;
    checkError.value = userMessageFor(err);
  } finally {
    checking.value = false;
  }
}

function submit() {
  if (!canSubmit.value) return;
  const input = secret.value.trim();
  const backupPassword = isBackup.value ? password.value : undefined;
  const raw = allowRawHex.value;
  secret.value = "";
  password.value = "";
  confirmed.value = false;
  preview.value = null;
  emit("submit", input, backupPassword, raw);
}
</script>

<template>
  <form class="import-form" autocomplete="off" @submit.prevent="submit">
    <label class="label" for="import-secret">Private identity key or encrypted backup</label>
    <p class="accepted" data-testid="import-accepted">
      Accepted: <strong>nsec</strong> · <strong>private hex</strong> · <strong>ncryptsec</strong>.
      A public <code>npub</code> or public-key hex cannot sign in.
    </p>
    <input
      id="import-secret"
      v-model="secret"
      class="field"
      type="password"
      autocomplete="off"
      spellcheck="false"
      placeholder="nsec1… or ncryptsec1…"
      :aria-invalid="rejectedReason ? 'true' : undefined"
      :aria-describedby="rejectedReason ? 'import-npub-error' : undefined"
      data-testid="import-secret"
      @input="onInputChanged"
    />
    <p v-if="rejectedReason" id="import-npub-error" class="error" role="alert" data-testid="import-npub-error">
      {{ rejectedReason }}
    </p>

    <!-- Developer-only escape hatch for a raw PRIVATE hex key. Never on the
         normal path: raw hex cannot be told apart from a public key. -->
    <label v-if="isBareHex" class="confirm" data-testid="import-allow-hex-row">
      <input v-model="allowRawHex" type="checkbox" data-testid="import-allow-hex" @change="onInputChanged" />
      <span>
        <strong>Advanced (developer):</strong> treat this 64-character hex as a
        <strong>private</strong> key. A public key has the same length and cannot be distinguished
        by format — only use this if you are certain this value is a private key.
      </span>
    </label>
    <template v-if="isBackup">
      <label class="label" for="import-password">Backup password</label>
      <input
        id="import-password"
        v-model="password"
        class="field"
        type="password"
        autocomplete="off"
        data-testid="import-password"
        @input="onInputChanged"
      />
    </template>

    <!-- Step 1: which identity is this, actually? Nothing is stored yet. -->
    <BaseButton
      v-if="!preview"
      type="button"
      variant="secondary"
      :disabled="!canCheck"
      data-testid="import-check"
      @click="check"
    >
      {{ checking ? "Checking…" : "Check key" }}
    </BaseButton>
    <p v-if="checkError" class="error" role="alert" data-testid="import-check-error">{{ checkError }}</p>

    <!-- Step 2: confirm it is the identity you expect, then import. -->
    <div v-if="preview" class="preview" data-testid="import-preview">
      <p class="label">This key belongs to identity:</p>
      <p class="npub" data-testid="import-preview-npub">{{ preview.npub }}</p>
      <p class="fingerprint" data-testid="import-preview-pubkey">{{ shortKey(preview.pubkey) }}</p>
      <p v-if="preview.looksLikeBareHex" class="warn" data-testid="import-hex-warning">
        64-character hex is ambiguous. SWF Buzz treats raw hex entered here as a
        <strong>private</strong> key — a public key is the same length, so if you pasted one by
        mistake you would sign in as a different identity. Confirm the identity above is the one you
        intended before importing.
      </p>
      <p v-else class="note">Import only if this is the identity you expect.</p>
    </div>

    <label v-if="needsConfirm" class="confirm">
      <input v-model="confirmed" type="checkbox" data-testid="import-confirm" />
      <span>{{ confirmText ?? "I understand this replaces the unreadable stored identity." }}</span>
    </label>
    <BaseButton type="submit" variant="primary" :disabled="!canSubmit" data-testid="import-submit">
      {{ submitLabel ?? "Import identity" }}
    </BaseButton>
    <p class="note">Your key is decoded and stored on this device only. It is never sent to a server.</p>
  </form>
</template>

<style scoped>
.import-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
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
.confirm {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.note {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.accepted {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.accepted code {
  font-family: monospace;
}
.error {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
.preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
}
.npub {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-xs);
  word-break: break-all;
  color: var(--color-text);
}
.fingerprint {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.warn {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
</style>
