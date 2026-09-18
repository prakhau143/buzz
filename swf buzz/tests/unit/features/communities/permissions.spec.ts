import { describe, expect, it } from "vitest";
import { resolveMyCommunityRole } from "@/features/communities/permissions";
import type { CommunityMember } from "@/features/communities/CommunityService";

const members: CommunityMember[] = [
  { userId: "u1", role: "owner", joinedAt: "2026-01-01T00:00:00Z" },
  { userId: "u2", role: "member", joinedAt: "2026-01-02T00:00:00Z" },
];

describe("resolveMyCommunityRole", () => {
  it("finds the role for the given userId", () => {
    expect(resolveMyCommunityRole(members, "u1")).toBe("owner");
    expect(resolveMyCommunityRole(members, "u2")).toBe("member");
  });

  it("returns null for a userId not in the roster", () => {
    expect(resolveMyCommunityRole(members, "u3")).toBeNull();
  });

  it("returns null when members is null (no roster yet)", () => {
    expect(resolveMyCommunityRole(null, "u1")).toBeNull();
  });

  it("returns null when userId is null (not signed in)", () => {
    expect(resolveMyCommunityRole(members, null)).toBeNull();
  });
});
