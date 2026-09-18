/**
 * Thread marker resolution — mirrors buzz/crates/buzz-core/src/nip10.rs
 * exactly (docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §9). Do not diverge from
 * this resolution rule; the relay validates against server-computed ancestry
 * built the same way.
 */
import type { RawNostrEvent } from "./types";

const HEX64 = /^[0-9a-f]{64}$/i;

export interface RawThreadMarkers {
  root?: string;
  reply?: string;
}

/** Extracts root/reply markers from an event's `e` tags (last valid occurrence of each marker wins). */
export function extractThreadMarkers(tags: string[][]): RawThreadMarkers {
  const markers: RawThreadMarkers = {};
  for (const tag of tags) {
    if (tag[0] !== "e" || tag.length < 4) continue;
    const [, eventId, , marker] = tag;
    if (!eventId || !HEX64.test(eventId)) continue;
    if (marker === "root") markers.root = eventId;
    else if (marker === "reply") markers.reply = eventId;
  }
  return markers;
}

/**
 * Resolves (rootId, replyToId) from raw markers:
 * - root + reply both present → nested reply: (root, reply)
 * - reply only → direct reply to root: (reply, reply)
 * - root only, or neither → not a reply (top-level message)
 */
export function resolveThreadMarkers(markers: RawThreadMarkers): {
  rootId?: string;
  parentId?: string;
} {
  if (markers.root && markers.reply) {
    return { rootId: markers.root, parentId: markers.reply };
  }
  if (markers.reply) {
    return { rootId: markers.reply, parentId: markers.reply };
  }
  return {};
}

export function resolveThreadMarkersFromEvent(event: Pick<RawNostrEvent, "tags">): {
  rootId?: string;
  parentId?: string;
} {
  return resolveThreadMarkers(extractThreadMarkers(event.tags));
}

/**
 * Builds the `e` reply tags for a new message, per `buildReplyTags`
 * (desktop/src/features/messages/lib/threading.ts:101-128).
 */
export function buildReplyTags(params: { rootEventId: string; parentEventId: string }): string[][] {
  const { rootEventId, parentEventId } = params;
  if (parentEventId === rootEventId) {
    return [["e", rootEventId, "", "reply"]];
  }
  return [
    ["e", rootEventId, "", "root"],
    ["e", parentEventId, "", "reply"],
  ];
}
