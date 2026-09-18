import { describe, expect, it, vi, beforeEach } from "vitest";

const apiRequestMock = vi.fn();
vi.mock("@/services/ApiClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

const conversationDto = {
  id: "c1",
  participant_ids: ["u1", "u2"],
  created_at: "2026-01-01T00:00:00Z",
};

const messageDto = {
  id: "m1",
  seq: 1,
  conversation_id: "c1",
  sender_user_id: "u1",
  content: "hi",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("DmServiceHttp", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("open POSTs the given user_ids and maps the response", async () => {
    apiRequestMock.mockResolvedValueOnce(conversationDto);
    const { dmServiceHttp } = await import("@/features/dm/DmServiceHttp");

    const result = await dmServiceHttp.open(["u1", "u2"]);

    expect(result.id).toBe("c1");
    expect(result.participantIds).toEqual(["u1", "u2"]);
    expect(apiRequestMock).toHaveBeenCalledWith("/api/dm/open", {
      method: "POST",
      body: { user_ids: ["u1", "u2"] },
    });
  });

  it("open called twice with the same set resolves to the same conversation id, both times", async () => {
    apiRequestMock.mockResolvedValueOnce(conversationDto);
    apiRequestMock.mockResolvedValueOnce(conversationDto);
    const { dmServiceHttp } = await import("@/features/dm/DmServiceHttp");

    const first = await dmServiceHttp.open(["u1", "u2"]);
    const second = await dmServiceHttp.open(["u2", "u1"]);

    expect(first.id).toBe(second.id);
  });

  it("listConversations maps every returned row", async () => {
    apiRequestMock.mockResolvedValueOnce([conversationDto]);
    const { dmServiceHttp } = await import("@/features/dm/DmServiceHttp");

    const result = await dmServiceHttp.listConversations();

    expect(apiRequestMock).toHaveBeenCalledWith("/api/dm");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("c1");
  });

  it("send POSTs content to the conversation's message endpoint", async () => {
    apiRequestMock.mockResolvedValueOnce(messageDto);
    const { dmServiceHttp } = await import("@/features/dm/DmServiceHttp");

    const result = await dmServiceHttp.send("c1", "hi");

    expect(result.senderUserId).toBe("u1");
    expect(apiRequestMock).toHaveBeenCalledWith("/api/dm/c1/messages", {
      method: "POST",
      body: { content: "hi" },
    });
  });

  it("listMessages omits query params when unset and includes them when given", async () => {
    apiRequestMock.mockResolvedValueOnce([messageDto]);
    const { dmServiceHttp } = await import("@/features/dm/DmServiceHttp");

    await dmServiceHttp.listMessages("c1");
    expect(apiRequestMock).toHaveBeenCalledWith("/api/dm/c1/messages");

    apiRequestMock.mockResolvedValueOnce([messageDto]);
    await dmServiceHttp.listMessages("c1", 5, 10);
    expect(apiRequestMock).toHaveBeenCalledWith("/api/dm/c1/messages?before_seq=5&limit=10");
  });
});
