/**
 * Centralized environment configuration. No secrets live here — see
 * docs/SECURITY.md and .env.example for the full variable list.
 */

function readEnv(name: string, fallback?: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

export const config = {
  relayUrl: readEnv("VITE_RELAY_URL", import.meta.env.DEV ? "ws://localhost:3000" : undefined),
  oktaIssuer: import.meta.env.VITE_OKTA_ISSUER as string | undefined,
  oktaClientId: import.meta.env.VITE_OKTA_CLIENT_ID as string | undefined,
  /**
   * Base URL of the new `swf-buzz-backend` service (DECISIONS.md D10,
   * docs/BACKEND_SESSION_DESIGN.md) — the Application User / community /
   * channel / message / DM HTTP+realtime API, separate from the relay. Not
   * a secret: this is where the frontend sends its bearer session token,
   * never the token itself.
   */
  backendUrl: readEnv(
    "VITE_SWF_BACKEND_URL",
    import.meta.env.DEV ? "http://127.0.0.1:8787" : undefined,
  ).replace(/\/+$/, ""),
  environment:
    (import.meta.env.VITE_ENVIRONMENT as string | undefined) ??
    (import.meta.env.DEV ? "development" : "production"),
  /**
   * Base URL of the deployment-wide admin console (`/api/admin/v1/*`) — a
   * SEPARATE host from the relay's own WebSocket/HTTP origin (see
   * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §11). Optional: most
   * communities never expose this, and this deployment's own local dev relay
   * doesn't either (no `BUZZ_ADMIN_HOST` configured — confirmed by a 404 on
   * `/api/admin/v1/probe`). Absent ⇒ the Platform Admin UI stays hidden.
   */
  adminUrl: (import.meta.env.VITE_ADMIN_URL as string | undefined)?.replace(/\/+$/, "") || undefined,
};

/**
 * The relay's HTTP(S) base URL, derived from its WebSocket URL (ws→http,
 * wss→https) — used for NIP-98-authed reads (`/moderation/*`) that have no
 * WebSocket equivalent. Mirrors how ../buzz's own desktop client resolves its
 * relay HTTP origin from the same connection info.
 */
export function relayHttpUrl(): string {
  return config.relayUrl.replace(/^ws/, "http").replace(/\/+$/, "");
}

/**
 * `swf-buzz-backend`'s realtime `/ws` endpoint, derived from `config.backendUrl`
 * (http→ws, https→wss) — see `src/services/RealtimeService.ts`.
 */
export function backendWsUrl(): string {
  return config.backendUrl.replace(/^http/, "ws");
}
