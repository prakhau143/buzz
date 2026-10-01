/**
 * Operator community provisioning — the relay's own operator API.
 *
 *   GET  /operator/communities/availability?host=…   (probe: 200 only for an operator)
 *   POST /operator/communities  { host, initial_owner_pubkey, create_only: true }
 *
 * (crates/buzz-relay/src/api/operator.rs, handlers/community_provisioning.rs)
 *
 * A "community" on the Buzz relay is a tenant selected by HTTP `Host`; only a
 * deployment *operator* — a pubkey in the relay's `RELAY_OPERATOR_PUBKEYS` — may
 * create one, and creating it names its first owner. This service does not decide
 * who is an operator: it signs the request with the local identity (NIP-98) and
 * the relay accepts or refuses. "Am I an operator?" is therefore answered by the
 * server, never assumed by the client.
 *
 * The owner pubkey is just data: `create_only` bootstraps a `relay_members` owner
 * row for that key. It authenticates nobody — that owner must still prove
 * possession of the matching private key through NIP-42 to enter.
 *
 * OPERATOR ≠ OWNER (docs/SWF_ROLE_MODEL.md). An operator is deployment-level
 * authority proven by NIP-98 on `/operator/*`; an owner is a role inside one
 * community proven by NIP-42. Creating a community gives the operator no membership
 * in it. Provisioning is **always `create_only: true`**: the relay's default mode
 * would let an operator-signed request rotate an existing community's owner, so that
 * mode is deliberately not reachable from this app.
 */
import { nip19 } from "nostr-tools";
import { buildNip98Auth } from "@/services/nip98";
import { diagnostics } from "@/stores/diagnostics";
import { buildConnectLink } from "./RelayInviteService";
import { relayHttpBase } from "./relayCommunities";

const REQUEST_TIMEOUT_MS = 15_000;
// Any syntactically valid host works; it is only used to see whether the relay
// lets us past its operator check (it answers 403 before looking at the host).
const PROBE_HOST = "operator-probe.invalid";

export type OperatorErrorKind =
  | "forbidden"
  | "exists"
  | "limit"
  | "invalid"
  | "not_enabled"
  | "unauthenticated"
  | "network"
  | "unknown";

export class OperatorError extends Error {
  constructor(
    readonly kind: OperatorErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OperatorError";
  }
}

/** The origin the relay verifies operator NIP-98 events against (`RELAY_OPERATOR_API_ORIGIN`). */
export function operatorOrigin(relayWsUrl: string): string {
  const override = (import.meta.env.VITE_OPERATOR_API_ORIGIN as string | undefined)?.trim();
  return (override || relayHttpBase(relayWsUrl)).replace(/\/+$/, "");
}

/** 64-char hex, or an `npub1…` decoded to hex; `null` if it is neither. */
export function parseOwnerPubkey(input: string): string | null {
  const text = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) return text.toLowerCase();
  if (/^npub1[0-9a-z]+$/i.test(text)) {
    try {
      const decoded = nip19.decode(text.toLowerCase());
      return decoded.type === "npub" ? decoded.data : null;
    } catch {
      return null;
    }
  }
  return null;
}

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/;

/**
 * The relay wants a normalised bare authority (lowercase, no scheme/path). Returns
 * `null` for anything else instead of guessing.
 */
export function normaliseCommunityHost(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^(?:https?|wss?):\/\//, "")
    .replace(/\/+$/, "");
  return host && host.length <= 255 && HOST_RE.test(host) ? host : null;
}

/** `acme.example.com` + an https origin → `wss://acme.example.com` (http → ws). */
export function relayUrlForHost(host: string, origin: string): string {
  return `${origin.startsWith("https") ? "wss" : "ws"}://${host}`;
}

function mapFailure(status: number, message: string | undefined): OperatorError {
  const text = message ?? "";
  if (status === 401) return new OperatorError("unauthenticated", "Sign in with your identity first.");
  if (status === 403) {
    return new OperatorError("forbidden", "This identity isn't a community operator on this server.", text);
  }
  if (status === 409 && text.startsWith("limit_reached")) {
    return new OperatorError("limit", "That owner already has the maximum number of communities.", text);
  }
  if (status === 409) return new OperatorError("exists", "A community already exists at that address.", text);
  if (status === 400) return new OperatorError("invalid", text || "The server rejected that request.", text);
  if (status === 500 && /origin is not configured/i.test(text)) {
    return new OperatorError("not_enabled", "Community creation isn't enabled on this server.", text);
  }
  return new OperatorError("unknown", "Something went wrong creating the community.", { status, text });
}

async function signedRequest(
  method: "GET" | "POST",
  url: string,
  body?: string,
): Promise<{ status: number; json: Record<string, unknown>; signerPubkey: string }> {
  let authorization: string;
  let signerPubkey: string;
  try {
    ({ header: authorization, signerPubkey } = await buildNip98Auth(url, method, body));
  } catch (cause) {
    throw new OperatorError("unauthenticated", "Sign in with your identity first.", cause);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: authorization,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const err = new OperatorError("network", "Can't reach the server. Check the address and your connection.", cause);
    (err as OperatorError & { signerPubkey?: string }).signerPubkey = signerPubkey;
    throw err;
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, json, signerPubkey };
}

/** The raw answer to the operator probe — what the relay said, and who signed the question. */
export interface OperatorProbe {
  /** HTTP status, or `null` when the request never completed. */
  status: number | null;
  /** Pubkey on the signed NIP-98 event; `null` only when signing itself failed. */
  signerPubkey: string | null;
  error: OperatorErrorKind | null;
  origin: string;
}

export interface OwnedCommunity {
  communityId: string;
  host: string;
  relayUrl: string;
}

export interface CreatedCommunity {
  communityId: string;
  host: string;
  ownerPubkey: string;
  relayUrl: string;
  /** `swfbuzz://connect?relay=…` — lets the owner add the community and sign in. */
  connectLink: string;
}

class OperatorService {
  /**
   * True only when the relay accepts this identity as an operator. Any refusal
   * or failure is "no" — the button stays hidden, and the relay still enforces
   * the real check on every creation.
   */
  async isOperator(relayWsUrl: string): Promise<boolean> {
    return (await this.probeOperator(relayWsUrl)).status === 200;
  }

  /**
   * The operator probe with its evidence: the HTTP status the relay answered and
   * the pubkey that signed the NIP-98 event. `isOperator` is `status === 200`;
   * this form exists so the sign-in path can verify that the signer is the
   * identity being signed in (an identity mismatch is an error, not "403") and
   * so the diagnostics panel can show the real exchange. Never throws.
   *
   * `forPubkey` is only recorded for diagnostics — the relay decides by the
   * signature, not by what the client believes.
   */
  async probeOperator(relayWsUrl: string, forPubkey: string | null = null): Promise<OperatorProbe> {
    const origin = operatorOrigin(relayWsUrl);
    const url = `${origin}/operator/communities/availability?host=${encodeURIComponent(PROBE_HOST)}`;
    let probe: OperatorProbe;
    try {
      const { status, signerPubkey } = await signedRequest("GET", url);
      probe = { status, signerPubkey, error: null, origin };
    } catch (err) {
      const kind = err instanceof OperatorError ? err.kind : "unknown";
      const signerPubkey =
        err instanceof OperatorError ? ((err as OperatorError & { signerPubkey?: string }).signerPubkey ?? null) : null;
      probe = { status: null, signerPubkey, error: kind, origin };
    }
    diagnostics()?.recordOperatorProbe({
      forPubkey,
      signerPubkey: probe.signerPubkey,
      status: probe.status,
      error: probe.error,
      origin,
      at: Date.now(),
    });
    return probe;
  }

  /**
   * The communities where `ownerPubkey` currently holds the owner role —
   * `GET /operator/communities?owner_pubkey=…`, operator-only. The relay has no
   * "list every community" call, so this is the Operator's view of what they own.
   */
  async listOwnedCommunities(relayWsUrl: string, ownerPubkey: string): Promise<OwnedCommunity[]> {
    const origin = operatorOrigin(relayWsUrl);
    const url = `${origin}/operator/communities?owner_pubkey=${encodeURIComponent(ownerPubkey)}`;
    const { status, json } = await signedRequest("GET", url);
    if (status < 200 || status >= 300) {
      throw mapFailure(status, typeof json.error === "string" ? json.error : undefined);
    }
    const rows = Array.isArray(json.communities) ? (json.communities as Record<string, unknown>[]) : [];
    return rows
      .filter((row) => typeof row.host === "string" && !row.archived_at)
      .map((row) => ({
        communityId: String(row.community_id),
        host: row.host as string,
        relayUrl: relayUrlForHost(row.host as string, origin),
      }));
  }

  async createCommunity(
    relayWsUrl: string,
    params: { host: string; ownerPubkey: string },
  ): Promise<CreatedCommunity> {
    const host = normaliseCommunityHost(params.host);
    if (!host) {
      throw new OperatorError(
        "invalid",
        "Enter the community's address, like acme.example.com (lowercase letters, numbers, dots, hyphens, optional :port).",
      );
    }
    const owner = parseOwnerPubkey(params.ownerPubkey);
    if (!owner) {
      throw new OperatorError("invalid", "The owner must be a 64-character hex public key or an npub1… address.");
    }

    const origin = operatorOrigin(relayWsUrl);
    // create_only: atomically create the host and its owner, and refuse (rather
    // than silently rotate ownership of) a host that already exists.
    const body = JSON.stringify({ host, initial_owner_pubkey: owner, create_only: true });
    const { status, json } = await signedRequest("POST", `${origin}/operator/communities`, body);
    if (status < 200 || status >= 300) {
      throw mapFailure(status, typeof json.error === "string" ? json.error : undefined);
    }
    const created = json as { community_id: string; host: string; owner_pubkey?: string };
    const relayUrl = relayUrlForHost(created.host, origin);
    return {
      communityId: created.community_id,
      host: created.host,
      ownerPubkey: created.owner_pubkey ?? owner,
      relayUrl,
      connectLink: buildConnectLink(relayUrl),
    };
  }
}

export const operatorService = new OperatorService();
