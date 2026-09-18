/**
 * Channel membership — put/remove user (9000/9001), self join/leave (9021/9022),
 * relay-authored admin/member lists (39001/39002). docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import type { Member } from "@/types/domain";
import {
  KIND_NIP29_GROUP_ADMINS,
  KIND_NIP29_GROUP_MEMBERS,
  KIND_NIP29_JOIN_REQUEST,
  KIND_NIP29_LEAVE_REQUEST,
  KIND_NIP29_PUT_USER,
  KIND_NIP29_REMOVE_USER,
} from "./kinds";
import { firstTagValue, type NostrFilter, type RawNostrEvent } from "./types";

export type MemberRole = "owner" | "admin" | "member";

export function buildPutUserEvent(params: {
  channelId: string;
  pubkey: string;
  role?: MemberRole;
}): UnsignedEvent {
  const tags: string[][] = [
    ["h", params.channelId],
    ["p", params.pubkey],
  ];
  if (params.role) tags.push(["role", params.role]);
  return { kind: KIND_NIP29_PUT_USER, content: "", tags };
}

export function buildRemoveUserEvent(params: { channelId: string; pubkey: string }): UnsignedEvent {
  return {
    kind: KIND_NIP29_REMOVE_USER,
    content: "",
    tags: [
      ["h", params.channelId],
      ["p", params.pubkey],
    ],
  };
}

/** Only succeeds server-side for open channels; the relay rejects private channels. */
export function buildJoinRequestEvent(channelId: string): UnsignedEvent {
  return { kind: KIND_NIP29_JOIN_REQUEST, content: "", tags: [["h", channelId]] };
}

export function buildLeaveRequestEvent(channelId: string): UnsignedEvent {
  return { kind: KIND_NIP29_LEAVE_REQUEST, content: "", tags: [["h", channelId]] };
}

/** Parses a relay-authored kind:39001 (admins, with roles) or kind:39002 (all members, no roles) event. */
export function parseMemberListEvent(event: RawNostrEvent): Member[] {
  const isAdminList = event.kind === KIND_NIP29_GROUP_ADMINS;
  return event.tags
    .filter((tag) => tag[0] === "p" && tag[1])
    .map((tag) => ({
      pubkey: tag[1],
      role: (isAdminList ? (tag[2] as MemberRole | undefined) : undefined) ?? "member",
    }));
}

export function memberListFilterForChannel(
  channelId: string,
  kind: typeof KIND_NIP29_GROUP_ADMINS | typeof KIND_NIP29_GROUP_MEMBERS,
): NostrFilter {
  return { kinds: [kind], "#d": [channelId], limit: 1 };
}

export function channelIdFromMemberListEvent(event: RawNostrEvent): string | undefined {
  return firstTagValue(event, "d");
}
