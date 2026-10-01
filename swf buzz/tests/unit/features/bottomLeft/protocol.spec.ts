/**
 * OLD BUZZ-compatible wire formats used by the bottom-left control centre:
 * NIP-38 custom status (kind 30315) and the NIP-43 community leave (kind 28936).
 */
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/services/errors";
import type { UnsignedEvent } from "@/features/signing/types";
import {
  QUICK_STATUSES,
  buildClearStatusEvent,
  buildSetStatusEvent,
  buildStatusFetchFilter,
  isStatusActive,
  parseStatusEvent,
  statusExpiry,
} from "@/protocol/userStatus";

const published: UnsignedEvent[] = [];
let outcome: () => Promise<unknown> = async () => ({});
vi.mock("@/services/publish", () => ({
  signAndPublish: (event: UnsignedEvent) => {
    published.push(event);
    return outcome();
  },
}));
const { buildLeaveCommunityEvent, leaveCommunity } = await import("@/features/communities/leaveCommunity");

const refusal = (reason: string) => () =>
  Promise.reject(new AppError("relay_rejected", "That action wasn't accepted by the server.", new Error(reason)));

describe("custom status (NIP-38, OLD BUZZ relayClientSession.ts)", () => {
  it("set = kind 30315, content text, d/emoji/expiration tags", () => {
    expect(buildSetStatusEvent({ emoji: "🏠", text: " Working remotely ", expiresAt: 1790400000 })).toEqual({
      kind: 30315,
      content: "Working remotely",
      tags: [["d", "general"], ["emoji", "🏠"], ["expiration", "1790400000"]],
    });
  });

  it("a text-only status gets OLD BUZZ's 💬", () => {
    expect(buildSetStatusEvent({ emoji: "", text: "Focus", expiresAt: null }).tags).toContainEqual(["emoji", "💬"]);
  });

  it("clear = empty 30315 with only the d tag, and reads back as no status", () => {
    const clear = buildClearStatusEvent();
    expect(clear).toEqual({ kind: 30315, content: "", tags: [["d", "general"]] });
    expect(parseStatusEvent({ ...clear, id: "x", pubkey: "p", created_at: 1, sig: "s" })).toBeNull();
  });

  it("fetches others' statuses by author with the general d tag", () => {
    expect(buildStatusFetchFilter(["a", "b"])).toEqual({ kinds: [30315], authors: ["a", "b"], "#d": ["general"], limit: 2 });
  });

  it("expired statuses are not active", () => {
    const status = { emoji: "🚌", text: "Commuting", expiresAt: 100, updatedAt: 1 };
    expect(isStatusActive(status, 99)).toBe(true);
    expect(isStatusActive(status, 100)).toBe(false);
  });

  it("quick statuses are OLD BUZZ's five, in order", () => {
    expect(QUICK_STATUSES.map((q) => q.text)).toEqual([
      "In a meeting",
      "Commuting",
      "Out sick",
      "Vacationing",
      "Working remotely",
    ]);
  });

  it("durations follow OLD BUZZ: +1h, +8h, next local midnight, next Monday 00:00", () => {
    const wed = new Date(2026, 8, 23, 15, 10); // Wednesday 15:10 local
    const sec = (d: Date) => Math.floor(d.getTime() / 1000);
    expect(statusExpiry("1h", wed)).toBe(sec(wed) + 3600);
    expect(statusExpiry("8h", wed)).toBe(sec(wed) + 8 * 3600);
    expect(statusExpiry("today", wed)).toBe(sec(new Date(2026, 8, 24, 0, 0)));
    expect(statusExpiry("week", wed)).toBe(sec(new Date(2026, 8, 28, 0, 0)));
    const monday = new Date(2026, 8, 28, 9, 0);
    expect(statusExpiry("week", monday)).toBe(sec(new Date(2026, 9, 5, 0, 0)));
  });
});

describe("leave community (NIP-43, kind 28936)", () => {
  it("publishes exactly OLD BUZZ's leave: empty content, protected tag", async () => {
    published.length = 0;
    outcome = async () => ({});
    expect(await leaveCommunity()).toBe("left");
    expect(published).toEqual([buildLeaveCommunityEvent()]);
    expect(buildLeaveCommunityEvent()).toEqual({ kind: 28936, content: "", tags: [["-"]] });
  });

  it("'not a relay member' means already out (OLD BUZZ treats it the same)", async () => {
    outcome = refusal("invalid: you are not a relay member");
    expect(await leaveCommunity()).toBe("already-left");
  });

  it("the relay owner is told plainly why they can't leave", async () => {
    outcome = refusal("invalid: relay owner cannot leave");
    const thrown = await leaveCommunity().then(
      () => null,
      (e: unknown) => e,
    );
    expect((thrown as Error).message).toBe("You own this community, so you can't leave it.");
  });
});
