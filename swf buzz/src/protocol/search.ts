/**
 * NIP-50 message search.
 *
 * ## Where permission is enforced — and where it is NOT
 *
 * The relay is the access boundary, not this file and not the UI.
 * `crates/buzz-search/src/lib.rs:12-15` states it directly: *"The relay
 * refetches canonical events through `buzz-db`'s scoped fetcher and runs access
 * checks per hit; search is never the access boundary."*
 *
 * Concretely, for every search REQ the relay:
 *   1. resolves `accessible_channels` from the NIP-42 *authenticated* pubkey —
 *      never from anything the client sends (`handlers/req.rs:110-126`);
 *   2. maps that to a `ChannelScope` (`req.rs:576-594`) — and when the caller
 *      has no accessible channels and no global access, short-circuits to EOSE
 *      rather than running SQL at all;
 *   3. binds `community_id` as the first SQL predicate, so a query bound to one
 *      community cannot return another's rows *by construction*
 *      (`buzz-search/src/lib.rs:17-22`);
 *   4. refetches each hit through the scoped fetcher and re-authorizes it.
 *
 * Therefore a hit arriving at this client is already one the signed-in identity
 * is allowed to read. We deliberately do **not** re-filter results against a
 * locally-known channel list: doing so would be security theatre over data the
 * relay already vetted, and — worse — a local list that is merely *stale* would
 * silently hide legitimate results while providing no protection whatsoever
 * against a relay that had failed to vet them.
 *
 * The one filter applied here is by *kind*, which is a rendering concern rather
 * than an access one: the timeline can only draw message kinds.
 */
import { KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2 } from "./kinds";
import type { NostrFilter } from "./types";

/** Kinds a search result can be rendered as. Mirrors the timeline's renderable set. */
export const SEARCHABLE_MESSAGE_KINDS = [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2] as const;

/**
 * Default page size.
 *
 * The relay clamps `limit` server-side regardless of what we ask for, so this
 * is a UI-scale choice, not a safety one.
 */
export const SEARCH_PAGE_LIMIT = 50;

export interface BuildSearchFilterParams {
  /** Raw user query. Whitespace-only is not a valid search — callers must not send it. */
  query: string;
  /**
   * Optional single-channel scope. When set the relay still intersects it with
   * the authenticated identity's accessible channels, so passing a channel the
   * user cannot read yields no hits rather than a leak (`req.rs:149-189`).
   */
  channelId?: string;
  limit?: number;
}

/**
 * Builds the NIP-50 filter for a message search.
 *
 * Search REQs are **one-shot** on this relay: it answers matching events then
 * EOSE and registers no persistent subscription (`req.rs:596-598`). So the
 * caller wants `fetchEventsOnce`, never a long-lived `subscribe`.
 */
export function buildMessageSearchFilter(params: BuildSearchFilterParams): NostrFilter {
  const filter: NostrFilter = {
    kinds: [...SEARCHABLE_MESSAGE_KINDS],
    search: params.query.trim(),
    limit: params.limit ?? SEARCH_PAGE_LIMIT,
  };
  if (params.channelId) {
    filter["#h"] = [params.channelId];
  }
  return filter;
}

/** True when a query is worth sending — guards against empty/whitespace REQs the relay would reject. */
export function isSearchableQuery(query: string): boolean {
  return query.trim().length > 0;
}
