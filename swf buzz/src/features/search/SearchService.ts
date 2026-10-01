import { fetchEventsOnce } from "@/services/relayQuery";
import {
  buildMessageSearchFilter,
  isSearchableQuery,
  SEARCH_PAGE_LIMIT,
} from "@/protocol/search";
import { isRenderableMessageKind, parseMessageEvent } from "@/protocol/messages";
import type { Message } from "@/types/domain";

export interface SearchHit {
  message: Message;
  /** The channel the hit belongs to. Always present — a hit without `h` is discarded. */
  channelId: string;
}

export interface SearchOptions {
  channelId?: string;
  limit?: number;
}

/**
 * Message search over the relay's Postgres FTS (NIP-50).
 *
 * Permission is the relay's job — see the header of `@/protocol/search` for why
 * results are deliberately NOT re-filtered here against a local channel list.
 */
class SearchService {
  /**
   * Run a one-shot search.
   *
   * Search REQs register no persistent subscription on this relay: the answer
   * is "matching events, then EOSE" (`handlers/req.rs:596-598`), which is
   * exactly `fetchEventsOnce`'s contract. Using `subscribe` would leak a
   * subscription per keystroke.
   */
  async searchMessages(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    if (!isSearchableQuery(query)) return [];

    const events = await fetchEventsOnce([
      buildMessageSearchFilter({
        query,
        channelId: options.channelId,
        limit: options.limit ?? SEARCH_PAGE_LIMIT,
      }),
    ]);

    const hits: SearchHit[] = [];
    const seen = new Set<string>();
    for (const event of events) {
      // Kind check is a rendering guard, not an access one: the timeline can
      // only draw message kinds, and a relay is free to answer with others.
      if (!isRenderableMessageKind(event.kind)) continue;
      if (seen.has(event.id)) continue;
      seen.add(event.id);

      const message = parseMessageEvent(event);
      // A message with no `h` tag cannot be navigated to, so it is not a
      // useful result even though the relay considered it a match.
      if (!message.channelId) continue;
      hits.push({ message, channelId: message.channelId });
    }

    // Newest first — search is a lookup surface, not a timeline, so recency is
    // the more useful default than the relay's relevance ordering.
    hits.sort((a, b) => b.message.createdAt - a.message.createdAt);
    return hits;
  }
}

export const searchService = new SearchService();
