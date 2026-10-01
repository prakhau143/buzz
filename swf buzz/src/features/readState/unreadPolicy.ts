import type { Message } from "@/types/domain";
import { messageMentionsMe } from "@/features/mentions/everyone";

/**
 * Whether a message counts toward a channel's or DM's unread badge.
 *
 * One rule, shared by the live subscription and the startup catch-up, so the
 * badge after a restart is the badge you would have seen had the app been open.
 * Mirrors OLD BUZZ (docs/OLD_BUZZ_SIDEBAR_INBOX_MASTER_SPEC.md §1):
 *   - my own messages never count;
 *   - a top-level message from someone else counts;
 *   - a thread reply counts only when it mentions me. OLD BUZZ also counts
 *     replies in threads I authored or took part in; SWF has no cheap
 *     participation index yet, so those are NOT counted rather than guessed —
 *     undercounting a thread is recoverable, a phantom badge is not.
 */
export function countsAsUnread(message: Message, myPubkey: string | null): boolean {
  if (!myPubkey || message.authorPubkey === myPubkey) return false;
  const isReply = message.thread.rootId !== undefined && message.thread.rootId !== message.id;
  return !isReply || messageMentionsMe(message, myPubkey);
}
