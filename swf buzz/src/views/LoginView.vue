<script setup lang="ts">
import { ref } from "vue";
import { useAuth } from "@/features/auth/useAuth";
import BaseButton from "@/components/BaseButton.vue";
import { config } from "@/app/config";

const {
  isLoading,
  error,
  pendingBunkerPairing,
  loginWithOkta,
  completeBunkerPairing,
  loginWithDevelopmentMode,
} = useAuth();
const isDev = import.meta.env.DEV;
const bunkerUriInput = ref("");
// Best-effort UI hint only — the Rust OIDC command (SWF_BUZZ_OKTA_*, a
// separate process-env pair, see .env.example) is the actual source of
// truth and still errors clearly if the two are out of sync.
const oktaConfigured = !!config.oktaIssuer && !!config.oktaClientId;

function submitBunkerUri() {
  if (!bunkerUriInput.value.trim()) return;
  completeBunkerPairing(bunkerUriInput.value.trim());
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1>SWF Buzz</h1>

      <template v-if="!pendingBunkerPairing">
        <p class="subtitle">Sign in to connect to your team's Buzz workspace.</p>

        <BaseButton
          v-if="oktaConfigured"
          variant="primary"
          :disabled="isLoading"
          @click="loginWithOkta"
        >
          Sign in with Okta
        </BaseButton>
        <p v-else class="dev-note">
          Okta isn't configured for this build yet.
          <template v-if="!isDev">Contact your admin.</template>
        </p>

        <div v-if="isDev" class="dev-section">
          <div class="divider"><span>Development only</span></div>
          <BaseButton variant="secondary" :disabled="isLoading" @click="loginWithDevelopmentMode">
            Continue in Development Mode
          </BaseButton>
          <p class="dev-note">
            Uses a temporary in-memory identity. Never available in a production build.
          </p>
        </div>
      </template>

      <template v-else>
        <p class="subtitle">
          Signed in as {{ pendingBunkerPairing.employeeEmail ?? "your Okta account" }}. Connect your
          Nostr signer to finish.
        </p>
        <label class="field-label" for="bunker-uri">Bunker URI</label>
        <input
          id="bunker-uri"
          v-model="bunkerUriInput"
          class="bunker-input"
          type="text"
          placeholder="bunker://..."
          :disabled="isLoading"
          @keyup.enter="submitBunkerUri"
        />
        <BaseButton variant="primary" :disabled="isLoading" @click="submitBunkerUri">
          Connect signer
        </BaseButton>
      </template>

      <p v-if="error" class="error">{{ error }}</p>
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
  max-width: 360px;
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

.subtitle {
  margin: 0 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.dev-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.divider {
  display: flex;
  align-items: center;
  text-align: center;
  color: var(--color-text-subtle);
  font-size: var(--font-size-xs);
}
.divider::before,
.divider::after {
  content: "";
  flex: 1;
  border-bottom: 1px solid var(--color-border);
}
.divider span {
  padding: 0 var(--space-2);
}

.dev-note {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

.field-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.bunker-input {
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}
.bunker-input:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}
</style>
