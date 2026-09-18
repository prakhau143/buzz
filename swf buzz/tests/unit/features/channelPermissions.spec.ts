import { describe, expect, it } from "vitest";
import {
  assignableChannelRoles,
  canAddChannelMember,
  canManageChannelMember,
  isSoleChannelOwner,
} from "@/features/channels/channelPermissions";
import type { Member } from "@/types/domain";

describe("canAddChannelMember", () => {
  it("open channels admit any authenticated user, even a non-member", () => {
    expect(canAddChannelMember(null, "open")).toBe(true);
    expect(canAddChannelMember("member", "open")).toBe(true);
  });

  it("private channels require the actor to already be an active member", () => {
    expect(canAddChannelMember(null, "private")).toBe(false);
    expect(canAddChannelMember("member", "private")).toBe(true);
    expect(canAddChannelMember("admin", "private")).toBe(true);
    expect(canAddChannelMember("owner", "private")).toBe(true);
  });
});

describe("assignableChannelRoles", () => {
  it("owner or admin may grant member, admin, or owner", () => {
    expect(assignableChannelRoles("owner")).toEqual(["member", "admin", "owner"]);
    expect(assignableChannelRoles("admin")).toEqual(["member", "admin", "owner"]);
  });

  it("a plain member or non-member may only grant plain member", () => {
    expect(assignableChannelRoles("member")).toEqual(["member"]);
    expect(assignableChannelRoles(null)).toEqual(["member"]);
  });
});

describe("canManageChannelMember", () => {
  it("allows owner and admin, denies member and null", () => {
    expect(canManageChannelMember("owner")).toBe(true);
    expect(canManageChannelMember("admin")).toBe(true);
    expect(canManageChannelMember("member")).toBe(false);
    expect(canManageChannelMember(null)).toBe(false);
  });
});

describe("isSoleChannelOwner", () => {
  const soleOwnerRoster: Member[] = [
    { pubkey: "aaa", role: "owner" },
    { pubkey: "bbb", role: "member" },
  ];
  const coOwnedRoster: Member[] = [
    { pubkey: "aaa", role: "owner" },
    { pubkey: "ccc", role: "owner" },
  ];

  it("is true for the only owner in the roster", () => {
    expect(isSoleChannelOwner(soleOwnerRoster, "aaa")).toBe(true);
  });

  it("is false for a non-owner, even if they're the only member of that name", () => {
    expect(isSoleChannelOwner(soleOwnerRoster, "bbb")).toBe(false);
  });

  it("is false when a co-owner exists", () => {
    expect(isSoleChannelOwner(coOwnedRoster, "aaa")).toBe(false);
    expect(isSoleChannelOwner(coOwnedRoster, "ccc")).toBe(false);
  });

  it("is false when there are no owners at all", () => {
    expect(isSoleChannelOwner([{ pubkey: "aaa", role: "member" }], "aaa")).toBe(false);
  });
});
