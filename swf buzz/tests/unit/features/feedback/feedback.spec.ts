/**
 * Send Feedback: OLD BUZZ's verified wire format (kind 42000 over the open
 * community's socket), with SWF's rules — uploads only on send, no client
 * role claim, opt-in diagnostics with secrets redacted, MP4-only video.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnsignedEvent } from "@/features/signing/types";

const published: UnsignedEvent[] = [];
vi.mock("@/services/publish", () => ({
  signAndPublish: async (event: UnsignedEvent) => {
    published.push(event);
    return { ...event, id: "evt", pubkey: "p".repeat(64), sig: "s", created_at: 1 };
  },
}));
const uploads: { type: string; purpose?: string; authTtlSecs?: number }[] = [];
vi.mock("@/services/MediaService", () => ({
  mediaService: {
    upload: async (blob: Blob, options: { purpose?: string; authTtlSecs?: number }) => {
      uploads.push({ type: blob.type, purpose: options.purpose, authTtlSecs: options.authTtlSecs });
      const sha = String(uploads.length).padStart(64, "0");
      return { url: `https://c.example/media/${sha}.bin`, sha256: sha, size: blob.size, mimeType: blob.type || "application/octet-stream" };
    },
  },
}));
vi.mock("@/features/messages/attachments", () => ({
  prepareImageAttachment: async (_file: File) => ({ blob: new Blob(["img"], { type: "image/jpeg" }), filename: "shot.jpg", dim: "10x10" }),
}));

const model = await import("@/features/feedback/feedbackModel");
const { sendFeedback } = await import("@/features/feedback/feedbackService");

const mp4 = (brand = "isom") => new File([new Uint8Array([0, 0, 0, 24, ...[..."ftyp"].map((c) => c.charCodeAt(0)), ...[...brand].map((c) => c.charCodeAt(0)), 0, 0, 0, 0])], "clip.mp4", { type: "video/mp4" });

beforeEach(() => {
  published.length = 0;
  uploads.length = 0;
});

describe("feedback event", () => {
  it("is kind 42000 with the message, optional category and one imeta per attachment", () => {
    const event = model.buildFeedbackEvent({
      category: "bug",
      message: "  Name shows the old value  ",
      attachments: [{ url: "https://c.example/media/" + "a".repeat(64) + ".jpg", mimeType: "image/jpeg", sha256: "a".repeat(64), size: 3 }],
    });
    expect(event.kind).toBe(42000);
    expect(event.content.startsWith("Name shows the old value")).toBe(true);
    expect(event.content).toContain("![image](https://c.example/media/");
    expect(event.tags[0]).toEqual(["category", "bug"]);
    expect(event.tags[1][0]).toBe("imeta");
  });

  it("never carries a role, community or identity claim — the reader derives those", () => {
    const event = model.buildFeedbackEvent({ category: null, message: "hi", attachments: [] });
    expect(event.tags).toEqual([]);
    expect(JSON.stringify(event)).not.toMatch(/role|owner|admin|community/i);
  });

  it("validates the message: required, and within the relay's 32 KiB body limit", () => {
    expect(model.validateFeedbackMessage("   ")).toMatch(/Tell us/);
    expect(model.validateFeedbackMessage("x".repeat(40_000))).toMatch(/too long/);
    expect(model.validateFeedbackMessage("fine")).toBeNull();
  });

  it("accepts images and MP4 only — WebM/MOV/other files are refused with a reason", () => {
    expect(model.classifyFeedbackFile({ type: "image/png", size: 10, name: "a.png" })).toEqual({ kind: "image" });
    expect(model.classifyFeedbackFile({ type: "video/mp4", size: 10, name: "a.mp4" })).toEqual({ kind: "video" });
    expect(model.classifyFeedbackFile({ type: "video/webm", size: 10, name: "a.webm" })).toHaveProperty("error");
    expect(model.classifyFeedbackFile({ type: "image/svg+xml", size: 10, name: "a.svg" })).toHaveProperty("error");
    expect(model.classifyFeedbackFile({ type: "application/pdf", size: 10, name: "a.pdf" })).toHaveProperty("error");
    expect(model.classifyFeedbackFile({ type: "video/mp4", size: 200 * 1024 * 1024, name: "big.mp4" })).toHaveProperty("error");
  });

  it("MP4 header check refuses QuickTime and non-MP4 bytes", () => {
    const bytes = (s: string) => new Uint8Array([0, 0, 0, 24, ...[...s].map((c) => c.charCodeAt(0))]);
    expect(model.mp4HeaderProblem(bytes("ftypisom"))).toBeNull();
    expect(model.mp4HeaderProblem(bytes("ftypqt  "))).toMatch(/QuickTime/);
    expect(model.mp4HeaderProblem(bytes("RIFFWEBP"))).toMatch(/MP4/);
  });

  it("diagnostics hold only the five safe fields, and anything key-like is redacted", () => {
    const d = model.collectDiagnostics("0.1.0", new Date("2026-09-29T00:00:00Z"));
    expect(Object.keys(d).sort()).toEqual(["appVersion", "capturedAt", "language", "platform", "userAgent"]);
    const text = model.formatDiagnostics({ ...d, userAgent: "UA nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq token=abc " + "f".repeat(64) });
    expect(text).not.toMatch(/nsec1|token=abc|f{64}/);
    expect(text).toContain("[redacted]");
  });
});

describe("sending", () => {
  it("uploads attachments only when sending, then publishes one kind 42000 event", async () => {
    await sendFeedback({
      category: "needs-work",
      message: "Please add dark mode",
      files: [
        { id: "1", file: new File(["x"], "shot.png", { type: "image/png" }), kind: "image" },
        { id: "2", file: mp4(), kind: "video" },
      ],
      includeDiagnostics: false,
      appVersion: "0.1.0",
    });
    expect(uploads.map((u) => u.type)).toEqual(["image/jpeg", "video/mp4"]);
    expect(uploads.every((u) => u.purpose === "Upload feedback attachment")).toBe(true);
    expect(uploads[1].authTtlSecs).toBeGreaterThan(120); // large videos outlive the default token
    expect(published).toHaveLength(1);
    expect(published[0].kind).toBe(42000);
    expect(published[0].tags.filter((t) => t[0] === "imeta")).toHaveLength(2);
  });

  it("diagnostics are uploaded only when opted in", async () => {
    await sendFeedback({ category: null, message: "a", files: [], includeDiagnostics: true, appVersion: "0.1.0" });
    expect(uploads.map((u) => u.purpose)).toEqual(["Upload feedback diagnostics"]);
    expect(published[0].tags.filter((t) => t[0] === "imeta")).toHaveLength(1);
  });

  it("a QuickTime file is rejected before any upload and nothing is published", async () => {
    await expect(
      sendFeedback({ category: null, message: "a", files: [{ id: "v", file: mp4("qt  "), kind: "video" }], includeDiagnostics: false, appVersion: "0" }),
    ).rejects.toThrow(/QuickTime/);
    expect(uploads).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it("an empty message never reaches the relay", async () => {
    await expect(sendFeedback({ category: null, message: " ", files: [], includeDiagnostics: false, appVersion: "0" })).rejects.toThrow();
    expect(published).toHaveLength(0);
  });
});
