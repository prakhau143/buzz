/**
 * `stripJpegMetadata` — the fix for avatar uploads failing with HTTP 422.
 *
 * The relay demands a metadata-free image and rejects APP1-APP13 (0xe1-0xed),
 * APP15 (0xef) and COM (0xfe) outright
 * (`buzz-media/src/validation.rs:581-583` -> "media contains metadata or a
 * non-canonical metadata channel"). Chromium's canvas JPEG encoder — the one
 * the Tauri WebView uses — attaches an ICC colour profile as APP2, so EVERY
 * avatar upload failed regardless of which file the user chose. Reproduced and
 * fixed against the live relay: APP2 present -> 422, stripped -> 200.
 */
import { describe, expect, it } from "vitest";
import { stripJpegMetadata } from "@/services/MediaService";

/** Minimal but structurally valid JPEG: SOI, canonical JFIF APP0, SOS, data, EOI. */
function baseJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0, length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // version/units/density/no thumbnail
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS
    0x12, 0x34, 0x56, // entropy-coded data
    0xff, 0xd9, // EOI
  ]);
}

/** Splice a segment in immediately after SOI, as an encoder would. */
function withSegment(jpeg: Uint8Array, marker: number, payload: number[]): Uint8Array {
  const len = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, marker, (len >> 8) & 0xff, len & 0xff,
    ...payload,
    ...jpeg.subarray(2),
  ]);
}

const has = (bytes: Uint8Array, marker: number) => {
  for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === marker) return true;
  return false;
};

describe("stripJpegMetadata", () => {
  it("removes the APP2 ICC profile that made every upload fail", () => {
    const icc = [...new TextEncoder().encode("ICC_PROFILE\0"), 1, 1, ...new Array(64).fill(7)];
    const withIcc = withSegment(baseJpeg(), 0xe2, icc);
    expect(has(withIcc, 0xe2)).toBe(true);

    const cleaned = stripJpegMetadata(withIcc);
    expect(has(cleaned, 0xe2), "APP2 must be gone").toBe(false);
    // Back to exactly the original bytes.
    expect(Array.from(cleaned)).toEqual(Array.from(baseJpeg()));
  });

  it("removes every marker the relay forbids", () => {
    for (const marker of [0xe1, 0xe2, 0xe7, 0xed, 0xef, 0xfe]) {
      const dirty = withSegment(baseJpeg(), marker, [1, 2, 3, 4]);
      const cleaned = stripJpegMetadata(dirty);
      expect(has(cleaned, marker), `marker 0x${marker.toString(16)} must be stripped`).toBe(false);
    }
  });

  it("keeps the canonical JFIF APP0 header, which the relay allows", () => {
    const cleaned = stripJpegMetadata(baseJpeg());
    expect(has(cleaned, 0xe0)).toBe(true);
  });

  it("keeps the image data and the scan header intact", () => {
    const cleaned = stripJpegMetadata(withSegment(baseJpeg(), 0xe2, [9, 9, 9]));
    expect(has(cleaned, 0xda), "SOS must survive").toBe(true);
    expect(Array.from(cleaned).join(",")).toContain("18,52,86"); // 0x12,0x34,0x56
  });

  it("ends exactly at EOI, dropping trailing bytes", () => {
    // The relay also rejects anything after EOI (validation.rs:546-549).
    const trailing = new Uint8Array([...baseJpeg(), 0x00, 0x11, 0x22]);
    const cleaned = stripJpegMetadata(trailing);
    expect(cleaned[cleaned.length - 2]).toBe(0xff);
    expect(cleaned[cleaned.length - 1]).toBe(0xd9);
  });

  it("is idempotent — stripping twice changes nothing", () => {
    const once = stripJpegMetadata(withSegment(baseJpeg(), 0xe2, [1, 2, 3]));
    const twice = stripJpegMetadata(once);
    expect(Array.from(twice)).toEqual(Array.from(once));
  });

  it("leaves a non-JPEG untouched rather than corrupting it", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(stripJpegMetadata(png)).toBe(png);
  });

  it("gives up on malformed input instead of producing garbage", () => {
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, 0xff]);
    expect(stripJpegMetadata(truncated)).toBe(truncated);
  });
});
