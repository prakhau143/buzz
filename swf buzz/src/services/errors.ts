/**
 * Single normalization boundary for errors surfaced to the UI.
 * Raw Rust/Tauri error strings and protocol/relay errors must be converted
 * here rather than shown to the user directly.
 */

export type AppErrorCode =
  | "network"
  | "relay_rejected"
  | "auth_required"
  | "auth_failed"
  | "signing_failed"
  | "not_found"
  | "permission_denied"
  | "unknown";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly cause?: unknown;
  /**
   * The raw HTTP status, when this AppError came from `ApiClient.apiRequest`
   * (undefined for errors constructed elsewhere). `AppErrorCode` is coarse
   * on purpose (one shared taxonomy across every feature), but a few flows
   * — invite claim/preview in particular — need to distinguish e.g. 409
   * (usage limit reached) from 410 (expired/revoked) to show the right
   * message, and both currently map to the same `relay_rejected` code. This
   * field lets a caller branch on the precise status without widening the
   * shared taxonomy for a need only one feature has.
   */
  readonly status?: number;

  constructor(code: AppErrorCode, message: string, cause?: unknown, status?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.cause = cause;
    this.status = status;
  }
}

const USER_FACING_MESSAGES: Record<AppErrorCode, string> = {
  network: "Can't reach the server right now. Check your connection and try again.",
  relay_rejected: "That action wasn't accepted by the server.",
  auth_required: "Please sign in to continue.",
  auth_failed: "Sign-in failed. Please try again.",
  signing_failed: "Couldn't sign that action. Please try again.",
  not_found: "That item couldn't be found.",
  permission_denied: "You don't have permission to do that.",
  unknown: "Something went wrong. Please try again.",
};

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof Error) {
    return new AppError("unknown", USER_FACING_MESSAGES.unknown, error);
  }

  if (typeof error === "string") {
    return new AppError("unknown", USER_FACING_MESSAGES.unknown, error);
  }

  return new AppError("unknown", USER_FACING_MESSAGES.unknown, error);
}

/**
 * Every `new AppError(code, message, ...)` call site in this codebase
 * deliberately authors `message` as a safe, specific, user-facing string
 * (raw/internal detail goes in the third `cause` argument instead, which
 * only `logError` ever touches) — e.g. "Okta isn't configured for this
 * build yet. Ask an admin, or use Development Mode." This must win over
 * the generic per-code fallback below, or every one of those specific
 * messages is silently replaced with boilerplate before the user ever sees
 * it. The fallback exists only for the `AppError`s `toAppError()` itself
 * constructs from a raw, non-`AppError` value, where `.message` is already
 * `USER_FACING_MESSAGES.unknown` — so this still degrades safely for a
 * genuinely unrecognized error.
 */
export function userMessageFor(error: unknown): string {
  const appError = toAppError(error);
  return appError.message || USER_FACING_MESSAGES[appError.code] || USER_FACING_MESSAGES.unknown;
}

/** Developer-facing diagnostic log — never pass secrets/keys/tokens here. */
export function logError(context: string, error: unknown): void {
  const appError = toAppError(error);
  console.error(`[${context}]`, appError.code, appError.message, appError.cause);
}
