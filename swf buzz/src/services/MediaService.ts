import { getActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { AppError } from "./errors";
import { relayHttpBase, relayHost } from "@/features/communities/relayCommunities";
import { activeRelayUrl } from "@/features/communities/relayCommunities";
import { config } from "@/app/config";

/**
 * Blossom media upload against the Buzz relay.
 *
 * The relay already implements the whole media stack (BUD-01/02/11) — upload,
 * hash-addressed retrieval, MIME sniffing, size limits, per-pubkey rate
 * limiting — and OLD BUZZ's own clients use it. SWF therefore reuses it rather
 * than adding an endpoint to swf-buzz-backend, which has no media route at all.
 *
 * The auth contract, read from the relay (`crates/buzz-media/src/auth.rs:31-135`
 * and `crates/buzz-relay/src/api/media.rs:160-220`):
 *
 *   Authorization: Nostr <base64(kind:24242 event)>
 *   X-SHA-256:     <hex sha-256 of the exact bytes>
 *
 * and the signed event must carry
 *   - non-empty content (a human-readable reason)
 *   - ["t", "upload"]            the verb
 *   - ["x", "<sha256 hex>"]      must equal the X-SHA-256 header
 *   - ["expiration", "<unix>"]   strictly in the future
 *   - a recent `created_at`      (≤5 s ahead, not older than the relay's window)
 *
 * The event is SIGNED but never published. The private key never reaches this
 * code — signing goes through the active signing service (Rust/OS keyring for a
 * local identity), and nothing here logs the event or its signature.
 */

const BLOSSOM_AUTH_KIND = 24242;
/** Short-lived: the token authorises exactly one upload, moments from now. */
const AUTH_TTL_SECS = 120;

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Avatars are displayed small; anything larger is wasted bytes for every viewer. */
export const AVATAR_TARGET_PX = 512;

export interface UploadedMedia {
  /** Hash-addressed URL served by the relay: `<base>/media/<sha256>.<ext>`. */
  url: string;
  sha256: string;
  size: number;
  mimeType: string;
}

/** Lowercase hex SHA-256 of the exact bytes that will be uploaded. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function currentRelayUrl(): string {
  return activeRelayUrl.value || config.relayUrl;
}

/**
 * Re-encode an image to a square, at most `AVATAR_TARGET_PX` on a side.
 *
 * Centre-cropped to a square first so faces are not stretched. Uses the
 * browser's own canvas — no image library is added for this.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  // Whatever the browser can decode is fair game — the output is always JPEG.
  // A format it cannot read (an exotic HEIC, a mislabelled file) throws a bare
  // DOMException, so name the problem instead of leaking it to the user.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AppError("unknown", "That file couldn't be read as an image. Try a JPG or PNG.");
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const target = Math.min(side, AVATAR_TARGET_PX);
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AppError("unknown", "Couldn't process that image.");
    // JPEG has no alpha, so a transparent source would composite onto black.
    // Paint the canvas first and transparency becomes white instead.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, target, target);
    // Centre crop: take the largest square from the middle of the source.
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      target,
      target,
    );
    /*
      JPEG, not WebP. The relay validates image bytes strictly and rejects any
      chunk it does not expect (`buzz-media/src/validation.rs:702-707`,
      `MetadataForbidden`/`InvalidImage` → HTTP 422). Browser-encoded WebP from
      `canvas.toBlob` carries exactly such chunks, so every avatar upload failed
      with 422 while the very same image as JPEG or PNG was accepted — verified
      against the running relay. JPEG is also the right format for a photo.
    */
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) throw new AppError("unknown", "Couldn't process that image.");

    // The encoder adds an ICC profile (APP2) that the relay refuses, so strip
    // the forbidden segments before upload — see `stripJpegMetadata`.
    const cleaned = stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()));
    // `.buffer` (an ArrayBuffer) rather than the view: TS's BlobPart does not
    // accept a `Uint8Array<ArrayBufferLike>` directly.
    return new Blob([cleaned.buffer as ArrayBuffer], { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

/**
 * Remove every JPEG marker segment the relay refuses.
 *
 * WHY THIS EXISTS: the relay demands a metadata-free image and rejects
 * APP1-APP13 (`0xe1..=0xed`), APP15 (`0xef`) and COM (`0xfe`) outright
 * (`buzz-media/src/validation.rs:581-583` -> `MetadataForbidden`, HTTP 422).
 * Chromium's canvas JPEG encoder — which is what the Tauri WebView uses —
 * attaches an ICC colour profile as **APP2**, so every single avatar upload
 * failed with 422 no matter what file the user picked. Re-encoding alone could
 * not fix it, because the encoder itself adds the offending segment.
 *
 * It also truncates anything after EOI: the validator requires the file to end
 * exactly at `FFD9` (`validation.rs:546-549`).
 *
 * Kept deliberately small and dependency-free — it only walks segment headers
 * and copies bytes; it never re-encodes pixels, so image quality is untouched.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array {
  const FORBIDDEN = (m: number) => (m >= 0xe1 && m <= 0xed) || m === 0xef || m === 0xfe;
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return input; // not a JPEG

  const out: number[] = [0xff, 0xd8];
  let i = 2;

  while (i < input.length) {
    if (input[i] !== 0xff) return input; // malformed — leave it to the server to judge
    while (i < input.length && input[i] === 0xff) i++; // fill bytes
    if (i >= input.length) break;
    const marker = input[i++];

    // Standalone markers carry no payload.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(0xff, marker);
      continue;
    }
    if (marker === 0xd9) break; // EOI — appended below, dropping any trailing bytes

    if (i + 2 > input.length) return input;
    const length = (input[i] << 8) | input[i + 1];
    if (length < 2) return input;
    const segEnd = i + length;
    if (segEnd > input.length) return input;

    if (marker === 0xda) {
      // Start of scan: copy the header, then the entropy-coded data up to EOI.
      out.push(0xff, marker);
      for (let k = i; k < segEnd; k++) out.push(input[k]);
      let k = segEnd;
      while (k + 1 < input.length && !(input[k] === 0xff && input[k + 1] === 0xd9)) {
        out.push(input[k]);
        k++;
      }
      break;
    }

    if (!FORBIDDEN(marker)) {
      out.push(0xff, marker);
      for (let k = i; k < segEnd; k++) out.push(input[k]);
    }
    i = segEnd;
  }

  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

/**
 * Any image the browser can decode is fine.
 *
 * The list was JPG/PNG/WebP only, which rejected perfectly ordinary files
 * (GIF, AVIF, HEIC, BMP) before they were even tried. Since `prepareAvatar`
 * re-encodes everything to a clean JPEG, the only real requirement is that the
 * browser can decode it — and if it cannot, `createImageBitmap` says so and the
 * user gets a clear message instead of a pre-emptive refusal.
 */
export function validateImageFile(file: File): string | null {
  if (file.type && !file.type.startsWith("image/")) {
    return "Choose an image file.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "That image is larger than 5 MB. Choose a smaller one.";
  }
  return null;
}

class MediaService {
  /**
   * Upload bytes and return their hash-addressed URL.
   *
   * `onProgress` receives 0..1. XHR is used rather than `fetch` purely because
   * it reports upload progress; the request itself is an ordinary PUT.
   */
  async upload(
    blob: Blob,
    options: {
      onProgress?: (fraction: number) => void;
      relayUrl?: string;
      /** Human-readable purpose in the Blossom auth event (BUD-11). */
      purpose?: string;
      /** Token lifetime; large files (video) need longer, since the relay re-checks it after the body arrives. */
      authTtlSecs?: number;
    } = {},
  ): Promise<UploadedMedia> {
    const relayUrl = options.relayUrl ?? currentRelayUrl();
    const bytes = await blob.arrayBuffer();
    const hash = await sha256Hex(bytes);

    let signer;
    try {
      signer = getActiveSigningService();
    } catch (err) {
      throw new AppError("auth_required", "Please sign in to upload a photo.", err);
    }

    const now = Math.floor(Date.now() / 1000);
    const authEvent = await signer.signEvent({
      kind: BLOSSOM_AUTH_KIND,
      // Non-empty content is mandatory (BUD-11: a human-readable string).
      content: options.purpose ?? "Upload profile photo",
      created_at: now,
      tags: [
        ["t", "upload"],
        ["x", hash],
        ["expiration", String(now + Math.min(options.authTtlSecs ?? AUTH_TTL_SECS, 3000))],
        // Bind the token to this tenant host so it cannot be replayed elsewhere.
        ["server", relayHost(relayUrl)],
      ],
    });

    const url = `${relayHttpBase(relayUrl)}/upload`;
    const descriptor = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Authorization", `Nostr ${btoa(JSON.stringify(authEvent))}`);
      xhr.setRequestHeader("X-SHA-256", hash);
      xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");

      if (options.onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) options.onProgress?.(e.loaded / e.total);
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as Record<string, unknown>);
          } catch {
            reject(new AppError("unknown", "The server returned an unreadable upload response."));
          }
          return;
        }
        // The relay answers `{"error": "<reason>"}`. Carry that reason — a bare
        // "upload failed" turned a precise 422 ("invalid image data") into a
        // guessing game once already.
        let relayReason: string | undefined;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: unknown };
          if (typeof body.error === "string") relayReason = body.error;
        } catch {
          // Not JSON — the status alone has to do.
        }
        reject(uploadError(xhr.status, relayReason));
      };
      xhr.onerror = () => reject(new AppError("network", "Couldn't reach the server to upload."));
      xhr.onabort = () => reject(new AppError("network", "The upload was cancelled."));
      xhr.send(blob);
    });

    const resolvedUrl = typeof descriptor.url === "string" ? descriptor.url : "";
    if (!resolvedUrl) {
      throw new AppError("unknown", "The server didn't return a URL for that photo.");
    }
    return {
      url: resolvedUrl,
      sha256: typeof descriptor.sha256 === "string" ? descriptor.sha256 : hash,
      size: typeof descriptor.size === "number" ? descriptor.size : blob.size,
      mimeType: typeof descriptor.type === "string" ? descriptor.type : blob.type,
    };
  }

  /**
   * Fetch an attachment's bytes as an object URL usable by `<img src>`/`<a href>`.
   *
   * WHY THIS EXISTS: `GET /media/{sha256}` is NOT public. The relay requires a
   * Blossom GET auth event *and* relay membership
   * (`api/media.rs:527-550` → `verify_blossom_get_auth` +
   * `enforce_relay_membership`), which is what keeps a private channel's
   * attachments private. A browser cannot attach an Authorization header to a
   * plain `<img src>`, so pointing an `<img>` straight at the relay URL yields
   * 401 and a broken image for every attachment. Fetch the bytes with auth,
   * then hand the element a `blob:` URL.
   *
   * Callers own the returned URL and must `revokeObjectURL` it — otherwise the
   * blob is retained for the document's lifetime.
   */
  async fetchAuthorizedBlobUrl(url: string, sha256: string): Promise<string> {
    const signer = getActiveSigningService();
    const now = Math.floor(Date.now() / 1000);
    // `t get` — a GET token is a different verb from an upload token and the
    // relay checks the verb, so an upload token cannot be replayed as a read.
    const authEvent = await signer.signEvent({
      kind: BLOSSOM_AUTH_KIND,
      content: "Fetch attachment",
      created_at: now,
      tags: [
        ["t", "get"],
        ["x", sha256],
        ["expiration", String(now + AUTH_TTL_SECS)],
        ["server", relayHost(url)],
      ],
    });

    const res = await fetch(url, {
      headers: { Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}` },
    });
    if (!res.ok) {
      throw uploadError(res.status, `GET ${res.status}`);
    }
    return URL.createObjectURL(await res.blob());
  }
}

/**
 * Relay upload failures, mapped to something a person can act on. The relay's
 * own reason is attached as `cause` so it reaches logs and diagnosis even when
 * the message shown is friendlier.
 */
function uploadError(status: number, relayReason?: string): AppError {
  const cause = relayReason ? new Error(`relay: ${relayReason}`) : undefined;
  if (status === 401 || status === 403) {
    return new AppError("permission_denied", "You're not allowed to upload here.", cause);
  }
  if (status === 413) return new AppError("unknown", "That image is too large.", cause);
  if (status === 415) {
    return new AppError("unknown", "That file type isn't supported.", cause);
  }
  if (status === 422) {
    // The image reached the relay but failed its content validation.
    return new AppError(
      "unknown",
      "The server couldn't accept that image. Try a different photo.",
      cause,
    );
  }
  if (status === 429) {
    return new AppError("unknown", "Too many uploads. Wait a moment and retry.", cause);
  }
  return new AppError("unknown", "The upload failed. Please try again.", cause);
}

export const mediaService = new MediaService();
