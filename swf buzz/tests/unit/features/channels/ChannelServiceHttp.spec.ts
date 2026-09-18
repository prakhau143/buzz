import { describe, expect, it, vi, beforeEach } from "vitest";

const apiRequestMock = vi.fn();
vi.mock("@/services/ApiClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

describe("ChannelServiceHttp", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("createChannel POSTs name/visibility/description and maps the response", async () => {
    apiRequestMock.mockResolvedValueOnce({
      id: "ch1",
      community_id: "c1",
      name: "general",
      visibility: "open",
      description: null,
    });
    const { channelServiceHttp } = await import("@/features/channels/ChannelServiceHttp");

    const result = await channelServiceHttp.createChannel("c1", "general", "open");

    expect(result).toEqual({
      id: "ch1",
      communityId: "c1",
      name: "general",
      visibility: "open",
      description: null,
    });
    expect(apiRequestMock).toHaveBeenCalledWith("/api/communities/c1/channels", {
      method: "POST",
      body: { name: "general", visibility: "open", description: null },
    });
  });

  it("listChannels maps snake_case DTOs into camelCase HttpChannel", async () => {
    apiRequestMock.mockResolvedValueOnce([
      { id: "ch1", community_id: "c1", name: "general", visibility: "open", description: null },
    ]);
    const { channelServiceHttp } = await import("@/features/channels/ChannelServiceHttp");

    const result = await channelServiceHttp.listChannels("c1");

    expect(result[0].communityId).toBe("c1");
    expect(apiRequestMock).toHaveBeenCalledWith("/api/communities/c1/channels");
  });

  it("addMember sends user_id/role and maps the response", async () => {
    apiRequestMock.mockResolvedValueOnce({
      user_id: "u2",
      role: "member",
      joined_at: "2026-01-02T00:00:00Z",
    });
    const { channelServiceHttp } = await import("@/features/channels/ChannelServiceHttp");

    await channelServiceHttp.addMember("ch1", "u2", "member");

    expect(apiRequestMock).toHaveBeenCalledWith("/api/channels/ch1/members", {
      method: "POST",
      body: { user_id: "u2", role: "member" },
    });
  });

  it("joinChannel is addMember with the caller's own id at role member", async () => {
    apiRequestMock.mockResolvedValueOnce({
      user_id: "me",
      role: "member",
      joined_at: "2026-01-02T00:00:00Z",
    });
    const { channelServiceHttp } = await import("@/features/channels/ChannelServiceHttp");

    await channelServiceHttp.joinChannel("ch1", "me");

    expect(apiRequestMock).toHaveBeenCalledWith("/api/channels/ch1/members", {
      method: "POST",
      body: { user_id: "me", role: "member" },
    });
  });

  it("changeRole PATCHes the target member's role", async () => {
    apiRequestMock.mockResolvedValueOnce({
      user_id: "u2",
      role: "admin",
      joined_at: "2026-01-02T00:00:00Z",
    });
    const { channelServiceHttp } = await import("@/features/channels/ChannelServiceHttp");

    await channelServiceHttp.changeRole("ch1", "u2", "admin");

    expect(apiRequestMock).toHaveBeenCalledWith("/api/channels/ch1/members/u2", {
      method: "PATCH",
      body: { role: "admin" },
    });
  });

  it("removeMember DELETEs the member", async () => {
    apiRequestMock.mockResolvedValueOnce(undefined);
    const { channelServiceHttp } = await import("@/features/channels/ChannelServiceHttp");

    await channelServiceHttp.removeMember("ch1", "u2");

    expect(apiRequestMock).toHaveBeenCalledWith("/api/channels/ch1/members/u2", { method: "DELETE" });
  });
});
