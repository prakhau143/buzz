import { describe, expect, it, vi, beforeEach } from "vitest";

const apiRequestMock = vi.fn();
vi.mock("@/services/ApiClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

function messageDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

describe("ThreadServiceHttp", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("getThread maps root + replies and forwards after_seq/limit as query params", async () => {
    apiRequestMock.mockResolvedValueOnce({
      root: messageDto({ id: "root1" }),
      replies: [messageDto({ id: "reply1", parent_message_id: "root1", root_message_id: "root1" })],
    });
    const { threadServiceHttp } = await import("@/features/threads/ThreadServiceHttp");

    const result = await threadServiceHttp.getThread("root1", 3, 20);

    expect(result.root.id).toBe("root1");
    expect(result.replies[0].id).toBe("reply1");
    expect(apiRequestMock).toHaveBeenCalledWith("/api/messages/root1/thread?after_seq=3&limit=20");
  });

  it("getThreadSummaries joins ids with commas and maps the response", async () => {
    apiRequestMock.mockResolvedValueOnce([
      { root_message_id: "root1", reply_count: 2, descendant_count: 3, last_reply_at: null },
    ]);
    const { threadServiceHttp } = await import("@/features/threads/ThreadServiceHttp");

    const result = await threadServiceHttp.getThreadSummaries(["root1", "root2"]);

    expect(result).toEqual([
      { rootMessageId: "root1", replyCount: 2, descendantCount: 3, lastReplyAt: null },
    ]);
    expect(apiRequestMock).toHaveBeenCalledWith("/api/messages/thread-summaries?ids=root1,root2");
  });

  it("getThreadSummaries short-circuits without calling the API for an empty id list", async () => {
    const { threadServiceHttp } = await import("@/features/threads/ThreadServiceHttp");

    const result = await threadServiceHttp.getThreadSummaries([]);

    expect(result).toEqual([]);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});
