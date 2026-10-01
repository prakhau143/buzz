/**
 * Message attachments.
 *
 * Uploads reuse `MediaService` — the same Blossom `PUT /upload` the avatar path
 * already uses. There is deliberately no second upload backend: the relay
 * dispatches one route three ways by sniffed MIME (`api/media.rs:362-394`).
 *
 * ## What this relay build accepts
 *
 * | Kind    | Path                  | Accepted |
 * |---------|-----------------------|----------|
 * | Image   | image validator       | jpeg, png, gif, webp — and **metadata-free** (`validation.rs:15`, `:508-588`) |
 * | Video   | `process_video_upload`| MP4 / H.264 + AAC, moov-first, ≤600 s, ≤4K |
 * | File    | generic attachment    | documents, text, archives, data — served as downloads |
 * | **Audio** | —                   | **rejected** (`validation.rs:198-207`) |
 *
 * Audio is refused outright on the generic path: *"audio is rejected until Buzz
 * has an explicit sanitizer and location-metadata validator for its
 * container"*, and recognized audio cannot fall through to opaque storage
 * (`api/media.rs:383`). That is why there is no voice-note recorder here — see
 * `docs/PHASE_4_RUN_STATE.md` §4D. Shipping a record button that always ends in
 * a 415 would be worse than not shipping one.
 *
 * SCOPE: this module and the `imeta` protocol layer are complete and tested,
 * but **no UI calls them yet** — there is no composer file picker and no
 * attachment renderer. See the layer table in `docs/PHASE_4_RUN_STATE.md` §4D
 * before assuming an end-to-end attachment path exists.
 */
import { AppError } from "@/services/errors";
import {
  mediaService,
  MAX_UPLOAD_BYTES,
  stripJpegMetadata,
  type UploadedMedia,
} from "@/services/MediaService";
import type { Attachment } from "@/protocol/imeta";

/** Largest edge for an inline image. Full-resolution photos are wasted bytes for every viewer. */
export const MESSAGE_IMAGE_TARGET_PX = 1600;

/** Audio is refused by the relay; saying so early beats a 415 after an upload. */
export function rejectionReasonFor(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is larger than ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`;
  }
  if (file.type.startsWith("audio/")) {
    return "This relay doesn't accept audio attachments yet.";
  }
  return null;
}

export interface PreparedAttachment {
  blob: Blob;
  filename: string;
  /** "WxH" for images, once decoded. */
  dim?: string;
}

/**
 * Re-encode an image so the relay's metadata rules are satisfied.
 *
 * Unlike the avatar path this does NOT crop to a square — a screenshot pasted
 * into a chat should keep its shape — but it does downscale and, critically,
 * run the same JPEG sanitizer: Chromium's canvas encoder attaches an APP2 ICC
 * profile that the relay rejects with 422, which is not avatar-specific.
 */
export async function prepareImageAttachment(file: File): Promise<PreparedAttachment> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MESSAGE_IMAGE_TARGET_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AppError("unknown", "Couldn't process that image.");
    // JPEG has no alpha; paint first so transparency becomes white, not black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const encoded = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!encoded) throw new AppError("unknown", "Couldn't process that image.");

    const cleaned = stripJpegMetadata(new Uint8Array(await encoded.arrayBuffer()));
    return {
      blob: new Blob([cleaned.buffer as ArrayBuffer], { type: "image/jpeg" }),
      filename: replaceExtension(file.name, "jpg"),
      dim: `${width}x${height}`,
    };
  } finally {
    bitmap.close();
  }
}

/** Non-image files go up byte-for-byte — the relay stores them as opaque downloads. */
export function prepareFileAttachment(file: File): PreparedAttachment {
  return { blob: file, filename: file.name };
}

export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  return file.type.startsWith("image/") ? prepareImageAttachment(file) : prepareFileAttachment(file);
}

/** Upload a prepared attachment and turn the relay's descriptor into an `imeta` attachment. */
export async function uploadAttachment(
  prepared: PreparedAttachment,
  onProgress?: (fraction: number) => void,
): Promise<Attachment> {
  const uploaded: UploadedMedia = await mediaService.upload(prepared.blob, { onProgress });
  return {
    url: uploaded.url,
    mimeType: uploaded.mimeType,
    sha256: uploaded.sha256,
    size: uploaded.size,
    dim: prepared.dim,
    filename: prepared.filename,
  };
}

function replaceExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${ext}`;
}
