/**
 * Inbox / activity feed.
 *
 * ## The feed is a relay query, not a local derivation
 *
 * The relay owns the categories. A client asks for them by name on the HTTP
 * bridge (`POST /query`) via the `feed_types` filter extension — a Buzz
 * extension that `nostr::Filter` drops, which is why the bridge two-pass parses
 * the raw JSON to recover it (`api/bridge.rs:1112-1113, :351`). The categories
 * themselves are SQL in `buzz-db/src/store/feed.rs`, and the relay applies
 * `event_in_accessible_channel` plus `reader_authorized_for_event` to every hit
 * before returning it (`bridge.rs:1281-1289`). We therefore do not re-derive
 * membership or visibility here.
 *
 * ## Three server categories, not four
 *
 * The CLI advertises four names (`buzz-cli/src/commands/feed.rs:6`) but the
 * relay canonicalizes **`agent_activity` → `activity`** and then de-duplicates
 * by canonical name (`bridge.rs:1226-1232`). Asking for both returns one set,
 * not two. So there are three distinct server queries:
 *
 * | Category      | Server query          | Kinds (feed.rs)                                  |
 * |---------------|-----------------------|--------------------------------------------------|
 * | `mentions`    | `query_mentions`      | 9, 40002, 1, forum + git kinds, joined on `event_mentions` for MY pubkey |
 * | `needs_action`| `query_needs_action`  | 46010 approval-requested, 40007 reminder — tagged with MY pubkey |
 * | `activity`    | `query_activity`      | 9, 40002, forum post, 43001/43003/43004 agent job events, across accessible channels |
 *
 * "Agent updates" is therefore a **client-side view over the `activity`
 * result**, narrowed to the agent job kinds — not a fourth request. Issuing a
 * separate `agent_activity` query would return the identical rows as
 * `activity`, so a UI that showed both as distinct tabs would be duplicating
 * one result set under two labels.
 */
import {
  KIND_JOB_PROGRESS,
  KIND_JOB_REQUEST,
  KIND_JOB_RESULT,
} from "./kinds";
import type { NostrFilter } from "./types";

/** The categories this client requests from the relay. Deliberately three — see the header. */
export const INBOX_SERVER_CATEGORIES = ["mentions", "needs_action", "activity"] as const;
export type InboxServerCategory = (typeof INBOX_SERVER_CATEGORIES)[number];

/** What the UI presents. `agent_activity` is a view over `activity`, not a request. */
export const INBOX_VIEWS = ["mentions", "needs_action", "activity", "agent_activity"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/** Agent job kinds — the subset of `activity` that "Agent updates" shows. */
export const AGENT_ACTIVITY_KINDS = [
  KIND_JOB_REQUEST,
  KIND_JOB_PROGRESS,
  KIND_JOB_RESULT,
] as const;

export const INBOX_PAGE_LIMIT = 50;

/** Maps a UI view onto the server category that actually backs it. */
export function serverCategoryFor(view: InboxView): InboxServerCategory {
  return view === "agent_activity" ? "activity" : view;
}

/**
 * A filter carrying the `feed_types` extension.
 *
 * `#p` is the caller's own pubkey, matching the CLI's shape
 * (`commands/feed.rs:40-43`). The relay resolves the *authenticated* pubkey for
 * the mention/needs-action joins regardless, so this is a scope hint rather
 * than an authorization claim.
 */
export interface InboxFilter extends NostrFilter {
  feed_types: InboxServerCategory[];
}

export function buildInboxFilter(params: {
  category: InboxServerCategory;
  pubkey: string;
  limit?: number;
  since?: number;
}): InboxFilter {
  const filter: InboxFilter = {
    "#p": [params.pubkey],
    limit: params.limit ?? INBOX_PAGE_LIMIT,
    feed_types: [params.category],
  };
  if (params.since !== undefined) filter.since = params.since;
  return filter;
}

/** True when an activity event is an agent job event rather than human chatter. */
export function isAgentActivityKind(kind: number): boolean {
  return (AGENT_ACTIVITY_KINDS as readonly number[]).includes(kind);
}
