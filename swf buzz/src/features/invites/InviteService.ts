/**
 * kind:9009 create-invite. Per docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §7
 * and docs/DECISIONS.md D4: the relay's side-effect handler for this kind is
 * a confirmed no-op today. This service only creates/lists invite events —
 * there is no acceptance flow here, and none should be added until the
 * backend team confirms one exists. The UI must stay explicit that these
 * are "coming soon" rather than implying server-side enforcement.
 */
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import { buildCreateInviteEvent, parseInviteEvent } from "@/protocol/invites";
import { KIND_NIP29_CREATE_INVITE } from "@/protocol/kinds";
import type { Invite } from "@/types/domain";

class InviteService {
  async createInvite(channelId: string): Promise<Invite> {
    const signed = await signAndPublish(buildCreateInviteEvent(channelId));
    const invite = parseInviteEvent(signed);
    if (!invite) {
      throw new Error("Failed to build invite from the published event — this should not happen.");
    }
    return invite;
  }

  async listMyInvites(channelId: string, myPubkey: string): Promise<Invite[]> {
    const events = await fetchEventsOnce([
      { kinds: [KIND_NIP29_CREATE_INVITE], authors: [myPubkey], "#h": [channelId] },
    ]);
    return events
      .map(parseInviteEvent)
      .filter((i): i is Invite => i !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}

export const inviteService = new InviteService();
