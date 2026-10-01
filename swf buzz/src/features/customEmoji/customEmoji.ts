import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import { mediaService } from "@/services/MediaService";
import { AppError } from "@/services/errors";
import { CUSTOM_EMOJI_SET_D_TAG, KIND_EMOJI_SET } from "@/protocol/kinds";
import type { RawNostrEvent } from "@/protocol/types";

/**
 * Custom emoji — NIP-30, exactly OLD BUZZ's model (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md §7):
 * every member publishes their OWN kind 30030 set (`d = "buzz:custom-emoji"`,
 * tags `["emoji", shortcode, url]`); the community palette is the union of
 * all members' sets on this community's relay. You can only change your own
 * set, so only your own emoji can be removed.
 */
export interface CustomEmoji {
  shortcode: string;
  url: string;
  author: string;
  createdAt: number;
}

const SHORTCODE_RE = /^[a-z0-9_-]{1,64}$/;

/** `:Party_Parrot:` → `party_parrot`; `null` when it can't be a valid shortcode. */
export function normalizeShortcode(input: string): string | null {
  const value = input.trim().replace(/^:+|:+$/g, "").toLowerCase();
  return SHORTCODE_RE.test(value) ? value : null;
}

/** A shortcode suggestion from a file name. */
export function suggestShortcode(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return stem.slice(0, 64) || "emoji";
}

function emojiTags(event: RawNostrEvent): { shortcode: string; url: string }[] {
  return event.tags
    .filter((t) => t[0] === "emoji" && typeof t[1] === "string" && typeof t[2] === "string")
    .map((t) => ({ shortcode: t[1], url: t[2] }))
    .filter((e) => SHORTCODE_RE.test(e.shortcode) && /^https?:\/\//.test(e.url));
}

/** The palette: one winner per shortcode — newest set wins, ties to the smaller URL (as OLD BUZZ). */
export function unionPalette(events: RawNostrEvent[]): CustomEmoji[] {
  const byCode = new Map<string, CustomEmoji>();
  for (const event of events) {
    for (const { shortcode, url } of emojiTags(event)) {
      const candidate = { shortcode, url, author: event.pubkey, createdAt: event.created_at };
      const held = byCode.get(shortcode);
      if (!held || candidate.createdAt > held.createdAt || (candidate.createdAt === held.createdAt && candidate.url < held.url)) {
        byCode.set(shortcode, candidate);
      }
    }
  }
  return [...byCode.values()].sort((a, b) => a.shortcode.localeCompare(b.shortcode));
}

export async function fetchPalette(): Promise<CustomEmoji[]> {
  return unionPalette(await fetchEventsOnce([{ kinds: [KIND_EMOJI_SET], "#d": [CUSTOM_EMOJI_SET_D_TAG] }]));
}

async function fetchOwnSet(me: string): Promise<RawNostrEvent | null> {
  const events = await fetchEventsOnce([{ kinds: [KIND_EMOJI_SET], authors: [me], "#d": [CUSTOM_EMOJI_SET_D_TAG], limit: 1 }]);
  return events.reduce<RawNostrEvent | null>((a, b) => (!a || b.created_at > a.created_at ? b : a), null);
}

/** Read-modify-write of MY set; never touches anyone else's. */
async function writeOwnSet(me: string, mutate: (entries: Map<string, string>) => void): Promise<void> {
  const current = await fetchOwnSet(me);
  const entries = new Map((current ? emojiTags(current) : []).map((e) => [e.shortcode, e.url] as const));
  mutate(entries);
  await signAndPublish({
    kind: KIND_EMOJI_SET,
    content: "",
    tags: [["d", CUSTOM_EMOJI_SET_D_TAG], ...[...entries].map(([code, url]) => ["emoji", code, url])],
    created_at: Math.max(Math.floor(Date.now() / 1000), (current?.created_at ?? 0) + 1),
  });
}

export async function addCustomEmoji(me: string, shortcode: string, url: string): Promise<void> {
  const code = normalizeShortcode(shortcode);
  if (!code) throw new AppError("unknown", "Use only letters, numbers, hyphen or underscore (up to 64).");
  await writeOwnSet(me, (entries) => entries.set(code, url));
}

export async function removeCustomEmoji(me: string, shortcode: string): Promise<void> {
  await writeOwnSet(me, (entries) => entries.delete(shortcode));
}

/** Re-encode to a 128 px PNG: metadata-free (the relay requires it), keeps transparency. */
export async function prepareEmojiImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new AppError("unknown", "Choose a PNG, JPEG, GIF or WebP image.");
  }
  if (file.size > 5 * 1024 * 1024) throw new AppError("unknown", "That image is larger than 5 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 128 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new AppError("unknown", "Couldn't process that image.");
    return blob;
  } finally {
    bitmap.close();
  }
}

export async function uploadEmojiImage(file: File, onProgress?: (f: number) => void): Promise<string> {
  const blob = await prepareEmojiImage(file);
  const uploaded = await mediaService.upload(blob, { onProgress, purpose: "Upload custom emoji" });
  return uploaded.url;
}
