/**
 * Phase 4D — NIP-92 `imeta` attachment tags.
 *
 * The wire shape is copied from OLD BUZZ's own producer/consumer
 * (`media_upload.dart:210-222`, `message_media.dart:50-110`). The subtlety that
 * makes this worth testing rather than eyeballing is the **first-space-only**
 * split: each element after the tag name is a `key value` pair, and values
 * routinely contain spaces — a filename almost always does. Splitting on every
 * space silently truncates `filename my quarterly report.pdf` to `my`, which
 * looks like a cosmetic bug and is actually a corrupted download name.
 */
import { describe, expect, it } from "vitest";
import {
  attachmentKind,
  attachmentMarkdown,
  buildImetaTag,
  parseImetaTags,
  type Attachment,
} from "@/protocol/imeta";
import { parseMessageEvent } from "@/protocol/messages";
import type { RawNostrEvent } from "@/protocol/types";

const base: Attachment = {
  url: "https://relay.example/media/abc.png",
  mimeType: "image/png",
  sha256: "f".repeat(64),
  size: 2048,
};

function event(tags: string[][]): RawNostrEvent {
  return {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    created_at: 1_700_000_000,
    kind: 9,
    tags: [["h", "channel-1"], ...tags],
    content: "see attached",
    sig: "c".repeat(128),
  };
}

describe("imeta round trip", () => {
  it("preserves a filename containing spaces", () => {
    const withName: Attachment = { ...base, filename: "my quarterly report.pdf" };
    const parsed = parseImetaTags(event([buildImetaTag(withName)]));

    expect(parsed.get(base.url)?.filename).toBe("my quarterly report.pdf");
  });

  it("round-trips every field it was given", () => {
    const full: Attachment = {
      ...base,
      dim: "1920x1080",
      thumb: "https://relay.example/media/thumb.png",
      duration: 12.5,
      filename: "clip one.mp4",
      alt: "a short clip",
    };
    const parsed = parseImetaTags(event([buildImetaTag(full)]));

    expect(parsed.get(full.url)).toEqual(full);
  });

  it("omits optional fields entirely rather than sending them empty", () => {
    const tag = buildImetaTag(base);

    expect(tag.some((p) => p.startsWith("dim"))).toBe(false);
    expect(tag.some((p) => p.startsWith("filename"))).toBe(false);
    expect(tag.some((p) => p.startsWith("duration"))).toBe(false);
    // An empty `dim ` would parse back as the string "" and render as a broken
    // dimension rather than an absent one.
    expect(tag.every((p) => p === "imeta" || p.split(" ").length >= 2)).toBe(true);
  });

  it("skips a malformed tag instead of throwing, keeping the good ones", () => {
    const parsed = parseImetaTags(
      event([
        ["imeta", "nourlhere"], // no url => skipped
        ["imeta"], // empty => skipped
        buildImetaTag(base),
      ]),
    );

    expect(parsed.size).toBe(1);
    expect(parsed.get(base.url)?.mimeType).toBe("image/png");
  });

  it("falls back to a safe MIME and size when the sender omitted them", () => {
    const parsed = parseImetaTags(event([["imeta", `url ${base.url}`]]));
    const attachment = parsed.get(base.url)!;

    expect(attachment.mimeType).toBe("application/octet-stream");
    expect(attachment.size).toBe(0);
    expect(attachment.duration).toBeUndefined();
  });

  it("ignores a negative or non-numeric size rather than trusting it", () => {
    const parsed = parseImetaTags(
      event([["imeta", `url ${base.url}`, "size -5", "duration not-a-number"]]),
    );
    const attachment = parsed.get(base.url)!;

    expect(attachment.size).toBe(0);
    expect(attachment.duration).toBeUndefined();
  });
});

describe("attachment rendering", () => {
  it("classifies by the imeta MIME, not by the URL extension", () => {
    // A URL ending .png that the sender declared as a file must not be treated
    // as an image — the declared type is what the relay validated.
    expect(attachmentKind({ ...base, mimeType: "application/pdf" })).toBe("file");
    expect(attachmentKind({ ...base, mimeType: "image/jpeg" })).toBe("image");
    expect(attachmentKind({ ...base, mimeType: "video/mp4" })).toBe("video");
  });

  it("escapes brackets in a filename used as markdown link text", () => {
    const markdown = attachmentMarkdown({
      ...base,
      mimeType: "application/pdf",
      filename: "report [final].pdf",
    });

    expect(markdown).toContain("\\[final\\]");
  });
});

describe("parseMessageEvent wiring", () => {
  it("populates attachments from imeta tags", () => {
    const message = parseMessageEvent(event([buildImetaTag(base)]));

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].url).toBe(base.url);
  });

  it("yields an empty list for a plain text message", () => {
    // Every consumer reads `.attachments` unconditionally, so this must be an
    // empty array rather than undefined.
    const message = parseMessageEvent(event([]));

    expect(message.attachments).toEqual([]);
  });

  it("keeps multiple attachments in tag order", () => {
    const second: Attachment = { ...base, url: "https://relay.example/media/two.png" };
    const message = parseMessageEvent(event([buildImetaTag(base), buildImetaTag(second)]));

    expect(message.attachments.map((a) => a.url)).toEqual([base.url, second.url]);
  });
});
