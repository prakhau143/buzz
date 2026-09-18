/**
 * Community moderation — report submission (WS write) + ban/unban/timeout/
 * untimeout/resolve (WS writes) + reports/audit/restrictions (NIP-98 HTTP
 * reads). See docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2b.
 *
 * Every write runs a client-side permission pre-flight
 * (`community-members/permissions.ts`) before signing/publishing — fail-fast
 * UX only, the relay is the real gate (docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md §9).
 */
import { signAndPublish } from "@/services/publish";
import { fetchEventsOnce } from "@/services/relayQuery";
import { AppError } from "@/services/errors";
import { relayHttpUrl } from "@/app/config";
import { buildNip98AuthHeader } from "@/services/nip98";
import {
  buildBanEvent,
  buildReportEvent,
  buildResolveReportEvent,
  buildTimeoutEvent,
  buildUnbanEvent,
  buildUntimeoutEvent,
  statusForAction,
  type ReportType,
  type ResolutionAction,
} from "@/protocol/moderation";
import { buildRemoveUserEvent } from "@/protocol/membership";
import {
  canBanOrTimeout,
  canResolveReport,
  canUnbanOrUntimeout,
} from "@/features/community-members/permissions";
import type { RelayMemberRole } from "@/protocol/relayMembers";
import type {
  CommunityRestriction,
  ModerationActionRecord,
  ModerationReportSummary,
} from "@/types/domain";

type RawReport = {
  id: string;
  report_event_id: string;
  reporter_pubkey: string;
  target_kind: "event" | "pubkey" | "blob";
  target: string;
  channel_id: string | null;
  report_type: string;
  note: string | null;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  action_id: string | null;
  created_at: string;
};

type RawAction = {
  id: string;
  actor_pubkey: string;
  action: string;
  target_pubkey: string | null;
  target_event_id: string | null;
  channel_id: string | null;
  reason_code: string | null;
  public_reason: string | null;
  private_reason: string | null;
  created_at: string;
};

type RawRestriction = {
  pubkey: string;
  banned: boolean;
  ban_expires_at: string | null;
  ban_reason: string | null;
  muted_until: string | null;
  mute_reason: string | null;
  actor_pubkey: string;
  updated_at: string;
};

function toReport(r: RawReport): ModerationReportSummary {
  return {
    id: r.id,
    reportEventId: r.report_event_id,
    reporterPubkey: r.reporter_pubkey,
    targetKind: r.target_kind,
    target: r.target,
    channelId: r.channel_id,
    reportType: r.report_type,
    note: r.note,
    status: r.status,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at,
    actionId: r.action_id,
    createdAt: r.created_at,
  };
}

function toAction(a: RawAction): ModerationActionRecord {
  return {
    id: a.id,
    actorPubkey: a.actor_pubkey,
    action: a.action,
    targetPubkey: a.target_pubkey,
    targetEventId: a.target_event_id,
    channelId: a.channel_id,
    reasonCode: a.reason_code,
    publicReason: a.public_reason,
    privateReason: a.private_reason,
    createdAt: a.created_at,
  };
}

function toRestriction(b: RawRestriction): CommunityRestriction {
  return {
    pubkey: b.pubkey,
    banned: b.banned,
    banExpiresAt: b.ban_expires_at,
    banReason: b.ban_reason,
    mutedUntil: b.muted_until,
    muteReason: b.mute_reason,
    actorPubkey: b.actor_pubkey,
    updatedAt: b.updated_at,
  };
}

class ModerationService {
  async submitReport(params: {
    authorPubkey: string;
    eventId: string;
    reportType: ReportType;
    note?: string;
  }): Promise<void> {
    await signAndPublish(buildReportEvent(params));
  }

  async banMember(params: {
    pubkey: string;
    targetRole: RelayMemberRole | null;
    actingRole: RelayMemberRole | null;
    expiresAt?: number;
    reason?: string;
  }): Promise<void> {
    if (!canBanOrTimeout(params.actingRole, params.targetRole)) {
      throw new AppError("permission_denied", "You don't have permission to do that.");
    }
    await signAndPublish(buildBanEvent(params));
  }

  async unbanMember(params: { pubkey: string; actingRole: RelayMemberRole | null }): Promise<void> {
    if (!canUnbanOrUntimeout(params.actingRole)) {
      throw new AppError("permission_denied", "You don't have permission to do that.");
    }
    await signAndPublish(buildUnbanEvent(params.pubkey));
  }

  async timeoutMember(params: {
    pubkey: string;
    targetRole: RelayMemberRole | null;
    actingRole: RelayMemberRole | null;
    expiresAt: number;
    reason?: string;
  }): Promise<void> {
    if (!canBanOrTimeout(params.actingRole, params.targetRole)) {
      throw new AppError("permission_denied", "You don't have permission to do that.");
    }
    await signAndPublish(buildTimeoutEvent(params));
  }

  async untimeoutMember(params: {
    pubkey: string;
    actingRole: RelayMemberRole | null;
  }): Promise<void> {
    if (!canUnbanOrUntimeout(params.actingRole)) {
      throw new AppError("permission_denied", "You don't have permission to do that.");
    }
    await signAndPublish(buildUntimeoutEvent(params.pubkey));
  }

  /**
   * Kick a member from a specific channel — kind:9001 (NIP-29 remove-user).
   * NOTE (documented deviation, see docs/BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md §3):
   * in the reference Buzz, kick is gated by the target channel's own role
   * roster, not the community role plane — this queue instead gates it by
   * community owner/admin, since the moderation queue may reference a
   * channel the acting moderator doesn't hold an elevated role in. Revisit
   * if/when channel-level roles are modeled in SWF Buzz.
   */
  async kickFromChannel(params: {
    channelId: string;
    pubkey: string;
    actingRole: RelayMemberRole | null;
  }): Promise<void> {
    if (!canResolveReport(params.actingRole)) {
      throw new AppError("permission_denied", "You don't have permission to do that.");
    }
    await signAndPublish(buildRemoveUserEvent({ channelId: params.channelId, pubkey: params.pubkey }));
  }

  async resolveReport(params: {
    reportEventId: string;
    action: ResolutionAction;
    actingRole: RelayMemberRole | null;
    reason?: string;
  }): Promise<void> {
    if (!canResolveReport(params.actingRole)) {
      throw new AppError("permission_denied", "You don't have permission to do that.");
    }
    await signAndPublish(
      buildResolveReportEvent({
        reportEventId: params.reportEventId,
        status: statusForAction(params.action),
        action: params.action,
        reason: params.reason,
      }),
    );
  }

  /**
   * The reported author's pubkey. For a `pubkey`-kind report the target IS
   * the pubkey; for an `event`-kind report, the original kind:1984 report
   * event's own `p` tag (NIP-56) names the reported author — fetch it once.
   * Returns `null` for `blob`-kind reports (no author to act against).
   */
  async resolveReportAuthorPubkey(report: ModerationReportSummary): Promise<string | null> {
    if (report.targetKind === "pubkey") return report.target;
    if (report.targetKind === "blob") return null;
    const [reportEvent] = await fetchEventsOnce([{ ids: [report.reportEventId] }], {
      timeoutMs: 5000,
    });
    return reportEvent?.tags.find((tag) => tag[0] === "p")?.[1] ?? null;
  }

  private async moderationGet<T>(pathWithQuery: string): Promise<T> {
    const url = `${relayHttpUrl()}${pathWithQuery}`;
    const authorization = await buildNip98AuthHeader(url, "GET");
    const response = await fetch(url, { headers: { Authorization: authorization } });
    if (!response.ok) {
      if (response.status === 403) {
        throw new AppError("permission_denied", "You don't have permission to do that.");
      }
      throw new AppError("network", "Can't reach the server right now. Check your connection and try again.");
    }
    return (await response.json()) as T;
  }

  /** `GET /moderation/reports` — mod-authz gated relay-side; ordinary members get 403. */
  async listReports(options?: { status?: string; limit?: number }): Promise<ModerationReportSummary[]> {
    const params = new URLSearchParams();
    if (options?.limit != null) params.set("limit", String(options.limit));
    if (options?.status) params.set("status", options.status);
    const query = params.toString();
    const rows = await this.moderationGet<RawReport[]>(
      query ? `/moderation/reports?${query}` : "/moderation/reports",
    );
    return rows.map(toReport);
  }

  /** `GET /moderation/audit`, newest-first. Mod-authz gated. */
  async listAuditActions(limit?: number): Promise<ModerationActionRecord[]> {
    const query = limit != null ? `?limit=${limit}` : "";
    const rows = await this.moderationGet<RawAction[]>(`/moderation/audit${query}`);
    return rows.map(toAction);
  }

  /** `GET /moderation/restricted` — currently-active bans/timeouts. Mod-authz gated. */
  async listRestrictions(): Promise<CommunityRestriction[]> {
    const rows = await this.moderationGet<RawRestriction[]>("/moderation/restricted");
    return rows.map(toRestriction);
  }
}

export const moderationService = new ModerationService();
