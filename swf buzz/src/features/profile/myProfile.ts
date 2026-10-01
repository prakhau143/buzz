import { buildNip98AuthHeader } from "@/services/nip98";
import { signAndPublish } from "@/services/publish";
import { relayHttpBase, activeRelayUrl, communities } from "@/features/communities/relayCommunities";
import { useAccessStore } from "@/stores/access";
import { useSessionStore } from "@/stores/session";
import { KIND_PROFILE_METADATA } from "@/protocol/kinds";
import { CURRENT_PROFILE_VERSION, type ProfileFields } from "@/protocol/profile";
import { AppError } from "@/services/errors";
import type { RawNostrEvent } from "@/protocol/types";
import { absorbProfileEvents, profileEventFor } from "./profileStore";
import { rememberProfileEvent } from "./identityProfile";

/**
 * The signed-in identity's own profile: the ONE write path.
 *
 * Contract ("universal" as far as it can honestly go): kind:0 is relay-local,
 * so a profile is universal across the SWF communities THIS identity belongs
 * to — it is published to the open community, then replicated verbatim to every
 * other membership, and re-replicated into any community entered later that
 * holds an older copy (profileSync.ts). It is not, and is not claimed to be,
 * synchronized to arbitrary external Nostr relays.
 */

/**
 * Build the new kind:0 content by MERGING into the newest existing one.
 *
 * `buildProfileEvent` rebuilt the content from scratch, so every save silently
 * dropped fields SWF does not edit (nip05, website, banner, lud16, ...) — the
 * same data loss OLD BUZZ has (audit §3.2). Here only the edited keys change.
 * A field cleared in the editor is removed, not written as "".
 */
export function mergeProfileContent(previous: RawNostrEvent | null, fields: ProfileFields): string {
  let base: Record<string, unknown> = {};
  if (previous) {
    try {
      const parsed = JSON.parse(previous.content) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed as Record<string, unknown>;
    } catch {
      // Unreadable old content: start clean rather than propagate garbage.
    }
  }
  const next: Record<string, unknown> = { ...base };
  const displayName = fields.displayName.trim();
  next.display_name = displayName;
  next.name = displayName;
  next.profile_version = CURRENT_PROFILE_VERSION;
  const setOrDrop = (key: string, value: string | undefined) => {
    if (value === undefined) return; // not edited: keep whatever was there
    const trimmed = value.trim();
    if (trimmed) next[key] = trimmed;
    else delete next[key];
  };
  setOrDrop("designation", fields.designation);
  setOrDrop("about", fields.about);
  setOrDrop("picture", fields.picture);
  return JSON.stringify(next);
}

/** Strictly after the previous version, so a save can never lose to the event it replaces. */
export function nextProfileCreatedAt(previous: RawNostrEvent | null, now = Math.floor(Date.now() / 1000)): number {
  return previous ? Math.max(now, previous.created_at + 1) : now;
}

export interface ReplicationResult {
  relayUrl: string;
  ok: boolean;
  error?: string;
}

export interface SaveProfileResult {
  event: RawNostrEvent;
  /** Every OTHER community it was pushed to (the open one already accepted it). */
  replication: Promise<ReplicationResult[]>;
}

/**
 * Save my profile: publish to the open community (awaited — the save only
 * succeeds when the relay accepted it), make it canonical everywhere in the UI
 * immediately, remember it locally, then replicate to my other communities.
 */
export async function saveMyProfile(fields: ProfileFields): Promise<SaveProfileResult> {
  const me = useSessionStore().pubkey;
  if (!me) throw new AppError("auth_required", "Sign in to edit your profile.");
  if (!fields.displayName.trim()) throw new AppError("unknown", "A display name is required.");
  const previous = profileEventFor(me);
  const signed = (await signAndPublish({
    kind: KIND_PROFILE_METADATA,
    content: mergeProfileContent(previous, fields),
    tags: previous?.tags.filter((t) => t[0] !== "alt") ?? [],
    created_at: nextProfileCreatedAt(previous),
  })) as unknown as RawNostrEvent;
  absorbProfileEvents([signed]);
  rememberProfileEvent(signed);
  return { event: signed, replication: replicateToMyCommunities(signed) };
}

/** Where my profile must exist: every confirmed membership (else the address book), minus the open one. */
export function replicationTargets(): string[] {
  const memberships = useAccessStore().memberships.map((m) => m.relayUrl);
  const known = memberships.length ? memberships : communities.value.map((c) => c.relayUrl);
  const active = activeRelayUrl.value;
  return [...new Set(known)].filter((url) => url && url !== active);
}

/**
 * Push an already-signed kind:0, verbatim, to one community over the relay's
 * HTTP publish endpoint `POST /events` (NIP-98). The previous code posted to
 * `/event` — a route the relay does not have — and never looked at the answer,
 * so replication had never worked. Now the status is checked and reported.
 */
export async function replicateProfileTo(relayUrl: string, event: RawNostrEvent): Promise<ReplicationResult> {
  const url = `${relayHttpBase(relayUrl)}/events`;
  const body = JSON.stringify(event);
  try {
    const authorization = await buildNip98AuthHeader(url, "POST", body);
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) return { relayUrl, ok: true };
    const reason = response.status === 403 ? "not a member there" : `HTTP ${response.status}`;
    return { relayUrl, ok: false, error: reason };
  } catch (err) {
    return { relayUrl, ok: false, error: err instanceof Error ? err.message : "unreachable" };
  }
}

export async function replicateToMyCommunities(event: RawNostrEvent): Promise<ReplicationResult[]> {
  return Promise.all(replicationTargets().map((relayUrl) => replicateProfileTo(relayUrl, event)));
}
