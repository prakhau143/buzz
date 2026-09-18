/**
 * HTTP-backed channels + channel membership (DECISIONS.md D10, Phase 5 of
 * `swf-buzz-backend`). Deliberately parallel to `./ChannelService.ts` (the
 * old pubkey/Nostr-event version), not a replacement — that file still
 * backs whatever isn't migrated yet. See
 * `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §2's "build alongside, verify, delete
 * old code only after everything is migrated" sequencing.
 *
 * Every mutation here is a plain authenticated HTTP call — the caller's
 * identity comes from the bearer session (`ApiClient`), never from
 * anything this module sends explicitly. Role enforcement is server-side
 * (`backend/src/channel_authz.rs`); `./channelPermissionsHttp.ts`'s checks
 * are UX-only, same discipline `CommunityService.ts` already documented.
 */
import { apiRequest } from "@/services/ApiClient";
import type { ChannelRole } from "./channelPermissionsHttp";

export type ChannelVisibility = "open" | "private";

export interface HttpChannel {
  id: string;
  communityId: string;
  name: string;
  visibility: ChannelVisibility;
  description: string | null;
}

export interface HttpChannelMember {
  userId: string;
  role: ChannelRole;
  joinedAt: string;
}

interface ChannelDto {
  id: string;
  community_id: string;
  name: string;
  visibility: ChannelVisibility;
  description: string | null;
}

interface ChannelMemberDto {
  user_id: string;
  role: ChannelRole;
  joined_at: string;
}

function channelFromDto(dto: ChannelDto): HttpChannel {
  return {
    id: dto.id,
    communityId: dto.community_id,
    name: dto.name,
    visibility: dto.visibility,
    description: dto.description,
  };
}

function memberFromDto(dto: ChannelMemberDto): HttpChannelMember {
  return { userId: dto.user_id, role: dto.role, joinedAt: dto.joined_at };
}

class ChannelServiceHttp {
  async createChannel(
    communityId: string,
    name: string,
    visibility: ChannelVisibility,
    description?: string,
  ): Promise<HttpChannel> {
    const channel = await apiRequest<ChannelDto>(`/api/communities/${communityId}/channels`, {
      method: "POST",
      body: { name, visibility, description: description ?? null },
    });
    return channelFromDto(channel);
  }

  async listChannels(communityId: string): Promise<HttpChannel[]> {
    const channels = await apiRequest<ChannelDto[]>(`/api/communities/${communityId}/channels`);
    return channels.map(channelFromDto);
  }

  async listMembers(channelId: string): Promise<HttpChannelMember[]> {
    const members = await apiRequest<ChannelMemberDto[]>(`/api/channels/${channelId}/members`);
    return members.map(memberFromDto);
  }

  async addMember(channelId: string, userId: string, role: ChannelRole): Promise<HttpChannelMember> {
    const member = await apiRequest<ChannelMemberDto>(`/api/channels/${channelId}/members`, {
      method: "POST",
      body: { user_id: userId, role },
    });
    return memberFromDto(member);
  }

  async changeRole(channelId: string, userId: string, role: ChannelRole): Promise<HttpChannelMember> {
    const member = await apiRequest<ChannelMemberDto>(
      `/api/channels/${channelId}/members/${userId}`,
      { method: "PATCH", body: { role } },
    );
    return memberFromDto(member);
  }

  async removeMember(channelId: string, userId: string): Promise<void> {
    await apiRequest<unknown>(`/api/channels/${channelId}/members/${userId}`, { method: "DELETE" });
  }

  /** Self-add convenience — `addMember` with the caller's own id, for the open-channel "join" flow. */
  joinChannel(channelId: string, myUserId: string): Promise<HttpChannelMember> {
    return this.addMember(channelId, myUserId, "member");
  }
}

export const channelServiceHttp = new ChannelServiceHttp();
