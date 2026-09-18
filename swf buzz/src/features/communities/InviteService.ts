/**
 * HTTP-backed community invites (DECISIONS.md D10, `backend/src/routes/invites.rs`).
 * Deliberately parallel to `../invites/InviteService.ts` (the old kind:9009
 * version, confirmed dead server-side — see docs/DECISIONS.md D4/D10) —
 * that file is left alone this phase per the additive-migration rule; it's
 * replaced only in the one UI integration point invites actually appear
 * (`CommunityManagementModal.vue`'s "Invites" tab), not deleted outright.
 */
import { apiRequest } from "@/services/ApiClient";

export interface CreatedInvite {
  id: string;
  code: string;
  url: string;
  expiresAt: string;
  maxUses: number | null;
  usesRemaining: number | null;
}

interface CreateInviteResponseDto {
  id: string;
  code: string;
  url: string;
  expires_at: string;
  max_uses: number | null;
  uses_remaining: number | null;
}

export interface InvitePreview {
  communityName: string;
}

export type ClaimResult =
  | { status: "joined"; community: { id: string; name: string }; membership: { userId: string; role: string } }
  | { status: "already_member" };

interface ClaimResponseDto {
  status: "joined" | "already_member";
  community?: { id: string; name: string };
  membership?: { user_id: string; role: string };
}

class InviteService {
  async createInvite(
    communityId: string,
    opts: { ttlSecs?: number; maxUses?: number } = {},
  ): Promise<CreatedInvite> {
    const dto = await apiRequest<CreateInviteResponseDto>(
      `/api/communities/${communityId}/invites`,
      { method: "POST", body: { ttl_secs: opts.ttlSecs, max_uses: opts.maxUses } },
    );
    return {
      id: dto.id,
      code: dto.code,
      url: dto.url,
      expiresAt: dto.expires_at,
      maxUses: dto.max_uses,
      usesRemaining: dto.uses_remaining,
    };
  }

  async revokeInvite(inviteId: string): Promise<void> {
    await apiRequest<unknown>(`/api/invites/${inviteId}/revoke`, { method: "POST" });
  }

  /** Public, unauthenticated — safe to call before login. */
  async previewInvite(token: string): Promise<InvitePreview> {
    const dto = await apiRequest<{ community_name: string }>(
      `/api/invites/${encodeURIComponent(token)}/preview`,
    );
    return { communityName: dto.community_name };
  }

  async claimInvite(code: string): Promise<ClaimResult> {
    const dto = await apiRequest<ClaimResponseDto>("/api/invites/claim", {
      method: "POST",
      body: { code },
    });
    if (dto.status === "already_member") return { status: "already_member" };
    if (!dto.community || !dto.membership) {
      throw new Error("claim reported 'joined' without community/membership — unexpected response shape");
    }
    return {
      status: "joined",
      community: dto.community,
      membership: { userId: dto.membership.user_id, role: dto.membership.role },
    };
  }
}

export const inviteHttpService = new InviteService();
