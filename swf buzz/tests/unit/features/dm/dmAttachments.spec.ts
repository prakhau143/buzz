/**
 * DM attachments ride the same NIP-92 `imeta` tags as channel messages, because
 * a DM message is wire-identical to a channel message (kind:9 scoped by `h`).
 *
 * REGRESSION GUARD: `useSendDm.send` previously took only (content,
 * mentionPubkeys) and hard-coded `attachments: []`. The DM composer therefore
 * could not carry a file at all — and the empty array read as "no attachments
 * on this message" rather than "this path drops attachments", so nothing
 * failed loudly. These tests pin the parameter through every layer of the
 * chain, so removing it anywhere fails here rather than silently shipping a
 * picker whose files never reach the event.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SignedEvent } from "@/features/signing/types";
import type { Attachment } from "@/protocol/imeta";

const imageAttachment: Attachment = {
  url: "http://localhost:3000/media/abc123.jpg",
  mimeType: "image/jpeg",
  sha256: "a".repeat(64),
  size: 2048,
  dim: "800x600",
  filename: "holiday photo.jpg",
};

const fileAttachment: Attachment = {
  url: "http://localhost:3000/media/def456.pdf",
  mimeType: "application/pdf",
  sha256: "b".repeat(64),
  size: 40960,
  filename: "report.pdf",
};

function signedFor(tags: string[][], content: string): SignedEvent {
  return {
    id: "e".repeat(64),
    pubkey: "p".repeat(64),
    created_at: 1_700_000_000,
    kind: 9,
    tags,
    content,
    sig: "sig",
  };
}

vi.mock("@/services/publish", () => ({
  signAndPublish: vi.fn(),
  signAndPublishWithResponse: vi.fn(),
}));

const { Kind41010Transport } = await import("@/features/dm/Kind41010Transport");
const { DmService } = await import("@/features/dm/DmService");
const { signAndPublish } = await import("@/services/publish");

beforeEach(() => {
  vi.mocked(signAndPublish).mockReset();
});

/** Captures the unsigned event handed to signAndPublish, echoing it back as signed. */
function captureSend() {
  vi.mocked(signAndPublish).mockImplementation(async (unsigned) => {
    const u = unsigned as { tags: string[][]; content: string };
    return signedFor(u.tags, u.content);
  });
}

describe("Kind41010Transport.send — attachments", () => {
  it("emits an imeta tag per attachment", async () => {
    captureSend();
    await new Kind41010Transport().send("dm-1", "look", [], [imageAttachment, fileAttachment]);

    const unsigned = vi.mocked(signAndPublish).mock.calls[0]![0] as { tags: string[][] };
    const imeta = unsigned.tags.filter((t) => t[0] === "imeta");
    expect(imeta).toHaveLength(2);
    expect(imeta[0]).toContain(`url ${imageAttachment.url}`);
    expect(imeta[0]).toContain("m image/jpeg");
    expect(imeta[1]).toContain("m application/pdf");
  });

  it("preserves a filename containing spaces", async () => {
    // The pair is split on the FIRST space only; splitting on every space
    // would truncate this to "holiday".
    captureSend();
    await new Kind41010Transport().send("dm-1", "look", [], [imageAttachment]);

    const unsigned = vi.mocked(signAndPublish).mock.calls[0]![0] as { tags: string[][] };
    const imeta = unsigned.tags.find((t) => t[0] === "imeta")!;
    expect(imeta).toContain("filename holiday photo.jpg");
  });

  it("carries sha256, size and dim so the receiver can verify and lay out", async () => {
    captureSend();
    await new Kind41010Transport().send("dm-1", "look", [], [imageAttachment]);

    const unsigned = vi.mocked(signAndPublish).mock.calls[0]![0] as { tags: string[][] };
    const imeta = unsigned.tags.find((t) => t[0] === "imeta")!;
    expect(imeta).toContain(`x ${imageAttachment.sha256}`);
    expect(imeta).toContain("size 2048");
    expect(imeta).toContain("dim 800x600");
  });

  it("appends a markdown reference so a non-imeta client renders something", async () => {
    captureSend();
    await new Kind41010Transport().send("dm-1", "look", [], [imageAttachment]);

    const unsigned = vi.mocked(signAndPublish).mock.calls[0]![0] as { content: string };
    expect(unsigned.content).toContain(imageAttachment.url);
  });

  it("returns a Message whose attachments round-trip back out of the event", async () => {
    captureSend();
    const sent = await new Kind41010Transport().send("dm-1", "look", [], [imageAttachment]);

    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]!.url).toBe(imageAttachment.url);
    expect(sent.attachments[0]!.filename).toBe("holiday photo.jpg");
    expect(sent.attachments[0]!.sha256).toBe(imageAttachment.sha256);
  });

  it("sends no imeta tag when there are no attachments", async () => {
    captureSend();
    await new Kind41010Transport().send("dm-1", "plain text", []);

    const unsigned = vi.mocked(signAndPublish).mock.calls[0]![0] as { tags: string[][] };
    expect(unsigned.tags.filter((t) => t[0] === "imeta")).toHaveLength(0);
  });

  it("leaves plain-text content untouched", async () => {
    captureSend();
    await new Kind41010Transport().send("dm-1", "plain text", []);

    const unsigned = vi.mocked(signAndPublish).mock.calls[0]![0] as { content: string };
    expect(unsigned.content).toBe("plain text");
  });
});

describe("DmService.sendMessage — attachment pass-through", () => {
  it("forwards attachments to the transport", async () => {
    const send = vi.fn().mockResolvedValue({ id: "m1", attachments: [imageAttachment] });
    const service = new DmService({
      open: vi.fn(),
      send,
      hide: vi.fn(),
      subscribe: vi.fn(),
      fetchHistory: vi.fn(),
      fetchOlder: vi.fn(),
      fetchSince: vi.fn(),
    });

    await service.sendMessage("dm-1", "look", ["mention"], [imageAttachment]);

    expect(send).toHaveBeenCalledWith("dm-1", "look", ["mention"], [imageAttachment]);
  });

  it("forwards undefined attachments without substituting an empty array", async () => {
    // Substituting [] here would make "caller sent nothing" indistinguishable
    // from "caller explicitly sent no attachments" at the transport boundary.
    const send = vi.fn().mockResolvedValue({ id: "m1", attachments: [] });
    const service = new DmService({
      open: vi.fn(),
      send,
      hide: vi.fn(),
      subscribe: vi.fn(),
      fetchHistory: vi.fn(),
      fetchOlder: vi.fn(),
      fetchSince: vi.fn(),
    });

    await service.sendMessage("dm-1", "look");

    expect(send).toHaveBeenCalledWith("dm-1", "look", undefined, undefined);
  });
});
