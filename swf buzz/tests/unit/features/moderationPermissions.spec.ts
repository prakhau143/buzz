import { describe, expect, it } from "vitest";
import {
  canBanOrTimeout,
  canResolveReport,
  canUnbanOrUntimeout,
  canViewModerationQueue,
} from "@/features/community-members/permissions";

describe("canViewModerationQueue", () => {
  it("allows owner and admin, denies member and null", () => {
    expect(canViewModerationQueue("owner")).toBe(true);
    expect(canViewModerationQueue("admin")).toBe(true);
    expect(canViewModerationQueue("member")).toBe(false);
    expect(canViewModerationQueue(null)).toBe(false);
  });
});

describe("canBanOrTimeout", () => {
  it("owner is unrestricted, even against another owner/admin", () => {
    expect(canBanOrTimeout("owner", "owner")).toBe(true);
    expect(canBanOrTimeout("owner", "admin")).toBe(true);
    expect(canBanOrTimeout("owner", "member")).toBe(true);
    expect(canBanOrTimeout("owner", null)).toBe(true);
  });

  it("admin cannot ban/timeout the owner or a fellow admin", () => {
    expect(canBanOrTimeout("admin", "owner")).toBe(false);
    expect(canBanOrTimeout("admin", "admin")).toBe(false);
  });

  it("admin can ban/timeout a plain member or a non-member target", () => {
    expect(canBanOrTimeout("admin", "member")).toBe(true);
    expect(canBanOrTimeout("admin", null)).toBe(true);
  });

  it("plain member or unauthenticated cannot ban/timeout anyone", () => {
    expect(canBanOrTimeout("member", "member")).toBe(false);
    expect(canBanOrTimeout(null, "member")).toBe(false);
  });
});

describe("canUnbanOrUntimeout", () => {
  it("carries no guard rail — owner and admin can always lift a restriction", () => {
    expect(canUnbanOrUntimeout("owner")).toBe(true);
    expect(canUnbanOrUntimeout("admin")).toBe(true);
  });

  it("plain member or unauthenticated cannot lift a restriction", () => {
    expect(canUnbanOrUntimeout("member")).toBe(false);
    expect(canUnbanOrUntimeout(null)).toBe(false);
  });
});

describe("canResolveReport", () => {
  it("owner and admin can resolve, member and unauthenticated cannot", () => {
    expect(canResolveReport("owner")).toBe(true);
    expect(canResolveReport("admin")).toBe(true);
    expect(canResolveReport("member")).toBe(false);
    expect(canResolveReport(null)).toBe(false);
  });
});
