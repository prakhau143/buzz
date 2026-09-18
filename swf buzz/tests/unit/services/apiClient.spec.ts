import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn(() => true);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("ApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe("getStoredSessionToken / clearStoredSessionToken", () => {
    it("reads the whitelisted swf_session_token key via secure_storage_get", async () => {
      invokeMock.mockResolvedValueOnce("raw-token-123");
      const { getStoredSessionToken } = await import("@/services/ApiClient");

      const token = await getStoredSessionToken();

      expect(token).toBe("raw-token-123");
      expect(invokeMock).toHaveBeenCalledWith("secure_storage_get", { key: "swf_session_token" });
    });

    it("returns null outside the Tauri runtime without calling invoke", async () => {
      isTauriMock.mockReturnValue(false);
      const { getStoredSessionToken } = await import("@/services/ApiClient");

      const token = await getStoredSessionToken();

      expect(token).toBeNull();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it("clearStoredSessionToken deletes the same key", async () => {
      invokeMock.mockResolvedValueOnce(undefined);
      const { clearStoredSessionToken } = await import("@/services/ApiClient");

      await clearStoredSessionToken();

      expect(invokeMock).toHaveBeenCalledWith("secure_storage_delete", { key: "swf_session_token" });
    });
  });

  describe("apiRequest", () => {
    it("attaches the stored bearer token to the Authorization header", async () => {
      invokeMock.mockResolvedValueOnce("stored-token");
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      const { apiRequest } = await import("@/services/ApiClient");

      await apiRequest("/api/session");

      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer stored-token");
    });

    it("prefers an explicitly passed token over the stored one", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 200 }));
      const { apiRequest } = await import("@/services/ApiClient");

      await apiRequest("/api/session", { token: "explicit-token" });

      expect(invokeMock).not.toHaveBeenCalled();
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer explicit-token");
    });

    it("on 401, clears the stored token and throws an auth_required AppError", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
      const { apiRequest } = await import("@/services/ApiClient");

      // Matched against a plain object, not `new AppError(...)`: the real
      // call legitimately passes the response body text as `cause` (for
      // logging), and AppError's constructor always sets `this.cause`, so
      // comparing against a constructed instance would implicitly require
      // `cause` to be `undefined` too and fail on that unrelated detail.
      await expect(apiRequest("/api/session", { token: "dead-token" })).rejects.toMatchObject({
        code: "auth_required",
        message: "Please sign in to continue.",
      });
      expect(invokeMock).toHaveBeenCalledWith("secure_storage_delete", { key: "swf_session_token" });
    });

    it("maps other non-2xx statuses to the matching AppError code", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response("nope", { status: 403 }));
      const { apiRequest } = await import("@/services/ApiClient");

      await expect(apiRequest("/api/communities/x/members", { token: "t" })).rejects.toMatchObject({
        code: "permission_denied",
      });
    });

    it("surfaces a fetch/network failure as an AppError with code network", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const { apiRequest } = await import("@/services/ApiClient");

      await expect(apiRequest("/api/session", { token: "t" })).rejects.toMatchObject({
        code: "network",
      });
    });

    it("sends the JSON body and Content-Type for a POST with a body", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 200 }));
      const { apiRequest } = await import("@/services/ApiClient");

      await apiRequest("/api/dm/open", { method: "POST", body: { user_ids: ["a", "b"] }, token: "t" });

      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(init?.body).toBe(JSON.stringify({ user_ids: ["a", "b"] }));
    });
  });

  describe("getSession", () => {
    it("requests GET /api/session against the configured backend URL", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            expires_at: "2026-01-01T00:00:00Z",
            user: { id: "u1", okta_sub: "sub1", email: "a@b.com", display_name: "A B" },
          }),
          { status: 200 },
        ),
      );
      const { getSession } = await import("@/services/ApiClient");

      const info = await getSession("t");

      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toContain("/api/session");
      expect(info.user.okta_sub).toBe("sub1");
    });
  });
});
