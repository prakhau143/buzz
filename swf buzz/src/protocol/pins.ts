/**
 * Conversation pins — kind:40004 (`KIND_STREAM_MESSAGE_PINNED`).
 * docs/PHASE_G_PINNED_MESSAGES_EVERYONE.md §Protocol.
 *
 * One event shape for pin AND unpin, so the whole history of a conversation's
 * pin is one ordered stream that every client folds to the same answer
 * (`features/pins/pinModel.ts`):
 *
 *   kind 40004, content ""
 *   ["h", <channel or DM channel id>]   conversation (relay scopes + gates on it)
 *   ["e", <message id>]                 the message pinned / unpinned
 *   ["action", "pin" | "unpin"]
 *   ["author", <hex>]                   pin only: the message's author (a claim)
 *
 * Deliberately NO `p` tag: the relay indexes `p` tags into mentions
 * (`event_mentions`), so tagging the author would turn every pin into a
 * mention in their Inbox.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import { KIND_STREAM_MESSAGE_PINNED } from "./kinds";
import { firstTagValue, type RawNostrEvent } from "./types";

export type PinAction = "pin" | "unpin";

export interface PinEvent {
  id: string;
  conversationId: string;
  messageId: string;
  action: PinAction;
  /** Who published it — the relay verified the signature, so this is the actor. */
  actorPubkey: string;
  /** The pinned message's author as CLAIMED by the actor; verified when the message is known. */
  claimedAuthor: string | null;
  createdAt: number;
}

const HEX64 = /^[0-9a-f]{64}$/i;

export function buildPinEvent(params: {
  conversationId: string;
  messageId: string;
  action: PinAction;
  messageAuthor?: string | null;
}): UnsignedEvent {
  const tags: string[][] = [
    ["h", params.conversationId],
    ["e", params.messageId],
    ["action", params.action],
  ];
  if (params.action === "pin" && params.messageAuthor && HEX64.test(params.messageAuthor)) {
    tags.push(["author", params.messageAuthor.toLowerCase()]);
  }
  return { kind: KIND_STREAM_MESSAGE_PINNED, content: "", tags };
}

/** A well-formed pin/unpin event, or null — malformed events are ignored, never guessed at. */
export function parsePinEvent(event: RawNostrEvent): PinEvent | null {
  if (event.kind !== KIND_STREAM_MESSAGE_PINNED) return null;
  const conversationId = firstTagValue(event, "h");
  const messageId = firstTagValue(event, "e");
  const rawAction = firstTagValue(event, "action") ?? "pin";
  if (!conversationId || !messageId) return null;
  if (rawAction !== "pin" && rawAction !== "unpin") return null;
  const author = firstTagValue(event, "author");
  return {
    id: event.id,
    conversationId,
    messageId,
    action: rawAction,
    actorPubkey: event.pubkey.toLowerCase(),
    claimedAuthor: author && HEX64.test(author) ? author.toLowerCase() : null,
    createdAt: event.created_at,
  };
}
