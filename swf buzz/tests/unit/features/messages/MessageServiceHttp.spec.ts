import { describe, expect, it, vi, beforeEach } from "vitest";

const apiRequestMock = vi.fn();
vi.mock("@/services/ApiClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

const dto = {
  id: "m1",
  seq: 1,
  channel_id: "ch1",
  sender_user_id: "u1",
  content: "hi",
  parent_message_id: null,
  root_message_id: null,
  depth: 0,
  reply_count: 0,
  descendant_count: 0,
  last_reply_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("MessageServiceHttp", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("send POSTs content and an explicit null parent_message_id when replying to nothing", async () => {
    apiRequestMock.mockResolvedValueOnce(dto);
    const { messageServiceHttp } = await import("@/features/messages/MessageServiceHttp");

    const result = await messageServiceHttp.send("ch1", "hi");

    expect(result.id).toBe("m1");
    expect(result.senderUserId).toBe("u1");
    expect(apiRequestMock).toHaveBeenCalledWith("/api/channels/ch1/messages", {
      method: "POST",
      body: { content: "hi", parent_message_id: null },
    });
  });

  it("send passes a real parent_message_id through untouched when replying", async () => {
    apiRequestMock.mockResolvedValueOnce({ ...dto, parent_message_id: "root1", root_message_id: "root1" });
    const { messageServiceHttp } = await import("@/features/messages/MessageServiceHttp");

    await messageServiceHttp.send("ch1", "a reply", "root1");

    expect(apiRequestMock).toHaveBeenCalledWith("/api/channels/ch1/messages", {
      method: "POST",
      body: { content: "a reply", parent_message_id: "root1" },
    });
  });

  it("list omits query params when unset and includes them when given", async () => {
    apiRequestMock.mockResolvedValueOnce([dto]);
    const { messageServiceHttp } = await import("@/features/messages/MessageServiceHttp");

    await messageServiceHttp.list("ch1");
    expect(apiRequestMock).toHaveBeenCalledWith("/api/channels/ch1/messages");

    apiRequestMock.mockResolvedValueOnce([dto]);
    await messageServiceHttp.list("ch1", 5, 10);
    expect(apiRequestMock).toHaveBeenCalledWith("/api/channels/ch1/messages?before_seq=5&limit=10");
  });
});
