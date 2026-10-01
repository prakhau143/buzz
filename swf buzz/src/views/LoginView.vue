<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import { useAuth } from "@/features/auth/useAuth";
import { useIdentitySessionStore, type IdentitySessionPhase } from "@/features/auth/identitySession";
import { getLocalIdentity, type LocalIdentityInfo } from "@/features/signing/signingService.tauri";
import { useSessionStore } from "@/stores/session";
import { useConnectionStore } from "@/stores/connection";
import { pendingLink } from "@/features/deeplink/pendingLink";
import { shortKey } from "@/features/identity/format";
import IdentitySetup from "@/features/onboarding/ui/IdentitySetup.vue";
import ImportAnotherIdentity from "@/features/onboarding/ui/ImportAnotherIdentity.vue";
import CreateIdentityFlow from "@/features/onboarding/ui/CreateIdentityFlow.vue";
import BaseButton from "@/components/BaseButton.vue";

// The sign-in screen for the local Nostr identity (no Okta). It is only about
// IDENTITY, and it reflects the DEVICE truthfully (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §9):
//   STATE 1  no identity stored     → "No identity is stored on this device."
//                                     [Import existing identity] [Create new identity]
//   STATE 2  identity stored, not   → "Identity found on this device." + fingerprint
//            yet signed in            [Continue with this identity] [Switch / Import another identity]
//   STATE 3  switch/import flow     → names the CURRENT identity, explicit tick, "Switch identity"
// SWF sign-out REMOVES the identity from the device, so after a sign-out this
// screen is always STATE 1 — never "Continue with" a previous person's key. If
// that removal failed, STATE 2 shows the failure and offers to retry it.
// The screen never asks for, shows or lets you pick a community address. Which
// community (or the Operator dashboard, or a picker) you land on is decided
// AFTER sign-in from what the relay says about this identity — see `resolveAccess`
// in useAuth.ts.
// TODO(identity-migration): the "Sign in with Okta" button and bunker-URI step used
// to live here. They are intentionally gone from the view; their logic
// (`loginWithOkta`, `completeBunkerPairing`, `OktaCallbackView`) is untouched in
// useAuth.ts until the Okta code is removed — see
// docs/SWF_BUZZ_OLD_BUZZ_IDENTITY_MIGRATION_PLAN.md §26.
const {
  isLoading,
  error,
  continueWithLocalIdentity,
  replaceIdentityLocal,
  removeStoredIdentity,
} = useAuth();
const session = useSessionStore();
const connection = useConnectionStore();
const lifecycle = useIdentitySessionStore();
const router = useRouter();
const inTauri = isTauri();

const identity = ref<LocalIdentityInfo | null>(null);
const identityError = ref<string | null>(null);
const identityLoading = ref(inTauri);
/**
 * `create` = the explicit backup checkpoint (CreateIdentityFlow): the key is
 * generated, SHOWN, and its backup CONFIRMED before anything signs in.
 */
const step = ref<"main" | "create">("main");
/** Set right after a successful switch so the screen shows the NEW identity and the sign-in progress. */
const switchedTo = ref<string | null>(null);

/**
 * The visible sign-in progression after a switch: Authenticating… → NIP-42 ✓ →
 * Resolving permissions… → Operator ✓ / Member ✓ → Ready. Driven by the
 * identity-session lifecycle store; each step is done, active, or pending.
 */
const PROGRESS_STEPS = computed<{ phase: IdentitySessionPhase; label: string }[]>(() => [
  { phase: "SIGNER_READY", label: "Authenticating…" },
  // A community sign-in authenticates the socket (NIP-42); an operator with no
  // community to open authenticates HTTP requests only (NIP-98).
  { phase: "NIP42_AUTHENTICATED", label: connection.authenticatedPubkey ? "NIP-42" : "NIP-98" },
  { phase: "ROLE_RESOLVED", label: "Resolving permissions…" },
  { phase: "READY", label: "Ready" },
]);
const PHASE_ORDER: IdentitySessionPhase[] = [
  "NO_IDENTITY",
  "IDENTITY_LOADED",
  "SIGNER_READY",
  "RELAY_CONNECTING",
  "NIP42_AUTHENTICATED",
  "ROLE_RESOLVED",
  "READY",
];
function stepState(phase: IdentitySessionPhase): "done" | "active" | "pending" | "failed" {
  if (lifecycle.failedAt === phase) return "failed";
  const current = PHASE_ORDER.indexOf(lifecycle.phase);
  const mine = PHASE_ORDER.indexOf(phase);
  if (current > mine) return "done";
  if (current === mine) return lifecycle.phase === "READY" ? "done" : "active";
  return "pending";
}
/** "Operator ✓" / "Member ✓" — the roles the relay actually returned for the new pubkey, separately. */
const resolvedRoles = computed(() => {
  const parts: string[] = [];
  if (session.isPlatformOperator) parts.push("Operator");
  if (session.communityRole) parts.push(session.communityRole[0].toUpperCase() + session.communityRole.slice(1));
  return parts;
});

async function refreshIdentity() {
  if (!inTauri) return;
  try {
    identity.value = await getLocalIdentity();
    identityError.value = null;
  } catch (err) {
    identityError.value = err instanceof Error ? err.message : "Couldn't read your identity.";
  } finally {
    identityLoading.value = false;
  }
}

onMounted(async () => {
  await refreshIdentity();
  // A swfbuzz:// link was opened before/while this screen was showing: act on it.
  if (identity.value?.pubkey && pendingLink.value) await router.push({ name: "join" });
});

// Re-read the identity after each attempt: a create can succeed in Rust and
// still fail afterwards (e.g. relay unreachable), and the screen must then
// offer "Continue" rather than "Create" again.
async function onContinue() {
  await continueWithLocalIdentity();
  await refreshIdentity();
}

async function onIdentityReady(_info: LocalIdentityInfo, _source: "created" | "imported") {
  await refreshIdentity();
  if (pendingLink.value) return router.push({ name: "join" });
  // An imported identity came from a backup or another device: sign straight in.
  // (A created one never arrives here — it goes through `CreateIdentityFlow`.)
  await onContinue();
}

// "Create new identity": generate → SHOW the keys → CONFIRM the backup → only
// then sign in (NIP-98/NIP-42, roles, community selection). Part L: no relay
// authentication before the backup is confirmed.
function onStartCreate() {
  step.value = "create";
}

async function onCreateConfirmed(_pubkey: string) {
  step.value = "main";
  await refreshIdentity();
  if (pendingLink.value) return router.push({ name: "join" });
  await onContinue();
}

// The key exists but the backup was not confirmed: back to STATE 2 (the
// identity is on the device; the user can continue or switch), not signed in.
async function onCreateLeft(_pubkey: string) {
  step.value = "main";
  await refreshIdentity();
}

function onCreateCancel() {
  step.value = "main";
}

// "Switch / Import another identity" while one exists: end the current session,
// swap the identity in Rust (the old key is archived first), re-read which
// identity the device now has — the screen shows THAT one from here on — and
// sign in as it.
async function onReplace(input: string, password: string | undefined) {
  if (!(await replaceIdentityLocal(input, password))) return;
  await refreshIdentity();
  switchedTo.value = identity.value?.pubkey ?? null;
  if (pendingLink.value) return router.push({ name: "join" });
  await onContinue();
}

// A sign-out whose Rust removal failed: the session is over but the key is
// still here. Ask Rust again; when it succeeds the screen becomes STATE 1.
async function onRetryRemove() {
  await removeStoredIdentity();
  await refreshIdentity();
}

const hasIdentity = computed(() => !!identity.value?.pubkey);
const recovery = computed(() => identity.value?.recovery ?? "none");
/** Only meaningful while the identity is in fact still stored. */
const removalFailed = computed(() => hasIdentity.value && !!session.identityRemovalError);
const shownError = computed(() => error.value ?? identityError.value ?? session.authError);
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1>SWF Buzz</h1>

      <p v-if="!inTauri" class="subtitle">
        Your identity is held by the SWF Buzz desktop app. Open the desktop app to sign in.
      </p>

      <p v-else-if="identityLoading" class="subtitle">Loading your identity…</p>

      <template v-else-if="step === 'create'">
        <CreateIdentityFlow @confirmed="onCreateConfirmed" @left-unconfirmed="onCreateLeft" @cancel="onCreateCancel" />
      </template>

      <template v-else>
        <p v-if="pendingLink && !hasIdentity" class="subtitle" data-testid="pending-link-banner">
          You opened an invite link. Set up your identity to continue.
        </p>

        <template v-if="hasIdentity && identity?.pubkey">
          <template v-if="switchedTo && switchedTo === identity.pubkey">
            <p class="subtitle success" data-testid="switch-success">Identity switched successfully</p>
            <p class="subtitle">Current identity:</p>
          </template>
          <p v-else class="subtitle">Identity found on this device.</p>
          <p class="identity-line" data-testid="identity-pubkey">{{ shortKey(identity.pubkey) }}</p>

          <div v-if="removalFailed" class="removal-failed" role="alert" data-testid="removal-failed">
            <p class="error">{{ session.identityRemovalError }}</p>
            <p class="subtitle">
              You are signed out, but this identity is still stored on this device. Remove it before
              handing the device to someone else.
            </p>
            <BaseButton
              variant="danger"
              :disabled="isLoading"
              data-testid="retry-remove-identity"
              @click="onRetryRemove"
            >
              {{ isLoading ? "Removing…" : "Remove identity from this device" }}
            </BaseButton>
          </div>

          <ol v-if="switchedTo && (isLoading || lifecycle.phase !== 'NO_IDENTITY')" class="progress" data-testid="switch-progress" aria-live="polite">
            <li v-for="s in PROGRESS_STEPS" :key="s.phase" :class="stepState(s.phase)" :data-phase="s.phase">
              <span class="mark" aria-hidden="true">{{ stepState(s.phase) === "done" ? "✓" : stepState(s.phase) === "failed" ? "✕" : "·" }}</span>
              <span>
                {{ s.label }}
                <template v-if="s.phase === 'ROLE_RESOLVED' && stepState('ROLE_RESOLVED') === 'done' && resolvedRoles.length">
                  — {{ resolvedRoles.join(" · ") }} ✓
                </template>
              </span>
            </li>
          </ol>

          <BaseButton
            variant="primary"
            :disabled="isLoading"
            data-testid="continue-identity"
            @click="onContinue"
          >
            Continue with this identity
          </BaseButton>
          <ImportAnotherIdentity
            :current-pubkey="identity.pubkey"
            :busy="isLoading"
            @replace="onReplace"
          />
        </template>

        <template v-else>
          <p class="subtitle" data-testid="no-identity">No identity is stored on this device.</p>
          <IdentitySetup :recovery="recovery" @ready="onIdentityReady" @create="onStartCreate" />
        </template>
      </template>

      <!-- The "Continue in Development Mode" shortcut was removed: it signed in
           with a throwaway in-memory identity, which now produces a confusing
           session rather than a convenient one — a temporary key is in no
           community's `relay_members`, so it resolves to no role and none of the
           owner/admin/member functionality applies to it. Signing in with a real
           identity is the only path. -->
      <p v-if="shownError" class="error" data-testid="login-error">{{ shownError }}</p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  padding: var(--space-5);
}

.login-card {
  width: 100%;
  max-width: 400px;
  /*
    A flex item defaults to `min-width: auto`, so it refuses to shrink below
    its content's min-content width and pushes past a narrow viewport instead.
    Verified in headless Chrome at 375px: the card overflowed the right edge
    and clipped its own text. `min-width: 0` lets it shrink; the wrapping rules
    below keep long unbroken strings (npub/hex identity lines, relay URLs) from
    re-creating the same overflow from the inside.
  */
  min-width: 0;
  overflow-wrap: anywhere;
  /*
    Bound against the VIEWPORT, not the parent. The parent chain was measured
    wider than the viewport at narrow widths in headless Chrome (card left edge
    pinned to the page padding while its right edge ran past the screen), so a
    percentage bound inherits the same bad width. `100vw` minus the page's own
    horizontal padding is independent of whatever an ancestor computes to.
  */
  max-width: min(400px, calc(100vw - 2 * var(--space-5)));
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

h1 {
  margin: 0;
  font-size: var(--font-size-xl);
  color: var(--color-text);
}

h2 {
  margin: 0;
  font-size: var(--font-size-md, 1rem);
  color: var(--color-text);
}

.subtitle {
  margin: 0 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.identity-line {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.success {
  color: var(--color-success, var(--color-text));
  font-weight: 600;
}

.removal-failed {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
}

.progress {
  list-style: none;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.progress li {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
}
.progress li.done {
  color: var(--color-text);
}
.progress li.active {
  color: var(--color-accent, var(--color-text));
}
.progress li.failed {
  color: var(--color-danger);
}
.progress .mark {
  display: inline-block;
  width: 1em;
  text-align: center;
  font-family: monospace;
}

.error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}
</style>
