import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  canAddMember,
  canChangeRole,
  canManageCommunityMembers,
  canRemoveMember,
  resolveMyRole,
} from "@/features/community-members/permissions";
import type { RelayMember } from "@/protocol/relayMembers";

describe("resolveMyRole", () => {
  const members: RelayMember[] = [
    { pubkey: "aaa", role: "owner" },
    { pubkey: "bbb", role: "member" },
  ];

  it("resolves the matching member's role", () => {
    expect(resolveMyRole(members, "aaa")).toBe("owner");
    expect(resolveMyRole(members, "bbb")).toBe("member");
  });

  it("resolves null for a pubkey not in the roster", () => {
    expect(resolveMyRole(members, "ccc")).toBeNull();
  });

  it("resolves null when the relay has no membership snapshot at all (open relay)", () => {
    expect(resolveMyRole(null, "aaa")).toBeNull();
  });

  it("resolves null when no pubkey is known yet", () => {
    expect(resolveMyRole(members, null)).toBeNull();
  });
});

describe("canManageCommunityMembers", () => {
  it("allows owner and admin, denies member and null", () => {
    expect(canManageCommunityMembers("owner")).toBe(true);
    expect(canManageCommunityMembers("admin")).toBe(true);
    expect(canManageCommunityMembers("member")).toBe(false);
    expect(canManageCommunityMembers(null)).toBe(false);
  });
});

describe("canAddMember", () => {
  it("owner can grant member or admin", () => {
    expect(canAddMember("owner", "member")).toBe(true);
    expect(canAddMember("owner", "admin")).toBe(true);
  });

  it("admin can only grant member, never admin", () => {
    expect(canAddMember("admin", "member")).toBe(true);
    expect(canAddMember("admin", "admin")).toBe(false);
  });

  it("nobody can grant owner through this path", () => {
    expect(canAddMember("owner", "owner")).toBe(false);
  });

  it("plain member or unauthenticated cannot add anyone", () => {
    expect(canAddMember("member", "member")).toBe(false);
    expect(canAddMember(null, "member")).toBe(false);
  });
});

describe("canRemoveMember", () => {
  it("owner can remove admin or member, never another owner", () => {
    expect(canRemoveMember("owner", "admin", false)).toBe(true);
    expect(canRemoveMember("owner", "member", false)).toBe(true);
    expect(canRemoveMember("owner", "owner", false)).toBe(false);
  });

  it("admin can remove only member-role targets", () => {
    expect(canRemoveMember("admin", "member", false)).toBe(true);
    expect(canRemoveMember("admin", "admin", false)).toBe(false);
    expect(canRemoveMember("admin", "owner", false)).toBe(false);
  });

  it("nobody can remove themselves via this action, even the owner", () => {
    expect(canRemoveMember("owner", "member", true)).toBe(false);
    expect(canRemoveMember("admin", "member", true)).toBe(false);
  });

  it("plain member cannot remove anyone", () => {
    expect(canRemoveMember("member", "member", false)).toBe(false);
  });
});

describe("canChangeRole", () => {
  it("only owner may change roles", () => {
    expect(canChangeRole("owner", "member", false, "admin")).toBe(true);
    expect(canChangeRole("admin", "member", false, "admin")).toBe(false);
  });

  it("cannot change your own role, even as owner", () => {
    expect(canChangeRole("owner", "owner", true, "admin")).toBe(false);
  });

  it("cannot change the current owner's role", () => {
    expect(canChangeRole("owner", "owner", false, "admin")).toBe(false);
  });

  it("cannot grant owner through a role change", () => {
    expect(canChangeRole("owner", "member", false, "owner")).toBe(false);
  });

  it("owner can promote a member to admin and demote an admin to member", () => {
    expect(canChangeRole("owner", "member", false, "admin")).toBe(true);
    expect(canChangeRole("owner", "admin", false, "member")).toBe(true);
  });
});

describe("assignableRoles", () => {
  it("owner may assign member or admin", () => {
    expect(assignableRoles("owner")).toEqual(["member", "admin"]);
  });

  it("admin may assign member only", () => {
    expect(assignableRoles("admin")).toEqual(["member"]);
  });

  it("member and unauthenticated may assign nothing", () => {
    expect(assignableRoles("member")).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
  });
});
