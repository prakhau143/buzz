/**
 * Control-plane helpers for reading feedback.
 *
 * ROLE — derived, never trusted. The feedback row records the submitter's
 * pubkey and the community (from the connection's host), but no role
 * (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md §15.7), and the SWF client
 * deliberately sends none: a role claimed by a client proves nothing. The
 * role is derived here from the community's own RELAY-SIGNED membership
 * snapshot (NIP-43 kind 13534), read over that community's NIP-98 `/query`.
 * That read is authorized by membership, so it succeeds only for communities
 * the reviewing operator belongs to; otherwise the role is shown as
 * "not verifiable" — never guessed. (A relay-side join would remove that
 * limit; OLD BUZZ's relay is out of scope for SWF changes.)
 *
 * ATTACHMENTS — decided by the BYTES, never by the sender's claimed MIME:
 * raster images and verified MP4 video render inline; the diagnostics text
 * renders as plain text; anything else is a download.
 */
import { buildNip98AuthHeader } from "@/services/nip98";
import { parseRelayMembershipListEvent } from "@/protocol/relayMembers";
import { KIND_NIP43_MEMBERSHIP_LIST, KIND_PROFILE_METADATA } from "@/protocol/kinds";
import { parseProfileEvent } from "@/protocol/profile";
import type { RawNostrEvent } from "@/protocol/types";

export type DerivedRole = "owner" | "admin" | "member" | "not-a-member";

export interface SubmitterInsight {
  role: DerivedRole | null;
  /** True only when the role came from the relay-signed snapshot. */
  verified: boolean;
  displayName: string | null;
  note?: string;
}

function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return name === "localhost" || name.endsWith(".localhost") || name === "127.0.0.1" || name === "[::1]";
}

export function communityHttpBase(host: string): string {
  return `${isLocalHost(host) ? "http" : "https"}://${host}`;
}

/** Pure: the role a relay-signed snapshot gives `pubkey`. */
export function roleFromSnapshot(snapshot: RawNostrEvent | undefined, pubkey: string): DerivedRole | null {
  if (!snapshot) return null;
  const members = parseRelayMembershipListEvent(snapshot);
  const match = members.find((m) => m.pubkey === pubkey);
  return (match?.role as DerivedRole | undefined) ?? "not-a-member";
}

export async function deriveSubmitterInsight(communityHost: string | null, pubkey: string): Promise<SubmitterInsight> {
  if (!communityHost) {
    return { role: null, verified: false, displayName: null, note: "The community no longer exists." };
  }
  const url = `${communityHttpBase(communityHost)}/query`;
  const body = JSON.stringify([
    { kinds: [KIND_NIP43_MEMBERSHIP_LIST], limit: 1 },
    { kinds: [KIND_PROFILE_METADATA], authors: [pubkey], limit: 1 },
  ]);
  try {
    const authorization = await buildNip98AuthHeader(url, "POST", body);
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) {
      return { role: null, verified: false, displayName: null, note: "You're not a member of this community, so its roles can't be read." };
    }
    if (!response.ok) return { role: null, verified: false, displayName: null, note: `Community unavailable (HTTP ${response.status}).` };
    const events = (await response.json()) as RawNostrEvent[];
    const newest = (kind: number) =>
      events.filter((e) => e.kind === kind).reduce<RawNostrEvent | undefined>((a, b) => (!a || b.created_at > a.created_at ? b : a), undefined);
    const snapshot = newest(KIND_NIP43_MEMBERSHIP_LIST);
    const profile = events.find((e) => e.kind === KIND_PROFILE_METADATA && e.pubkey === pubkey);
    const role = roleFromSnapshot(snapshot, pubkey);
    return {
      role,
      verified: role !== null,
      displayName: profile ? parseProfileEvent(profile).displayName : null,
      note: role === null ? "This community publishes no membership list (open community)." : undefined,
    };
  } catch {
    return { role: null, verified: false, displayName: null, note: "Couldn't reach the community." };
  }
}

// ---------------------------------------------------------------------------
// Attachments

export interface FeedbackAttachmentRef {
  sha256: string;
  claimedMime: string;
  filename: string | null;
  size: number | null;
}

export function feedbackAttachments(tags: string[][]): FeedbackAttachmentRef[] {
  return tags
    .filter((t) => t[0] === "imeta")
    .map((t) => {
      const fields = new Map<string, string>();
      for (const entry of t.slice(1)) {
        const space = entry.indexOf(" ");
        if (space > 0) fields.set(entry.slice(0, space), entry.slice(space + 1));
      }
      return {
        sha256: (fields.get("x") ?? "").toLowerCase(),
        claimedMime: fields.get("m") ?? "application/octet-stream",
        filename: fields.get("filename") ?? null,
        size: fields.has("size") ? Number(fields.get("size")) : null,
      };
    })
    .filter((a) => /^[0-9a-f]{64}$/.test(a.sha256));
}

export type SniffedKind =
  | { kind: "image"; mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp" }
  | { kind: "video"; mime: "video/mp4" }
  | { kind: "text" }
  | { kind: "file" };

/** Classify by magic bytes. */
export function sniffAttachment(bytes: Uint8Array): SniffedKind {
  const b = bytes;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") return { kind: "image", mime: "image/png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", mime: "image/jpeg" };
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return { kind: "image", mime: "image/gif" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { kind: "image", mime: "image/webp" };
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && ascii(8, 12) !== "qt  ") return { kind: "video", mime: "video/mp4" };
  if (looksLikeText(b)) return { kind: "text" };
  return { kind: "file" };
}

function looksLikeText(b: Uint8Array): boolean {
  if (b.length === 0 || b.length > 64 * 1024) return false;
  for (const byte of b) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) return false;
  }
  return true;
}
