/**
 * Reactions — KIND_REACTION (7), NIP-25. docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §4.
 * Subscription quirk: reactions are only delivered filtered by #h, never a bare {kinds:[7]}.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import { KIND_REACTION } from "./kinds";
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

/** Reaction subscriptions must be scoped by channel — a bare {kinds:[7]} filter delivers nothing. */
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
