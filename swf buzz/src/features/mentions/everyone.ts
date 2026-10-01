/**
 * `@everyone` — the audience mention (docs/PHASE_G_PINNED_MESSAGES_EVERYONE.md).
 *
 * Semantics: "everyone who can read this channel". It is resolved by each
 * READER, never fanned out by the sender: a reader only ever receives a channel
 * message through subscriptions the relay has already access-checked
 * (`event_in_accessible_channel` / NIP-29 membership), so a member of a private
 * channel is notified and nobody else even sees the event — no recipient list
 * exists anywhere that could leak private membership.
 *
 * The literal text `@everyone` is not a mention. Only an event carrying
 * `EVERYONE_MENTION_TAG` (see protocol/messages.ts) is — the text only says
 * where to draw the chip, exactly like a person mention's `p` tag.
 */
import type { Message } from "@/types/domain";
import { findMentionOccurrences } from "./mentionModel";

export const EVERYONE_LABEL = "everyone";

/** Whether `@everyone` is offered in a conversation: community channels only, never DMs. */
export function everyoneAllowedIn(scope: { kind: "channel" | "dm" } | null | undefined): boolean {
  return scope?.kind === "channel";
}

/** The draft says `@everyone` as a mention token (boundaries, code and URLs as for person mentions). */
export function draftMentionsEveryone(content: string): boolean {
  return findMentionOccurrences(content, [EVERYONE_LABEL]).length > 0;
}

/**
 * Does this message mention ME — by name (`p` tag) or as part of everyone?
 *
 * The sender never mentions themselves, a DM has no `@everyone`, and a system
 * message mentions nobody. Callers pass `isDm` from what they already know
 * about the conversation; access needs no check here (see the header).
 */
export function messageMentionsMe(
  message: Pick<Message, "mentions" | "mentionsEveryone" | "authorPubkey" | "isSystemMessage">,
  me: string | null | undefined,
  opts: { isDm?: boolean } = {},
): boolean {
  if (!me || message.isSystemMessage) return false;
  if (message.mentions.includes(me)) return true;
  return !!message.mentionsEveryone && !opts.isDm && message.authorPubkey !== me;
}
