/**
 * Resolves attachment URLs into `blob:` URLs the DOM can actually load.
 *
 * WHY: `GET /media/{sha256}` is not public. The relay requires a Blossom GET
 * auth event *and* relay membership (`api/media.rs:527-550`), which is what
 * keeps a private channel's attachments private. A browser cannot attach an
 * Authorization header to `<img src>`, `<video src>` or `<a href>`, so
 * pointing them at the relay URL directly returns 401 and every attachment
 * renders broken. Discovered by the DM attachment real-relay E2E — no unit
 * test caught it, because none of them ever fetched the URL.
 *
 * Each resolved object URL is revoked on unmount, so a long-lived channel view
 * does not retain every image it has ever scrolled past.
 */
import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import { mediaService } from "@/services/MediaService";
import { logError } from "@/services/errors";
import type { Attachment } from "@/protocol/imeta";

export interface ResolvedMedia {
  /** `blob:` URL once fetched; undefined while loading or after a failure. */
  url: string | undefined;
  status: "loading" | "ready" | "error";
}

export function useAuthorizedMedia(attachments: Ref<readonly Attachment[]>) {
  const resolved = ref(new Map<string, ResolvedMedia>());
  const objectUrls = new Set<string>();

  function revokeAll(): void {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  }

  async function resolveOne(attachment: Attachment): Promise<void> {
    const key = attachment.url;
    if (resolved.value.get(key)) return; // already loading, ready or failed

    resolved.value = new Map(resolved.value).set(key, { url: undefined, status: "loading" });
    try {
      const objectUrl = await mediaService.fetchAuthorizedBlobUrl(key, attachment.sha256);
      objectUrls.add(objectUrl);
      resolved.value = new Map(resolved.value).set(key, { url: objectUrl, status: "ready" });
    } catch (err) {
      // A failed attachment must not blank the message around it.
      logError("useAuthorizedMedia.resolve", err);
      resolved.value = new Map(resolved.value).set(key, { url: undefined, status: "error" });
    }
  }

  watch(
    attachments,
    (list) => {
      for (const attachment of list) void resolveOne(attachment);
    },
    { immediate: true, deep: true },
  );

  onBeforeUnmount(revokeAll);

  return { resolved };
}
