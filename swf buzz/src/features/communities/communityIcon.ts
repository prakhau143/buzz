import { signAndPublish } from "@/services/publish";
import { relayHttpBase } from "./relayCommunities";
import { KIND_RELAY_ADMIN_SET_ICON } from "@/protocol/kinds";
import { AppError } from "@/services/errors";

/**
 * The community icon — the ONE server-side community setting OLD BUZZ has
 * (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md §9). Written as a signed kind 9033
 * (owner/admin; the relay decides), read back from the relay's NIP-11 `icon`.
 * Stored inline as a small data URL, as OLD BUZZ does, so it renders for any
 * member without an authorized media fetch.
 */

/** Relay limit for an inline icon (relay_admin.rs:59-95). */
export const MAX_ICON_DATA_URL_BYTES = 98_304;
const ICON_PX = 128;

export async function fetchCommunityIcon(relayUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${relayHttpBase(relayUrl)}/info`, {
      headers: { Accept: "application/nostr+json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const info = (await response.json()) as { icon?: unknown };
    return typeof info.icon === "string" && isSafeIcon(info.icon) ? info.icon : null;
  } catch {
    return null;
  }
}

/** Only raster data URLs or http(s) URLs are ever rendered. */
export function isSafeIcon(value: string): boolean {
  return /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value) || /^https?:\/\//.test(value);
}

/** Center-crop to a square, downscale to 128 px, JPEG — small enough for the relay's inline limit. */
export async function makeIconDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new AppError("unknown", "Choose an image file.");
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AppError("unknown", "Couldn't process that image.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ICON_PX, ICON_PX);
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, ICON_PX, ICON_PX);
    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= MAX_ICON_DATA_URL_BYTES) return dataUrl;
    }
    throw new AppError("unknown", "That image is too detailed to use as an icon.");
  } finally {
    bitmap.close();
  }
}

/** Set (or, with "", clear) the open community's icon. Resolves when the relay accepted it. */
export async function setCommunityIcon(value: string): Promise<void> {
  await signAndPublish({ kind: KIND_RELAY_ADMIN_SET_ICON, content: "", tags: [["icon", value]] });
}
