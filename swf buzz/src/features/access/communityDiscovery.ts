import { config } from "@/app/config";
import { buildNip98AuthHeader } from "@/services/nip98";
import {
  communities,
  forgetCommunity,
  relayHost,
  relayHttpBase,
} from "@/features/communities/relayCommunities";
import {
  parseRelayMembershipListEvent,
  relayMembershipListFilter,
  type RelayMemberRole,
} from "@/protocol/relayMembers";
import { resolveMyRole } from "@/features/community-members/permissions";
import type { RawNostrEvent } from "@/protocol/types";

/**
 * "Which communities does this identity belong to?" — answered by the relay, per
 * community, with a signed request.
 *
 * **What the relay can and cannot do.** A Buzz community is a tenant chosen by the
 * request `Host`, and the relay deliberately gives an unknown host a generic 404
 * so nobody can enumerate communities. There is therefore *no* endpoint that lists
 * every community a public key belongs to; membership can only be asked of a
 * community whose address is already known. The addresses come from where they
 * legitimately arrive — never from the user typing one:
 *
 *  1. the deployment's home relay (`config.relayUrl`, build configuration);
 *  2. communities this device already joined or created (the invite / connect link
 *     carried the address; it is remembered as an address book, nothing more).
 *
 * The address book grants nothing. Each entry is only a *candidate*: whether this
 * identity is a member, and in what role, is decided by the relay on every launch
 * (`POST /query`, NIP-98 signed with the local key, refused with 403 to a
 * non-member). A community that removed the person simply stops showing up.
 *
 * Known limit (documented in docs/PHASE_2_FINAL_AUDIT.md): a restored identity on a
 * brand-new device has an empty address book, so it needs one link (invite or
 * connect) before its memberships can be found — unless the home relay is one.
 */

export interface Membership {
  relayUrl: string;
  host: string;
  /** A display label. The relay stores none, so this is the saved label, else the host. */
  name: string;
  /**
   * `null` = the relay let this identity in but did not say what their role is
   * (no roster snapshot yet, or they are not named in it). NOT the same as
   * "member", and deliberately not collapsed into it — see `probeMembership`.
   * The authoritative role is resolved later, per community, by
   * `identitySession.ts` after NIP-42.
   */
  role: RelayMemberRole | null;
}

export type ProbeOutcome =
  /** Allowed in. `role` is `null` when the relay published no role for them. */
  | { status: "member"; role: RelayMemberRole | null }
  | { status: "not_member" }
  /** The relay has no community at this address — a stale address-book entry. */
  | { status: "gone" }
  | { status: "unreachable" };

const PROBE_TIMEOUT_MS = 8_000;

/** Ask one community whether the signing identity is a member (and its role). */
export async function probeMembership(relayUrl: string, pubkey: string): Promise<ProbeOutcome> {
  const url = `${relayHttpBase(relayUrl)}/query`;
  const body = JSON.stringify([relayMembershipListFilter()]);
  let response: Response;
  try {
    const authorization = await buildNip98AuthHeader(url, "POST", body);
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return { status: "unreachable" };
  }

  if (response.status === 404) {
    // The relay has no community at that address at all (it answers 404 to an
    // unknown Host so communities cannot be enumerated). The address book entry
    // is stale — a community that was deleted, renamed, or never existed here —
    // so it is forgotten rather than re-probed on every sign-in.
    return { status: "gone" };
  }
  if (response.status === 401 || response.status === 403) {
    // Not a member (or blocked). The community exists; keep the address.
    return { status: "not_member" };
  }
  if (!response.ok) return { status: "unreachable" };

  let events: unknown;
  try {
    events = await response.json();
  } catch {
    return { status: "unreachable" };
  }
  const list = Array.isArray(events) ? (events as RawNostrEvent[]) : [];
  // Allowed in. The role comes from the relay's roster snapshot — and when
  // there is no snapshot, or this pubkey is not named in it, the honest answer
  // is "unknown", NOT "member".
  //
  // This used to return `role ?? "member"`. The relay only publishes a kind:13534
  // snapshot after a community's first membership change, so on a freshly
  // provisioned community that fallback labelled the actual OWNER as a member —
  // and it contradicted identitySession.ts, which correctly stores `null` for
  // the same unresolved state. Two code paths, two answers to one question.
  const newest = list.length ? list.reduce((a, b) => (b.created_at > a.created_at ? b : a)) : null;
  const role = newest ? resolveMyRole(parseRelayMembershipListEvent(newest), pubkey) : null;
  return { status: "member", role };
}

/** Community addresses worth asking about, in a stable order, without duplicates. */
export function candidateRelays(): { relayUrl: string; name: string }[] {
  const seen = new Set<string>();
  const out: { relayUrl: string; name: string }[] = [];
  const add = (relayUrl: string, name?: string) => {
    if (seen.has(relayUrl)) return;
    seen.add(relayUrl);
    out.push({ relayUrl, name: name?.trim() || relayHost(relayUrl) });
  };
  for (const saved of communities.value) add(saved.relayUrl, saved.name);
  add(config.relayUrl);
  return out;
}

export interface DiscoveryResult {
  memberships: Membership[];
  /** Candidates that could not be asked (offline, timeout, server error). */
  unreachable: string[];
  /** Addresses the relay does not know — removed from the address book. */
  gone: string[];
  /** How many candidates were asked. */
  asked: number;
}

/** Ask every candidate community, in parallel, and keep those that say "member". */
export async function discoverMemberships(pubkey: string): Promise<DiscoveryResult> {
  const candidates = candidateRelays();
  const outcomes = await Promise.all(
    candidates.map(async (candidate) => ({ candidate, outcome: await probeMembership(candidate.relayUrl, pubkey) })),
  );
  const memberships: Membership[] = [];
  const unreachable: string[] = [];
  const gone: string[] = [];
  for (const { candidate, outcome } of outcomes) {
    if (outcome.status === "member") {
      memberships.push({
        relayUrl: candidate.relayUrl,
        host: relayHost(candidate.relayUrl),
        name: candidate.name,
        role: outcome.role,
      });
    } else if (outcome.status === "unreachable") {
      unreachable.push(candidate.relayUrl);
    } else if (outcome.status === "gone") {
      gone.push(candidate.relayUrl);
    }
  }
  // Forget addresses the relay says do not exist. Without this, a community
  // that was deleted (e.g. by a development reset) is re-probed on every
  // sign-in forever, producing a 404 per stale host in the console. The home
  // relay is never forgotten — it is build configuration, not an address-book
  // entry, and may simply not be provisioned yet.
  for (const relayUrl of gone) {
    if (relayUrl !== config.relayUrl) forgetCommunity(relayUrl);
  }
  return { memberships, unreachable, gone, asked: candidates.length };
}
