<script setup lang="ts">
/**
 * Settings → Custom emoji (NIP-30 kind 30030; features/customEmoji/customEmoji.ts).
 * Upload → preview → name → save publishes MY set; the grid shows the whole
 * community palette, with only my own emoji removable.
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import AppIcon from "@/components/AppIcon.vue";
import BaseButton from "@/components/BaseButton.vue";
import StateView from "@/components/StateView.vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import { useSessionStore } from "@/stores/session";
import { useAuthorizedMedia } from "@/composables/useAuthorizedMedia";
import { queryKeys } from "@/app/providers/queryKeys";
import {
  addCustomEmoji,
  fetchPalette,
  normalizeShortcode,
  removeCustomEmoji,
  suggestShortcode,
  uploadEmojiImage,
  type CustomEmoji,
} from "@/features/customEmoji/customEmoji";
import { logError, userMessageFor } from "@/services/errors";
import type { Attachment } from "@/protocol/imeta";

const session = useSessionStore();
const queryClient = useQueryClient();
const me = computed(() => session.pubkey ?? "");

const palette = useQuery({
  queryKey: computed(() => queryKeys.customEmoji()),
  queryFn: fetchPalette,
  staleTime: 60_000,
});
const mine = computed(() => (palette.data.value ?? []).filter((e) => e.author === me.value));
const others = computed(() => (palette.data.value ?? []).filter((e) => e.author !== me.value));

// Relay media needs an authorized fetch to display.
const shaOf = (url: string) => url.match(/\/media\/([0-9a-f]{64})/)?.[1] ?? "";
const mediaList = computed<Attachment[]>(() =>
  (palette.data.value ?? []).map((e) => ({ url: e.url, sha256: shaOf(e.url), mimeType: "image/png", size: 0 })),
);
const { resolved } = useAuthorizedMedia(mediaList);
const src = (e: CustomEmoji) => resolved.value.get(e.url)?.url;

// ---- Add ----
const file = ref<File | null>(null);
const preview = ref<string | null>(null);
const name = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const done = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const normalized = computed(() => normalizeShortcode(name.value));
const nameError = computed(() => (name.value && !normalized.value ? "Letters, numbers, - and _ only (max 64)." : null));
const replaces = computed(() => (normalized.value ? mine.value.find((e) => e.shortcode === normalized.value) : undefined));
const takenByOther = computed(() => (normalized.value ? others.value.find((e) => e.shortcode === normalized.value) : undefined));

function pick(event: Event) {
  const f = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!f) return;
  if (preview.value) URL.revokeObjectURL(preview.value);
  file.value = f;
  preview.value = URL.createObjectURL(f);
  if (!name.value) name.value = suggestShortcode(f.name);
  error.value = null;
  done.value = null;
}
function clearForm() {
  if (preview.value) URL.revokeObjectURL(preview.value);
  file.value = null;
  preview.value = null;
  name.value = "";
}
onBeforeUnmount(() => preview.value && URL.revokeObjectURL(preview.value));

async function save() {
  if (!file.value || !normalized.value || busy.value) return;
  busy.value = true;
  error.value = null;
  done.value = null;
  try {
    const url = await uploadEmojiImage(file.value);
    await addCustomEmoji(me.value, normalized.value, url);
    done.value = `:${normalized.value}: ${replaces.value ? "updated" : "added"}.`;
    clearForm();
    await queryClient.invalidateQueries({ queryKey: queryKeys.customEmoji() });
  } catch (err) {
    error.value = userMessageFor(err);
    logError("CustomEmojiSection.save", err);
  } finally {
    busy.value = false;
  }
}

const removing = ref<string | null>(null);
async function remove(shortcode: string) {
  removing.value = shortcode;
  error.value = null;
  try {
    await removeCustomEmoji(me.value, shortcode);
    await queryClient.invalidateQueries({ queryKey: queryKeys.customEmoji() });
  } catch (err) {
    error.value = userMessageFor(err);
  } finally {
    removing.value = null;
  }
}
</script>

<template>
  <SettingsPage title="Custom emoji" description="Emoji everyone in this community can see. You can remove only your own.">
    <SettingsCard title="Add emoji">
      <div class="add">
        <button type="button" class="drop" :class="{ has: preview }" data-testid="emoji-pick" @click="fileInput?.click()">
          <img v-if="preview" :src="preview" alt="New emoji preview" />
          <template v-else><AppIcon name="upload" :size="20" /><span>Upload image</span></template>
        </button>
        <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="pick" />
        <div class="add-fields">
          <label class="field">
            <span class="field-label">Name</span>
            <span class="code-input">
              <span aria-hidden="true">:</span>
              <input v-model="name" placeholder="party_parrot" maxlength="66" data-testid="emoji-name" :aria-invalid="!!nameError" />
              <span aria-hidden="true">:</span>
            </span>
          </label>
          <span v-if="nameError" class="err">{{ nameError }}</span>
          <span v-else-if="replaces" class="warn">You already have :{{ replaces.shortcode }}: — saving replaces its image.</span>
          <span v-else-if="takenByOther" class="warn">Someone else has :{{ takenByOther.shortcode }}:. The newest one is shown to everyone.</span>
          <span class="hint">Square images work best. Animated images are saved as a still frame.</span>
          <div class="add-actions">
            <BaseButton variant="ghost" :disabled="busy || (!file && !name)" @click="clearForm">Clear</BaseButton>
            <BaseButton variant="primary" :disabled="busy || !file || !normalized" data-testid="emoji-save" @click="save">
              {{ busy ? "Saving…" : replaces ? "Replace emoji" : "Save emoji" }}
            </BaseButton>
          </div>
        </div>
      </div>
      <p v-if="error" class="banner err" role="alert">{{ error }}</p>
      <p v-else-if="done" class="banner ok" role="status"><AppIcon name="check" :size="16" />{{ done }}</p>
    </SettingsCard>

    <SettingsCard :title="`My emoji (${mine.length})`" plain>
      <StateView v-if="palette.isLoading.value" kind="loading" title="Loading emoji…" />
      <StateView v-else-if="palette.isError.value" kind="error" title="Couldn't load emoji" @retry="palette.refetch()" />
      <p v-else-if="mine.length === 0" class="empty">You haven't added any emoji yet.</p>
      <div v-else class="grid">
        <div v-for="e in mine" :key="e.shortcode" class="tile" :data-testid="`my-emoji-${e.shortcode}`">
          <span class="img"><img v-if="src(e)" :src="src(e)" :alt="`:${e.shortcode}:`" /></span>
          <span class="code">:{{ e.shortcode }}:</span>
          <button type="button" class="remove" :disabled="removing === e.shortcode" :aria-label="`Remove :${e.shortcode}:`" @click="remove(e.shortcode)">
            <AppIcon name="close" :size="16" />
          </button>
        </div>
      </div>
    </SettingsCard>

    <SettingsCard v-if="others.length" :title="`Community emoji (${others.length})`" plain>
      <div class="grid">
        <div v-for="e in others" :key="e.shortcode" class="tile">
          <span class="img"><img v-if="src(e)" :src="src(e)" :alt="`:${e.shortcode}:`" /></span>
          <span class="code">:{{ e.shortcode }}:</span>
        </div>
      </div>
    </SettingsCard>
  </SettingsPage>
</template>

<style scoped>
.add {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
  padding: var(--space-5);
}
.drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 112px;
  height: 112px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.drop.has {
  border-style: solid;
  background: var(--color-bg);
}
.drop img {
  max-width: 72px;
  max-height: 72px;
}
.hidden {
  display: none;
}
.add-fields {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: var(--font-size-sm);
  font-weight: 600;
}
.code-input {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text-subtle);
  font-family: var(--font-mono);
}
.code-input input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
}
.err {
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
.warn {
  font-size: var(--font-size-sm);
  color: var(--color-warning);
}
.hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-subtle);
}
.add-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.banner {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
}
.banner.ok {
  color: var(--color-success);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: var(--space-3);
}
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: var(--space-3) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  transition: transform 150ms ease, box-shadow 150ms ease;
}
.tile:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.img {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}
.img img {
  max-width: 40px;
  max-height: 40px;
}
.code {
  max-width: 100%;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remove {
  position: absolute;
  top: 0;
  right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-subtle);
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}
.tile:hover .remove,
.remove:focus-visible {
  opacity: 1;
}
/* Touch screens have no hover: the remove control is always visible there. */
@media (hover: none) {
  .remove {
    opacity: 1;
  }
}
.remove:hover {
  background: var(--color-danger-muted);
  color: var(--color-danger);
}
.empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
