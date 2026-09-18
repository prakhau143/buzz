/**
 * Typing indicators — KIND_TYPING_INDICATOR (20002), ephemeral, thread-scoped.
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §6. Also doubles as the fallback
 * "agent is working" signal when kind:24200 observer frames aren't available.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import { KIND_TYPING_INDICATOR } from "./kinds";
import { buildReplyTags } from "./nip10";
import { firstTagValue, type NostrFilter, type RawNostrEvent } from "./types";

/** Client-side throttle window, matching the reference implementation. */
export const TYPING_THROTTLE_MS = 3000;

export interface BuildTypingIndicatorParams {
  channelId: string;
  thread?: { rootEventId: string; parentEventId: string };
}

export function buildTypingIndicatorEvent(params: BuildTypingIndicatorParams): UnsignedEvent {
  const tags: string[][] = [["h", params.channelId]];
  if (params.thread) {
    tags.push(...buildReplyTags(params.thread));
  }
  return { kind: KIND_TYPING_INDICATOR, content: "", tags };
}

export function buildTypingFilter(channelId: string): NostrFilter {
  return { kinds: [KIND_TYPING_INDICATOR], "#h": [channelId] };
}

export interface ParsedTypingEvent {
  pubkey: string;
  channelId: string;
  rootEventId?: string;
  parentEventId?: string;
  createdAt: number;
}

export function parseTypingIndicatorEvent(event: RawNostrEvent): ParsedTypingEvent | null {
  const channelId = firstTagValue(event, "h");
  if (!channelId) return null;
  const eTags = event.tags.filter((t) => t[0] === "e");
  const rootTag = eTags.find((t) => t[3] === "root");
  const replyTag = eTags.find((t) => t[3] === "reply");
  return {
    pubkey: event.pubkey,
    channelId,
    rootEventId: rootTag?.[1] ?? replyTag?.[1],
    parentEventId: replyTag?.[1],
    createdAt: event.created_at,
  };
}
