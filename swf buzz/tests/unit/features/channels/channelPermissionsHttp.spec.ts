import { describe, expect, it } from "vitest";
import {
  isSoleChannelOwnerById,
  resolveMyChannelRole,
} from "@/features/channels/channelPermissionsHttp";
import { canAddChannelMember, assignableChannelRoles, canManageChannelMember } from "@/features/channels/channelPermissionsHttp";
import type { HttpChannelMember } from "@/features/channels/ChannelServiceHttp";

describe("channelPermissionsHttp", () => {
  it("re-exports the same rule functions as the old pubkey-based module (never duplicated/drifted)", async () => {
    const old = await import("@/features/channels/channelPermissions");
    expect(canAddChannelMember).toBe(old.canAddChannelMember);
    expect(assignableChannelRoles).toBe(old.assignableChannelRoles);
    expect(canManageChannelMember).toBe(old.canManageChannelMember);
  });

  describe("resolveMyChannelRole", () => {
    const members: HttpChannelMember[] = [
      { userId: "u1", role: "owner", joinedAt: "2026-01-01T00:00:00Z" },
      { userId: "u2", role: "member", joinedAt: "2026-01-02T00:00:00Z" },
    ];

    it("finds the caller's role by userId", () => {
      expect(resolveMyChannelRole(members, "u2")).toBe("member");
    });

    it("returns null when the userId isn't a member", () => {
      expect(resolveMyChannelRole(members, "stranger")).toBeNull();
    });

    it("returns null when members or userId is null", () => {
      expect(resolveMyChannelRole(null, "u1")).toBeNull();
      expect(resolveMyChannelRole(members, null)).toBeNull();
    });
  });

  describe("isSoleChannelOwnerById", () => {
    it("is true when exactly one owner exists and it's this userId", () => {
      const members: HttpChannelMember[] = [
        { userId: "u1", role: "owner", joinedAt: "2026-01-01T00:00:00Z" },
        { userId: "u2", role: "member", joinedAt: "2026-01-02T00:00:00Z" },
      ];
      expect(isSoleChannelOwnerById(members, "u1")).toBe(true);
    });

    it("is false when there are two owners", () => {
      const members: HttpChannelMember[] = [
        { userId: "u1", role: "owner", joinedAt: "2026-01-01T00:00:00Z" },
        { userId: "u2", role: "owner", joinedAt: "2026-01-02T00:00:00Z" },
      ];
      expect(isSoleChannelOwnerById(members, "u1")).toBe(false);
    });
  });
});
