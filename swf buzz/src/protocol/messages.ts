/**
 * Channel messages — KIND_STREAM_MESSAGE (9), read-side KIND_STREAM_MESSAGE_V2
 * (40002) and KIND_SYSTEM_MESSAGE (40099). docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §3.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import type { Message, ThreadMarkers } from "@/types/domain";
import { KIND_STREAM_MESSAGE, KIND_SYSTEM_MESSAGE, RENDERABLE_MESSAGE_KINDS } from "./kinds";
import { buildReplyTags, resolveThreadMarkersFromEvent } from "./nip10";
import { allTagValues, firstTagValue, type RawNostrEvent } from "./types";

export interface BuildMessageParams {
  channelId: string;
  content: string;
  /** Set when this message is a reply — the parent message's author and root markers. */
  reply?: { rootEventId: string; parentEventId: string; parentAuthorPubkey: string };
  /** Explicit @mentions inserted by the composer, distinct from the reply-notify pubkey. */
  mentionPubkeys?: string[];
}

/** Builds an unsigned kind:9 event — pass the result to SigningService.signEvent(). */
export function buildMessageEvent(params: BuildMessageParams): UnsignedEvent {
  const tags: string[][] = [["h", params.channelId]];

  if (params.reply) {
    tags.push(["p", params.reply.parentAuthorPubkey]);
  }
  for (const pubkey of params.mentionPubkeys ?? []) {
    tags.push(["p", pubkey]);
  }
  if (params.reply) {
    tags.push(
      ...buildReplyTags({
        rootEventId: params.reply.rootEventId,
        parentEventId: params.reply.parentEventId,
      }),
    );
  }

  return {
    kind: KIND_STREAM_MESSAGE,
    content: params.content,
    tags,
  };
}

export function isRenderableMessageKind(kind: number): boolean {
  return (RENDERABLE_MESSAGE_KINDS as readonly number[]).includes(kind);
}

export function isSystemMessageKind(kind: number): boolean {
  return kind === KIND_SYSTEM_MESSAGE;
}

/** Parses a raw kind:9/40002 event into the domain Message shape (reactions filled in separately). */
export function parseMessageEvent(event: RawNostrEvent): Message {
  const channelId = firstTagValue(event, "h") ?? "";
  const { rootId, parentId } = resolveThreadMarkersFromEvent(event);
  const thread: ThreadMarkers = { rootId, parentId };

  return {
    id: event.id,
    channelId,
    authorPubkey: event.pubkey,
    content: event.content,
    createdAt: event.created_at,
    thread,
    mentions: allTagValues(event, "p"),
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
  };
}

export interface SystemMessagePayload {
  type: string;
  [key: string]: unknown;
}

/** Parses a relay-authored kind:40099 system message. Never attribute this to a user. */
export function parseSystemMessageEvent(
  event: RawNostrEvent,
): { channelId: string; payload: SystemMessagePayload } | null {
  const channelId = firstTagValue(event, "h");
  if (!channelId) return null;
  try {
    const payload = JSON.parse(event.content) as SystemMessagePayload;
    return { channelId, payload };
  } catch {
    return null;
  }
}
