/**
 * NIP-92 `imeta` attachment tags.
 *
 * Wire shape, taken verbatim from OLD BUZZ's own producer
 * (`mobile/lib/shared/relay/media_upload.dart:210-222`) and consumer
 * (`mobile/lib/features/channels/message_media.dart:50-110`):
 *
 *   ["imeta", "url <url>", "m <mime>", "x <sha256>", "size <bytes>",
 *             "dim <WxH>"?, "blurhash <b>"?, "thumb <url>"?,
 *             "duration <secs>"?, "image <url>"?, "filename <name>"?]
 *
 * Each element after the tag name is a single `key value` pair split on the
 * FIRST space — values may themselves contain spaces (a filename commonly
 * does), so splitting on every space corrupts them.
 *
 * The attachment URL is ALSO appended to the message content as markdown
 * (`toMarkdownImage`, `media_upload.dart:224-234`) so that a client which does
 * not parse `imeta` still shows something rather than an apparently empty
 * message. We keep that behaviour: the tag is metadata, not the only carrier.
 */
import type { RawNostrEvent } from "./types";

export interface Attachment {
  url: string;
  mimeType: string;
  sha256: string;
  size: number;
  /** "WxH", when known. */
  dim?: string;
  filename?: string;
  alt?: string;
  thumb?: string;
  /** Seconds, for time-based media. */
  duration?: number;
}

/** Builds one `imeta` tag. Optional fields are omitted entirely rather than sent empty. */
export function buildImetaTag(attachment: Attachment): string[] {
  const tag = [
    "imeta",
    `url ${attachment.url}`,
    `m ${attachment.mimeType}`,
    `x ${attachment.sha256}`,
    `size ${attachment.size}`,
  ];
  if (attachment.dim) tag.push(`dim ${attachment.dim}`);
  if (attachment.thumb) tag.push(`thumb ${attachment.thumb}`);
  if (attachment.duration !== undefined) tag.push(`duration ${attachment.duration}`);
  if (attachment.filename) tag.push(`filename ${attachment.filename}`);
  if (attachment.alt) tag.push(`alt ${attachment.alt}`);
  return tag;
}

/** The markdown reference appended to content so non-imeta clients still render something. */
export function attachmentMarkdown(attachment: Attachment): string {
  const label = (attachment.filename ?? "file").replace(/[\\[\]]/g, (m) => `\\${m}`);
  if (attachment.mimeType.startsWith("image/")) return `![image](${attachment.url})`;
  if (attachment.mimeType.startsWith("video/")) return `![video](${attachment.url})`;
  if (attachment.mimeType.startsWith("audio/")) return `![audio](${attachment.url})`;
  return `[${label}](${attachment.url})`;
}

/**
 * The message text with the appended attachment references removed.
 *
 * `buildMessageEvent` appends a markdown reference per attachment so clients
 * that do not parse `imeta` still show something (OLD BUZZ mobile renders
 * content through a markdown widget, so `![image](url)` becomes the image
 * itself). SWF renders content as PLAIN TEXT and renders attachments as real
 * UI, so leaving the reference in would show the literal `![image](http://…)`
 * above the very image it refers to.
 *
 * This is display-only: the wire format is untouched, so other clients still
 * get their fallback. Only references matching an attachment we are actually
 * rendering are removed — a URL the user typed themselves is left alone.
 */
export function contentWithoutAttachmentRefs(
  content: string,
  attachments: readonly Attachment[],
): string {
  if (attachments.length === 0) return content;

  let text = content;
  for (const attachment of attachments) {
    // Match the exact reference `buildMessageEvent` would have produced, so a
    // hand-typed link to the same URL with different text survives.
    const reference = attachmentMarkdown(attachment);
    const index = text.lastIndexOf(reference);
    if (index === -1) continue;
    text = text.slice(0, index) + text.slice(index + reference.length);
  }
  return text.trim();
}

/** Parses every `imeta` tag on an event, keyed by URL. Malformed tags are skipped, not thrown. */
export function parseImetaTags(event: Pick<RawNostrEvent, "tags">): Map<string, Attachment> {
  const byUrl = new Map<string, Attachment>();

  for (const tag of event.tags) {
    if (tag[0] !== "imeta") continue;

    const fields: Record<string, string> = {};
    for (const part of tag.slice(1)) {
      // Split on the FIRST space only — `filename my report.pdf` is one pair.
      const separator = part.indexOf(" ");
      if (separator <= 0) continue;
      fields[part.slice(0, separator)] = part.slice(separator + 1);
    }

    const url = fields.url;
    if (!url) continue;

    const size = Number.parseInt(fields.size ?? "", 10);
    const duration = Number.parseFloat(fields.duration ?? "");

    byUrl.set(url, {
      url,
      mimeType: fields.m ?? "application/octet-stream",
      sha256: fields.x ?? "",
      size: Number.isFinite(size) && size >= 0 ? size : 0,
      dim: fields.dim,
      thumb: fields.thumb,
      filename: fields.filename,
      alt: fields.alt,
      duration: Number.isFinite(duration) && duration >= 0 ? duration : undefined,
    });
  }

  return byUrl;
}

export type AttachmentKind = "image" | "video" | "file";

/** How an attachment should be rendered. The imeta MIME is authoritative over the extension. */
export function attachmentKind(attachment: Attachment): AttachmentKind {
  if (attachment.mimeType.startsWith("image/")) return "image";
  if (attachment.mimeType.startsWith("video/")) return "video";
  return "file";
}

/** Human-readable size, for the file row. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
