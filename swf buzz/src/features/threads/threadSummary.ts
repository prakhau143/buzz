import type { Message, ThreadSummary } from "@/types/domain";

/**
 * Per-root thread summary for the channel feed's summary row
 * ("👤👤 2 replies · Last reply 3m ago").
 *
 * Derived from the messages already loaded for the channel — the feed query
 * fetches replies as well as top-level messages (the feed simply does not
 * *render* the replies; see `ChannelsView.topLevelMessages`), so counts,
 * participants and last-reply times for anything in the loaded window need no
 * extra request and update live from the same cache the panel and the feed use.
 * That is the "single source of truth" requirement: one `rootId -> replies`
 * index, two derived views.
 *
 * Since channel history uses the relay's top-level window, replies are NOT in
 * that cache on load — they arrive only live, or when a thread is opened. The
 * relay's own counts come with each history page instead (kind 39005 via
 * `include_summaries`, kept in `stores/threadIndex`), and `mergeThreadSummaries`
 * below adds the replies seen since then on top of them.
 */
export interface ThreadSummaryView {
  rootId: string;
  count: number;
  /** Unique, most recent replier first, capped at `MAX_PARTICIPANTS`. */
  participantPubkeys: string[];
  /** Unix seconds of the newest reply, or `null` when only a relay count is known. */
  lastReplyAt: number | null;
  /** How many distinct people replied (may exceed the avatars shown). */
  participantTotal?: number;
  /** Local summaries only: every loaded reply's time, so the merge can add replies newer than the relay's count. */
  replyCreatedAts?: number[];
}

export const MAX_PARTICIPANTS = 3;

/**
 * Index every loaded reply under its thread root. A reply to a reply belongs to
 * the ROOT thread, not to a nested sub-thread — `message.thread.rootId` already
 * carries that (NIP-10 root marker), so nesting never appears here.
 */
export function buildThreadSummaries(messages: Message[]): Map<string, ThreadSummaryView> {
  const repliesByRoot = new Map<string, Message[]>();
  for (const message of messages) {
    const rootId = message.thread.rootId;
    // Not a reply, or an optimistic reply that has not been assigned an id yet.
    if (!rootId) continue;
    const list = repliesByRoot.get(rootId);
    if (list) list.push(message);
    else repliesByRoot.set(rootId, [message]);
  }

  const summaries = new Map<string, ThreadSummaryView>();
  for (const [rootId, replies] of repliesByRoot) {
    const newestFirst = [...replies].sort((a, b) => b.createdAt - a.createdAt);
    const allRepliers = [...new Set(newestFirst.map((r) => r.authorPubkey).filter(Boolean))];
    const participantPubkeys = allRepliers.slice(0, MAX_PARTICIPANTS);
    summaries.set(rootId, {
      rootId,
      count: replies.length,
      participantPubkeys,
      lastReplyAt: newestFirst[0]?.createdAt ?? null,
      participantTotal: allRepliers.length,
      replyCreatedAts: newestFirst.map((r) => r.createdAt),
    });
  }
  return summaries;
}

/**
 * Combine the relay's summaries with the replies loaded locally.
 *
 * The relay's count is the truth up to its `lastReplyAt`; replies loaded here
 * that are NEWER than that (a live reply, one's own just-sent reply) are added
 * on top — so a 3-reply thread shows 4 the moment a 4th arrives. (Taking
 * max(local, relay) got this wrong: after a reload only the new reply is loaded,
 * so max(1, 3) stayed 3.) Without a relay timestamp we can't tell which loaded
 * replies it already counted, so the larger of the two is used — a stale relay
 * summary never shrinks what is visible. The cache dedupes replies by event id,
 * so a duplicate delivery can't be counted twice. Participants: newest local
 * repliers first, then the relay's, unique, capped.
 */
export function mergeThreadSummaries(
  local: Map<string, ThreadSummaryView>,
  fromRelay: Map<string, ThreadSummary>,
): Map<string, ThreadSummaryView> {
  const merged = new Map(local);
  for (const [rootId, relay] of fromRelay) {
    const mine = merged.get(rootId);
    if (!mine) {
      if (relay.replyCount > 0) {
        merged.set(rootId, {
          rootId,
          count: relay.replyCount,
          participantPubkeys: (relay.participants ?? []).slice(0, MAX_PARTICIPANTS),
          lastReplyAt: relay.lastReplyAt ?? null,
          participantTotal: new Set(relay.participants ?? []).size,
        });
      }
      continue;
    }
    const newerLocal =
      relay.lastReplyAt !== undefined
        ? (mine.replyCreatedAts ?? []).filter((t) => t > (relay.lastReplyAt as number)).length
        : 0;
    const count =
      relay.lastReplyAt !== undefined
        ? Math.max(relay.replyCount + newerLocal, mine.count)
        : Math.max(mine.count, relay.replyCount);
    const everyone = [...new Set([...mine.participantPubkeys, ...(relay.participants ?? [])])];
    const participantPubkeys = everyone.slice(0, MAX_PARTICIPANTS);
    const participantTotal = Math.max(everyone.length, mine.participantTotal ?? 0);
    const lastReplyAt = Math.max(mine.lastReplyAt ?? 0, relay.lastReplyAt ?? 0) || null;
    merged.set(rootId, { ...mine, count, participantPubkeys, participantTotal, lastReplyAt });
  }
  return merged;
}

/** "1 reply" / "2 replies" — never "2 reply". */
export function replyCountLabel(count: number): string {
  return `${count} ${count === 1 ? "reply" : "replies"}`;
}
