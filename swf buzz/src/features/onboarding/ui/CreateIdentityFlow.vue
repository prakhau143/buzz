<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import {
  MIN_BACKUP_PASSPHRASE_LEN,
  createIdentityWithBackup,
  saveBackup,
  type CreatedIdentityReveal,
} from "@/features/identity/identityApi";
import { userMessageFor } from "@/services/errors";

/**
 * "Create new identity" — the explicit backup checkpoint
 * (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §3c):
 *
 *   CREATE_START → BACKUP_PASSWORD → GENERATE_IDENTITY → IDENTITY_BACKUP_REVEAL
 *                → BACKUP_CONFIRMATION → (parent) COMMUNITY_SELECTION → READY
 *
 * Nothing is signed in and no relay is contacted until the user has SEEN the
 * generated identity and CONFIRMED the backup — the parent only starts the
 * session on `confirmed`. The private key (`nsec`) exists in the webview only as
 * this component's local `reveal` value, only on the reveal screen, hidden
 * behind "Show", and is cleared the moment the component is left. It never
 * touches Pinia, Vue Query, localStorage, a URL, a log or a request.
 */
type Step = "BACKUP_PASSWORD" | "GENERATE_IDENTITY" | "IDENTITY_BACKUP_REVEAL" | "BACKUP_CONFIRMATION";

const emit = defineEmits<{
  /** The identity exists on the device AND the user confirmed the backup. Public key only. */
  confirmed: [pubkey: string];
  /** Back to the identity choice before anything was generated. */
  cancel: [];
  /** The identity was generated but the user left without confirming the backup (warned). */
  leftUnconfirmed: [pubkey: string];
}>();

const step = ref<Step>("BACKUP_PASSWORD");
const password = ref("");
const confirmation = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

// The one-time reveal. `nsec` lives here and nowhere else.
const reveal = ref<CreatedIdentityReveal | null>(null);
const showPrivate = ref(false);
const copied = ref<"npub" | "nsec" | "ncryptsec" | null>(null);
const savedPath = ref<string | null>(null);

const storedAck = ref(false);
const lossAck = ref(false);
const leaveWarning = ref(false);

const passwordProblem = computed(() => {
  if (password.value.length < MIN_BACKUP_PASSPHRASE_LEN) {
    return `Use at least ${MIN_BACKUP_PASSPHRASE_LEN} characters.`;
  }
  if (password.value !== confirmation.value) return "The two passwords don't match.";
  return null;
});
const canContinue = computed(() => storedAck.value && lossAck.value && !busy.value);

async function create() {
  if (passwordProblem.value || busy.value) return;
  busy.value = true;
  error.value = null;
  step.value = "GENERATE_IDENTITY";
  try {
    reveal.value = await createIdentityWithBackup(password.value);
    step.value = "IDENTITY_BACKUP_REVEAL";
  } catch (err) {
    error.value = userMessageFor(err);
    step.value = "BACKUP_PASSWORD";
  } finally {
    // The passphrase has done its job (it is inside the ncryptsec now).
    password.value = "";
    confirmation.value = "";
    busy.value = false;
  }
}

async function copy(what: "npub" | "nsec" | "ncryptsec") {
  if (!reveal.value) return;
  try {
    await navigator.clipboard.writeText(reveal.value[what]);
    copied.value = what;
  } catch {
    error.value = "Couldn't copy to the clipboard.";
  }
}

async function download() {
  if (!reveal.value) return;
  busy.value = true;
  error.value = null;
  try {
    savedPath.value = await saveBackup(reveal.value.ncryptsec);
  } catch (err) {
    error.value = userMessageFor(err);
  } finally {
    busy.value = false;
  }
}

function toConfirmation() {
  step.value = "BACKUP_CONFIRMATION";
}

/** Drop the private key from memory. Idempotent; also runs on unmount. */
function clearSecret() {
  if (reveal.value) reveal.value = { ...reveal.value, nsec: "" };
  showPrivate.value = false;
}

function confirm() {
  if (!canContinue.value || !reveal.value) return;
  const pubkey = reveal.value.pubkey;
  clearSecret();
  emit("confirmed", pubkey);
}

function onBack() {
  if (step.value === "BACKUP_PASSWORD") return emit("cancel");
  // An identity already exists on the device: leaving now means leaving it
  // without a confirmed backup. Warn once; never trap the user.
  leaveWarning.value = true;
}

function leaveAnyway() {
  const pubkey = reveal.value?.pubkey ?? "";
  clearSecret();
  leaveWarning.value = false;
  emit("leftUnconfirmed", pubkey);
}

onBeforeUnmount(() => {
  clearSecret();
  reveal.value = null;
  password.value = "";
  confirmation.value = "";
});
</script>

<template>
  <div class="flow" :data-step="step">
    <!-- Step 1 — Create -->
    <template v-if="step === 'BACKUP_PASSWORD' || step === 'GENERATE_IDENTITY'">
      <h2>Create your identity</h2>
      <p class="hint">Create a secure backup password.</p>
      <label class="label" for="create-backup-password">Backup password</label>
      <input
        id="create-backup-password"
        v-model="password"
        class="field"
        type="password"
        autocomplete="new-password"
        :disabled="busy"
        data-testid="create-backup-password"
      />
      <label class="label" for="create-backup-confirm">Confirm password</label>
      <input
        id="create-backup-confirm"
        v-model="confirmation"
        class="field"
        type="password"
        autocomplete="new-password"
        :disabled="busy"
        data-testid="create-backup-confirm"
        @keydown.enter="create"
      />
      <p v-if="password && passwordProblem" class="problem" data-testid="create-password-problem">{{ passwordProblem }}</p>
      <BaseButton variant="primary" :disabled="!!passwordProblem || busy" data-testid="create-identity-submit" @click="create">
        {{ busy ? "Creating…" : "Create identity" }}
      </BaseButton>
      <BaseButton variant="ghost" :disabled="busy" data-testid="create-back" @click="onBack">Back</BaseButton>
    </template>

    <!-- Step 2 — Key generated -->
    <template v-else-if="step === 'IDENTITY_BACKUP_REVEAL' && reveal">
      <h2>Your identity is ready</h2>

      <section class="block">
        <h3>Public identity</h3>
        <p class="key" data-testid="reveal-npub">{{ reveal.npub }}</p>
        <BaseButton variant="secondary" data-testid="copy-npub" @click="copy('npub')">
          {{ copied === "npub" ? "Copied" : "Copy public identity" }}
        </BaseButton>
      </section>

      <section class="block">
        <h3>Private identity key</h3>
        <p class="key" data-testid="reveal-nsec" :aria-label="showPrivate ? 'Private key' : 'Private key hidden'">
          {{ showPrivate ? reveal.nsec : "•".repeat(24) }}
        </p>
        <div class="row">
          <BaseButton variant="secondary" data-testid="toggle-nsec" @click="showPrivate = !showPrivate">
            {{ showPrivate ? "Hide" : "Show" }}
          </BaseButton>
          <BaseButton variant="secondary" data-testid="copy-nsec" @click="copy('nsec')">
            {{ copied === "nsec" ? "Copied" : "Copy" }}
          </BaseButton>
        </div>
      </section>

      <section class="block">
        <h3>Encrypted backup</h3>
        <p class="key" data-testid="reveal-ncryptsec">{{ reveal.ncryptsec }}</p>
        <div class="row">
          <BaseButton variant="secondary" data-testid="copy-ncryptsec" @click="copy('ncryptsec')">
            {{ copied === "ncryptsec" ? "Copied" : "Copy backup" }}
          </BaseButton>
          <BaseButton variant="secondary" :disabled="busy" data-testid="download-backup" @click="download">
            {{ savedPath ? "Downloaded" : busy ? "Saving…" : "Download backup" }}
          </BaseButton>
        </div>
        <p v-if="savedPath" class="path" data-testid="backup-path">Saved to: {{ savedPath }}</p>
      </section>

      <BaseButton variant="primary" data-testid="reveal-next" @click="toConfirmation">I've saved my keys</BaseButton>
      <BaseButton variant="ghost" data-testid="reveal-back" @click="onBack">Back</BaseButton>
    </template>

    <!-- Step 3 — Warning + confirmation -->
    <template v-else-if="step === 'BACKUP_CONFIRMATION'">
      <h2>⚠ Save your identity backup</h2>
      <p class="warning">Your private key is required to sign in again.</p>
      <p class="warning">If you lose your private key and backup, you may not be able to access this identity again.</p>
      <p class="warning">Never share your private key with anyone.</p>

      <label class="check">
        <input v-model="storedAck" type="checkbox" data-testid="ack-stored" />
        <span>I have securely stored my identity backup.</span>
      </label>
      <label class="check">
        <input v-model="lossAck" type="checkbox" data-testid="ack-loss" />
        <span>I understand that losing it may prevent me from signing in again.</span>
      </label>

      <BaseButton variant="primary" :disabled="!canContinue" data-testid="continue-to-communities" @click="confirm">
        Continue to Communities
      </BaseButton>
      <BaseButton variant="ghost" data-testid="confirm-back" @click="step = 'IDENTITY_BACKUP_REVEAL'">Back to my keys</BaseButton>
    </template>

    <div v-if="leaveWarning" class="leave" role="alertdialog" aria-labelledby="leave-title" data-testid="leave-warning">
      <p id="leave-title" class="warning">
        You haven't confirmed your identity backup. Without your private key or backup you may not be able to sign in to
        this identity again.
      </p>
      <div class="row">
        <BaseButton variant="secondary" data-testid="leave-stay" @click="leaveWarning = false">Stay</BaseButton>
        <BaseButton variant="danger" data-testid="leave-anyway" @click="leaveAnyway">Leave anyway</BaseButton>
      </div>
    </div>

    <p v-if="error" class="problem" data-testid="create-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.flow {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
h2 {
  margin: 0;
  font-size: var(--font-size-md, 1rem);
  color: var(--color-text);
}
h3 {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}
.hint,
.warning {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.warning {
  color: var(--color-text);
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
.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
}
.key {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-xs);
  word-break: break-all;
  color: var(--color-text);
}
.row {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.path {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-xs);
  word-break: break-all;
  color: var(--color-text-muted);
}
.check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text);
}
.check input {
  margin-top: 3px;
}
.leave {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
}
.problem {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
</style>
