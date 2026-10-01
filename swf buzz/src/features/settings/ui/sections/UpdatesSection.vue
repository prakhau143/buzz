<script setup lang="ts">
/**
 * Settings → Updates. Current version always; update checks only when this
 * build carries SWF's own update feed + signing key (src-tauri/src/updater.rs).
 * Install is always an explicit click; the downloaded package is signature-
 * verified before it is installed.
 */
import { computed, onMounted, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import BaseButton from "@/components/BaseButton.vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import SettingsRow from "../primitives/SettingsRow.vue";
import { appVersion, loadAppVersion } from "@/app/appVersion";
import { checkForUpdate, installUpdate, lastChecked, updatesConfigured, type UpdateInfo } from "@/features/updates/updates";

type State = "loading" | "not-configured" | "idle" | "checking" | "up-to-date" | "available" | "installing" | "error";
const state = ref<State>("loading");
const update = ref<UpdateInfo | null>(null);
const error = ref<string | null>(null);
const checkedAt = ref<Date | null>(lastChecked());
const downloaded = ref(0);
const total = ref<number | null>(null);

onMounted(async () => {
  await loadAppVersion();
  state.value = (await updatesConfigured()) ? "idle" : "not-configured";
});

async function check() {
  state.value = "checking";
  error.value = null;
  try {
    update.value = await checkForUpdate();
    checkedAt.value = new Date();
    state.value = update.value ? "available" : "up-to-date";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    state.value = "error";
  }
}

async function install() {
  state.value = "installing";
  downloaded.value = 0;
  total.value = null;
  try {
    await installUpdate((d, t) => {
      downloaded.value = d;
      total.value = t;
    });
    // The app restarts into the new version; nothing after this runs.
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    state.value = "error";
  }
}

const percent = computed(() => (total.value ? Math.min(100, Math.round((downloaded.value / total.value) * 100)) : null));
const checkedLabel = computed(() =>
  checkedAt.value ? checkedAt.value.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never",
);
</script>

<template>
  <SettingsPage title="Updates" description="Keep SWF Buzz up to date.">
    <SettingsCard>
      <div class="hero">
        <span class="hero-icon"><AppIcon name="download" :size="24" /></span>
        <div class="hero-text">
          <span class="label">Current version</span>
          <strong data-testid="updates-current-version">v{{ appVersion }}</strong>
        </div>
        <div class="hero-status" data-testid="updates-state" :data-state="state">
          <template v-if="state === 'up-to-date'"><AppIcon name="check" :size="16" />You're up to date</template>
          <template v-else-if="state === 'available' && update">New version v{{ update.version }} available</template>
          <template v-else-if="state === 'checking'"><span class="spinner" />Checking…</template>
          <template v-else-if="state === 'installing'">Downloading and installing…</template>
        </div>
      </div>

      <div v-if="state === 'not-configured'" class="notice" data-testid="updates-not-configured">
        <AppIcon name="info" :size="16" />
        <div>
          <strong>Automatic updates aren't set up for this build.</strong>
          <p>
            This copy of SWF Buzz was built without SWF's update feed and signing key, so it can't check for or install
            updates. Get new versions from your SWF administrator.
          </p>
        </div>
      </div>

      <template v-else>
        <SettingsRow label="Check for updates" :description="`Last checked: ${checkedLabel}`">
          <BaseButton variant="secondary" :disabled="state === 'checking' || state === 'installing' || state === 'loading'" data-testid="updates-check" @click="check">
            <AppIcon name="refresh" :size="16" />{{ state === "checking" ? "Checking…" : "Check now" }}
          </BaseButton>
        </SettingsRow>

        <div v-if="state === 'available' && update" class="release">
          <h3>What's new in v{{ update.version }}</h3>
          <p v-if="update.notes" class="notes">{{ update.notes }}</p>
          <p v-else class="notes muted">No release notes were published.</p>
          <BaseButton variant="primary" data-testid="updates-install" @click="install">Install and restart</BaseButton>
        </div>

        <div v-if="state === 'installing'" class="progress" role="progressbar" :aria-valuenow="percent ?? undefined" aria-valuemin="0" aria-valuemax="100">
          <div class="bar"><span :style="{ width: percent !== null ? `${percent}%` : '35%' }" :class="{ indeterminate: percent === null }" /></div>
          <span class="muted">{{ percent !== null ? `${percent}%` : "Downloading…" }} — SWF Buzz will restart when it's done.</span>
        </div>

        <p v-if="state === 'error'" class="error" role="alert">
          <AppIcon name="warning" :size="16" />{{ error }}
          <BaseButton variant="ghost" @click="check">Try again</BaseButton>
        </p>
      </template>
    </SettingsCard>
  </SettingsPage>
</template>

<style scoped>
.hero {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4);
  padding: var(--space-5);
}
.hero-icon {
  display: inline-flex;
  padding: 12px;
  border-radius: 14px;
  background: var(--color-primary-muted);
  color: var(--color-primary);
}
.hero-text {
  display: flex;
  flex-direction: column;
}
.label {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.hero-text strong {
  font-size: calc(var(--font-size-xl) + 2px);
  font-variant-numeric: tabular-nums;
}
.hero-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-muted);
}
.hero-status[data-state="up-to-date"] {
  color: var(--color-success);
}
.hero-status[data-state="available"] {
  color: var(--color-primary);
}
.notice {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface-muted) 50%, transparent);
  font-size: var(--font-size-sm);
}
.notice p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
}
.release,
.progress {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--color-border);
}
.release h3 {
  margin: 0;
  font-size: var(--font-size-md);
}
.notes {
  margin: 0;
  white-space: pre-wrap;
  font-size: var(--font-size-sm);
}
.muted {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
.bar {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--color-surface-muted);
}
.bar span {
  display: block;
  height: 100%;
  background: var(--color-primary);
  transition: width 150ms linear;
}
.bar span.indeterminate {
  animation: slide 1.2s ease-in-out infinite;
}
.error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--color-border);
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-border-strong);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}
:deep(.base-button) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}
</style>
