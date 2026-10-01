import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { buildChannelDiscoveryFilter, parseChannelEvent } from "@/protocol/channels";
import { buildDmVisibilityFilter, parseDmVisibilityEvent } from "@/protocol/dm";
import type { Channel, Message } from "@/types/domain";
import type { Attachment } from "@/protocol/imeta";
import type { TimelineEvent, TimelinePage } from "@/features/messages/MessageService";
import type { MessageCursor } from "@/features/messages/messageCursor";
import { Kind41010Transport } from "./Kind41010Transport";
import type { DmTransport } from "./DmTransport";

/**
 * Application service for direct messages. Depends only on `DmTransport`
 * (see docs/DECISIONS.md D1.F) — conversation discovery below reuses the
 * kind:39000 discovery mechanism directly since that part of the wire format
 * is shared with channels, but message send/receive/hide always goes through
 * the injected transport.
 */
class DmService {
  constructor(private readonly transport: DmTransport = new Kind41010Transport()) {}

  private async fetchHiddenConversationIds(myPubkey: string): Promise<Set<string>> {
    const events = await fetchEventsOnce([buildDmVisibilityFilter(myPubkey)]);
    if (!events[0]) return new Set();
    return new Set(parseDmVisibilityEvent(events[0]).hiddenChannelIds);
  }

  async discoverConversations(myPubkey: string): Promise<Channel[]> {
    const [channelEvents, hiddenIds] = await Promise.all([
      fetchEventsOnce([buildChannelDiscoveryFilter()]),
      this.fetchHiddenConversationIds(myPubkey),
    ]);

    const byId = new Map<string, Channel>();
    for (const event of channelEvents) {
      const channel = parseChannelEvent(event);
      if (!channel || channel.channelType !== "dm") continue;
      if (!channel.dmParticipants?.includes(myPubkey)) continue;
      if (hiddenIds.has(channel.id)) continue;
      byId.set(channel.id, channel);
    }
    return [...byId.values()];
  }

  subscribeToConversationUpdates(
    myPubkey: string,
    onConversation: (channel: Channel) => void,
  ): RelaySubscriptionHandle {
    return relayConnectionService.subscribe(
      "dm-list-live",
      [{ ...buildChannelDiscoveryFilter(), since: Math.floor(Date.now() / 1000) }],
      {
        onEvent: (event) => {
          const channel = parseChannelEvent(event);
          if (channel?.channelType === "dm" && channel.dmParticipants?.includes(myPubkey)) {
            onConversation(channel);
          }
        },
      },
    );
  }

  openConversation(otherParticipantPubkeys: string[]): Promise<string> {
    return this.transport.open(otherParticipantPubkeys);
  }

  sendMessage(
    conversationId: string,
    content: string,
    mentionPubkeys?: string[],
    attachments?: Attachment[],
  ): Promise<Message> {
    return this.transport.send(conversationId, content, mentionPubkeys, attachments);
  }

  hideConversation(conversationId: string): Promise<void> {
    return this.transport.hide(conversationId);
  }

  fetchHistory(conversationId: string): Promise<TimelinePage> {
    return this.transport.fetchHistory(conversationId);
  }

  /** Keyset-paged older history. See `MessageService.fetchOlderMessages` for why it is not a bare `until`. */
  fetchOlder(conversationId: string, cursor: MessageCursor): Promise<TimelinePage> {
    return this.transport.fetchOlder(conversationId, cursor);
  }

  fetchSince(conversationId: string, since: number): Promise<TimelinePage> {
    return this.transport.fetchSince(conversationId, since);
  }

  subscribeToConversation(
    conversationId: string,
    since: number,
    onEvent: (event: TimelineEvent) => void,
  ): RelaySubscriptionHandle {
    return this.transport.subscribe(conversationId, since, onEvent);
  }
}

export const dmService = new DmService();
export { DmService };
