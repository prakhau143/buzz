/**
 * Reactions — KIND_REACTION (7), NIP-25. docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §4.
 *
 * Channel scoping is VIRTUAL for this kind: the client publishes only an `e`
 * tag, the relay derives and stores the channel from the target, and a `#h`
 * filter is matched server-side against that stored channel — the kind:7 event
 * itself never carries an `h` tag. The client must therefore not re-apply `#h`
 * against literal tags (nostr-tools does by default; see
 * `matchesAllowingVirtualChannelTag` in services/RelayConnectionService.ts —
 * without it every delivered reaction was dropped, docs/PHASE_3_IMPLEMENTATION_AUDIT.md §19).
 */
import type { UnsignedEvent } from "@/features/signing/types";
import { KIND_DELETION, KIND_REACTION } from "./kinds";
import { firstTagValue, type NostrFilter, type RawNostrEvent } from "./types";

const MAX_PLAIN_EMOJI_LENGTH = 64;

export interface BuildReactionParams {
  targetEventId: string;
  emoji: string;
  /** Required when `emoji` is a `:shortcode:` custom-emoji form. */
  customEmojiUrl?: string;
}

/** Builds an unsigned kind:7 event. Client adds only an `e` tag — the server derives the channel. */
export function buildReactionEvent(params: BuildReactionParams): UnsignedEvent {
  const tags: string[][] = [["e", params.targetEventId]];
  const isShortcode = params.emoji.length > MAX_PLAIN_EMOJI_LENGTH;
  if (isShortcode) {
    if (!params.customEmojiUrl) {
      throw new Error("Custom emoji reactions require customEmojiUrl for the emoji tag.");
    }
    const shortcode = params.emoji.replace(/^:|:$/g, "").toLowerCase();
    tags.push(["emoji", shortcode, params.customEmojiUrl]);
  }
  return { kind: KIND_REACTION, content: params.emoji, tags };
}

/**
 * Builds an unsigned kind:5 (NIP-09) deletion targeting one of MY OWN
 * reaction (kind:7) events, identified by its own event id — not the
 * message it reacted to. The relay enforces self-authorship server-side.
 */
export function buildRemoveReactionEvent(reactionEventId: string): UnsignedEvent {
  return { kind: KIND_DELETION, content: "", tags: [["e", reactionEventId]] };
}

export interface ParsedReactionEvent {
  id: string;
  targetEventId: string;
  reactorPubkey: string;
  emoji: string;
  createdAt: number;
}

export function parseReactionEvent(event: RawNostrEvent): ParsedReactionEvent | null {
  const targetEventId = [...event.tags]
    .reverse()
    .find((tag) => tag[0] === "e" && /^[0-9a-f]{64}$/i.test(tag[1] ?? ""))?.[1];
  if (!targetEventId) return null;
  return {
    id: event.id,
    targetEventId,
    reactorPubkey: event.pubkey,
    emoji: event.content,
    createdAt: event.created_at,
  };
}

/** Reaction subscriptions are scoped by channel — served from the relay's derived channel (see file header). */
export function buildReactionFilter(channelId: string): NostrFilter {
  return { kinds: [KIND_REACTION], "#h": [channelId] };
}

export function reactionEmojiLabel(event: Pick<RawNostrEvent, "content" | "tags">): {
  emoji: string;
  emojiUrl?: string;
} {
  if (event.content.length > MAX_PLAIN_EMOJI_LENGTH) {
    const emojiUrl = firstTagValue(event, "emoji")
      ? event.tags.find((t) => t[0] === "emoji")?.[2]
      : undefined;
    return { emoji: event.content, emojiUrl };
  }
  return { emoji: event.content };
}
