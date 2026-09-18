/**
 * Thin HTTP client for `swf-buzz-backend` (DECISIONS.md D10,
 * docs/BACKEND_SESSION_DESIGN.md). Bearer-token auth, not a cookie — see the
 * design doc for why (the Okta token exchange happens in the Tauri Rust
 * process, not this webview, so a `Set-Cookie` response there would never
 * reach `fetch()` here). The token itself lives only in the OS keychain via
 * `secure_storage_*` Tauri commands (`StorageKey::SwfSessionToken`,
 * `src-tauri/src/commands/secure_storage.rs`) — this module never persists
 * it anywhere else (no localStorage/sessionStorage/in-memory cache that
 * outlives a single request), and never logs it.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@tauri-apps/api/core";
import { config } from "@/app/config";
import { AppError, logError } from "./errors";

const SESSION_TOKEN_KEY = "swf_session_token";

/** Wire shape from `GET /api/session` / `POST /api/session/bootstrap` — see `backend/src/routes/session.rs::UserView`. */
export interface ApplicationUserDto {
  id: string;
  okta_sub: string;
  email: string | null;
  display_name: string | null;
}

export interface SessionInfoDto {
  expires_at: string;
  user: ApplicationUserDto;
}

/**
 * Only meaningful in the Tauri runtime — the browser dev/preview build has
 * no OS keychain to read from, and its Okta flow (`oktaAuthServiceBrowser`)
 * is a separate, still-Nostr-based path this phase does not touch. Callers
 * outside Tauri should treat "no token" as the permanent answer, not an
 * error.
 */
export async function getStoredSessionToken(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>("secure_storage_get", { key: SESSION_TOKEN_KEY });
  } catch (err) {
    logError("ApiClient.getStoredSessionToken", err);
    return null;
  }
}

export async function clearStoredSessionToken(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("secure_storage_delete", { key: SESSION_TOKEN_KEY });
  } catch (err) {
    logError("ApiClient.clearStoredSessionToken", err);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Sent as a query string param instead of the Authorization header — only `/ws` needs this (browsers can't set headers on a WebSocket handshake). Every ordinary HTTP call should leave this unset. */
  token?: string;
}

/**
 * Every non-2xx response is normalized into an `AppError` here — callers
 * never need to branch on raw HTTP status codes. A 401 additionally clears
 * the stored token, since it means the backend has independently decided
 * this session is no longer valid (expired or revoked) — holding onto a
 * dead token would just fail identically on every future call.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = options.token ?? (await getStoredSessionToken());
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${config.backendUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    throw new AppError("network", "Can't reach the Buzz server right now. Please try again.", err);
  }

  if (response.status === 401) {
    await clearStoredSessionToken();
    throw new AppError(
      "auth_required",
      "Please sign in to continue.",
      await safeText(response),
      response.status,
    );
  }
  if (response.status === 403) {
    throw new AppError(
      "permission_denied",
      "You don't have permission to do that.",
      await safeText(response),
      response.status,
    );
  }
  if (response.status === 404) {
    throw new AppError(
      "not_found",
      "That item couldn't be found.",
      await safeText(response),
      response.status,
    );
  }
  if (!response.ok) {
    throw new AppError(
      "relay_rejected",
      "That action wasn't accepted by the server.",
      await safeText(response),
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** `GET /api/session` — used both for the initial silent-resume check at app start and for any later "am I still logged in" check. */
export function getSession(token?: string): Promise<SessionInfoDto> {
  return apiRequest<SessionInfoDto>("/api/session", { token });
}

export function logoutSession(): Promise<void> {
  return apiRequest<void>("/api/session/logout", { method: "POST" });
}
