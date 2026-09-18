import { describe, expect, it, vi, beforeEach } from "vitest";

const apiRequestMock = vi.fn();
vi.mock("@/services/ApiClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

describe("CommunityService", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("createCommunity POSTs the name and returns the created community", async () => {
    apiRequestMock.mockResolvedValueOnce({ id: "c1", name: "Engineering" });
    const { communityService } = await import("@/features/communities/CommunityService");

    const result = await communityService.createCommunity("Engineering");

    expect(result).toEqual({ id: "c1", name: "Engineering" });
    expect(apiRequestMock).toHaveBeenCalledWith("/api/communities", {
      method: "POST",
      body: { name: "Engineering" },
    });
  });

  it("listMembers maps snake_case DTOs into camelCase CommunityMember", async () => {
    apiRequestMock.mockResolvedValueOnce([
      { user_id: "u1", role: "owner", joined_at: "2026-01-01T00:00:00Z" },
    ]);
    const { communityService } = await import("@/features/communities/CommunityService");

    const result = await communityService.listMembers("c1");

    expect(result).toEqual([{ userId: "u1", role: "owner", joinedAt: "2026-01-01T00:00:00Z" }]);
    expect(apiRequestMock).toHaveBeenCalledWith("/api/communities/c1/members");
  });

  it("addMember sends user_id/role and maps the response", async () => {
    apiRequestMock.mockResolvedValueOnce({ user_id: "u2", role: "member", joined_at: "2026-01-02T00:00:00Z" });
    const { communityService } = await import("@/features/communities/CommunityService");

    const result = await communityService.addMember("c1", "u2", "member");

    expect(result.userId).toBe("u2");
    expect(apiRequestMock).toHaveBeenCalledWith("/api/communities/c1/members", {
      method: "POST",
      body: { user_id: "u2", role: "member" },
    });
  });

  it("changeRole PATCHes the target member's role", async () => {
    apiRequestMock.mockResolvedValueOnce({ user_id: "u2", role: "admin", joined_at: "2026-01-02T00:00:00Z" });
    const { communityService } = await import("@/features/communities/CommunityService");

    await communityService.changeRole("c1", "u2", "admin");

    expect(apiRequestMock).toHaveBeenCalledWith("/api/communities/c1/members/u2", {
      method: "PATCH",
      body: { role: "admin" },
    });
  });

  it("removeMember DELETEs the target member", async () => {
    apiRequestMock.mockResolvedValueOnce({ status: "removed" });
    const { communityService } = await import("@/features/communities/CommunityService");

    await communityService.removeMember("c1", "u2");

    expect(apiRequestMock).toHaveBeenCalledWith("/api/communities/c1/members/u2", { method: "DELETE" });
  });
});
