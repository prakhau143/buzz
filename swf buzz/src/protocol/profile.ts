/** Standard NIP-01 profile metadata (kind:0). Agent-ness is layered on top — see protocol/agents.ts. */
import type { UserProfile } from "@/types/domain";
import type { UnsignedEvent } from "@/features/signing/types";
import { KIND_PROFILE_METADATA } from "./kinds";
import type { NostrFilter, RawNostrEvent } from "./types";

export function buildProfileFilter(pubkeys: string[]): NostrFilter {
  return { kinds: [KIND_PROFILE_METADATA], authors: pubkeys };
}

/**
 * The schema version this client writes.
 *
 * v2 adds `designation` (a job title) and makes name + designation + picture
 * required. Bumping the version is what lets the app tell "this person filled
 * in a v1 profile years ago" apart from "this person has no profile", so an
 * existing profile can be upgraded rather than ignored or deleted.
 *
 * `profile_version` and `designation` are SWF extensions to kind:0. OLD BUZZ
 * writes neither (docs/PHASE_4_OLD_BUZZ_PROTOCOL_AUDIT.md §6.2). Unknown JSON
 * keys are ignored by every other client, so this is additive and backward
 * compatible in both directions: an older client still reads name/picture/about,
 * and a profile written by one is simply treated here as v1/incomplete.
 */
export const CURRENT_PROFILE_VERSION = 2;

interface ProfileContent {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  designation?: string;
  profile_version?: number;
}

export function parseProfileEvent(event: RawNostrEvent, isAgent = false): UserProfile {
  let content: ProfileContent = {};
  try {
    content = JSON.parse(event.content) as ProfileContent;
  } catch {
    // Malformed profile content — fall back to a pubkey-derived display name below.
  }
  return {
    pubkey: event.pubkey,
    displayName: content.display_name || content.name || event.pubkey.slice(0, 8),
    avatarUrl: content.picture,
    about: content.about,
    designation: typeof content.designation === "string" ? content.designation : undefined,
    // A profile with no version predates versioning: that is v1, not "unknown".
    profileVersion: typeof content.profile_version === "number" ? content.profile_version : 1,
    isAgent,
  };
}

export interface ProfileFields {
  displayName: string;
  /** Job title, e.g. "Solutions Architect". NOT the community role. */
  designation?: string;
  about?: string;
  /** An https image URL (Blossom media URL, or any https image). */
  picture?: string;
}

/**
 * Unsigned kind:0 for the signed-in identity. Content shape matches the reference
 * desktop (`events.rs::build_profile`): `display_name`, `name`, `about`, `picture`.
 * The event's pubkey is whoever signs it — the local identity — so a profile is
 * bound to a public key and never to an email or account.
 */
export function buildProfileEvent(fields: ProfileFields): UnsignedEvent {
  const displayName = fields.displayName.trim();
  const content: Record<string, string | number> = {
    display_name: displayName,
    name: displayName,
    profile_version: CURRENT_PROFILE_VERSION,
  };
  const designation = fields.designation?.trim();
  if (designation) content.designation = designation;
  const about = fields.about?.trim();
  if (about) content.about = about;
  const picture = fields.picture?.trim();
  if (picture) content.picture = picture;
  return { kind: KIND_PROFILE_METADATA, content: JSON.stringify(content), tags: [] };
}

/**
 * Whether `picture` is safe to store: an absolute https URL (or empty).
 *
 * Plain `http` is also accepted for LOOPBACK hosts only. The relay hands back
 * the URL of whatever it just stored, and a local development relay serves
 * `http://…localhost:3000/media/…` — so requiring https unconditionally
 * rejected the very photo the user had successfully uploaded a moment earlier.
 * The point of the rule is to keep a profile from carrying a `javascript:` or
 * `data:` payload, or an image fetched insecurely across a network; neither
 * concern applies to a loopback address, and no real deployment uses one.
 */
export function isAcceptablePictureUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/** `localhost`, any `*.localhost` subdomain (the relay's tenant hosts), and the loopback IPs. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}
