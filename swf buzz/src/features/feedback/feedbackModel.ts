/**
 * Send Feedback — the wire format and the rules, independent of any UI.
 *
 * Transport is OLD BUZZ's, verified end to end (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md
 * §15): a signed Nostr event of kind 42000 sent over the OPEN community's
 * relay socket. The relay does not store or broadcast it as an event; it
 * writes one row into the deployment-wide `product_feedback` table, attributed
 * to the submitter's pubkey and to the community of the connection. Community
 * members never see it; deployment operators/moderators read it.
 *
 * Nothing about the sender's ROLE is sent: a role claimed by a client proves
 * nothing, so the reader derives it from the community's relay-signed
 * membership list (features/platform-admin/feedbackRole.ts).
 */
import type { UnsignedEvent } from "@/features/signing/types";
import { attachmentMarkdown, buildImetaTag, type Attachment } from "@/protocol/imeta";

import { KIND_PRODUCT_FEEDBACK } from "@/protocol/kinds";
export { KIND_PRODUCT_FEEDBACK };

export type FeedbackCategory = "bug" | "praise" | "needs-work";
export const FEEDBACK_CATEGORIES: { id: FeedbackCategory; label: string; hint: string }[] = [
  { id: "bug", label: "Bug", hint: "Something is broken" },
  { id: "praise", label: "Praise", hint: "Something works well" },
  { id: "needs-work", label: "Needs work", hint: "Could be better" },
];

/** Relay limits (crates/buzz-relay/src/handlers/product_feedback.rs:11-13). */
export const MAX_FEEDBACK_BODY_BYTES = 32 * 1024;
export const MAX_FEEDBACK_TAGS_BYTES = 64 * 1024;

export const MAX_FEEDBACK_ATTACHMENTS = 4;
/** Images are re-encoded (metadata stripped, ≤1600 px) before upload. */
export const MAX_FEEDBACK_IMAGE_BYTES = 20 * 1024 * 1024;
/** The relay allows 500 MB of video; feedback does not need anywhere near that. */
export const MAX_FEEDBACK_VIDEO_BYTES = 100 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export type AttachmentKind = "image" | "video";

/**
 * What the relay's media validator accepts (docs/SWF_SETTINGS_FEEDBACK_IMPLEMENTATION.md §8):
 * raster images, and video ONLY as fast-start H.264/AAC MP4 (≤600 s, ≤4K, no
 * metadata boxes). WebM / MOV / fragmented MP4 are refused by the relay and
 * SWF has no transcoder, so they are rejected here with a clear reason rather
 * than failing after a long upload.
 */
export function classifyFeedbackFile(file: { type: string; size: number; name: string }): { kind: AttachmentKind } | { error: string } {
  const type = file.type.toLowerCase();
  if (IMAGE_TYPES.includes(type) || (type.startsWith("image/") && type !== "image/svg+xml")) {
    if (file.size > MAX_FEEDBACK_IMAGE_BYTES) return { error: `${file.name} is larger than 20 MB.` };
    return { kind: "image" };
  }
  if (type === "video/mp4" || (!type && /\.mp4$/i.test(file.name))) {
    if (file.size > MAX_FEEDBACK_VIDEO_BYTES) return { error: `${file.name} is larger than 100 MB.` };
    return { kind: "video" };
  }
  if (type.startsWith("video/")) {
    return { error: `${file.name}: only MP4 video (H.264) is supported. Export or convert it to MP4 first.` };
  }
  return { error: `${file.name}: attach an image or an MP4 video.` };
}

/**
 * Cheap container check before a long upload: an MP4 starts with an `ftyp`
 * box, and QuickTime's `qt  ` brand is refused by the relay. The relay still
 * does the real validation (codecs, fast-start, metadata).
 */
export function mp4HeaderProblem(head: Uint8Array): string | null {
  if (head.length < 12) return "This file is too small to be a video.";
  const box = String.fromCharCode(head[4], head[5], head[6], head[7]);
  if (box !== "ftyp") return "This doesn't look like an MP4 video.";
  const brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
  if (brand === "qt  ") return "QuickTime (.mov) video isn't supported. Export it as MP4 (H.264).";
  return null;
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function validateFeedbackMessage(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return "Tell us what happened.";
  if (utf8Length(trimmed) > MAX_FEEDBACK_BODY_BYTES - 2048) {
    // Headroom for the attachment references appended to the content.
    return "That's too long — keep it under about 30,000 characters.";
  }
  return null;
}

export interface FeedbackDraft {
  category: FeedbackCategory | null;
  message: string;
  attachments: Attachment[];
}

/** The unsigned kind 42000 event. Content = message + one markdown line per attachment (as OLD BUZZ). */
export function buildFeedbackEvent(draft: FeedbackDraft): UnsignedEvent {
  const body = draft.message.trim();
  const refs = draft.attachments.map(attachmentMarkdown);
  const content = refs.length ? `${body}\n\n${refs.join("\n")}` : body;
  const tags: string[][] = [];
  if (draft.category) tags.push(["category", draft.category]);
  for (const attachment of draft.attachments) tags.push(buildImetaTag(attachment));
  if (utf8Length(content) > MAX_FEEDBACK_BODY_BYTES) {
    throw new Error("Feedback is too long.");
  }
  if (utf8Length(JSON.stringify(tags)) > MAX_FEEDBACK_TAGS_BYTES) {
    throw new Error("Too many attachments.");
  }
  return { kind: KIND_PRODUCT_FEEDBACK, content, tags };
}

// ---------------------------------------------------------------------------
// Diagnostics (opt-in)

export interface Diagnostics {
  capturedAt: string;
  appVersion: string;
  platform: string;
  userAgent: string;
  language: string;
}

/** Anything that could be key material or a credential is removed, whatever field it appears in. */
const SECRET_PATTERNS: RegExp[] = [
  /nsec1[02-9ac-hj-np-z]{20,}/gi,
  /ncryptsec1[02-9ac-hj-np-z]{20,}/gi,
  /\b[0-9a-f]{64}\b/gi,
  /(authorization|token|secret|password|cookie)\s*[:=]\s*\S+/gi,
  /\bNostr\s+[A-Za-z0-9+/=]{20,}/g,
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "[redacted]"), text);
}

export function collectDiagnostics(appVersion: string, now = new Date()): Diagnostics {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return {
    capturedAt: now.toISOString(),
    appVersion,
    platform: nav?.platform ?? "unknown",
    userAgent: nav?.userAgent ?? "unknown",
    language: nav?.language ?? "unknown",
  };
}

/** The plain-text file attached when the person opts in. Only these five fields — no logs. */
export function formatDiagnostics(d: Diagnostics): string {
  return redactSecrets(
    [
      "SWF Buzz feedback diagnostics",
      `Captured: ${d.capturedAt}`,
      `App version: ${d.appVersion}`,
      `Platform: ${d.platform}`,
      `User agent: ${d.userAgent}`,
      `Language: ${d.language}`,
      "",
    ].join("\n"),
  );
}
