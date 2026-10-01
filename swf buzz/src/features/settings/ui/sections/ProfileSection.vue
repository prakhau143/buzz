<script setup lang="ts">
/**
 * Settings → Profile. Edits the identity-level profile (features/profile/myProfile.ts):
 * the save is published to the open community, becomes the canonical profile
 * everywhere in the app at once, and is replicated to every other community
 * this identity belongs to — with the per-community outcome shown, never
 * assumed. Unknown kind:0 fields are preserved. No private key is shown here.
 */
import { computed, onMounted, reactive, ref, watch } from "vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import AppIcon from "@/components/AppIcon.vue";
import BaseButton from "@/components/BaseButton.vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import SettingsRow from "../primitives/SettingsRow.vue";
import SaveIndicator from "../primitives/SaveIndicator.vue";
import { useSessionStore } from "@/stores/session";
import { profileEventFor, profileFor } from "@/features/profile/profileStore";
import { resolveIdentityProfile } from "@/features/profile/identityProfile";
import { saveMyProfile, type ReplicationResult } from "@/features/profile/myProfile";
import { mediaService, prepareAvatar, validateImageFile } from "@/services/MediaService";
import { isAcceptablePictureUrl } from "@/protocol/profile";
import { logError, userMessageFor } from "@/services/errors";
import { shortKey, shortNpub } from "@/features/identity/format";
import { relayHost } from "@/features/communities/relayCommunities";
import { nip19 } from "nostr-tools";

const session = useSessionStore();
const me = computed(() => session.pubkey ?? "");
const canonical = computed(() => profileFor(me.value));
const nip05 = computed(() => {
  const event = profileEventFor(me.value);
  if (!event) return null;
  try {
    const value = (JSON.parse(event.content) as { nip05?: unknown }).nip05;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
});
const npub = computed(() => (me.value ? nip19.npubEncode(me.value) : ""));

const form = reactive({ displayName: "", designation: "", about: "", picture: "" });
const dirty = ref(false);
const loadingProfile = ref(true);

function fillFromCanonical() {
  const p = canonical.value;
  form.displayName = p?.displayName && p.displayName !== me.value.slice(0, 8) ? p.displayName : "";
  form.designation = p?.designation ?? "";
  form.about = p?.about ?? "";
  form.picture = p?.avatarUrl ?? "";
  dirty.value = false;
}
// Follow the canonical profile until the person starts editing.
watch(canonical, () => {
  if (!dirty.value) fillFromCanonical();
});
onMounted(async () => {
  fillFromCanonical();
  try {
    // Pull the newest copy from every community into the registry first.
    if (me.value) await resolveIdentityProfile(me.value);
  } catch (err) {
    logError("ProfileSection.resolve", err);
  } finally {
    loadingProfile.value = false;
    if (!dirty.value) fillFromCanonical();
  }
});

function touch() {
  dirty.value = true;
  saveState.value = "idle";
}

// ---- Photo ----
const uploading = ref(false);
const uploadProgress = ref(0);
const photoError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

async function uploadPhoto(file: File) {
  const invalid = validateImageFile(file);
  if (invalid) {
    photoError.value = invalid;
    return;
  }
  photoError.value = null;
  uploading.value = true;
  uploadProgress.value = 0;
  try {
    const prepared = await prepareAvatar(file);
    const uploaded = await mediaService.upload(prepared, { onProgress: (f) => (uploadProgress.value = f) });
    form.picture = uploaded.url;
    touch();
  } catch (err) {
    photoError.value = userMessageFor(err);
    logError("ProfileSection.uploadPhoto", err);
  } finally {
    uploading.value = false;
  }
}
function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) void uploadPhoto(file);
  (event.target as HTMLInputElement).value = "";
}
function onDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0];
  if (file) void uploadPhoto(file);
}
function removePhoto() {
  form.picture = "";
  touch();
}

// ---- Save ----
const saveState = ref<"idle" | "saving" | "saved" | "error">("idle");
const saveError = ref<string | null>(null);
const replication = ref<ReplicationResult[] | null>(null);
const replicating = ref(false);

const nameError = computed(() => (dirty.value && !form.displayName.trim() ? "A display name is required." : null));
const pictureError = computed(() =>
  isAcceptablePictureUrl(form.picture) ? null : "The photo address must be an https link.",
);
const canSave = computed(
  () => dirty.value && !nameError.value && !pictureError.value && !uploading.value && saveState.value !== "saving",
);

async function save() {
  if (!canSave.value) return;
  saveState.value = "saving";
  saveError.value = null;
  replication.value = null;
  try {
    const result = await saveMyProfile({
      displayName: form.displayName,
      designation: form.designation,
      about: form.about,
      picture: form.picture,
    });
    dirty.value = false;
    saveState.value = "saved";
    replicating.value = true;
    replication.value = await result.replication;
  } catch (err) {
    saveState.value = "error";
    saveError.value = userMessageFor(err);
    logError("ProfileSection.save", err);
  } finally {
    replicating.value = false;
  }
}
function cancel() {
  fillFromCanonical();
  saveState.value = "idle";
}

const replicatedOk = computed(() => replication.value?.filter((r) => r.ok) ?? []);
const replicatedFailed = computed(() => replication.value?.filter((r) => !r.ok) ?? []);

// ---- Copy ----
const copied = ref<string | null>(null);
async function copy(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    copied.value = label;
    setTimeout(() => (copied.value = null), 1600);
  } catch {
    copied.value = null;
  }
}
</script>

<template>
  <SettingsPage title="Profile" description="How you appear to people in every SWF community you belong to.">
    <SettingsCard title="Photo">
      <div class="avatar-row" @dragover.prevent @drop.prevent="onDrop">
        <div class="avatar-frame" :class="{ busy: uploading }">
          <AvatarCircle :name="form.displayName || shortKey(me)" :avatar-url="form.picture || undefined" :size="84" />
          <div v-if="uploading" class="avatar-progress" :style="{ '--p': `${Math.round(uploadProgress * 100)}%` }" />
        </div>
        <div class="avatar-actions">
          <div class="avatar-buttons">
            <BaseButton variant="secondary" :disabled="uploading" data-testid="profile-change-photo" @click="fileInput?.click()">
              <AppIcon name="upload" :size="16" />{{ form.picture ? "Change photo" : "Upload photo" }}
            </BaseButton>
            <BaseButton v-if="form.picture" variant="ghost" :disabled="uploading" @click="removePhoto">Remove</BaseButton>
          </div>
          <p class="hint">
            {{ uploading ? `Uploading… ${Math.round(uploadProgress * 100)}%` : "JPG, PNG, GIF or WebP up to 5 MB. Drop an image here too." }}
          </p>
          <p v-if="photoError" class="field-error" role="alert">{{ photoError }}</p>
          <input ref="fileInput" type="file" accept="image/*" class="hidden-input" @change="onFile" />
        </div>
      </div>
    </SettingsCard>

    <SettingsCard title="Profile information">
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Display name</span>
          <input
            v-model="form.displayName"
            type="text"
            maxlength="80"
            autocomplete="name"
            data-testid="profile-display-name"
            :aria-invalid="!!nameError"
            @input="touch"
          />
          <span v-if="nameError" class="field-error">{{ nameError }}</span>
        </label>
        <label class="field">
          <span class="field-label">Title <span class="optional">e.g. Solutions Architect</span></span>
          <input v-model="form.designation" type="text" maxlength="80" data-testid="profile-designation" @input="touch" />
        </label>
        <label class="field">
          <span class="field-label">About</span>
          <textarea v-model="form.about" rows="3" maxlength="500" data-testid="profile-about" @input="touch" />
          <span class="counter">{{ form.about.length }}/500</span>
        </label>
      </div>
      <div class="form-footer">
        <SaveIndicator :state="saveState" :error="saveError" />
        <span v-if="loadingProfile" class="hint">Checking your other communities…</span>
        <div class="footer-buttons">
          <BaseButton v-if="dirty" variant="ghost" :disabled="saveState === 'saving'" @click="cancel">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!canSave" data-testid="profile-save" @click="save">
            {{ saveState === "saving" ? "Saving…" : "Save changes" }}
          </BaseButton>
        </div>
      </div>
      <div v-if="replicating || replication" class="replication" data-testid="profile-replication" role="status">
        <template v-if="replicating">Updating your other communities…</template>
        <template v-else-if="replication && replication.length === 0">
          Saved. You're only in this community, so there was nothing else to update.
        </template>
        <template v-else>
          <span v-if="replicatedOk.length">
            <AppIcon name="check" :size="16" />
            Updated in {{ replicatedOk.length }} other {{ replicatedOk.length === 1 ? "community" : "communities" }}.
          </span>
          <span v-for="r in replicatedFailed" :key="r.relayUrl" class="replication-failed">
            <AppIcon name="warning" :size="16" />
            Not updated in {{ relayHost(r.relayUrl) }} ({{ r.error }}). It will update next time you open it.
          </span>
        </template>
      </div>
    </SettingsCard>

    <SettingsCard title="Identity" description="Your public identity. It's the same in every community.">
      <SettingsRow label="Public key" :description="shortNpub(me)">
        <BaseButton variant="secondary" data-testid="copy-npub" @click="copy('npub', npub)">
          <AppIcon :name="copied === 'npub' ? 'check' : 'copy'" :size="16" />{{ copied === "npub" ? "Copied" : "Copy" }}
        </BaseButton>
      </SettingsRow>
      <SettingsRow label="Public key (hex)" :description="shortKey(me)">
        <BaseButton variant="secondary" @click="copy('hex', me)">
          <AppIcon :name="copied === 'hex' ? 'check' : 'copy'" :size="16" />{{ copied === "hex" ? "Copied" : "Copy" }}
        </BaseButton>
      </SettingsRow>
      <SettingsRow label="NIP-05" :description="nip05 ?? 'Not set'">
        <BaseButton v-if="nip05" variant="secondary" @click="copy('nip05', nip05)">
          <AppIcon :name="copied === 'nip05' ? 'check' : 'copy'" :size="16" />{{ copied === "nip05" ? "Copied" : "Copy" }}
        </BaseButton>
      </SettingsRow>
    </SettingsCard>
  </SettingsPage>
</template>

<style scoped>
.avatar-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-5);
  padding: var(--space-5);
}
.avatar-frame {
  position: relative;
  padding: 4px;
  border-radius: 50%;
  background: conic-gradient(from 210deg, color-mix(in srgb, var(--color-primary) 55%, transparent), transparent 60%);
}
.avatar-progress {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(var(--color-primary) var(--p), transparent 0);
  mask: radial-gradient(circle, transparent 60%, #000 61%);
}
.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.avatar-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.avatar-buttons :deep(.base-button) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.hidden-input {
  display: none;
}
.hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.form-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
}
.field {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
}
.optional {
  margin-left: var(--space-2);
  font-weight: 400;
  color: var(--color-text-subtle);
}
.field input,
.field textarea {
  width: 100%;
  padding: 10px var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  resize: vertical;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}
.field input:focus,
.field textarea:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-primary) 60%, var(--color-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 14%, transparent);
}
.field [aria-invalid="true"] {
  border-color: var(--color-danger);
}
.counter {
  align-self: flex-end;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.field-error {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
.form-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface-muted) 45%, transparent);
}
.footer-buttons {
  display: flex;
  gap: var(--space-2);
  margin-left: auto;
}
.replication {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.replication span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.replication-failed {
  color: var(--color-warning);
}
:deep(.settings-row .base-button) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
