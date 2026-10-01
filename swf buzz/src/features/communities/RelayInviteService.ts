/**
 * Relay invites — OLD BUZZ behaviour, reused as-is.
 *
 *   POST /api/invites        mint   — NIP-98, relay checks the caller is owner/admin
 *   POST /api/invites/claim  claim  — NIP-98 by the *joining* key; exempt from the
 *                                     membership gate (the joiner is not a member yet)
 *
 * (crates/buzz-relay/src/api/invites.rs, desktop/src/shared/api/invites.ts)
 *
 * Both are authenticated by a NIP-98 event signed with the local identity —
 * there is no session, no Okta, and no user id in a request body: the relay
 * derives the caller from the signature. An invite is an opaque random secret
 * (`v2.<43 chars>`); it contains no key, and claiming it only ever grants the
 * `member` role (the relay pins invite roles to `member`).
 *
 * The relay's own returned `url` (`https://host/invite/<code>`) opens a page that
 * hands off to the reference app's `buzz://` scheme, so SWF never uses it: it
 * builds a `swfbuzz://` link from the code instead.
 */
import { buildNip98AuthHeader } from "@/services/nip98";
import { relayHttpBase, relayHost } from "./relayCommunities";

const REQUEST_TIMEOUT_MS = 15_000;

/** Relay bounds (`buzz-core/src/invite.rs`): 60 s – 30 d, 1 – 10 000 uses. */
export const MIN_INVITE_TTL_SECS = 60;
export const MAX_INVITE_TTL_SECS = 30 * 24 * 60 * 60;
export const DEFAULT_INVITE_TTL_SECS = 72 * 60 * 60;
export const MAX_INVITE_USES = 10_000;

export type InviteErrorKind =
  | "invalid"
  | "expired"
  | "exhausted"
  | "policy_required"
  | "rate_limited"
  | "forbidden"
  | "unauthenticated"
  | "network"
  | "unknown";

/** An invite failure with a user-safe message and a kind the UI can branch on. */
export class InviteError extends Error {
  constructor(
    readonly kind: InviteErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "InviteError";
  }
}

const MESSAGES: Record<InviteErrorKind, string> = {
  invalid: "This invite isn't valid. Check the link, or ask for a new one.",
  expired: "This invite has expired. Ask for a new one.",
  exhausted: "This invite has reached its use limit. Ask for a new one.",
  policy_required:
    "This community requires accepting its terms before joining, which SWF Buzz doesn't support yet.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  forbidden: "Only a community owner or admin can create invites.",
  unauthenticated: "Sign in with your identity first.",
  network: "Can't reach the community server. Check the address and your connection.",
  unknown: "Something went wrong with that invite. Please try again.",
};

/** Map the relay's response (`{"error": "<code>"}` + HTTP status) to an {@link InviteError}. */
export function inviteErrorFrom(status: number, relayError: string | undefined): InviteError {
  const kind = ((): InviteErrorKind => {
    if (relayError === "invite_invalid") return "invalid";
    if (relayError === "invite_expired") return "expired";
    if (relayError === "invite_exhausted") return "exhausted";
    if (relayError === "join_policy_required") return "policy_required";
    if (status === 429) return "rate_limited";
    if (status === 401) return "unauthenticated";
    if (status === 403) return "forbidden";
    return "unknown";
  })();
  return new InviteError(kind, MESSAGES[kind], { status, relayError });
}

export interface CreatedRelayInvite {
  code: string;
  /** Unix seconds. */
  expiresAt: number;
  maxUses: number | null;
  usesRemaining: number | null;
  /** The shareable `swfbuzz://` link. */
  link: string;
}

export type ClaimStatus = "joined" | "already_member";

export interface ClaimResult {
  status: ClaimStatus;
  communityId: string;
  host: string;
  role: string;
}

/**
 * Optional, **unverified** details the link's author can add so the invitee sees
 * something friendlier than a server address. The relay knows neither (it only
 * verifies the code), so the receiving screen labels them "from the link".
 */
export interface JoinLinkHints {
  communityName?: string;
  /** The inviter's public key, 64-char lowercase hex. */
  invitedBy?: string;
}

/**
 * `swfbuzz://join/<code>?relay=<ws url>[&name=…][&by=<pubkey hex>]` — the format the
 * desktop deep-link handler parses. The relay address has to be in the link:
 * the relay picks the community from its host, so a code alone can't be claimed.
 */
export function buildJoinLink(relayWsUrl: string, code: string, hints: JoinLinkHints = {}): string {
  const params = new URLSearchParams({ relay: relayWsUrl });
  const name = hints.communityName?.trim();
  if (name) params.set("name", name);
  if (hints.invitedBy && /^[0-9a-f]{64}$/.test(hints.invitedBy)) params.set("by", hints.invitedBy);
  return `swfbuzz://join/${encodeURIComponent(code)}?${params.toString()}`;
}

/**
 * `swfbuzz://connect?relay=<ws url>[&name=…]` — hands a person the *address* of a
 * community they already belong to (an owner named at creation, or someone an
 * owner added by public key). It carries no secret and no code: the relay still
 * asks their private key for proof (NIP-42) and checks its own member list.
 */
export function buildConnectLink(relayWsUrl: string, hints: Pick<JoinLinkHints, "communityName"> = {}): string {
  const params = new URLSearchParams({ relay: relayWsUrl });
  const name = hints.communityName?.trim();
  if (name) params.set("name", name);
  return `swfbuzz://connect?${params.toString()}`;
}

async function signedPost<T>(relayWsUrl: string, path: string, body: string): Promise<T> {
  const url = `${relayHttpBase(relayWsUrl)}${path}`;
  let authorization: string;
  try {
    authorization = await buildNip98AuthHeader(url, "POST", body);
  } catch (cause) {
    throw new InviteError("unauthenticated", MESSAGES.unauthenticated, cause);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new InviteError("network", MESSAGES.network, cause);
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw inviteErrorFrom(response.status, typeof json.error === "string" ? json.error : undefined);
  }
  return json as T;
}

class RelayInviteService {
  /**
   * Mint an invite on `relayWsUrl`'s community. The relay checks that the
   * signer is an owner/admin there (403 otherwise).
   */
  async createInvite(
    relayWsUrl: string,
    options: { ttlSecs?: number; maxUses?: number; hints?: JoinLinkHints } = {},
  ): Promise<CreatedRelayInvite> {
    const { ttlSecs, maxUses, hints } = options;
    if (ttlSecs !== undefined && (ttlSecs < MIN_INVITE_TTL_SECS || ttlSecs > MAX_INVITE_TTL_SECS)) {
      throw new InviteError("unknown", "The expiry must be between 1 minute and 30 days.");
    }
    if (maxUses !== undefined && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_INVITE_USES)) {
      throw new InviteError("unknown", `Max uses must be a whole number from 1 to ${MAX_INVITE_USES}.`);
    }
    const body = JSON.stringify({
      ...(ttlSecs !== undefined ? { ttl_secs: ttlSecs } : {}),
      ...(maxUses !== undefined ? { max_uses: maxUses } : {}),
    });
    const dto = await signedPost<{
      code: string;
      expires_at: number;
      max_uses: number | null;
      uses_remaining: number | null;
    }>(relayWsUrl, "/api/invites", body);
    return {
      code: dto.code,
      expiresAt: dto.expires_at,
      maxUses: dto.max_uses ?? null,
      usesRemaining: dto.uses_remaining ?? null,
      link: buildJoinLink(relayWsUrl, dto.code, hints),
    };
  }

  /**
   * Claim an invite. Idempotent: an existing member gets `already_member`.
   * Signed by the joining key; works before membership exists.
   */
  async claimInvite(relayWsUrl: string, code: string, policyReceipt?: string): Promise<ClaimResult> {
    const body = JSON.stringify({ code, ...(policyReceipt ? { policy_receipt: policyReceipt } : {}) });
    const dto = await signedPost<{
      status: ClaimStatus;
      community_id: string;
      host: string;
      role: string;
    }>(relayWsUrl, "/api/invites/claim", body);
    return { status: dto.status, communityId: dto.community_id, host: dto.host, role: dto.role };
  }
}

export const relayInviteService = new RelayInviteService();

// ── Pasted invites ────────────────────────────────────────────────────────

const CODE_RE = /^[A-Za-z0-9._~-]{1,256}$/;

export interface ParsedInvite {
  relay: string;
  code: string;
  policyReceipt?: string;
  /** Unverified label from the link. */
  communityName?: string;
  /** Unverified inviter public key (hex) from the link. */
  invitedBy?: string;
}

/** Normalises a ws(s) URL to `ws(s)://host[:port]`; `null` if it isn't a plain relay address. */
export function normaliseRelayUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * What a pasted string turned out to be.
 *
 * A CONNECTION link is called out separately from "unrecognised" because it is
 * the single most likely wrong paste: a community's owner is handed
 * `swfbuzz://connect?relay=…` at creation time, and the only obvious box to put
 * a link in is "Join with invite". Refusing it is right — it carries no invite
 * code and cannot grant membership — but answering "that doesn't look like an
 * invite" makes a perfectly valid link look broken. Naming it lets the UI say
 * what it actually is and what to do with it.
 */
export type InviteInputKind =
  | { kind: "invite"; invite: ParsedInvite }
  | { kind: "connection"; relay: string; communityName?: string }
  | { kind: "unrecognised" };

/** Classify a pasted string. `parseInviteInput` is the invite-only shorthand. */
export function classifyInviteInput(input: string, defaultRelay: string | null): InviteInputKind {
  const text = input.trim();
  if (!text) return { kind: "unrecognised" };

  if (/^swfbuzz:/i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { kind: "unrecognised" };
    }
    if (url.hostname.toLowerCase() === "connect") {
      const relay = normaliseRelayUrl(url.searchParams.get("relay") ?? "");
      if (!relay) return { kind: "unrecognised" };
      const name = url.searchParams.get("name")?.trim();
      return {
        kind: "connection",
        relay,
        ...(name && name.length <= 80 ? { communityName: name } : {}),
      };
    }
  }

  const invite = parseInviteInput(text, defaultRelay);
  return invite ? { kind: "invite", invite } : { kind: "unrecognised" };
}

/**
 * Understands what a person might paste into "Join with invite":
 *  - a `swfbuzz://join?relay=…&code=…` link (or `swfbuzz://join/<code>?relay=…`)
 *  - the relay's own `https://host/invite/<code>` page URL (relay + code recovered from it)
 *  - a bare `v2.…` code, joined to `defaultRelay` (the community you are looking at)
 * Anything else is rejected rather than guessed — including a `swfbuzz://connect`
 * link, which is an address, not an invite (see `classifyInviteInput`).
 */
export function parseInviteInput(input: string, defaultRelay: string | null): ParsedInvite | null {
  const text = input.trim();
  if (!text) return null;

  if (/^swfbuzz:/i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.hostname.toLowerCase() !== "join") return null;
    const relay = normaliseRelayUrl(url.searchParams.get("relay") ?? "");
    const code = url.searchParams.get("code") ?? url.pathname.split("/").find(Boolean) ?? "";
    if (!relay || !CODE_RE.test(code)) return null;
    const receipt = url.searchParams.get("policy_receipt") ?? undefined;
    const name = url.searchParams.get("name")?.trim();
    const by = url.searchParams.get("by") ?? "";
    return {
      relay,
      code,
      ...(receipt ? { policyReceipt: receipt } : {}),
      ...(name && name.length <= 80 ? { communityName: name } : {}),
      ...(/^[0-9a-f]{64}$/.test(by) ? { invitedBy: by } : {}),
    };
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const match = /^\/invite\/([^/]+)\/?$/.exec(url.pathname);
      if (!match || !CODE_RE.test(match[1])) return null;
      const relay = normaliseRelayUrl(`${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`);
      return relay ? { relay, code: match[1] } : null;
    } catch {
      return null;
    }
  }

  if (CODE_RE.test(text) && defaultRelay) {
    const relay = normaliseRelayUrl(defaultRelay);
    return relay ? { relay, code: text } : null;
  }
  return null;
}

/** Human-readable community label for a relay URL. */
export function describeRelay(relayWsUrl: string): string {
  return relayHost(relayWsUrl);
}
