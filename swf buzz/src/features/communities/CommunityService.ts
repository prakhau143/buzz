/**
 * HTTP-backed community membership (DECISIONS.md D10, Phase 3/4 of
 * `swf-buzz-backend`). Deliberately parallel to
 * `../community-members/RelayMembersService.ts` (the old pubkey/Nostr-event
 * version), not a replacement of it — that file still backs whatever isn't
 * migrated yet. See `OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md` §2's "build
 * alongside, verify, delete old code only after everything is migrated"
 * sequencing.
 *
 * Every mutation here is a plain authenticated HTTP call — the caller's
 * identity comes from the bearer session (`ApiClient`), never from
 * anything this module sends explicitly. Role enforcement is server-side
 * (`backend/src/community_authz.rs`); the client-side checks in
 * `./permissions.ts` are UX-only, same discipline the old service already
 * documented.
 */
import { apiRequest } from "@/services/ApiClient";

export type CommunityRole = "owner" | "admin" | "member";

export interface Community {
  id: string;
  name: string;
}

export interface CommunityMember {
  userId: string;
  role: CommunityRole;
  joinedAt: string;
}

interface MemberDto {
  user_id: string;
  role: CommunityRole;
  joined_at: string;
}

function fromDto(dto: MemberDto): CommunityMember {
  return { userId: dto.user_id, role: dto.role, joinedAt: dto.joined_at };
}

class CommunityService {
  createCommunity(name: string): Promise<Community> {
    return apiRequest<Community>("/api/communities", { method: "POST", body: { name } });
  }

  async listMembers(communityId: string): Promise<CommunityMember[]> {
    const members = await apiRequest<MemberDto[]>(`/api/communities/${communityId}/members`);
    return members.map(fromDto);
  }

  async addMember(communityId: string, userId: string, role: CommunityRole): Promise<CommunityMember> {
    const member = await apiRequest<MemberDto>(`/api/communities/${communityId}/members`, {
      method: "POST",
      body: { user_id: userId, role },
    });
    return fromDto(member);
  }

  async changeRole(communityId: string, userId: string, role: CommunityRole): Promise<CommunityMember> {
    const member = await apiRequest<MemberDto>(
      `/api/communities/${communityId}/members/${userId}`,
      { method: "PATCH", body: { role } },
    );
    return fromDto(member);
  }

  async removeMember(communityId: string, userId: string): Promise<void> {
    await apiRequest<unknown>(`/api/communities/${communityId}/members/${userId}`, {
      method: "DELETE",
    });
  }
}

export const communityService = new CommunityService();
