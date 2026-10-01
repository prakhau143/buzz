<script setup lang="ts">
/**
 * Settings → Mobile. NIP-AB pairing, desktop side (src-tauri/src/pairing.rs).
 * Honest about what this build does: it verifies a secure channel with the
 * phone end to end, but does NOT transfer the identity — the private key never
 * leaves this device until SWF decides to allow it. No success is faked: the
 * "done" state appears only when the phone itself reports completion.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import QRCode from "qrcode";
import AppIcon from "@/components/AppIcon.vue";
import BaseButton from "@/components/BaseButton.vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import { activeRelayUrl } from "@/features/communities/relayCommunities";
import { userMessageFor } from "@/services/errors";
import {
  cancelPairing,
  confirmPairing,
  isActive,
  pairingAvailable,
  pairingReducer,
  startPairing,
  type PairingSignal,
  type PairingStep,
} from "@/features/mobilePairing/pairing";

const state = ref<PairingStep>({ step: "idle" });
const qrImage = ref<string>("");
const now = ref(Date.now());
const copied = ref(false);
const available = pairingAvailable();
const unlisteners: Array<() => void> = [];
let ticker: ReturnType<typeof setInterval> | undefined;

function send(signal: PairingSignal) {
  state.value = pairingReducer(state.value, signal);
}

onMounted(async () => {
  if (!available) return;
  const { listen } = await import("@tauri-apps/api/event");
  unlisteners.push(await listen<{ sas: string }>("pairing-sas-received", (e) => send({ type: "sas", sas: e.payload.sas })));
  unlisteners.push(await listen("pairing-complete", () => send({ type: "complete" })));
  unlisteners.push(await listen<{ message: string }>("pairing-aborted", (e) => send({ type: "aborted", message: e.payload.message })));
  unlisteners.push(await listen<{ message: string }>("pairing-error", (e) => send({ type: "error", message: e.payload.message })));
  ticker = setInterval(() => {
    now.value = Date.now();
    send({ type: "tick", now: now.value });
  }, 1000);
});

onBeforeUnmount(() => {
  unlisteners.forEach((u) => u());
  clearInterval(ticker);
  // Leaving the page mid-pairing cancels it (as OLD BUZZ does).
  if (isActive(state.value)) void cancelPairing();
});

async function begin() {
  const relay = activeRelayUrl.value;
  if (!relay) return;
  send({ type: "start" });
  try {
    const started = await startPairing(relay);
    qrImage.value = await QRCode.toDataURL(started.qrUri, { margin: 1, width: 416, errorCorrectionLevel: "M" });
    send({ type: "started", started, now: Date.now() });
  } catch (err) {
    send({ type: "error", message: userMessageFor(err) || String(err) });
  }
}

async function confirm() {
  send({ type: "confirm" });
  try {
    await confirmPairing();
    send({ type: "confirmed", now: Date.now() });
  } catch (err) {
    send({ type: "error", message: String(err) });
  }
}

async function cancel() {
  await cancelPairing();
  send({ type: "reset" });
  qrImage.value = "";
}

async function copyCode() {
  if (state.value.step !== "qr") return;
  try {
    await navigator.clipboard.writeText(state.value.qrUri);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    copied.value = false;
  }
}

const secondsLeft = computed(() =>
  "expiresAt" in state.value ? Math.max(0, Math.ceil((state.value.expiresAt - now.value) / 1000)) : 0,
);
</script>

<template>
  <SettingsPage title="Mobile" description="Connect your SWF identity to the SWF Buzz mobile app.">
    <SettingsCard>
      <div v-if="!available" class="panel" data-testid="pairing-unavailable">
        <AppIcon name="info" :size="20" />
        <p>Pairing is available in the SWF Buzz desktop app.</p>
      </div>

      <div v-else class="panel" :data-step="state.step" data-testid="pairing-panel">
        <!-- Idle -->
        <template v-if="state.step === 'idle'">
          <div class="illustration"><AppIcon name="smartphone" :size="24" /></div>
          <h3>Pair a phone</h3>
          <ol class="steps">
            <li>Open the SWF Buzz mobile app and choose <strong>Pair with desktop</strong>.</li>
            <li>Scan the code that appears here.</li>
            <li>Check that both screens show the same 6-digit number.</li>
          </ol>
          <p class="note">
            <AppIcon name="shield" :size="16" />
            The connection is end-to-end encrypted and expires after two minutes. In this version your private key is
            <strong>not</strong> sent to the phone — pairing verifies a secure connection only.
          </p>
          <BaseButton variant="primary" data-testid="pairing-start" :disabled="!activeRelayUrl" @click="begin">Start pairing</BaseButton>
        </template>

        <template v-else-if="state.step === 'starting'">
          <span class="spinner" />
          <p>Preparing a secure pairing code…</p>
        </template>

        <!-- QR -->
        <template v-else-if="state.step === 'qr'">
          <h3>Scan with your phone</h3>
          <div class="qr" data-testid="pairing-qr"><img :src="qrImage" alt="Pairing QR code" /></div>
          <p class="countdown" :class="{ low: secondsLeft <= 20 }">Expires in {{ secondsLeft }}s</p>
          <p class="muted">Waiting for your phone… (via {{ state.pairingRelay }})</p>
          <div class="actions">
            <BaseButton variant="secondary" data-testid="pairing-copy" @click="copyCode">
              <AppIcon :name="copied ? 'check' : 'copy'" :size="16" />{{ copied ? "Copied" : "Copy pairing code" }}
            </BaseButton>
            <BaseButton variant="ghost" @click="cancel">Cancel</BaseButton>
          </div>
          <p class="fine">The pairing code contains a one-time secret. Only paste it into your own device.</p>
        </template>

        <!-- SAS -->
        <template v-else-if="state.step === 'sas'">
          <h3>Do these numbers match?</h3>
          <p class="muted">Compare with the code on your phone.</p>
          <div class="sas" data-testid="pairing-sas" aria-live="polite">{{ state.sas.slice(0, 3) }} {{ state.sas.slice(3) }}</div>
          <div class="actions">
            <BaseButton variant="primary" data-testid="pairing-confirm" @click="confirm">Codes match</BaseButton>
            <BaseButton variant="danger" @click="cancel">They don't match</BaseButton>
          </div>
        </template>

        <template v-else-if="state.step === 'confirming' || state.step === 'sent'">
          <span class="spinner" />
          <p>Finishing securely… waiting for your phone to confirm.</p>
        </template>

        <!-- Done -->
        <template v-else-if="state.step === 'done'">
          <div class="illustration ok"><AppIcon name="check" :size="24" /></div>
          <h3>Secure connection verified</h3>
          <p class="muted" data-testid="pairing-done">
            Your phone confirmed the encrypted pairing. Your identity was <strong>not</strong> transferred — this version keeps
            your private key on this computer.
          </p>
          <BaseButton variant="secondary" @click="send({ type: 'reset' })">Done</BaseButton>
        </template>

        <template v-else-if="state.step === 'expired'">
          <div class="illustration warn"><AppIcon name="refresh" :size="24" /></div>
          <h3>Pairing code expired</h3>
          <BaseButton variant="primary" @click="begin">Generate a new code</BaseButton>
        </template>

        <template v-else-if="state.step === 'aborted' || state.step === 'error'">
          <div class="illustration warn"><AppIcon name="warning" :size="24" /></div>
          <h3>{{ state.step === "aborted" ? "Pairing stopped" : "Pairing failed" }}</h3>
          <p class="muted" role="alert">{{ state.message }}</p>
          <BaseButton variant="primary" @click="begin">Try again</BaseButton>
        </template>
      </div>
    </SettingsCard>
  </SettingsPage>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6) var(--space-5);
  text-align: center;
}
.panel h3 {
  margin: 0;
  font-size: var(--font-size-lg);
}
.illustration {
  display: inline-flex;
  padding: 14px;
  border-radius: 18px;
  background: var(--color-primary-muted);
  color: var(--color-primary);
}
.illustration.ok {
  background: var(--color-success-muted);
  color: var(--color-success);
}
.illustration.warn {
  background: var(--color-warning-muted);
  color: var(--color-warning);
}
.steps {
  margin: 0;
  padding-left: 1.2em;
  text-align: left;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
.note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  max-width: 520px;
  margin: 0;
  padding: var(--space-3);
  border-radius: 12px;
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-align: left;
}
.qr {
  width: 232px;
  height: 232px;
  padding: 12px;
  border-radius: var(--radius-lg);
  background: #fff;
  box-shadow: var(--shadow-md);
}
.qr img {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
.countdown {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.countdown.low {
  color: var(--color-warning);
}
.sas {
  padding: var(--space-3) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-bg);
  font-family: var(--font-mono);
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
}
.actions :deep(.base-button) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.muted {
  margin: 0;
  max-width: 520px;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
.fine {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--color-border-strong);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 800ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
