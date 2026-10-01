/**
 * Channel messages — KIND_STREAM_MESSAGE (9), read-side KIND_STREAM_MESSAGE_V2
 * (40002) and KIND_SYSTEM_MESSAGE (40099). docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §3.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import type { Message, ThreadMarkers } from "@/types/domain";
import {
  KIND_DELETION,
  KIND_NIP29_DELETE_EVENT,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_SYSTEM_MESSAGE,
  RENDERABLE_MESSAGE_KINDS,
} from "./kinds";
import { buildReplyTags, resolveThreadMarkersFromEvent } from "./nip10";
import { attachmentMarkdown, buildImetaTag, parseImetaTags, type Attachment } from "./imeta";
import { allTagValues, firstTagValue, type RawNostrEvent } from "./types";

export interface BuildMessageParams {
  channelId: string;
  content: string;
  /** Set when this message is a reply — the parent message's author and root markers. */
  reply?: { rootEventId: string; parentEventId: string; parentAuthorPubkey: string };
  /** Explicit @mentions inserted by the composer, distinct from the reply-notify pubkey. */
  mentionPubkeys?: string[];
  /** Uploaded attachments — emitted as NIP-92 `imeta` tags and referenced in content. */
  attachments?: Attachment[];
  /** A semantic `@everyone` (channel messages only) — emits `EVERYONE_MENTION_TAG`. */
  mentionsEveryone?: boolean;
}

/** Mention `p` tags per event — OLD BUZZ `events.rs` `MAX_MENTIONS`. */
const MAX_MENTION_TAGS = 50;

/**
 * The semantic `@everyone` mention (docs/PHASE_G_PINNED_MESSAGES_EVERYONE.md
 * §@everyone). Audience mentions have no representation in the relay or in
 * OLD BUZZ, so this is SWF's one canonical form: a two-element tag that no
 * relay or NIP gives another meaning (verified: no "mention" tag anywhere in
 * ../buzz/crates). The literal text `@everyone` alone is NEVER a mention —
 * only text plus this tag is, exactly like a person mention is text plus `p`.
 * Multi-letter, so the relay does not index it: recipients are resolved by each
 * reader from its own (already access-checked) subscriptions, with no fan-out.
 */
export const EVERYONE_MENTION_TAG = ["mention", "everyone"] as const;

export function hasEveryoneMentionTag(event: Pick<RawNostrEvent, "tags">): boolean {
  return event.tags.some((t) => t[0] === EVERYONE_MENTION_TAG[0] && t[1] === EVERYONE_MENTION_TAG[1]);
}

/**
 * `["p", hex]` tags for the given pubkeys: lowercase, one per identity, capped
 * — OLD BUZZ `events.rs` `mention_tags`. A reply's parent author who is also
 * @mentioned is one recipient, not two tags.
 */
function mentionTags(pubkeys: readonly string[], alreadyTagged: Set<string>): string[][] {
  const tags: string[][] = [];
  for (const raw of pubkeys) {
    const pubkey = raw.trim().toLowerCase();
    if (!pubkey || alreadyTagged.has(pubkey)) continue;
    if (tags.length >= MAX_MENTION_TAGS) break;
    alreadyTagged.add(pubkey);
    tags.push(["p", pubkey]);
  }
  return tags;
}

/** Builds an unsigned kind:9 event — pass the result to SigningService.signEvent(). */
export function buildMessageEvent(params: BuildMessageParams): UnsignedEvent {
  const tags: string[][] = [["h", params.channelId]];
  const tagged = new Set<string>();

  if (params.reply) {
    const parent = params.reply.parentAuthorPubkey.toLowerCase();
    tagged.add(parent);
    tags.push(["p", parent]);
  }
  tags.push(...mentionTags(params.mentionPubkeys ?? [], tagged));
  if (params.mentionsEveryone) tags.push([...EVERYONE_MENTION_TAG]);
  if (params.reply) {
    tags.push(
      ...buildReplyTags({
        rootEventId: params.reply.rootEventId,
        parentEventId: params.reply.parentEventId,
      }),
    );
  }

  const attachments = params.attachments ?? [];
  for (const attachment of attachments) {
    tags.push(buildImetaTag(attachment));
  }

  // The URL also goes in the content, as OLD BUZZ does
  // (`media_upload.dart:224-234`): a client that does not parse `imeta` would
  // otherwise render an attachment-only message as blank.
  const references = attachments.map(attachmentMarkdown).join("\n");
  const content = [params.content.trim(), references].filter(Boolean).join("\n\n");

  return {
    kind: KIND_STREAM_MESSAGE,
    content,
    tags,
  };
}

/**
 * Builds an unsigned kind:40003 edit of `targetEventId`.
 *
 * Tag shape mirrors OLD BUZZ's own client exactly
 * (`desktop/src-tauri/src/events.rs:359` `build_message_edit`): `h` = channel,
 * `e` = target. The relay additionally requires the edit's channel to match the
 * target's, so `channelId` must be the channel the target lives in.
 */
export function buildMessageEditEvent(params: {
  channelId: string;
  targetEventId: string;
  content: string;
  mentionPubkeys?: string[];
  /** Keeps an original `@everyone` semantic across the edit (the text must still say it). */
  mentionsEveryone?: boolean;
}): UnsignedEvent {
  const tags: string[][] = [
    ["h", params.channelId],
    ["e", params.targetEventId],
  ];
  tags.push(...mentionTags(params.mentionPubkeys ?? [], new Set()));
  if (params.mentionsEveryone) tags.push([...EVERYONE_MENTION_TAG]);
  return { kind: KIND_STREAM_MESSAGE_EDIT, content: params.content, tags };
}

/**
 * Builds an unsigned deletion of `targetEventId`.
 *
 * `mode: "self"` emits kind:5 (NIP-09 retraction, gated purely on authorship)
 * and `mode: "admin"` emits kind:9005, which additionally admits a channel
 * owner/admin deleting another member's message. Using kind:5 plus a local role
 * check for the admin case does NOT work — the relay gates kind:5 on authorship
 * and would refuse it.
 *
 * The `h` tag is non-standard for NIP-09 but required so that channel-scoped
 * subscriptions observe the delete (OLD BUZZ notes the same at
 * `desktop/src-tauri/src/events.rs:384`). The relay rejects any deletion that
 * does not carry exactly one `e`/`a` target (`ingest.rs:2710-2724`).
 */
export function buildMessageDeleteEvent(params: {
  channelId: string;
  targetEventId: string;
  mode: "self" | "admin";
}): UnsignedEvent {
  return {
    kind: params.mode === "admin" ? KIND_NIP29_DELETE_EVENT : KIND_DELETION,
    content: "",
    tags: [
      ["h", params.channelId],
      ["e", params.targetEventId],
    ],
  };
}

export function isMessageEditKind(kind: number): boolean {
  return kind === KIND_STREAM_MESSAGE_EDIT;
}

export function isMessageDeleteKind(kind: number): boolean {
  return kind === KIND_DELETION || kind === KIND_NIP29_DELETE_EVENT;
}

/** The `e`-tagged event a kind:40003/5/9005 acts upon, or null if malformed. */
export function editOrDeleteTargetId(event: RawNostrEvent): string | null {
  return firstTagValue(event, "e") ?? null;
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
    mentionsEveryone: hasEveryoneMentionTag(event),
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    // NIP-92: attachments live in `imeta` tags, in tag order. A message with no
    // imeta tag yields an empty list, which is what makes this safe to read
    // unconditionally at render time.
    attachments: [...parseImetaTags(event).values()],
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
