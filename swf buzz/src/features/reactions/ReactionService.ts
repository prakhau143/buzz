import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import {
  buildReactionEvent,
  buildReactionFilter,
  buildRemoveReactionEvent,
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
        existing.reactorEventIds[event.reactorPubkey] = event.id;
        existing.count += 1;
        if (event.reactorPubkey === myPubkey) existing.reactedByMe = true;
      }
    } else {
      byEmoji.set(event.emoji, {
        emoji: event.emoji,
        count: 1,
        reactedByMe: event.reactorPubkey === myPubkey,
        reactorPubkeys: [event.reactorPubkey],
        reactorEventIds: { [event.reactorPubkey]: event.id },
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
        reactorEventIds: { [event.reactorPubkey]: event.id },
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
    reactorEventIds: { ...existing.reactorEventIds, [event.reactorPubkey]: event.id },
  };
  const nextForTarget = [...existingForTarget];
  nextForTarget[idx] = updated;
  next.set(event.targetEventId, nextForTarget);
  return next;
}

/**
 * Removes `myPubkey`'s own reaction of `emoji` on `targetEventId` from local
 * state (used optimistically after publishing the kind:5 retraction — see
 * ReactionService.unreact). The relay excludes soft-deleted events from future
 * REQ responses, but does not fan out a "reaction removed" signal to other
 * subscribers (only the bare kind:7 add is delivered live) — see
 * docs/PHASE_3_IMPLEMENTATION_AUDIT.md §8 for that known limitation.
 */
export function retractReactionLocally(
  current: ReactionsByMessage,
  targetEventId: string,
  emoji: string,
  myPubkey: string,
): ReactionsByMessage {
  const existingForTarget = current.get(targetEventId);
  if (!existingForTarget) return current;
  const idx = existingForTarget.findIndex((r) => r.emoji === emoji);
  if (idx === -1) return current;
  const existing = existingForTarget[idx];
  if (!existing.reactorPubkeys.includes(myPubkey)) return current;

  const next = new Map(current);
  const remainingPubkeys = existing.reactorPubkeys.filter((p) => p !== myPubkey);
  const remainingEventIds = { ...existing.reactorEventIds };
  delete remainingEventIds[myPubkey];

  if (remainingPubkeys.length === 0) {
    next.set(
      targetEventId,
      existingForTarget.filter((_, i) => i !== idx),
    );
    return next;
  }

  const nextForTarget = [...existingForTarget];
  nextForTarget[idx] = {
    ...existing,
    count: remainingPubkeys.length,
    reactedByMe: false,
    reactorPubkeys: remainingPubkeys,
    reactorEventIds: remainingEventIds,
  };
  next.set(targetEventId, nextForTarget);
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

  /**
   * Retracts one of my own reactions via a standard NIP-09 kind:5 deletion
   * referencing the reaction's own event id (not the message's). Confirmed
   * supported server-side: buzz-relay's generic kind:5 handler
   * (`validate_standard_deletion_event`, crates/buzz-relay/src/handlers/side_effects.rs:233)
   * accepts any event kind's self-authored deletion via an `e`-tag target
   * lookup — there is no reaction-specific "unreact" kind, this is the
   * standard mechanism. See docs/PHASE_3_IMPLEMENTATION_AUDIT.md §8.
   */
  async unreact(reactionEventId: string): Promise<void> {
    await signAndPublish(buildRemoveReactionEvent(reactionEventId));
  }
}

export const reactionService = new ReactionService();
export { groupReactions };
