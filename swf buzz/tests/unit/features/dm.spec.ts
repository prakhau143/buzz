import { describe, expect, it, vi } from "vitest";
import type { SignedEvent } from "@/features/signing/types";

const signedEvent: SignedEvent = {
  id: "id".padEnd(64, "0"),
  pubkey: "pk".padEnd(64, "0"),
  created_at: 1_700_000_000,
  kind: 41010,
  tags: [["p", "other".padEnd(64, "0")]],
  content: "",
  sig: "sig",
};

vi.mock("@/services/publish", () => ({
  signAndPublish: vi.fn(),
  signAndPublishWithResponse: vi.fn(),
}));

const { Kind41010Transport } = await import("@/features/dm/Kind41010Transport");
const { signAndPublishWithResponse } = await import("@/services/publish");

describe("Kind41010Transport.open", () => {
  it("returns the channel id parsed from the relay's OK reason", async () => {
    vi.mocked(signAndPublishWithResponse).mockResolvedValue({
      signed: signedEvent,
      okReason: JSON.stringify({ channel_id: "dm-channel-1" }),
    });
    const transport = new Kind41010Transport();
    await expect(transport.open(["other-pubkey"])).resolves.toBe("dm-channel-1");
  });

  it("throws when the OK reason has no channel_id", async () => {
    vi.mocked(signAndPublishWithResponse).mockResolvedValue({ signed: signedEvent, okReason: "" });
    const transport = new Kind41010Transport();
    await expect(transport.open(["other-pubkey"])).rejects.toThrow();
  });

  it("throws when the OK reason is not JSON at all", async () => {
    vi.mocked(signAndPublishWithResponse).mockResolvedValue({
      signed: signedEvent,
      okReason: "ok",
    });
    const transport = new Kind41010Transport();
    await expect(transport.open(["other-pubkey"])).rejects.toThrow();
  });
});
