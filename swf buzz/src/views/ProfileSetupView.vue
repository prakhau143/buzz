<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import BaseButton from "@/components/BaseButton.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import { useSessionStore } from "@/stores/session";
import { profileService } from "@/services/ProfileService";
import {
  completenessOfFields,
  validateDesignation,
  validateDisplayName,
  validatePicture,
  DESIGNATION_MAX,
  DISPLAY_NAME_MAX,
} from "@/features/profile/profileCompleteness";
import { mediaService, validateImageFile, prepareAvatar } from "@/services/MediaService";
import { logError, userMessageFor } from "@/services/errors";
import { shortKey } from "@/features/identity/format";

/**
 * Mandatory first-run profile. Publishes a kind:0 signed by the local identity,
 * so the profile belongs to this public key — never to an email or account.
 *
 * This screen is BLOCKING and has no "Skip for now". Everyone in a community
 * needs a name, a title and a face, otherwise members see raw hex keys and
 * cannot tell each other apart. Existing profiles are never deleted: an older
 * (v1) profile simply arrives here to be upgraded, and the user republishes it
 * from their own key.
 */
const router = useRouter();
const session = useSessionStore();

const displayName = ref("");
const designation = ref("");
const about = ref("");
const picture = ref("");

const busy = ref(false);
const error = ref<string | null>(null);

const uploading = ref(false);
const uploadProgress = ref(0);
const uploadError = ref<string | null>(null);
const lastFile = ref<File | null>(null);

/** Shown only once a field has been touched, so the form does not open covered in red. */
const touched = ref<Record<string, boolean>>({});
function touch(field: string) {
  touched.value[field] = true;
}

const nameProblem = computed(() => validateDisplayName(displayName.value));
const designationProblem = computed(() => validateDesignation(designation.value));
const pictureProblem = computed(() => validatePicture(picture.value));

const completeness = computed(() =>
  completenessOfFields({
    displayName: displayName.value,
    designation: designation.value,
    picture: picture.value,
  }),
);
const canSave = computed(() => completeness.value.complete && !busy.value && !uploading.value);

const previewName = computed(() => displayName.value.trim() || "Your name");
const previewTitle = computed(() => designation.value.trim() || "Your role");

/** Common titles — a convenience list, not a constraint; any text is allowed. */
const TITLE_SUGGESTIONS = [
  "Software Engineer",
  "Senior Software Engineer",
  "Solutions Architect",
  "Product Manager",
  "Designer",
  "Data Scientist",
  "QA Engineer",
  "DevOps Engineer",
  "Engineering Manager",
  "Founder",
];

async function uploadFile(file: File) {
  const invalid = validateImageFile(file);
  if (invalid) {
    uploadError.value = invalid;
    return;
  }
  lastFile.value = file;
  uploadError.value = null;
  uploading.value = true;
  uploadProgress.value = 0;
  try {
    // Square-cropped and resized before upload: avatars render small, and the
    // relay bills every viewer for the bytes.
    const prepared = await prepareAvatar(file);
    const uploaded = await mediaService.upload(prepared, {
      onProgress: (f) => (uploadProgress.value = f),
    });
    picture.value = uploaded.url;
    touch("picture");
  } catch (err) {
    uploadError.value = userMessageFor(err);
    // The relay's own words go to the console (attached as `cause` by
    // MediaService). Without this, a precise server reason like "invalid image
    // data" is replaced by a friendly sentence and the actual cause is lost.
    logError("ProfileSetupView.uploadPhoto", err);
  } finally {
    uploading.value = false;
  }
}

function onFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) void uploadFile(file);
}

function onDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0];
  if (file) void uploadFile(file);
}

function retryUpload() {
  if (lastFile.value) void uploadFile(lastFile.value);
}

/** Give up on the photo and carry on — it is not required. */
function dismissUpload() {
  uploadError.value = null;
  lastFile.value = null;
}

async function save() {
  if (!canSave.value) return;
  busy.value = true;
  error.value = null;
  try {
    await profileService.publishProfile({
      displayName: displayName.value,
      designation: designation.value,
      about: about.value,
      picture: picture.value,
    });
    await router.push({ name: "channels" });
  } catch (err) {
    error.value = userMessageFor(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="profile-page">
    <form class="profile-card" @submit.prevent="save">
      <h1>Set up your profile</h1>
      <p class="subtitle">
        Your name, role and photo are how people recognise you. They're stored once for your
        identity and appear in every community you join.
      </p>

      <!-- Live preview: the same avatar component the message list uses, so this
           is genuinely what others will see rather than a second rendering. -->
      <div class="preview" data-testid="profile-preview">
        <AvatarCircle :name="previewName" :avatar-url="picture || undefined" :size="44" />
        <span class="preview-text">
          <span class="preview-name">{{ previewName }}</span>
          <span class="preview-title">{{ previewTitle }}</span>
        </span>
      </div>

      <label class="label" for="profile-name">Display name</label>
      <input
        id="profile-name"
        v-model="displayName"
        class="field"
        :maxlength="DISPLAY_NAME_MAX"
        autocomplete="name"
        data-testid="profile-name"
        @blur="touch('displayName')"
      />
      <p v-if="touched.displayName && nameProblem" class="problem" data-testid="profile-name-problem">
        {{ nameProblem }}
      </p>

      <label class="label" for="profile-designation">Role or job title</label>
      <input
        id="profile-designation"
        v-model="designation"
        class="field"
        :maxlength="DESIGNATION_MAX"
        list="title-suggestions"
        placeholder="Solutions Architect"
        data-testid="profile-designation"
        @blur="touch('designation')"
      />
      <datalist id="title-suggestions">
        <option v-for="title in TITLE_SUGGESTIONS" :key="title" :value="title" />
      </datalist>
      <p class="hint">
        This is your job title — separate from your role in a community, which owners and admins
        control.
      </p>
      <p
        v-if="touched.designation && designationProblem"
        class="problem"
        data-testid="profile-designation-problem"
      >
        {{ designationProblem }}
      </p>

      <span class="label">Profile photo (optional)</span>
      <p class="hint">
        Without one you get an avatar made from your initials, which is fine — you can add a photo
        any time.
      </p>
      <div
        class="dropzone"
        :class="{ 'has-image': !!picture }"
        data-testid="profile-dropzone"
        @drop.prevent="onDrop"
        @dragover.prevent
      >
        <AvatarCircle :name="previewName" :avatar-url="picture || undefined" :size="64" />
        <div class="dropzone-actions">
          <label class="file-label">
            <input
              type="file"
              class="file-input"
              accept="image/*"
              data-testid="profile-photo-input"
              @change="onFileInput"
            />
            <span class="file-button">{{ picture ? "Change photo" : "Choose photo" }}</span>
          </label>
          <span class="hint">JPG, PNG or WebP, up to 5 MB. Drag one here too.</span>
        </div>
      </div>

      <!-- Or point at an image you already host somewhere. -->
      <label class="label subtle" for="profile-picture-url">…or paste an image link</label>
      <input
        id="profile-picture-url"
        v-model="picture"
        class="field"
        placeholder="https://example.com/me.jpg"
        spellcheck="false"
        data-testid="profile-picture"
        @blur="touch('picture')"
      />

      <div v-if="uploading" class="upload-progress" data-testid="profile-upload-progress">
        <div class="bar" :style="{ width: `${Math.round(uploadProgress * 100)}%` }" />
        <span class="hint">Uploading… {{ Math.round(uploadProgress * 100) }}%</span>
      </div>
      <p v-if="uploadError" class="problem" data-testid="profile-upload-error">
        {{ uploadError }}
        <BaseButton v-if="lastFile" variant="ghost" data-testid="profile-upload-retry" @click="retryUpload">
          Retry upload
        </BaseButton>
        <!-- A failed upload must never block the rest of the profile. -->
        <BaseButton variant="ghost" data-testid="profile-upload-dismiss" @click="dismissUpload">
          Continue without a photo
        </BaseButton>
      </p>
      <p
        v-else-if="touched.picture && pictureProblem"
        class="problem"
        data-testid="profile-picture-problem"
      >
        {{ pictureProblem }}
      </p>

      <label class="label" for="profile-about">About (optional)</label>
      <textarea
        id="profile-about"
        v-model="about"
        class="field"
        rows="3"
        maxlength="280"
        data-testid="profile-about"
      />

      <BaseButton type="submit" variant="primary" :disabled="!canSave" data-testid="profile-save">
        {{ busy ? "Saving…" : "Save profile" }}
      </BaseButton>
      <p v-if="error" class="problem" data-testid="profile-error">
        {{ error }}
        <BaseButton variant="ghost" :disabled="busy" data-testid="profile-retry" @click="save">
          Try again
        </BaseButton>
      </p>

      <p v-if="session.pubkey" class="identity-note">
        Signed as <code>{{ shortKey(session.pubkey) }}</code>
      </p>
    </form>
  </div>
</template>

<style scoped>
.profile-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  padding: var(--space-5);
}

.profile-card {
  width: 520px;
  max-width: 100%;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  box-shadow: var(--shadow-lg);
}

h1 {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text);
}

.subtitle {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.preview {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-surface-muted);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-2);
}
.preview-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.preview-name {
  font-weight: 600;
  color: var(--color-text);
}
.preview-title {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-muted);
  margin-top: var(--space-2);
}
.label.subtle {
  font-weight: 400;
  color: var(--color-text-subtle);
}

.field {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  padding: var(--space-2);
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

.problem {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.dropzone {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
}
.dropzone.has-image {
  border-style: solid;
}
.dropzone-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

/* The native control is hidden but still focusable and labelled. */
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.file-label {
  display: inline-flex;
}
.file-button {
  display: inline-block;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  cursor: pointer;
  background: var(--color-surface);
}
.file-input:focus-visible + .file-button {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.upload-progress {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.upload-progress .bar {
  height: 4px;
  background: var(--color-primary);
  border-radius: var(--radius-full);
  transition: width 120ms linear;
}

.identity-note {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

@media (max-width: 480px) {
  .profile-page {
    padding: 0;
    align-items: stretch;
  }
  .profile-card {
    width: 100%;
    border-radius: 0;
    padding: var(--space-4);
    min-height: 100vh;
  }
}
</style>
