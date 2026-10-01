import { buildNip98AuthHeader } from "@/services/nip98";
import { activeRelayUrl, relayHttpBase } from "@/features/communities/relayCommunities";
import { withinCommunitySession } from "@/features/communities/communitySession";
import { config } from "@/app/config";
import {
  buildInboxFilter,
  isAgentActivityKind,
  serverCategoryFor,
  type InboxView,
  type InboxServerCategory,
  INBOX_PAGE_LIMIT,
} from "@/protocol/inbox";
import { AppError } from "@/services/errors";
import type { RawNostrEvent } from "@/protocol/types";

const INBOX_TIMEOUT_MS = 8_000;

function currentRelayUrl(): string {
  return activeRelayUrl.value || config.relayUrl;
}

export interface InboxEntry {
  event: RawNostrEvent;
  /** The channel the entry belongs to, when it has one. Community-global entries have none. */
  channelId?: string;
  createdAt: number;
}

/**
 * Inbox feed reads.
 *
 * Uses the relay's HTTP bridge rather than a WebSocket REQ because `feed_types`
 * is only honoured there (`api/bridge.rs:1210`). This is NOT the 4A-bis "HTTP
 * bridge history" work — that proposal was about moving *channel message
 * history* off the socket and remains unimplemented by design. The feed has no
 * WebSocket equivalent to move off of.
 */
class InboxService {
  /**
   * One relay category, unfiltered — what the Inbox workspace merges and
   * classifies itself (`inboxModel.ts`), so each category costs one request.
   */
  async fetchCategory(category: InboxServerCategory, pubkey: string): Promise<RawNostrEvent[]> {
    return (await this.request(category, pubkey, {})).map((entry) => entry.event);
  }

  async fetchFeed(
    view: InboxView,
    pubkey: string,
    options: { limit?: number; since?: number; relayUrl?: string } = {},
  ): Promise<InboxEntry[]> {
    const entries = await this.request(serverCategoryFor(view), pubkey, options);
    // "Agent updates" is a narrowing of the SAME activity result — the relay
    // aliases agent_activity to activity, so the distinction can only be made
    // here (see @/protocol/inbox). Asking the relay for it separately would
    // return these very rows plus the human ones.
    const filtered =
      view === "agent_activity"
        ? entries.filter((e) => isAgentActivityKind(e.event.kind))
        : view === "activity"
          ? entries.filter((e) => !isAgentActivityKind(e.event.kind))
          : entries;
    filtered.sort((a, b) => b.createdAt - a.createdAt);
    return filtered;
  }

  private request(
    category: InboxServerCategory,
    pubkey: string,
    options: { limit?: number; since?: number; relayUrl?: string },
  ): Promise<InboxEntry[]> {
    // An explicit relay is a deliberate cross-community read; the active
    // community's feed must not outlive a switch (communitySession.ts).
    if (options.relayUrl) return this.requestFrom(category, pubkey, options);
    return withinCommunitySession(() => this.requestFrom(category, pubkey, options));
  }

  private async requestFrom(
    category: InboxServerCategory,
    pubkey: string,
    options: { limit?: number; since?: number; relayUrl?: string },
  ): Promise<InboxEntry[]> {
    const relayUrl = options.relayUrl ?? currentRelayUrl();
    const url = `${relayHttpBase(relayUrl)}/query`;
    const body = JSON.stringify([
      buildInboxFilter({
        category,
        pubkey,
        limit: options.limit ?? INBOX_PAGE_LIMIT,
        since: options.since,
      }),
    ]);

    let response: Response;
    try {
      const authorization = await buildNip98AuthHeader(url, "POST", body);
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(INBOX_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AppError("network", "Couldn't reach the server to load your inbox.", err);
    }

    if (response.status === 401 || response.status === 403) {
      throw new AppError("permission_denied", "You don't have access to this community's inbox.");
    }
    if (!response.ok) {
      throw new AppError("unknown", "Couldn't load your inbox.");
    }

    let events: unknown;
    try {
      events = await response.json();
    } catch {
      throw new AppError("unknown", "The server returned an unreadable inbox response.");
    }
    if (!Array.isArray(events)) return [];

    const entries: InboxEntry[] = [];
    const seen = new Set<string>();
    for (const raw of events) {
      const event = raw as RawNostrEvent;
      if (!event || typeof event.id !== "string" || typeof event.kind !== "number") continue;
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      entries.push({
        event,
        channelId: event.tags?.find((t) => t[0] === "h")?.[1],
        createdAt: event.created_at,
      });
    }
    return entries;
  }
}

export const inboxService = new InboxService();
