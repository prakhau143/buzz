import { describe, expect, it, beforeEach } from "vitest";
import {
  setPendingInviteToken,
  getPendingInviteToken,
  clearPendingInviteToken,
} from "@/features/communities/pendingInvite";

describe("pendingInvite", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a token through sessionStorage", () => {
    setPendingInviteToken("abc123");
    expect(getPendingInviteToken()).toBe("abc123");
  });

  it("returns null when nothing is pending", () => {
    expect(getPendingInviteToken()).toBeNull();
  });

  it("clears the stored token", () => {
    setPendingInviteToken("abc123");
    clearPendingInviteToken();
    expect(getPendingInviteToken()).toBeNull();
  });

  it("overwrites a previously stashed token with the latest one", () => {
    setPendingInviteToken("first");
    setPendingInviteToken("second");
    expect(getPendingInviteToken()).toBe("second");
  });
});
