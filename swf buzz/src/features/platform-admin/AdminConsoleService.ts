/**
 * Deployment-wide admin console (`/api/admin/v1/*`) — a SEPARATE role plane
 * (platform Operator/Moderator) and a SEPARATE host from the relay's own
 * community. See docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §11.
 *
 * All request/response shapes verified against ../buzz's own
 * `crates/buzz-relay/src/api/admin/mod.rs` (camelCase JSON throughout), not
 * guessed. This surface is optional — `config.adminUrl` is unset unless a
 * deployment actually exposes it (confirmed absent on this project's own
 * local dev relay: `GET /api/admin/v1/probe` 404s there — see
 * docs/KNOWN_LIMITATIONS.md for what this means for live verification).
 */
import { isTauri, invoke } from "@tauri-apps/api/core";
import { config } from "@/app/config";
import { buildNip98AuthHeader } from "@/services/nip98";
import { AppError } from "@/services/errors";
import type {
  AdminFeedback,
  AdminFeedbackDetail,
  AdminOperatorEntry,
  AdminProbeResult,
  AdminReport,
} from "@/types/domain";
import type { ResolutionAction } from "@/protocol/moderation";

function requireAdminUrl(): string {
  if (!config.adminUrl) {
    throw new AppError("not_found", "That item couldn't be found.");
  }
  return config.adminUrl;
}

class AdminConsoleService {
  isConfigured(): boolean {
    return !!config.adminUrl;
  }

  /**
   * One signed request. Two fixes over the first version:
   *  - the NIP-98 event now covers the exact BODY (`payload` tag) — the relay
   *    requires it on PATCH/POST/PUT (`api/admin/auth.rs:383-391`), so every
   *    mutation used to fail with 401;
   *  - in the desktop app the request is made from Rust (`admin_request`),
   *    because the relay refuses any `Origin` but the admin host's own and a
   *    webview always sends one (`api/admin/auth.rs:221-227`).
   */
  private async request<T>(
    path: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    body?: unknown,
  ): Promise<T> {
    const url = `${requireAdminUrl()}${path}`;
    const bodyText = body !== undefined ? JSON.stringify(body) : undefined;
    const authorization = await buildNip98AuthHeader(url, method, bodyText);
    let status: number;
    let text: string;
    if (isTauri()) {
      const response = await invoke<{ status: number; body: string }>("admin_request", {
        method,
        url,
        body: bodyText ?? null,
        authorization,
      });
      status = response.status;
      text = response.body;
    } else {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: authorization,
          ...(bodyText !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: bodyText,
      });
      status = response.status;
      text = await response.text();
    }
    if (status < 200 || status >= 300) {
      if (status === 401 || status === 403) {
        throw new AppError("permission_denied", "You don't have permission to do that.");
      }
      if (status === 404) {
        throw new AppError("not_found", "That item couldn't be found.");
      }
      throw new AppError(
        "network",
        "Can't reach the server right now. Check your connection and try again.",
      );
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  /** `GET /probe` — discovers auth mode, role, and available capabilities before rendering anything. */
  probe(): Promise<AdminProbeResult> {
    return this.request<AdminProbeResult>("/probe", "GET");
  }

  /** `GET /reports` — deployment-wide, cross-tenant. No `status` ⇒ escalated-only backstop. */
  listReports(options?: { status?: string; scope?: "all"; communityId?: string; limit?: number }): Promise<
    AdminReport[]
  > {
    const params = new URLSearchParams();
    if (options?.status) params.set("status", options.status);
    if (options?.scope) params.set("scope", options.scope);
    if (options?.communityId) params.set("communityId", options.communityId);
    if (options?.limit != null) params.set("limit", String(options.limit));
    const query = params.toString();
    return this.request<AdminReport[]>(query ? `/reports?${query}` : "/reports", "GET");
  }

  /** `POST /reports/{id}/resolve` — Operator or Moderator. */
  resolveReport(params: {
    id: string;
    action: ResolutionAction | "delete";
    requestId: string;
    expirationSecs?: number;
    reason?: string;
  }): Promise<unknown> {
    return this.request(`/reports/${params.id}/resolve`, "POST", {
      action: params.action,
      requestId: params.requestId,
      expirationSecs: params.expirationSecs,
      reason: params.reason,
    });
  }

  /** `POST /reports/{id}/reopen` — Operator or Moderator. Requires the report to be terminal. */
  reopenReport(params: { id: string; requestId: string; reason?: string }): Promise<unknown> {
    return this.request(`/reports/${params.id}/reopen`, "POST", {
      requestId: params.requestId,
      reason: params.reason,
    });
  }

  /** `POST /reports/{id}/cancel` — the only recovery path for a pre-mutation failed action. */
  cancelReport(params: { id: string; actionId: string }): Promise<unknown> {
    return this.request(`/reports/${params.id}/cancel`, "POST", { actionId: params.actionId });
  }

  /** `GET /feedback` — deployment-wide, no server-side filters. */
  listFeedback(): Promise<AdminFeedback[]> {
    return this.request<AdminFeedback[]>("/feedback", "GET");
  }

  /** `GET /feedback/{id}` — full body and every source tag (imeta attachments included). */
  getFeedback(id: string): Promise<AdminFeedbackDetail> {
    return this.request<AdminFeedbackDetail>(`/feedback/${encodeURIComponent(id)}`, "GET");
  }

  /**
   * `GET /feedback/{id}/attachments/{sha256}` — the ONLY way attachments are
   * read (never the tenant's `/media`). The relay serves everything but raster
   * images as a download, so the bytes are returned raw and the caller decides
   * what may render from the sniffed bytes (see feedbackAttachments.ts).
   */
  async fetchFeedbackAttachment(id: string, sha256: string): Promise<ArrayBuffer> {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new AppError("not_found", "That attachment couldn't be found.");
    const url = `${requireAdminUrl()}/feedback/${encodeURIComponent(id)}/attachments/${sha256}`;
    const authorization = await buildNip98AuthHeader(url, "GET");
    if (isTauri()) {
      return invoke<ArrayBuffer>("admin_fetch_bytes", { url, authorization });
    }
    const response = await fetch(url, { headers: { Authorization: authorization } });
    if (!response.ok) throw new AppError("not_found", "That attachment couldn't be loaded.");
    return response.arrayBuffer();
  }

  /** `PATCH /feedback/{id}` — any authenticated principal. */
  updateFeedbackStatus(id: string, status: "new" | "reviewed" | "archived"): Promise<unknown> {
    return this.request(`/feedback/${id}`, "PATCH", { status });
  }

  /** `GET /operators` — Operator only. */
  listOperators(): Promise<AdminOperatorEntry[]> {
    return this.request<AdminOperatorEntry[]>("/operators", "GET");
  }

  /** `PUT /operators/{pubkey}` — Operator only. 409 if the target is config-backed. */
  upsertOperator(pubkey: string, role: "operator" | "moderator"): Promise<unknown> {
    return this.request(`/operators/${pubkey}`, "PUT", { role });
  }

  /** `DELETE /operators/{pubkey}` — Operator only. 409 if it would remove the last operator. */
  deleteOperator(pubkey: string): Promise<unknown> {
    return this.request(`/operators/${pubkey}`, "DELETE");
  }
}

export const adminConsoleService = new AdminConsoleService();
