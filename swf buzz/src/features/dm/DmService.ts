import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { buildChannelDiscoveryFilter, parseChannelEvent } from "@/protocol/channels";
import { buildDmVisibilityFilter, parseDmVisibilityEvent } from "@/protocol/dm";
import type { Channel, Message } from "@/types/domain";
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
  ): Promise<Message> {
    return this.transport.send(conversationId, content, mentionPubkeys);
  }

  hideConversation(conversationId: string): Promise<void> {
    return this.transport.hide(conversationId);
  }

  fetchHistory(conversationId: string): Promise<Message[]> {
    return this.transport.fetchHistory(conversationId);
  }

  subscribeToConversation(
    conversationId: string,
    onMessage: (message: Message) => void,
  ): RelaySubscriptionHandle {
    return this.transport.subscribe(conversationId, onMessage);
  }
}

export const dmService = new DmService();
export { DmService };
