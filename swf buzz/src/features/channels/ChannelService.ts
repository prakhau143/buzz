import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import {
  buildChannelDiscoveryFilter,
  buildCreateChannelEvent,
  buildEditChannelEvent,
  parseChannelEvent,
  type CreateChannelParams,
  type EditChannelParams,
} from "@/protocol/channels";
import {
  buildJoinRequestEvent,
  buildLeaveRequestEvent,
  buildPutUserEvent,
  buildRemoveUserEvent,
  memberListFilterForChannel,
  parseMemberListEvent,
  type MemberRole,
} from "@/protocol/membership";
import { KIND_NIP29_GROUP_ADMINS, KIND_NIP29_GROUP_MEMBERS } from "@/protocol/kinds";
import type { Channel, Member } from "@/types/domain";

/**
 * Application service for channel discovery/membership — the only place
 * outside `src/protocol/` allowed to know that a "channel" is a kind:39000
 * event. Composables (`useChannels.ts`) call this; they never touch
 * `RelayConnectionService` or `src/protocol/*` directly.
 */
class ChannelService {
  async discoverChannels(): Promise<Channel[]> {
    const events = await fetchEventsOnce([buildChannelDiscoveryFilter()]);
    const byId = new Map<string, Channel>();
    for (const event of events) {
      const channel = parseChannelEvent(event);
      if (channel) byId.set(channel.id, channel);
    }
    return [...byId.values()].filter((c) => c.channelType !== "dm");
  }

  /** Live channel discovery/edit updates — caller feeds these into the Vue Query cache. */
  subscribeToChannelUpdates(onChannel: (channel: Channel) => void): RelaySubscriptionHandle {
    return relayConnectionService.subscribe(
      "channels-live",
      [{ ...buildChannelDiscoveryFilter(), since: Math.floor(Date.now() / 1000) }],
      {
        onEvent: (event) => {
          const channel = parseChannelEvent(event);
          if (channel && channel.channelType !== "dm") onChannel(channel);
        },
      },
    );
  }

  async fetchMembers(channelId: string): Promise<Member[]> {
    const [adminEvents, memberEvents] = await Promise.all([
      fetchEventsOnce([memberListFilterForChannel(channelId, KIND_NIP29_GROUP_ADMINS)]),
      fetchEventsOnce([memberListFilterForChannel(channelId, KIND_NIP29_GROUP_MEMBERS)]),
    ]);

    const roleByPubkey = new Map<string, Member["role"]>();
    for (const event of adminEvents) {
      for (const m of parseMemberListEvent(event)) roleByPubkey.set(m.pubkey, m.role);
    }

    const allPubkeys = new Map<string, Member>();
    for (const event of memberEvents) {
      for (const m of parseMemberListEvent(event)) {
        allPubkeys.set(m.pubkey, {
          pubkey: m.pubkey,
          role: roleByPubkey.get(m.pubkey) ?? "member",
        });
      }
    }
    // Admin/owner list may include pubkeys not present in the member snapshot yet.
    for (const [pubkey, role] of roleByPubkey) {
      if (!allPubkeys.has(pubkey)) allPubkeys.set(pubkey, { pubkey, role });
    }
    return [...allPubkeys.values()];
  }

  async createChannel(params: CreateChannelParams): Promise<void> {
    await signAndPublish(buildCreateChannelEvent(params));
  }

  async editChannel(params: EditChannelParams): Promise<void> {
    await signAndPublish(buildEditChannelEvent(params));
  }

  async joinChannel(channelId: string): Promise<void> {
    await signAndPublish(buildJoinRequestEvent(channelId));
  }

  async leaveChannel(channelId: string): Promise<void> {
    await signAndPublish(buildLeaveRequestEvent(channelId));
  }

  /** Adds a member to the channel, or changes an existing member's role (kind:9000). */
  async addMember(params: { channelId: string; pubkey: string; role?: MemberRole }): Promise<void> {
    await signAndPublish(buildPutUserEvent(params));
  }

  /** Removes a member from the channel (kind:9001). */
  async removeMember(params: { channelId: string; pubkey: string }): Promise<void> {
    await signAndPublish(buildRemoveUserEvent(params));
  }
}

export const channelService = new ChannelService();
