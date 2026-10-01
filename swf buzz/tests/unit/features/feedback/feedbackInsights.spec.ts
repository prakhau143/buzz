/**
 * Control plane: the submitter's role is DERIVED from the community's
 * relay-signed membership snapshot — never from anything the client sent —
 * and attachments render by sniffed bytes, never by the claimed MIME.
 */
import { describe, expect, it, vi } from "vitest";
import type { RawNostrEvent } from "@/protocol/types";

vi.mock("@/services/nip98", () => ({ buildNip98AuthHeader: async () => "Nostr signed" }));
const insights = await import("@/features/platform-admin/feedbackInsights");

const OWNER = "1".repeat(64);
const MEMBER = "2".repeat(64);
const snapshot = { id: "s", pubkey: "r".repeat(64), kind: 13534, created_at: 1, content: "", sig: "x", tags: [["member", OWNER, "owner"], ["member", MEMBER, "member"]] } as RawNostrEvent;

describe("role derivation", () => {
  it("reads the role from the relay-signed snapshot", () => {
    expect(insights.roleFromSnapshot(snapshot, OWNER)).toBe("owner");
    expect(insights.roleFromSnapshot(snapshot, MEMBER)).toBe("member");
    expect(insights.roleFromSnapshot(snapshot, "3".repeat(64))).toBe("not-a-member");
    expect(insights.roleFromSnapshot(undefined, OWNER)).toBeNull();
  });

  it("queries the submitter's own community and marks the role verified", async () => {
    const profile = { id: "p", pubkey: MEMBER, kind: 0, created_at: 1, content: JSON.stringify({ display_name: "Prakhar Mittal" }), tags: [], sig: "x" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([snapshot, profile]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await insights.deriveSubmitterInsight("swf-prod.localhost:3000", MEMBER);
    expect(fetchMock.mock.calls[0][0]).toBe("http://swf-prod.localhost:3000/query");
    expect(result).toEqual({ role: "member", verified: true, displayName: "Prakhar Mittal", note: undefined });
    vi.unstubAllGlobals();
  });

  it("says 'not verifiable' — never guesses — when the reviewer can't read that community", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    const result = await insights.deriveSubmitterInsight("other.example.com", MEMBER);
    expect(result.verified).toBe(false);
    expect(result.role).toBeNull();
    expect(result.note).toMatch(/not a member/);
    vi.unstubAllGlobals();
  });
});

describe("attachments", () => {
  it("parses imeta tags and ignores ones without a valid hash", () => {
    const refs = insights.feedbackAttachments([
      ["category", "bug"],
      ["imeta", "url https://c/media/x.jpg", "m image/jpeg", `x ${"a".repeat(64)}`, "size 10", "filename shot.jpg"],
      ["imeta", "url https://c/media/y", "m video/mp4", "x nothex"],
    ]);
    expect(refs).toEqual([{ sha256: "a".repeat(64), claimedMime: "image/jpeg", filename: "shot.jpg", size: 10 }]);
  });

  it("decides what renders from the bytes: images, MP4, text — anything else is a download", () => {
    const b = (...xs: number[]) => new Uint8Array(xs);
    const s = (t: string) => [...t].map((c) => c.charCodeAt(0));
    expect(insights.sniffAttachment(b(0x89, ...s("PNG"), 13, 10, 26, 10))).toEqual({ kind: "image", mime: "image/png" });
    expect(insights.sniffAttachment(b(0xff, 0xd8, 0xff, 0xe0))).toEqual({ kind: "image", mime: "image/jpeg" });
    expect(insights.sniffAttachment(b(0, 0, 0, 24, ...s("ftypisom")))).toEqual({ kind: "video", mime: "video/mp4" });
    expect(insights.sniffAttachment(b(...s("App version: 0.1.0\n")))).toEqual({ kind: "text" });
    // An HTML/SVG payload claiming to be an image is still just a file.
    expect(insights.sniffAttachment(b(...s("<svg onload=alert(1)>"), 0))).toEqual({ kind: "file" });
  });
});
