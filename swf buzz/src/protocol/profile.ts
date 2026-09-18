/** Standard NIP-01 profile metadata (kind:0). Agent-ness is layered on top — see protocol/agents.ts. */
import type { UserProfile } from "@/types/domain";
import { KIND_PROFILE_METADATA } from "./kinds";
import type { NostrFilter, RawNostrEvent } from "./types";

export function buildProfileFilter(pubkeys: string[]): NostrFilter {
  return { kinds: [KIND_PROFILE_METADATA], authors: pubkeys };
}

interface ProfileContent {
  name?: string;
  display_name?: string;
  picture?: string;
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
    isAgent,
  };
}
