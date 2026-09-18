import { describe, expect, it, vi, beforeEach } from "vitest";

const apiRequestMock = vi.fn();
vi.mock("@/services/ApiClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

describe("InviteService (HTTP)", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("createInvite sends ttl_secs/max_uses and maps the snake_case response", async () => {
    apiRequestMock.mockResolvedValueOnce({
      id: "inv1",
      code: "raw-code",
      url: "http://localhost:5173/invite/raw-code",
      expires_at: "2026-01-08T00:00:00Z",
      max_uses: 5,
      uses_remaining: 5,
    });
    const { inviteHttpService } = await import("@/features/communities/InviteService");

    const result = await inviteHttpService.createInvite("c1", { ttlSecs: 3600, maxUses: 5 });

    expect(result).toEqual({
      id: "inv1",
      code: "raw-code",
      url: "http://localhost:5173/invite/raw-code",
      expiresAt: "2026-01-08T00:00:00Z",
      maxUses: 5,
      usesRemaining: 5,
    });
    expect(apiRequestMock).toHaveBeenCalledWith("/api/communities/c1/invites", {
      method: "POST",
      body: { ttl_secs: 3600, max_uses: 5 },
    });
  });

  it("revokeInvite POSTs to the revoke endpoint", async () => {
    apiRequestMock.mockResolvedValueOnce({ status: "revoked" });
    const { inviteHttpService } = await import("@/features/communities/InviteService");

    await inviteHttpService.revokeInvite("inv1");

    expect(apiRequestMock).toHaveBeenCalledWith("/api/invites/inv1/revoke", { method: "POST" });
  });

  it("previewInvite GETs the public preview and never requires a token", async () => {
    apiRequestMock.mockResolvedValueOnce({ community_name: "Engineering" });
    const { inviteHttpService } = await import("@/features/communities/InviteService");

    const result = await inviteHttpService.previewInvite("some code/with+chars");

    expect(result).toEqual({ communityName: "Engineering" });
    expect(apiRequestMock).toHaveBeenCalledWith(
      `/api/invites/${encodeURIComponent("some code/with+chars")}/preview`,
    );
  });

  it("claimInvite maps a 'joined' response", async () => {
    apiRequestMock.mockResolvedValueOnce({
      status: "joined",
      community: { id: "c1", name: "Engineering" },
      membership: { user_id: "u1", role: "member" },
    });
    const { inviteHttpService } = await import("@/features/communities/InviteService");

    const result = await inviteHttpService.claimInvite("raw-code");

    expect(result).toEqual({
      status: "joined",
      community: { id: "c1", name: "Engineering" },
      membership: { userId: "u1", role: "member" },
    });
  });

  it("claimInvite maps an 'already_member' response without requiring community/membership fields", async () => {
    apiRequestMock.mockResolvedValueOnce({ status: "already_member" });
    const { inviteHttpService } = await import("@/features/communities/InviteService");

    const result = await inviteHttpService.claimInvite("raw-code");

    expect(result).toEqual({ status: "already_member" });
  });

  it("claimInvite throws if the backend claims 'joined' but omits community/membership", async () => {
    apiRequestMock.mockResolvedValueOnce({ status: "joined" });
    const { inviteHttpService } = await import("@/features/communities/InviteService");

    await expect(inviteHttpService.claimInvite("raw-code")).rejects.toThrow();
  });
});
