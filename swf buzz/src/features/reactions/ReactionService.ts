import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import {
  buildReactionEvent,
  buildReactionFilter,
  parseReactionEvent,
  type ParsedReactionEvent,
} from "@/protocol/reactions";
import { useSessionStore } from "@/stores/session";
import type { Reaction } from "@/types/domain";

/** Reactions grouped by the message they target, keyed by `${targetEventId}:${emoji}`. */
export type ReactionsByMessage = Map<string, Reaction[]>;

function groupReactions(
  events: ParsedReactionEvent[],
  myPubkey: string | null,
): ReactionsByMessage {
  const byTarget = new Map<string, Map<string, Reaction>>();
  for (const event of events) {
    let byEmoji = byTarget.get(event.targetEventId);
    if (!byEmoji) {
      byEmoji = new Map();
      byTarget.set(event.targetEventId, byEmoji);
    }
    const existing = byEmoji.get(event.emoji);
    if (existing) {
      if (!existing.reactorPubkeys.includes(event.reactorPubkey)) {
        existing.reactorPubkeys.push(event.reactorPubkey);
        existing.count += 1;
        if (event.reactorPubkey === myPubkey) existing.reactedByMe = true;
      }
    } else {
      byEmoji.set(event.emoji, {
        emoji: event.emoji,
        count: 1,
        reactedByMe: event.reactorPubkey === myPubkey,
        reactorPubkeys: [event.reactorPubkey],
      });
    }
  }
  const result: ReactionsByMessage = new Map();
  for (const [targetId, byEmoji] of byTarget) {
    result.set(targetId, [...byEmoji.values()]);
  }
  return result;
}

/** Immutably patches one incoming reaction into an existing grouped map (used for live updates). */
export function applyReaction(
  current: ReactionsByMessage,
  event: ParsedReactionEvent,
  myPubkey: string | null,
): ReactionsByMessage {
  const next: ReactionsByMessage = new Map(current);
  const existingForTarget = next.get(event.targetEventId) ?? [];
  const idx = existingForTarget.findIndex((r) => r.emoji === event.emoji);

  if (idx === -1) {
    next.set(event.targetEventId, [
      ...existingForTarget,
      {
        emoji: event.emoji,
        count: 1,
        reactedByMe: event.reactorPubkey === myPubkey,
        reactorPubkeys: [event.reactorPubkey],
      },
    ]);
    return next;
  }

  const existing = existingForTarget[idx];
  if (existing.reactorPubkeys.includes(event.reactorPubkey)) return current;

  const updated: Reaction = {
    ...existing,
    count: existing.count + 1,
    reactedByMe: existing.reactedByMe || event.reactorPubkey === myPubkey,
    reactorPubkeys: [...existing.reactorPubkeys, event.reactorPubkey],
  };
  const nextForTarget = [...existingForTarget];
  nextForTarget[idx] = updated;
  next.set(event.targetEventId, nextForTarget);
  return next;
}

class ReactionService {
  async fetchChannelReactions(channelId: string): Promise<ReactionsByMessage> {
    const events = await fetchEventsOnce([buildReactionFilter(channelId)]);
    const parsed = events
      .map(parseReactionEvent)
      .filter((r): r is ParsedReactionEvent => r !== null);
    const myPubkey = useSessionStore().pubkey;
    return groupReactions(parsed, myPubkey);
  }

  subscribeToChannel(
    channelId: string,
    onReaction: (reaction: ParsedReactionEvent) => void,
  ): RelaySubscriptionHandle {
    return relayConnectionService.subscribe(
      "channel-reactions-live",
      [{ ...buildReactionFilter(channelId), since: Math.floor(Date.now() / 1000) }],
      {
        onEvent: (event) => {
          const parsed = parseReactionEvent(event);
          if (parsed) onReaction(parsed);
        },
      },
    );
  }

  async react(targetEventId: string, emoji: string): Promise<void> {
    await signAndPublish(buildReactionEvent({ targetEventId, emoji }));
  }
}

export const reactionService = new ReactionService();
export { groupReactions };
