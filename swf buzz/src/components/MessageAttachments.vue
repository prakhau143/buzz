<script setup lang="ts">
import { computed, toRef } from "vue";
import { attachmentKind, formatSize, type Attachment } from "@/protocol/imeta";
import { useAuthorizedMedia } from "@/composables/useAuthorizedMedia";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ attachments: readonly Attachment[] }>();

/**
 * Attachment URLs are NOT directly loadable: the relay requires Blossom GET
 * auth plus relay membership on `/media/{sha256}` (`api/media.rs:527-550`),
 * and a browser cannot put an Authorization header on `<img src>`. So every
 * src/href below is the resolved `blob:` URL, never `attachment.url`.
 */
const { resolved } = useAuthorizedMedia(toRef(props, "attachments"));

const mediaFor = computed(
  () => (attachment: Attachment) =>
    resolved.value.get(attachment.url) ?? { url: undefined, status: "loading" as const },
);

/**
 * `dim` is "WxH". Reserving the box before the image loads stops the message
 * list jumping as attachments decode — the same reason the thread summary row
 * takes a fixed clock rather than measuring.
 */
function aspectRatio(dim: string | undefined): string | undefined {
  if (!dim) return undefined;
  const [w, h] = dim.split("x").map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
  return `${w} / ${h}`;
}
</script>

<template>
  <ul v-if="attachments.length" class="attachments" data-testid="message-attachments">
    <li v-for="attachment in attachments" :key="attachment.url" class="attachment">
      <!-- A failed attachment degrades to a labelled placeholder; it must
           never blank the message it belongs to. -->
      <p
        v-if="mediaFor(attachment).status === 'error'"
        class="unavailable"
        data-testid="attachment-unavailable"
      >
        <AppIcon name="paperclip" class="file-icon" />
        {{ attachment.filename ?? "Attachment" }} couldn't be loaded.
      </p>

      <p
        v-else-if="mediaFor(attachment).status === 'loading'"
        class="loading"
        data-testid="attachment-loading"
        :style="{ aspectRatio: aspectRatio(attachment.dim) }"
      >
        <span class="visually-hidden">Loading attachment</span>
      </p>

      <a
        v-else-if="attachmentKind(attachment) === 'image'"
        :href="mediaFor(attachment).url"
        target="_blank"
        rel="noopener noreferrer"
        class="image-link"
        :aria-label="`Open ${attachment.filename ?? 'image'} full size`"
      >
        <img
          :src="mediaFor(attachment).url"
          :alt="attachment.alt ?? attachment.filename ?? 'Attached image'"
          :style="{ aspectRatio: aspectRatio(attachment.dim) }"
          class="image"
          loading="lazy"
        />
      </a>

      <video
        v-else-if="attachmentKind(attachment) === 'video'"
        :src="mediaFor(attachment).url"
        class="video"
        controls
        preload="metadata"
        :style="{ aspectRatio: aspectRatio(attachment.dim) }"
      />

      <a
        v-else
        :href="mediaFor(attachment).url"
        :download="attachment.filename ?? 'attachment'"
        class="file"
        :aria-label="`Download ${attachment.filename ?? 'file'}`"
      >
        <AppIcon name="paperclip" class="file-icon" />
        <span class="file-name">{{ attachment.filename ?? "Attachment" }}</span>
        <span v-if="formatSize(attachment.size)" class="file-size">{{
          formatSize(attachment.size)
        }}</span>
      </a>
    </li>
  </ul>
</template>

<style scoped>
.attachments {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.image-link {
  display: inline-block;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--color-border);
  max-width: 360px;
}
.image-link:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.image {
  display: block;
  width: 100%;
  height: auto;
  background: var(--color-surface-muted);
}

.video {
  display: block;
  max-width: 360px;
  width: 100%;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
}

.file {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 360px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  text-decoration: none;
  font-size: var(--font-size-sm);
}
.file:hover {
  background: var(--color-surface-muted);
}
.file:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.file-icon {
  flex: none;
  color: var(--color-text-muted);
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.unavailable {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.loading {
  display: block;
  margin: 0;
  max-width: 360px;
  min-height: var(--space-8, 2rem);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
