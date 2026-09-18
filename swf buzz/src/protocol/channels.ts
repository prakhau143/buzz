/**
 * Channel metadata — create (9007), edit (9002), relay-authored discovery (39000).
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §1.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import type { Channel, ChannelType, ChannelVisibility } from "@/types/domain";
import {
  KIND_NIP29_CREATE_GROUP,
  KIND_NIP29_EDIT_METADATA,
  KIND_NIP29_GROUP_METADATA,
} from "./kinds";
import { allTagValues, firstTagValue, type NostrFilter, type RawNostrEvent } from "./types";

export interface CreateChannelParams {
  name: string;
  visibility?: ChannelVisibility;
  channelType?: ChannelType;
  about?: string;
}

export function buildCreateChannelEvent(params: CreateChannelParams): UnsignedEvent {
  const tags: string[][] = [["name", params.name]];
  if (params.visibility) tags.push(["visibility", params.visibility]);
  if (params.channelType) tags.push(["channel_type", params.channelType]);
  if (params.about) tags.push(["about", params.about]);
  return { kind: KIND_NIP29_CREATE_GROUP, content: "", tags };
}

export interface EditChannelParams {
  channelId: string;
  name?: string;
  about?: string;
  topic?: string;
  purpose?: string;
  visibility?: ChannelVisibility;
  /** Seconds, or "" to clear an existing TTL. */
  ttl?: string;
}

export function buildEditChannelEvent(params: EditChannelParams): UnsignedEvent {
  const tags: string[][] = [["h", params.channelId]];
  if (params.name !== undefined) tags.push(["name", params.name]);
  if (params.about !== undefined) tags.push(["about", params.about]);
  if (params.topic !== undefined) tags.push(["topic", params.topic]);
  if (params.purpose !== undefined) tags.push(["purpose", params.purpose]);
  if (params.visibility !== undefined) tags.push(["visibility", params.visibility]);
  if (params.ttl !== undefined) tags.push(["ttl", params.ttl]);
  return { kind: KIND_NIP29_EDIT_METADATA, content: "", tags };
}

export function buildChannelDiscoveryFilter(): NostrFilter {
  return { kinds: [KIND_NIP29_GROUP_METADATA] };
}

/** Parses a relay-authored kind:39000 discovery event into the domain Channel shape. */
export function parseChannelEvent(event: RawNostrEvent): Channel | null {
  const id = firstTagValue(event, "d");
  const name = firstTagValue(event, "name");
  if (!id || !name) return null;

  const isPrivate = event.tags.some((t) => t[0] === "private");
  const isDm = event.tags.some((t) => t[0] === "hidden") || firstTagValue(event, "t") === "dm";

  return {
    id,
    name,
    about: firstTagValue(event, "about"),
    topic: firstTagValue(event, "topic"),
    visibility: isPrivate ? "private" : "open",
    channelType: (firstTagValue(event, "t") as ChannelType | undefined) ?? "stream",
    archived: event.tags.some((t) => t[0] === "archived" && t[1] === "true"),
    dmParticipants: isDm ? allTagValues(event, "p") : undefined,
  };
}
