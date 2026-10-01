import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import { AppError } from "@/services/errors";
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

  /**
   * The channel roster — and therefore the answer to "is this identity a
   * member?". Both lists must END WITH EOSE (`requireEose`): a timeout or a
   * relay `CLOSED` (e.g. "auth-required:" while a just-switched session is
   * still authenticating) used to resolve as an EMPTY roster, which every
   * screen then rendered as "You're not a member of this channel yet" for a
   * channel the user belongs to. Now it rejects, and `channelAccess.ts` shows
   * that as "checking"/"error" — never as a negative.
   */
  async fetchMembers(channelId: string): Promise<Member[]> {
    const [adminEvents, memberEvents] = await Promise.all([
      fetchEventsOnce([memberListFilterForChannel(channelId, KIND_NIP29_GROUP_ADMINS)], { requireEose: true }),
      fetchEventsOnce([memberListFilterForChannel(channelId, KIND_NIP29_GROUP_MEMBERS)], { requireEose: true }),
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

  /**
   * NIP-29 kind:9022 with `["h", <channel uuid>]` — byte-for-byte what OLD BUZZ
   * sends (desktop `events.rs` `build_leave`). A refusal carries the relay's
   * reason, which is turned into a message the person can act on.
   */
  async leaveChannel(channelId: string): Promise<void> {
    try {
      await signAndPublish(buildLeaveRequestEvent(channelId));
    } catch (err) {
      throw leaveRefusal(err);
    }
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

/**
 * The relay's kind:9022 refusals (`buzz-relay` `side_effects.rs` 9022 arm,
 * `channel_authz::decide_self_departure`, ingest membership gate), each mapped
 * to what the person can do about it. Anything unrecognised keeps the relay's
 * own words rather than a generic "not accepted".
 */
export function leaveRefusal(err: unknown): unknown {
  if (!(err instanceof AppError) || err.code !== "relay_rejected") return err;
  const reason = err.cause instanceof Error ? err.cause.message : String(err.cause ?? "");
  const say = (message: string) => new AppError("relay_rejected", message, err.cause);
  if (/channel is archived/i.test(reason)) {
    return say("This channel is archived, so it can't be left or changed.");
  }
  if (/last owner/i.test(reason)) {
    return say(
      "You can't leave this channel because you are its only owner. Transfer ownership or add another owner first.",
    );
  }
  if (/not an active member|not a channel member/i.test(reason)) {
    return say("You're not a member of this channel anymore.");
  }
  return reason ? say(`The server refused: ${reason}`) : err;
}
